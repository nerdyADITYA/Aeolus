"""End-to-end API test: set a site, poll the job, read forecasts/reports, switch turbines, run a date forecast, compare.

No network: the archive download and the Previous Runs API are replaced by fakes. Tiny model grids keep it to about a minute.
The tests are ordered (the module fixture builds the site once); the failure-path test runs last on purpose.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import requests
from fastapi.testclient import TestClient

from app.config import settings
from app.core import artifacts as art
from app.core.jobs import runner
from app.services import compare_service as cs
from app.services import data_service as ds
from app.services import pipeline_service as pl
from app.services.sarimax_service import SARIMAX_GRID

N = 2600


def synthetic_raw(n=N, seed=3) -> ds.RawResult:
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    ar = np.zeros(n)
    for i in range(1, n):
        ar[i] = 0.9 * ar[i - 1] + rng.normal(0, 0.4)
    df = pd.DataFrame({
        "timestamp_utc": pd.date_range("2025-01-01", periods=n, freq="h"),
        "wind_speed_100m": np.clip(5 + 1.5 * np.sin(2 * np.pi * t / 24) + ar, 0.2, None),
        "wind_direction_100m": (70 + 25 * np.sin(2 * np.pi * t / 120) + rng.normal(0, 8, n)) % 360,
        "wind_speed_10m": 2.5 + 0.3 * ar, "wind_direction_10m": 70.0, "temperature_2m": 26 + 3 * np.sin(2 * np.pi * t / 24),
        "surface_pressure": 1008 + rng.normal(0, 1, n), "relative_humidity_2m": 55.0, "cloud_cover": 10.0})
    units = {v: "x" for v in ds.HOURLY_VARS} | {"wind_speed_100m": "m/s", "wind_direction_100m": ds.DEGREE_SIGN}
    meta = {"latitude": 23.0228, "longitude": 72.6019, "elevation": 53.0, "timezone": "GMT", "hourly_units": units}
    return ds.RawResult(df=df, meta=meta, params={"fake": True})


def fake_previous_runs(lat, lon, start, end, http=None, timeout=0):
    """API forecast = observed + 0.3 m/s bias, so the API is expected to be closer than the model."""
    clean = art.load_clean()
    idx = pd.date_range(start, pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h", name="timestamp_utc")
    obs = clean.reindex(idx)
    return pd.DataFrame({"api_speed": obs.ws + 0.3, "api_dir": obs.wind_direction_deg}, index=idx).dropna()


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    root = tmp_path_factory.mktemp("wk")
    mp.setattr(settings, "data_dir", root / "data")
    mp.setattr(settings, "models_dir", root / "models")
    mp.setattr(settings, "reports_dir", root / "reports")
    for k, v in dict(val_days=15, test_days=10, refit_days=5, min_history_hours=1000, rate_limit_per_min=0).items():
        mp.setattr(settings, k, v)
    mp.setitem(pl.TUNING, "sarimax_grid", {k: SARIMAX_GRID[k] for k in ("(1,0,1) none", "(1,0,0)x(1,0,0,24)")})
    mp.setitem(pl.TUNING, "gbm_grid", {"small": dict(n=15, lr=0.2, leaves=4, mcs=20)})
    mp.setattr(ds, "fetch_raw", lambda *a, **k: synthetic_raw())
    mp.setattr(cs, "fetch_previous_runs", fake_previous_runs)
    with TestClient(app_under_test()) as c:
        yield c
    mp.undo()


def app_under_test():
    from app.main import app
    return app


def wait(client, job_id, timeout=240):
    status = runner.wait(job_id, timeout=timeout)
    return status, client.get(f"/api/jobs/{job_id}").json()


# ------------------------------------------------------------------ before any site exists
def test_no_site_yet(client):
    assert client.get("/api/site").json() == {"configured": False}
    r = client.get("/api/site/forecast")
    assert r.status_code == 404 and "PUT /api/site" in r.json()["hint"]
    assert client.get("/api/jobs/nope").status_code == 404


def test_input_validation(client):
    assert client.put("/api/site", json={"latitude": 123, "longitude": 10}).status_code == 422
    assert client.put("/api/site", json={"latitude": 10, "longitude": 200}).status_code == 422
    assert client.put("/api/site", json={"latitude": 10, "longitude": 10, "local_tz": "Mars/Base"}).status_code == 422
    r = client.put("/api/site", json={"latitude": 10, "longitude": 10, "turbine_name": "nope_9000"})
    assert r.status_code == 422 and "GET /api/turbines" in r.json()["hint"]
    assert client.get("/api/site").json() == {"configured": False}          # nothing was created


# ------------------------------------------------------------------ setup job
@pytest.fixture(scope="module")
def site_ready(client):
    r = client.put("/api/site", json={"latitude": 23.0225, "longitude": 72.5714, "name": "Test site"})
    assert r.status_code == 202
    body = r.json()
    job_id = body["job"]["id"]
    assert body["site"]["status"] == "preparing"
    # a second request while the job runs is refused, and so is changing the site
    assert client.put("/api/site", json={"latitude": 1, "longitude": 1}).status_code == 409
    assert client.post("/api/site/forecast", json={}).status_code == 409           # site still preparing
    status, job = wait(client, job_id)
    assert status == "done", job
    return job


def test_setup_job_finished_with_model_selection(client, site_ready):
    assert site_ready["progress"] == 1.0 and site_ready["result"]["model"] == "LightGBM"
    assert site_ready["result"]["latest_origin_utc"].startswith("2025-04-19")      # last synthetic hour


def test_site_status_and_forecast_dates(client, site_ready):
    s = client.get("/api/site").json()
    assert s["status"] == "ready" and s["dataset"]["rows"] == N and s["model"]["name"] == "LightGBM"
    assert 0.1 <= s["yaw"]["direction_conf_min"] <= 0.95 and s["active_job_id"] is None
    fd = s["forecast_dates"]
    assert fd["earliest_date"] and fd["latest_date"] and fd["earliest_date"] < fd["latest_date"]
    assert len(s["forecast_origins_cached"]) == 1


def test_latest_forecast_payload(client, site_ready):
    f = client.get("/api/site/forecast").json()
    assert len(f["hours"]) == 24 and len(f["history"]) == 48
    h = f["hours"][0]
    for k in ("timestamp_utc", "timestamp_local", "lead_h", "pred_speed_100m_ms", "pred_direction_deg", "direction_confidence",
              "direction_reliable", "recommended_nacelle_heading_deg", "yaw_note", "pred_speed_hub_ms", "power_kw", "energy_kwh"):
        assert k in h
    assert all(0 <= x["direction_confidence"] <= 1 for x in f["hours"])
    assert np.isclose(f["summary"]["total_kwh"], sum(x["energy_kwh"] for x in f["hours"]))
    assert f["turbine"]["name"] == "2023NREL_Bespoke_3.3MW_148" and f["limitations"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", h["timestamp_utc"])


def test_switching_turbine_and_heading_needs_no_retraining(client, site_ready):
    before = client.get("/api/site/forecast").json()
    assert client.patch("/api/site", json={"turbine_name": "nope"}).status_code == 422
    assert client.patch("/api/site", json={"nacelle_heading": 400}).status_code == 422
    r = client.patch("/api/site", json={"turbine_name": "IEA_Reference_3.4MW_130", "nacelle_heading": 90, "yaw_deadband_deg": 5})
    assert r.status_code == 200 and r.json()["turbine"]["name"] == "IEA_Reference_3.4MW_130"
    assert client.get("/api/site").json()["active_job_id"] is None                  # no job was started
    after = client.get("/api/site/forecast").json()
    assert [h["pred_speed_100m_ms"] for h in after["hours"]] == [h["pred_speed_100m_ms"] for h in before["hours"]]   # same model output
    assert after["summary"]["total_kwh"] != before["summary"]["total_kwh"]          # different turbine curve
    assert "yaw_change_from_current_deg" in after["hours"][0]
    client.patch("/api/site", json={"turbine_name": "2023NREL_Bespoke_3.3MW_148", "clear_nacelle_heading": True})
    again = client.get("/api/site/forecast").json()
    assert again["summary"]["total_kwh"] == before["summary"]["total_kwh"]


def test_forecast_for_a_chosen_date(client, site_ready):
    data = art.load_clean()
    day = str(data.index[2000].date())
    r = client.get("/api/site/forecast", params={"origin": day})
    assert r.status_code == 404 and "POST /api/site/forecast" in r.json()["hint"]
    assert client.post("/api/site/forecast", json={"origin": "2031-01-01"}).status_code == 422       # outside data: no job queued
    assert client.post("/api/site/forecast", json={"origin": str(data.index[300].date())}).status_code == 422   # too little history
    assert client.post("/api/site/forecast", json={"origin": "yesterday"}).status_code == 422
    r = client.post("/api/site/forecast", json={"origin": day})
    assert r.status_code == 202
    status, job = wait(client, r.json()["id"])
    assert status == "done", job
    f = client.get("/api/site/forecast", params={"origin": day}).json()
    assert f["hours"][0]["timestamp_utc"] == f"{day}T00:00:00Z"                    # a date forecasts that UTC day
    assert f["origin_utc"] == f"{pd.Timestamp(day) - pd.Timedelta(hours=1)}".replace(" ", " ")
    assert f["trained_through_utc"] == f["origin_utc"]                              # trained only up to the origin: out-of-sample
    assert len(client.get("/api/site").json()["forecast_origins_cached"]) == 2
    assert len([p for p in Path(settings.models_dir).iterdir() if p.is_dir()]) >= 1  # model bundle saved


def test_export_csv_and_json(client, site_ready):
    r = client.get("/api/site/export", params={"format": "csv"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert len(lines) == 25 and "energy_kwh" in lines[0] and "forecast_origin_utc" in lines[0]
    j = client.get("/api/site/export", params={"format": "json"}).json()
    assert len(j["predictions"]) == 24 and j["metadata"]["forecast_api_used_for_model_predictions"] is False
    assert client.get("/api/site/export", params={"origin": "2025-01-05"}).status_code in (404, 422)


def test_reports(client, site_ready):
    q = client.get("/api/site/data/quality").json()
    assert q["validation"]["duplicate_timestamps"] == 0 and q["feature_leakage_test"]["passed"] is True
    assert q["cleaning"]["rows"] == N
    h = client.get("/api/site/data/history", params={"days": 3}).json()
    assert len(h["hours"]) == 72
    rep = client.get("/api/site/models/report").json()
    assert [r["model"] for r in rep["test_table"]] == ["Persistence", "Seasonal naive (24h)", "SARIMAX", "LightGBM"]
    assert all(len(v) == 24 for v in rep["by_lead"].values())
    assert {r["target"] for r in rep["selection"]} == {"speed", "direction"} and rep["criteria"]
    assert rep["energy_error_proxy"]["rows"] and "NOT accuracy" in rep["energy_error_proxy"]["note"]
    d = client.get("/api/site/models/direction").json()
    assert set(d) >= {"conf_min", "sweep", "by_confidence", "by_speed", "summary", "corr_R_error"}


def test_turbine_endpoints(client):
    lst = client.get("/api/turbines").json()
    assert any(t["name"] == "2023NREL_Bespoke_3.3MW_148" and t["usable"] for t in lst)
    c = client.get("/api/turbines/2023NREL_Bespoke_3.3MW_148/curve").json()
    assert c["turbine"]["rated_kw"] == 3300 and len(c["curve"]) > 50
    assert client.get("/api/turbines/nope/curve").status_code == 404
    assert client.get("/api/turbines", params={"group": "moon"}).status_code == 422


# ------------------------------------------------------------------ comparison (fake Previous Runs API)
def test_compare_single_date_and_lead24(client, site_ready):
    data = art.load_clean()
    day = str(data.index[2000].date())
    c = client.get("/api/site/compare", params={"date": day}).json()
    assert c["mode"] == "single_forecast" and c["matched_hours"] == 24 and len(c["rows"]) == 24
    assert set(c["closer"]) == {"speed_MAE", "speed_RMSE", "dir_CMAE_all", "dir_CMAE_fast"}
    assert any("not ground truth" in n for n in c["notes"])
    r404 = client.get("/api/site/compare", params={"date": str(data.index[2300].date())})
    assert r404.status_code == 404 and "POST /api/site/forecast" in r404.json()["hint"]

    c = client.get("/api/site/compare").json()                                         # whole held-out period, lead 24 h
    ev = art.read_json("evaluation.json")
    assert c["mode"] == "lead24_heldout" and c["matched_hours"] == ev["split"]["test_origins"]
    assert c["api"]["speed_MAE"] == pytest.approx(0.3, abs=0.01)                     # the fake API is observed + 0.3
    assert c["model"]["hours"] == c["api"]["hours"] == c["persistence"]["hours"]
    assert c["speed_abs_err_diff_model_minus_api"]["verdict"] in ("API closer", "no significant difference", "model closer")
    assert c["daily"] and "heldout_period" in c
    assert client.get("/api/site/compare", params={"from": "2030-01-01", "to": "2030-01-05"}).status_code == 422
    assert client.get("/api/site/compare", params={"from": "2025-04-10", "to": "2025-04-01"}).status_code == 422
    assert client.get("/api/site/compare", params={"date": "22-10-2026"}).status_code == 422


def const_api(value=6.0):
    """A Previous Runs fake that has a forecast for ANY hours asked for (even ones with no observations)."""
    def fetch(lat, lon, start, end, http=None, timeout=0):
        idx = pd.date_range(start, pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h", name="timestamp_utc")
        return pd.DataFrame({"api_speed": value, "api_dir": 60.0}, index=idx)
    return fetch


def test_api_comparison_for_the_latest_forecast_needs_no_observations(client, site_ready, monkeypatch):
    monkeypatch.setattr(cs, "fetch_previous_runs", const_api(6.0))
    latest = client.get("/api/site/forecast").json()
    data = art.load_clean()
    assert pd.Timestamp(latest["origin_utc"]) >= data.index[-1]                        # the newest forecast: its hours have no observations yet
    r = client.get("/api/site/api-comparison")
    assert r.status_code == 200
    body = r.json()
    assert body["origin_utc"] == latest["origin_utc"] and body["matched_hours"] == 24 and len(body["hours"]) == 24
    assert [h["timestamp_utc"] for h in body["hours"]] == [h["timestamp_utc"] for h in latest["hours"]]    # the very same 24 hours
    assert all(h["api_speed"] == 6.0 for h in body["hours"])
    model = [h["pred_speed_100m_ms"] for h in latest["hours"]]
    assert [h["model_speed"] for h in body["hours"]] == pytest.approx(model, abs=1e-3)
    assert body["mean_abs_difference_ms"] == pytest.approx(float(np.mean(np.abs(np.array(model) - 6.0))), abs=2e-3)
    assert "Previous Runs" in body["api_source"] and any("does not say which one is right" in n for n in body["notes"])


def test_api_comparison_for_a_chosen_stored_date_and_for_missing_or_bad_input(client, site_ready, monkeypatch):
    monkeypatch.setattr(cs, "fetch_previous_runs", const_api(5.0))
    day = str(art.load_clean().index[2000].date())                                     # stored by an earlier test
    ok = client.get("/api/site/api-comparison", params={"origin": day})
    assert ok.status_code == 200 and ok.json()["hours"][0]["timestamp_utc"] == f"{day}T00:00:00Z"
    missing = client.get("/api/site/api-comparison", params={"origin": str(art.load_clean().index[2300].date())})
    assert missing.status_code == 404 and "POST /api/site/forecast" in missing.json()["hint"]
    assert client.get("/api/site/api-comparison", params={"origin": "tomorrow"}).status_code == 422


def test_api_comparison_reports_open_meteo_problems_without_breaking(client, site_ready, monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("no route to host")
    monkeypatch.setattr(cs, "fetch_previous_runs", boom)
    r = client.get("/api/site/api-comparison")
    assert r.status_code == 502 and "Forecast API request failed" in r.json()["detail"]
    monkeypatch.setattr(cs, "fetch_previous_runs", lambda *a, **k: pd.DataFrame({"api_speed": [], "api_dir": []}, index=pd.DatetimeIndex([], name="timestamp_utc")))
    empty = client.get("/api/site/api-comparison").json()
    assert empty["matched_hours"] == 0 and empty["mean_abs_difference_ms"] is None and "no forecast stored" in empty["message"]
    assert len(empty["hours"]) == 24 and all(h["model_speed"] is not None for h in empty["hours"])


def test_comparison_is_isolated_from_model_code():
    """Only compare_service may call a forecast service, and nothing else may import it except the reports router."""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    for f in app_dir.rglob("*.py"):
        text = f.read_text(encoding="utf-8")
        if f.name == "compare_service.py":
            continue
        assert "previous-runs-api" not in text and "open-meteo.com/v1/forecast" not in text, f"{f.name} calls a forecast service"
        if "compare_service" in text:
            assert f.name in ("reports.py", "main.py"), f"{f.name} imports compare_service"


# ------------------------------------------------------------------ misc
def test_refresh_marks_evaluation_stale(client, site_ready):
    r = client.post("/api/site/data/refresh")
    assert r.status_code == 202
    status, job = wait(client, r.json()["id"])
    assert status == "done" and job["result"]["rows"] == N
    assert client.get("/api/site").json()["evaluation_stale"] is True
    assert client.get("/api/site/models/report").json()["evaluation_stale"] is True
    assert len(client.get("/api/jobs", params={"limit": 3}).json()) == 3


def test_rate_limit_applies_to_changes_only(client, site_ready, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_min", 3)
    other = TestClient(client.app, client=("9.9.9.9", 5555))
    codes = [other.patch("/api/site", json={"yaw_deadband_deg": 99}).status_code for _ in range(5)]     # invalid body (422) still counts
    assert codes[:3] == [422, 422, 422] and codes[3:] == [429, 429]
    assert all(other.get("/api/health").status_code == 200 for _ in range(10))                    # reads are never limited


def test_zz_failed_setup_is_reported_and_blocks_reads(client, site_ready, monkeypatch):
    def boom(*a, **k):
        raise ds.DataValidationError("Archive download failed after 3 attempts: ConnectionError")
    monkeypatch.setattr(ds, "fetch_raw", boom)
    r = client.put("/api/site", json={"latitude": 23.0, "longitude": 72.0})
    assert r.status_code == 202
    status, job = wait(client, r.json()["job"]["id"], timeout=60)
    assert status == "failed" and "Archive download failed" in job["error"]
    s = client.get("/api/site").json()
    assert s["status"] == "error" and "Archive download failed" in s["status_message"]
    f = client.get("/api/site/forecast")
    assert f.status_code == 409 and "failed" in f.json()["detail"]
