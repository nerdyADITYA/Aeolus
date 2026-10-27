"""Fast unit tests for the Phase 2 services on a small synthetic series (the full notebook parity run is test_parity_slow.py)."""
import numpy as np
import pandas as pd
import pytest

from app.core.circular import circ_err
from app.core.metrics import block_boot_ci, score, summarize
from app.services import baseline_service as bl
from app.services import gbm_service as gbm
from app.services import sarimax_service as sar
from app.services.data_service import clean_history
from app.services.eval_data import EvalConfig, EvalData
from app.services.evaluation_service import run_evaluation

CFG = EvalConfig(val_days=15, test_days=10, origin_step_h=6, refit_days=5, sarimax_fit_days=40, sarimax_filter_days=5)
TINY_GBM = {"small": dict(n=15, lr=0.2, leaves=4, mcs=20)}
TINY_SAR = {"(1,0,0) none": ((1, 0, 0), (0, 0, 0, 0)), "(1,0,0)x(1,0,0,24)": ((1, 0, 0), (1, 0, 0, 24))}


def synthetic_clean(n=2400, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    ar = np.zeros(n)
    for i in range(1, n):
        ar[i] = 0.9 * ar[i - 1] + rng.normal(0, 0.4)
    raw = pd.DataFrame({
        "timestamp_utc": pd.date_range("2025-01-01", periods=n, freq="h"),
        "wind_speed_100m": np.clip(5 + 1.5 * np.sin(2 * np.pi * t / 24) + ar, 0.2, None),
        "wind_direction_100m": (70 + 25 * np.sin(2 * np.pi * t / 120) + rng.normal(0, 8, n)) % 360,
        "wind_speed_10m": 2.5 + 0.3 * ar, "wind_direction_10m": 70.0, "temperature_2m": 26 + 3 * np.sin(2 * np.pi * t / 24),
        "surface_pressure": 1008 + rng.normal(0, 1, n), "relative_humidity_2m": 55.0, "cloud_cover": 10.0})
    return clean_history(raw)


@pytest.fixture(scope="module")
def ed():
    return EvalData.build(synthetic_clean(), CFG)


# ------------------------------------------------------------------ splits and origins
def test_splits_are_chronological_and_do_not_overlap(ed):
    assert ed.val_start < ed.test_start < ed.n
    assert len(ed.val_origins) > 20 and len(ed.test_origins) > 20
    assert ed.val_origins.max() + ed.H < ed.test_start            # validation targets never touch the test block
    assert ed.test_origins.min() >= ed.test_start and ed.test_origins.max() + ed.H <= ed.n - 1
    assert (np.diff(ed.test_origins) % CFG.origin_step_h == 0).all()
    assert not np.isnan(ed.Y["ws"][ed.test_origins]).any()


def test_too_little_history_is_rejected():
    with pytest.raises(ValueError):
        EvalData.build(synthetic_clean(1000), CFG)


# ------------------------------------------------------------------ baselines
def test_persistence_and_seasonal_naive_formulas(ed):
    o = ed.test_origins[:5]
    p = bl.persistence(ed, o)
    assert np.allclose(p["ws"], ed.ws[o][:, None])
    s = bl.seasonal_naive(ed, o)
    for i, t in enumerate(o):
        for h in range(1, ed.H + 1):
            assert s["ws"][i, h - 1] == ed.ws[t + h - 24]         # value 24 h before the target hour ...
            assert t + h - 24 <= t                                # ... which is never in the future of the origin


# ------------------------------------------------------------------ metrics
def test_perfect_forecast_has_zero_error_and_circular_wrap(ed):
    o = ed.test_origins
    perfect = {k: ed.Y[k][o].copy() for k in ("ws", "sin", "cos")}
    s = score(ed, perfect, o)
    assert np.allclose(s.speed_MAE, 0) and np.allclose(s.dir_CMAE_all, 0, atol=1e-6)
    rot = np.deg2rad(2.0)                                        # rotate every direction by 2 degrees -> 2 deg error everywhere
    a = np.arctan2(perfect["sin"], perfect["cos"]) + rot
    rotated = {"ws": perfect["ws"], "sin": np.sin(a), "cos": np.cos(a)}
    assert np.allclose(score(ed, rotated, o).dir_CMAE_all, 2.0, atol=1e-6)
    assert circ_err(359, 1) == 2


def test_block_bootstrap_ci():
    lo, hi = block_boot_ci(-np.ones(200) + np.random.default_rng(0).normal(0, .1, 200))
    assert hi < 0
    lo, hi = block_boot_ci(np.tile([1.0, -1.0, 2.0, -2.0, 0.5, -0.5], 70))      # exactly zero mean
    assert lo < 0 < hi


# ------------------------------------------------------------------ no future data in training
def test_training_rows_never_use_unobserved_targets():
    for cutoff in (500, 1234):
        for h in (1, 6, 24):
            rows = gbm.training_rows(cutoff, h)
            assert rows.max() + h == cutoff and rows.min() == 0


def test_gbm_fit_uses_only_rows_observed_by_cutoff(ed, monkeypatch):
    seen = []

    class Rec:
        def fit(self, X, y): seen.append(len(X)); return self
        def predict(self, X): return np.zeros(len(X))
    monkeypatch.setattr(gbm, "make_gbm", lambda p, seed=42: Rec())
    cutoff = 1700
    gbm.fit_gbm_set(ed, cutoff, ["ws"], TINY_GBM["small"], False)
    assert seen == [cutoff - h + 1 for h in range(1, ed.H + 1)]


def test_predictions_are_invariant_to_future_data():
    base = synthetic_clean()
    cut = 1900
    perturbed = base.copy()
    perturbed.iloc[cut + 1:, perturbed.columns.get_loc("ws")] += 50.0          # wildly different future
    perturbed.iloc[cut + 1:, perturbed.columns.get_loc("dir_sin")] = 1.0
    perturbed.iloc[cut + 1:, perturbed.columns.get_loc("dir_cos")] = 0.0
    e1, e2 = EvalData.build(base, CFG), EvalData.build(perturbed, CFG)
    o = np.array([cut])
    p = TINY_GBM["small"]
    for delta in (False, True):
        a = gbm.predict_gbm_set(e1, gbm.fit_gbm_set(e1, cut, ["ws"], p, delta), o, ["ws"], delta)["ws"]
        b = gbm.predict_gbm_set(e2, gbm.fit_gbm_set(e2, cut, ["ws"], p, delta), o, ["ws"], delta)["ws"]
        assert np.allclose(a, b), f"GBM forecast changed when future data changed (delta={delta})"
    cfg = TINY_SAR["(1,0,0)x(1,0,0,24)"]
    sa = sar.sarimax_predict(e1, cfg, cut, o, targets=("ws",))["ws"]
    sb = sar.sarimax_predict(e2, cfg, cut, o, targets=("ws",))["ws"]
    assert np.allclose(sa, sb), "SARIMAX forecast changed when future data changed"


# ------------------------------------------------------------------ end-to-end on the small series
def test_run_evaluation_end_to_end_small():
    stages = []
    res = run_evaluation(synthetic_clean(), CFG, sarimax_grid=TINY_SAR, gbm_grid=TINY_GBM,
                         progress=lambda s, f: stages.append(s))
    assert list(res.test_table.index) == [bl.PERSISTENCE, bl.SEASONAL_NAIVE, "SARIMAX", res.ml_name]
    for k in ("ws", "sin", "cos"):
        assert res.test_res[res.ml_name][k].shape == (len(res.ed.test_origins), 24)
    assert not np.isnan(res.test_res[res.ml_name]["ws"]).any() and (res.test_res[res.ml_name]["ws"] >= 0).all()
    assert (np.abs(res.test_res[res.ml_name]["sin"]) <= 1).all()
    assert len(res.refit_log) >= 2 and "Done" in stages
    assert set(res.selection.table.index) == {"speed", "direction"} and "Model-selection report" in res.report_md
    # the ML model should at least beat persistence on 24 h-ahead speed for a periodic, noisy series
    assert res.test_table.loc[res.ml_name, "MAE@24h"] < res.test_table.loc[bl.PERSISTENCE, "MAE@24h"] * 1.05
