import numpy as np
import pandas as pd
import pytest

from app.core.circular import circ_err, mean_res_len, signed_angle_difference, to_deg
from app.services import data_service as ds
from app.services.feature_service import build_features, check_no_lookahead


# ------------------------------------------------------------------ circular helpers
def test_circular_error_wraps():
    assert circ_err(359, 1) == 2
    assert circ_err(1, 359) == 2
    assert circ_err(0, 180) == 180
    assert np.allclose(circ_err([10, 350], [350, 10]), [20, 20])


def test_signed_difference_and_to_deg():
    assert signed_angle_difference(10, 350) == 20
    assert signed_angle_difference(350, 10) == -20
    assert np.isclose(to_deg(0.0, 1.0), 0.0)
    assert np.isclose(to_deg(1.0, 0.0), 90.0)
    assert np.isclose(to_deg(-1.0, 0.0), 270.0)


def test_confidence_is_capped_at_one():
    assert mean_res_len(0.9, 0.9) == 1.0       # hypot = 1.27 -> capped (notebook bug)
    assert np.isclose(mean_res_len(0.3, 0.4), 0.5)
    assert mean_res_len(0.0, 0.0) == 0.0


# ------------------------------------------------------------------ synthetic raw frame
def make_raw(n=800, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2025-01-01", periods=n, freq="h")
    t = np.arange(n)
    raw = pd.DataFrame({
        "timestamp_utc": idx,
        "wind_speed_100m": 5 + 2 * np.sin(2 * np.pi * t / 24) + rng.normal(0, .3, n),
        "wind_direction_100m": (60 + 30 * np.sin(2 * np.pi * t / 96) + rng.normal(0, 5, n)) % 360,
        "wind_speed_10m": 2.5 + rng.normal(0, .2, n), "wind_direction_10m": 60.0,
        "temperature_2m": 25.0 + rng.normal(0, 1, n), "surface_pressure": 1008.0 + rng.normal(0, 1, n),
        "relative_humidity_2m": 55.0 + rng.normal(0, 3, n), "cloud_cover": 10.0})
    return raw


def test_fill_short_gaps_only_fills_short_runs():
    s = pd.Series([1.0, np.nan, np.nan, 4.0, np.nan, np.nan, np.nan, np.nan, 9.0])
    out = ds.fill_short_gaps(s, 3)
    assert np.allclose(out[:4], [1, 2, 3, 4])           # 2-hour gap filled
    assert out[4:8].isna().all()                        # 4-hour gap untouched (not partially filled)


def test_clean_keeps_raw_unchanged_and_handles_dupes_gaps_and_wraparound():
    raw = make_raw()
    raw.loc[10, "wind_speed_100m"] = np.nan                    # 1 h gap -> interpolated
    raw.loc[100:105, "wind_speed_100m"] = np.nan               # 6 h gap -> stays NaN
    raw.loc[200, "wind_direction_100m"] = 360.0                # wraps to 0
    raw.loc[300, "wind_speed_100m"] = -4.0                     # impossible -> blanked, then interpolated
    raw = pd.concat([raw, raw.iloc[[50]]], ignore_index=True)  # duplicate timestamp at the end
    snapshot = raw.copy(deep=True)

    data = ds.clean_history(raw, max_gap=3)

    pd.testing.assert_frame_equal(raw, snapshot)                # raw untouched
    assert data.index.is_monotonic_increasing and data.index.is_unique
    assert data.index.freq is not None or (data.index.to_series().diff().dropna() == pd.Timedelta("1h")).all()
    assert not np.isnan(data.ws.iloc[10]) and data.was_interpolated.iloc[10]
    assert data.ws.iloc[100:106].isna().all()
    assert np.isclose(data.wind_direction_deg.iloc[200], raw.wind_direction_100m.iloc[200] % 360, atol=1e-6)
    assert data.ws.iloc[300] >= 0 and data.was_interpolated.iloc[300]
    assert np.allclose(np.hypot(data.dir_sin, data.dir_cos).dropna(), 1.0)      # unit vectors
    summary = ds.cleaning_summary(data)
    assert summary["remaining_missing_hours"] == 6 and summary["remaining_gaps"] == 1


def test_trailing_nulls_are_trimmed():
    raw = make_raw(300)
    raw.loc[290:, ["wind_speed_100m", "wind_direction_100m"]] = np.nan
    data = ds.clean_history(raw)
    assert data.index[-1] == raw.timestamp_utc.iloc[289]


def test_validate_raw_reports_and_rejects_wrong_units():
    raw = make_raw()
    raw.loc[5, "wind_speed_100m"] = np.nan
    meta = {"latitude": 23.0228, "longitude": 72.6019, "elevation": 53.0,
            "hourly_units": {**{v: "x" for v in ds.HOURLY_VARS},
                             "wind_speed_100m": "m/s", "wind_direction_100m": ds.DEGREE_SIGN}}
    rep = ds.validate_raw(raw, meta, 23.0225, 72.5714, now_utc=pd.Timestamp("2025-02-15"))
    assert rep["duplicate_timestamps"] == 0 and rep["null_counts"]["wind_speed_100m"] == 1
    assert rep["grid_cell_offset_km"] < 5 and 0 < rep["shear_alpha_10_to_100m"] < 1
    assert rep["stale"] is True                                   # data ends Feb 3, "now" is Feb 15 (> 7 days)
    fresh = ds.validate_raw(raw, meta, 23.0225, 72.5714, now_utc=pd.Timestamp("2025-02-05"))
    assert fresh["stale"] is False
    bad = {**meta, "hourly_units": {**meta["hourly_units"], "wind_speed_100m": "km/h"}}
    with pytest.raises(ds.DataValidationError):
        ds.validate_raw(raw, bad, 23.0225, 72.5714)


# ------------------------------------------------------------------ features
def test_features_have_no_lookahead_and_expected_columns():
    data = ds.clean_history(make_raw(900))
    assert check_no_lookahead(data, n=6) == 6
    f = build_features(data)
    for col in ("ws_lag0", "ws_lag24", "sin_lag6", "ws_mean24", "hour_sin", "doy_cos", "pres_d3", "dir_steadiness24"):
        assert col in f.columns
    assert f.ws_lag1.iloc[10] == data.ws.iloc[9]                  # lag direction is backwards


def test_leakage_check_catches_a_planted_leak(monkeypatch):
    data = ds.clean_history(make_raw(900))
    from app.services import feature_service as fs
    real = fs.build_features

    def leaky(d, tz="Asia/Kolkata"):
        f = real(d, tz)
        f["leak"] = d.ws.shift(-1)                                # uses the future
        return f
    monkeypatch.setattr(fs, "build_features", leaky)
    with pytest.raises(AssertionError):
        fs.check_no_lookahead(data, n=6)


def test_backtest_artifact_roundtrip_keeps_timestamps(tmp_path, monkeypatch):
    """Regression: origins were once saved as int64 and read back as 1970 dates (pandas 3 timestamp units)."""
    from app.config import settings
    from app.core import artifacts as art
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    origins = pd.date_range("2026-05-01 00:00", periods=5, freq="6h")
    z = np.zeros((5, 24))
    preds = {"A": {"ws": z, "sin": z, "cos": z}}
    art.save_backtest(origins, preds, {"ws": z, "sin": z, "cos": z}, ["A"])
    bt = art.load_backtest(["A"])
    assert (bt["origins"] == origins).all() and bt["origins"][0].year == 2026
    assert bt["models"]["A"]["ws"].shape == (5, 24)


def test_old_database_with_retired_profile_column_is_upgraded(tmp_path):
    """A database made while the Quick option existed has a NOT NULL site.profile column; opening it must drop that column."""
    import sqlite3
    from sqlalchemy import inspect
    from app.db import session as dbs
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE site (id INTEGER PRIMARY KEY, profile VARCHAR(16) NOT NULL)")
    con.execute("INSERT INTO site (id, profile) VALUES (1, 'quick')")
    con.commit(); con.close()
    dbs.init_db(path)
    cols = {c["name"] for c in inspect(dbs.engine).get_columns("site")}
    assert "profile" not in cols
    dbs.engine.dispose()
