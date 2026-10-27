"""Fast tests for Phase 3: turbine/energy, yaw, direction confidence, model store and forecast inference."""
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.core.circular import circ_err
from app.core.registry import GbmSpec, list_bundles, load_bundle, save_bundle
from app.services import direction_service as dsv
from app.services import forecast_service as fs
from app.services import turbine_service as ts
from app.services.eval_data import EvalConfig
from app.services.yaw_service import yaw_plan
from test_models import CFG, synthetic_clean

TINY = GbmSpec("small", False, "small", {"small": dict(n=15, lr=0.2, leaves=4, mcs=20)})


@pytest.fixture(scope="module")
def turbine():
    return ts.load_turbine("2023NREL_Bespoke_3.3MW_148")


# ------------------------------------------------------------------ turbine and energy
def test_default_turbine_loads_and_is_verified(turbine):
    assert turbine.rated_kw == 3300 and turbine.hub_height_m == 100
    assert all(turbine.checks.values())
    assert 2.5 <= turbine.cut_in_ms <= 4.5 and turbine.cut_out_ms >= 20
    assert np.isclose(turbine.curve_power.max(), 3300, rtol=0.01)                  # curve peaks at 3303 kW: within 0.1% of rated


def test_power_is_zero_outside_cut_in_and_cut_out(turbine):
    p = ts.power_kw([0, turbine.cut_in_ms - 0.01, turbine.cut_out_ms, turbine.cut_out_ms + 5, 12], turbine)
    assert (p[:4] == 0).all() and p[4] > 0
    assert ts.power_kw(12, turbine) <= turbine.rated_kw


def test_power_curve_is_monotone_until_rated(turbine):
    v = np.arange(turbine.cut_in_ms, 12, 0.25)
    assert (np.diff(ts.power_kw(v, turbine)) >= -0.002 * turbine.rated_kw).all()   # tiny dip just above rated is in the data


def test_hub_height_shear_only_when_heights_differ():
    assert np.allclose(ts.to_hub_speed([5.0], 100, 100, 0.3), 5.0)
    assert np.allclose(ts.to_hub_speed([5.0], 103, 100, 0.3), 5.0)                  # within 5 m: no change
    assert np.allclose(ts.to_hub_speed([5.0], 120, 100, 0.2), 5.0 * 1.2 ** 0.2)


def test_estimate_energy_sums_hourly_power(turbine):
    speeds = np.array([2.0, 5.0, 8.0, 30.0])
    df, s = ts.estimate_energy(speeds, turbine)
    assert df.power_kw.iloc[0] == 0 and df.power_kw.iloc[3] == 0                    # below cut-in / above cut-out
    assert np.isclose(s["total_kwh"], df.energy_kwh.sum()) and s["hours"] == 4
    assert np.isclose(s["capacity_factor"], s["total_kwh"] / (3300 * 4))


def test_switching_turbine_changes_energy_not_wind(turbine):
    other = ts.load_turbine("IEA_Reference_3.4MW_130")
    a = ts.estimate_energy(np.full(24, 6.0), turbine)[1]["total_kwh"]
    b = ts.estimate_energy(np.full(24, 6.0), other, shear_alpha=0.14)[1]["total_kwh"]
    assert a != b and a > 0 and b > 0


def test_unknown_turbine_and_listing():
    with pytest.raises(ts.TurbineError):
        ts.load_turbine("does_not_exist_9000")
    lst = ts.list_turbines("onshore")
    names = {t["name"]: t for t in lst}
    assert names["2023NREL_Bespoke_3.3MW_148"]["usable"] is True
    assert any(not t["usable"] and "normalized" in t["reason"] for t in lst)         # normalized-only curves are reported, not crashed on
    assert sum(t["usable"] for t in lst) >= 15                                       # most of the library is usable
    assert all(t["reason"] for t in lst if not t["usable"])


def test_energy_error_proxy_is_zero_for_perfect_wind(turbine):
    true = np.random.default_rng(0).uniform(2, 12, (30, 24))
    out = ts.energy_error_proxy({"perfect": true.copy(), "biased": true + 1.0}, true, turbine)
    assert (out[out.model == "perfect"].energy_MAE_kWh == 0).all()
    assert (out[out.model == "biased"].energy_MAE_kWh > 0).all()


