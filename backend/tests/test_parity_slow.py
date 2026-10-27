"""Full-pipeline parity with wind_prediction_engine.ipynb (about 20 minutes). Run with:  pytest -m slow -s

Compares the backend's rolling-backtest metrics with outputs/backtest_summary.csv produced by the notebook on the same
cleaned dataset (outputs/clean_hourly_dataset.csv).
"""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services.eval_data import EvalConfig
from app.services.evaluation_service import run_evaluation

REPO = Path(__file__).resolve().parents[2]
CLEAN = REPO / "outputs" / "clean_hourly_dataset.csv"
SUMMARY = REPO / "outputs" / "backtest_summary.csv"

pytestmark = [pytest.mark.slow,
              pytest.mark.skipif(not (CLEAN.exists() and SUMMARY.exists()), reason="notebook outputs not present")]


@pytest.fixture(scope="module")
def result():
    data = pd.read_csv(CLEAN, index_col="timestamp_utc", parse_dates=True, float_precision="round_trip")   # exact floats: trees can flip on a last-digit change
    return run_evaluation(data, EvalConfig(), progress=lambda s, f: print(f"  [{f:4.0%}] {s}", flush=True))


def test_split_and_origin_counts(result):
    assert len(result.ed.test_origins) == 596


def test_chosen_configs_match_notebook(result):
    assert result.sarimax.best_speed == "(1,0,1)x(1,0,1,24) [orig]"
    assert result.sarimax.best_dir == "(1,0,1)x(1,0,1,24) [orig]"
    assert (result.gbm.speed_cfg, result.gbm.speed_delta, result.gbm.dir_cfg) == ("medium", False, "medium")


def test_test_metrics_match_notebook(result):
    nb = pd.read_csv(SUMMARY, index_col="model")
    got = result.test_table
    assert set(nb.index) == set(got.index)
    for model in nb.index:
        for col in nb.columns:
            # the notebook CSV is rounded to 4 decimals, so 6e-4 is the tightest meaningful tolerance
            assert abs(got.loc[model, col] - nb.loc[model, col]) <= 6e-4, (model, col, got.loc[model, col], nb.loc[model, col])


def test_selection_matches_notebook(result):
    assert result.selection.speed_winner == "LightGBM" and result.selection.dir_winner == "LightGBM"
    assert bool(result.selection.table.significantly_better.all())
    assert bool(result.selection.criteria.met.all())


# ------------------------------------------------------------------ Phase 3: forecast, yaw and energy vs the notebook's export
FORECAST_CSV = REPO / "outputs" / "wind_24_hour_predictions.csv"


@pytest.fixture(scope="module")
def forecast_run(tmp_path_factory):
    from app.core.registry import GbmSpec, load_bundle, save_bundle
    from app.services import forecast_service as fs
    from app.services.turbine_service import load_turbine

    data = pd.read_csv(CLEAN, index_col="timestamp_utc", parse_dates=True, float_precision="round_trip")
    p = {"medium": dict(n=250, lr=0.04, leaves=15, mcs=60)}
    spec = GbmSpec("medium", False, "medium", p)                         # configs the notebook chose on validation
    turbine = load_turbine("2023NREL_Bespoke_3.3MW_148")
    final, summ, bundle = fs.make_forecast(data, EvalConfig(), spec, turbine, conf_min=0.75, speed_min=3.0, deadband_deg=8.0)
    root = tmp_path_factory.mktemp("models")
    folder = save_bundle(bundle, root)
    reloaded = fs.predict_from_bundle(load_bundle(folder, root), data, bundle.cutoff_pos)
    return final, summ, reloaded


@pytest.mark.skipif(not FORECAST_CSV.exists(), reason="notebook forecast export not present")
def test_forecast_yaw_energy_match_notebook_export(forecast_run):
    final, summ, _ = forecast_run
    nb = pd.read_csv(FORECAST_CSV, index_col="timestamp_utc", parse_dates=True, float_precision="round_trip")
    assert (final.index == nb.index).all() and final.forecast_origin_utc.iloc[0] == nb.forecast_origin_utc.iloc[0]
    assert list(final.timestamp_local) == list(nb.timestamp_local) and list(final.lead_h) == list(nb.lead_h)
    assert np.allclose(final.pred_speed_100m_ms, nb.pred_speed_100m_ms, atol=6e-4)
    assert np.abs((final.pred_direction_deg.values - nb.pred_direction_deg.values + 180) % 360 - 180).max() < 6e-3
    assert np.allclose(final.direction_confidence, np.minimum(1.0, nb.direction_confidence), atol=6e-4)   # backend caps at 1
    assert (final.direction_reliable.values == nb.direction_reliable.values).all()
    assert np.allclose(final.recommended_nacelle_heading_deg, nb.recommended_nacelle_heading_deg, atol=6e-3, equal_nan=True)
    assert list(final.yaw_note) == list(nb.yaw_note)
    assert np.allclose(final.yaw_change_vs_prev_hour_deg, nb.yaw_change_vs_prev_hour_deg, atol=6e-3, equal_nan=True)
    assert np.allclose(final.power_kw, nb.power_kw, atol=0.02) and np.allclose(final.energy_kwh, nb.energy_kwh, atol=0.02)
    assert abs(summ["total_kwh"] - nb.energy_kwh.sum()) < 0.5


def test_saved_model_reproduces_the_forecast(forecast_run):
    final, _, reloaded = forecast_run
    assert np.allclose(final.pred_speed_100m_ms, reloaded.pred_speed_100m_ms)
    assert np.allclose(final.pred_direction_deg, reloaded.pred_direction_deg)
