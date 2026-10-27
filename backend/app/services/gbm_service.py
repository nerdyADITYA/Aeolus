"""Gradient-boosted trees, direct multi-step forecasting (notebook sections 12-13, Phases 4-5).

Strategy: a separate model per lead h = 1..H and per target (speed, sin, cos). Features at the origin, target = value at
t+h. No recursive feedback.

No future data: a model trained with knowledge up to cutoff c only sees rows with origin + h <= c (the target must
already be observed). In the rolling backtest the model is retrained on an expanding window every `refit_days` and used
only for origins after its cutoff.
"""
from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

from app.core.circular import circ_err, to_deg
from app.core.metrics import Pred
from app.services.eval_data import EvalData

GBM_GRID = {"small": dict(n=200, lr=0.05, leaves=7, mcs=100),
            "medium": dict(n=250, lr=0.04, leaves=15, mcs=60),
            "large": dict(n=300, lr=0.03, leaves=31, mcs=40)}


def gbm_backend() -> str:
    if importlib.util.find_spec("lightgbm"):
        return "lightgbm"
    if importlib.util.find_spec("xgboost"):
        return "xgboost"
    return "sklearn-hist"


def model_name() -> str:
    return {"lightgbm": "LightGBM", "xgboost": "XGBoost"}.get(gbm_backend(), "HistGradientBoosting")


def make_gbm(p: dict, seed: int = 42):
    backend = gbm_backend()
    if backend == "lightgbm":
        import lightgbm as lgb
        return lgb.LGBMRegressor(n_estimators=p["n"], learning_rate=p["lr"], num_leaves=p["leaves"],
                                 min_child_samples=p["mcs"], subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                                 reg_lambda=1.0, random_state=seed, verbose=-1, n_jobs=-1)
    if backend == "xgboost":
        import xgboost as xgb
        return xgb.XGBRegressor(n_estimators=p["n"], learning_rate=p["lr"], max_depth=max(2, int(np.log2(p["leaves"]))),
                                subsample=0.8, colsample_bytree=0.8, random_state=seed, n_jobs=-1)
    from sklearn.ensemble import HistGradientBoostingRegressor
    return HistGradientBoostingRegressor(max_iter=p["n"], learning_rate=p["lr"], max_leaf_nodes=p["leaves"], random_state=seed)


def training_rows(cutoff: int, h: int) -> np.ndarray:
    """Origins usable for lead h when knowledge ends at `cutoff`: origin + h <= cutoff."""
    return np.arange(0, cutoff - h + 1)


def fit_gbm_set(ed: EvalData, cutoff: int, targets, p: dict, speed_delta: bool, seed: int = 42) -> dict:
    models = {}
    for k in targets:
        arr = ed.arrays[k]
        for h in range(1, ed.H + 1):
            rows = training_rows(cutoff, h)
            y = arr[rows + h]
            if k == "ws" and speed_delta:
                y = y - ed.ws[rows]
            good = ~np.isnan(y) & ~np.isnan(ed.ws[rows])
            m = make_gbm(p, seed)
            m.fit(ed.X[rows[good]], y[good])
            models[(k, h)] = m
    return models


def predict_gbm_set(ed: EvalData, models: dict, origins: np.ndarray, targets, speed_delta: bool) -> Pred:
    out: Pred = {}
    for k in targets:
        P = np.column_stack([models[(k, h)].predict(ed.X[origins]) for h in range(1, ed.H + 1)])
        if k == "ws":
            if speed_delta:
                P = P + ed.ws[origins][:, None]
            P = np.clip(P, 0, None)
        else:
            P = np.clip(P, -1, 1)
        out[k] = P
    return out


@dataclass
class GbmTuning:
    table: pd.DataFrame
    speed_cfg: str
    speed_delta: bool
    dir_cfg: str
    val_pred: Pred
    grid: dict