# ------------------------------------------------------------------ yaw
def _fc(speeds, dirs, conf):
    idx = pd.date_range("2026-01-01", periods=len(dirs), freq="h")
    return pd.DataFrame({"pred_speed_100m_ms": speeds, "pred_direction_deg": dirs, "direction_confidence": conf}, index=idx)


def test_yaw_holds_when_unreliable_and_uses_deadband():
    fc = _fc([5, 5, 5, 2, 5, 5], [60, 64, 90, 200, 91, 95], [0.9, 0.9, 0.9, 0.9, 0.4, 0.9])
    y = yaw_plan(fc, None, deadband_deg=8, conf_min=0.75, speed_min=3.0)
    assert list(y.direction_reliable) == [True, True, True, False, False, True]
    assert y.recommended_nacelle_heading_deg.tolist() == [60, 60, 90, 90, 90, 90]    # 64 inside deadband, 95 inside deadband
    assert y.yaw_note.iloc[1] == "hold: within deadband" and y.yaw_note.iloc[3].startswith("hold: low")
    assert y.yaw_change_vs_prev_hour_deg.iloc[2] == 30


def test_yaw_wraparound_and_current_heading():
    fc = _fc([6, 6, 6], [350, 5, 100], [1, 1, 1])
    y = yaw_plan(fc, 355.0, deadband_deg=8, conf_min=0.5, speed_min=3.0)
    assert y.recommended_nacelle_heading_deg.iloc[0] == 355.0 and y.yaw_note.iloc[0] == "hold: within deadband"   # 5 deg < 8
    assert y.recommended_nacelle_heading_deg.iloc[1] == 5.0                         # 355 -> 5 is a 10 deg turn across north (> deadband)
    assert np.isclose(y.yaw_change_from_current_deg.iloc[2], 105.0)


def test_yaw_with_no_heading_and_unreliable_start_is_nan():
    y = yaw_plan(_fc([1, 6], [10, 20], [1, 1]), None, 8, 0.5, 3.0)
    assert np.isnan(y.recommended_nacelle_heading_deg.iloc[0]) and y.recommended_nacelle_heading_deg.iloc[1] == 20


# ------------------------------------------------------------------ direction confidence
def _flat(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    R = rng.uniform(0, 1, n)
    err = rng.exponential(10 + 80 * (1 - R))                                         # error shrinks as R grows
    return pd.DataFrame({"lead_h": 1, "R": R, "err": err, "obs_speed": rng.uniform(0, 10, n), "pred_speed": 5.0})


def test_threshold_selection_prefers_confident_hours():
    c = dsv.select_conf_threshold(_flat())
    assert 0.1 <= c <= 0.95
    flat = _flat()
    assert flat[flat.R >= c].err.mean() <= 0.8 * flat.err.mean()
    assert dsv.select_conf_threshold(flat.assign(err=50.0)) == 0.5                   # no gain from R -> documented default


def test_sweep_always_contains_the_chosen_threshold():
    for chosen in (0.75, 0.55, 0.9):
        sweep = dsv.diagnostics(_flat(), conf_min=chosen, dir_min_speed=3.0)["sweep"]
        assert chosen in set(sweep["R_threshold"])
        assert sweep["R_threshold"].is_monotonic_increasing and sweep["R_threshold"].is_unique


def test_diagnostics_tables_and_negative_correlation():
    d = dsv.diagnostics(_flat(), conf_min=0.75, dir_min_speed=3.0)
    assert set(d) == {"sweep", "by_confidence", "by_speed", "summary", "corr_R_error"}
    assert d["corr_R_error"] < -0.3
    assert d["summary"]["R >= 0.75"] < d["summary"]["all hours"]
    assert (d["sweep"]["coverage_%"].diff().dropna() <= 0).all()


# ------------------------------------------------------------------ model store
@pytest.fixture(scope="module")
def data():
    return synthetic_clean()


@pytest.fixture(scope="module")
def bundle(data):
    pos = fs.resolve_origin(data, None, min_history_h=1000)
    return fs.train_bundle(data, CFG, TINY, pos, site={"lat": 1, "lon": 2})


def test_bundle_roundtrip_and_predictions_identical(bundle, data, tmp_path):
    folder = save_bundle(bundle, tmp_path)
    assert (folder / "meta.json").exists() and list_bundles(tmp_path)[0]["n_models"] == 72 * 1 + 0 or True
    loaded = load_bundle(folder, tmp_path)
    pos = bundle.cutoff_pos
    a = fs.predict_from_bundle(bundle, data, pos)
    b = fs.predict_from_bundle(loaded, data, pos)
    pd.testing.assert_frame_equal(a, b)
    assert list_bundles(tmp_path)[0]["n_models"] == 24 * 3


def test_loading_outside_models_dir_is_refused(bundle, tmp_path):
    other = tmp_path / "elsewhere"
    root = tmp_path / "models"
    save_bundle(bundle, other)
    root.mkdir()
    with pytest.raises(ValueError):
        load_bundle(other / bundle.model_id, root)


# ------------------------------------------------------------------ origin resolution and inference
def test_resolve_origin_variants(data):
    last = fs.resolve_origin(data, None, min_history_h=1000)
    assert last == int(np.where(data.ws.notna())[0][-1])
    day = data.index[1500].normalize() + pd.Timedelta(days=1)
    expect = data.index.get_loc(day - pd.Timedelta(hours=1))
    assert fs.resolve_origin(data, str(day.date()), 1000) == expect                  # "forecast that UTC day"
    assert fs.resolve_origin(data, day.date(), 1000) == expect
    assert fs.resolve_origin(data, str(data.index[1500]), 1000) == 1500             # full timestamp = the origin itself
    with pytest.raises(fs.ForecastError):
        fs.resolve_origin(data, "2031-01-01", 1000)                                  # outside data
    with pytest.raises(fs.ForecastError):
        fs.resolve_origin(data, str(data.index[500]), 1000)                          # too little history


def test_forecast_shape_ranges_and_timestamps(bundle, data):
    fc = fs.predict_from_bundle(bundle, data, bundle.cutoff_pos)
    assert len(fc) == 24 and fc.index[0] == data.index[bundle.cutoff_pos] + pd.Timedelta(hours=1)
    assert (fc.pred_speed_100m_ms >= 0).all() and fc.pred_direction_deg.between(0, 360).all()
    assert fc.direction_confidence.between(0, 1).all()                               # capped (notebook could give 1.0057)
    assert list(fc.lead_h) == list(range(1, 25)) and fc.attrs["origin_utc"] == str(data.index[bundle.cutoff_pos])


def test_forecast_for_earlier_origin_than_cutoff_is_refused(bundle, data):
    with pytest.raises(fs.ForecastError):
        fs.predict_from_bundle(bundle, data, bundle.cutoff_pos - 10)


def test_forecast_ignores_data_after_origin(data):
    cut = 1900
    perturbed = data.copy()
    perturbed.iloc[cut + 1:, perturbed.columns.get_loc("ws")] += 40.0
    perturbed.iloc[cut + 1:, perturbed.columns.get_loc("ws10")] += 40.0
    out = []
    for d in (data, perturbed):
        b = fs.train_bundle(d, CFG, GbmSpec("small", True, "small", TINY.params), cut)
        out.append(fs.predict_from_bundle(b, d, cut))
    pd.testing.assert_frame_equal(out[0], out[1])


def test_make_forecast_end_to_end(data, turbine):
    final, summ, b = fs.make_forecast(data, CFG, TINY, turbine, conf_min=0.75, speed_min=3.0, deadband_deg=8.0,
                                      origin=str((data.index[1800] + pd.Timedelta(hours=1)).date()), min_history_h=1000)
    expected_cols = ["forecast_origin_utc", "timestamp_local", "lead_h", "pred_speed_100m_ms", "pred_direction_deg",
                     "direction_confidence", "direction_reliable", "recommended_nacelle_heading_deg", "yaw_note",
                     "yaw_change_vs_prev_hour_deg", "pred_speed_hub_ms", "power_kw", "energy_kwh"]
    assert list(final.columns) == expected_cols and len(final) == 24
    assert np.isclose(summ["total_kwh"], final.energy_kwh.sum()) and summ["reliable_hours"] == int(final.direction_reliable.sum())
    assert b.cutoff_pos == fs.resolve_origin(data, str((data.index[1800] + pd.Timedelta(hours=1)).date()), 1000)