def tune_gbm(ed: EvalData, grid: dict | None = None, progress: Callable[[str, float], None] | None = None) -> GbmTuning:
    """Hyperparameters are chosen on the validation block only (models trained on data before it)."""
    grid = grid or GBM_GRID
    seed, rows = ed.cfg.random_seed, []
    gval: dict = {}
    yt = {k: ed.Y[k][ed.val_origins] for k in ("ws", "sin", "cos")}
    fast = yt["ws"] >= ed.cfg.dir_min_speed
    for i, (gname, p) in enumerate(grid.items()):
        for delta in (False, True):
            pr = predict_gbm_set(ed, fit_gbm_set(ed, ed.val_start - 1, ["ws"], p, delta, seed), ed.val_origins, ["ws"], delta)
            gval[("ws", gname, delta)] = pr["ws"]
            e = pr["ws"] - yt["ws"]
            rows.append({"target": "speed", "config": gname, "speed_delta": delta,
                         "val_RMSE": float(np.sqrt((e ** 2).mean())), "val_MAE": float(np.abs(e).mean())})
        pr = predict_gbm_set(ed, fit_gbm_set(ed, ed.val_start - 1, ["sin", "cos"], p, False, seed), ed.val_origins, ["sin", "cos"], False)
        gval[("dir", gname)] = pr
        err = circ_err(to_deg(pr["sin"], pr["cos"]), to_deg(yt["sin"], yt["cos"]))
        rows.append({"target": "direction", "config": gname, "speed_delta": np.nan, "val_RMSE": np.nan, "val_MAE": float(err[fast].mean())})
        if progress:
            progress(f"LightGBM tuning: {gname}", (i + 1) / len(grid))
    table = pd.DataFrame(rows)
    bs = table[table.target == "speed"].sort_values("val_RMSE").iloc[0]
    bd = table[table.target == "direction"].sort_values("val_MAE").iloc[0]
    speed_cfg, speed_delta, dir_cfg = bs.config, bool(bs.speed_delta), bd.config
    val_pred = {"ws": gval[("ws", speed_cfg, speed_delta)], **gval[("dir", dir_cfg)]}
    return GbmTuning(table, speed_cfg, speed_delta, dir_cfg, val_pred, grid)


def rolling_backtest_gbm(ed: EvalData, tuning: GbmTuning, progress: Callable[[str, float], None] | None = None) -> tuple[Pred, list[dict]]:
    """For each `refit_days` block of the test period: retrain on everything observed up to the block's first origin,
    then forecast H hours from every origin in the block."""
    seed, origins = ed.cfg.random_seed, ed.test_origins
    step = ed.cfg.refit_days * 24
    blocks, b = [], int(origins[0])
    while b <= origins[-1]:
        blocks.append((b, b + step))
        b += step
    pred = {k: np.zeros((len(origins), ed.H)) for k in ("ws", "sin", "cos")}
    log = []
    for i, (lo, hi) in enumerate(blocks):
        idx = np.where((origins >= lo) & (origins < hi))[0]
        if len(idx) == 0:
            continue
        cut = int(origins[idx[0]])
        m_ws = fit_gbm_set(ed, cut, ["ws"], tuning.grid[tuning.speed_cfg], tuning.speed_delta, seed)
        m_dir = fit_gbm_set(ed, cut, ["sin", "cos"], tuning.grid[tuning.dir_cfg], False, seed)
        pred["ws"][idx] = predict_gbm_set(ed, m_ws, origins[idx], ["ws"], tuning.speed_delta)["ws"]
        pd_ = predict_gbm_set(ed, m_dir, origins[idx], ["sin", "cos"], False)
        pred["sin"][idx], pred["cos"][idx] = pd_["sin"], pd_["cos"]
        log.append({"trained_through": str(ed.data.index[cut]), "n_origins_scored": int(len(idx))})
        if progress:
            progress(f"Rolling backtest block {i + 1}/{len(blocks)}", (i + 1) / len(blocks))
    return pred, log


def fit_final(ed: EvalData, tuning: GbmTuning, cutoff: int) -> dict:
    """Final models using all information up to `cutoff` (inclusive). Returns {"ws": models, "dir": models}."""
    seed = ed.cfg.random_seed
    return {"ws": fit_gbm_set(ed, cutoff, ["ws"], tuning.grid[tuning.speed_cfg], tuning.speed_delta, seed),
            "dir": fit_gbm_set(ed, cutoff, ["sin", "cos"], tuning.grid[tuning.dir_cfg], False, seed)}
