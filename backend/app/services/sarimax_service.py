"""SARIMAX benchmark (notebook section 11, Phase 3).

No leakage: parameters are estimated once on data ending BEFORE the scored block; at each origin the fitted model is
only *filtered* (`apply`, no refit) over the trailing window of observations up to that origin, then forecasts H hours.
Speed, sine and cosine each get their own SARIMAX with the same orders.
"""
from __future__ import annotations

import warnings
from typing import Callable

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

from app.core.metrics import Pred, score
from app.services.eval_data import EvalData

SARIMAX_GRID: dict[str, tuple[tuple[int, int, int], tuple[int, int, int, int]]] = {
    "(1,0,1) none": ((1, 0, 1), (0, 0, 0, 0)),
    "(2,0,1) none": ((2, 0, 1), (0, 0, 0, 0)),
    "(1,0,0)x(1,0,0,12)": ((1, 0, 0), (1, 0, 0, 12)),
    "(1,0,1)x(1,0,0,12)": ((1, 0, 1), (1, 0, 0, 12)),
    "(1,0,0)x(1,0,0,24)": ((1, 0, 0), (1, 0, 0, 24)),
    "(2,0,1)x(1,0,0,24)": ((2, 0, 1), (1, 0, 0, 24)),
    "(1,0,1)x(1,0,0,24)": ((1, 0, 1), (1, 0, 0, 24)),
    "(1,0,1)x(1,0,1,24) [orig]": ((1, 0, 1), (1, 0, 1, 24)),
}


def sarimax_fit(series: np.ndarray, cfg):
    order, seas = cfg
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        m = SARIMAX(series, order=order, seasonal_order=seas, trend="c",
                    enforce_stationarity=False, enforce_invertibility=False)
        return m.fit(disp=False, maxiter=80)


def sarimax_roll(ed: EvalData, fitted, arr: np.ndarray, origins: np.ndarray) -> np.ndarray:
    W = ed.cfg.sarimax_filter_days * 24
    out = np.empty((len(origins), ed.H))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for i, o in enumerate(origins):
            seg = arr[max(0, o - W + 1): o + 1]                  # only observations up to and including the origin
            out[i] = fitted.apply(seg, refit=False).forecast(ed.H)
    return out


def sarimax_predict(ed: EvalData, cfg, fit_end: int, origins: np.ndarray, targets=("ws", "sin", "cos")) -> Pred:
    """Estimate parameters on the window ending at `fit_end` (exclusive), then roll over `origins`."""
    out: Pred = {}
    for k in targets:
        arr = ed.arrays[k]
        fit_seg = arr[max(0, fit_end - ed.cfg.sarimax_fit_days * 24): fit_end]
        fit_seg = pd.Series(fit_seg).interpolate(limit_direction="both").to_numpy()
        out[k] = sarimax_roll(ed, sarimax_fit(fit_seg, cfg), arr, origins)
    if "ws" in out:
        out["ws"] = np.clip(out["ws"], 0, None)
    if "sin" in out:
        out["sin"], out["cos"] = np.clip(out["sin"], -1, 1), np.clip(out["cos"], -1, 1)
    return out


class SarimaxTuning:
    def __init__(self, table: pd.DataFrame, best_speed: str, best_dir: str, val_pred: Pred, grid):
        self.table, self.best_speed, self.best_dir, self.val_pred, self.grid = table, best_speed, best_dir, val_pred, grid


def tune_sarimax(ed: EvalData, grid=None, progress: Callable[[str, float], None] | None = None) -> SarimaxTuning:
    """Score every config on the validation block (parameters fitted on data ending at val_start)."""
    grid = grid or SARIMAX_GRID
    rows, preds = [], {}
    for i, (name, cfg) in enumerate(grid.items()):
        p = sarimax_predict(ed, cfg, ed.val_start, ed.val_origins)
        s = score(ed, p, ed.val_origins)
        preds[name] = p
        rows.append({"config": name, "val_speed_RMSE": s.speed_RMSE.mean(), "val_speed_MAE": s.speed_MAE.mean(),
                     "val_dir_CMAE_fast": s.dir_CMAE_fast.mean()})
        if progress:
            progress(f"SARIMAX tuning: {name}", (i + 1) / len(grid))
    table = pd.DataFrame(rows).set_index("config")
    best_speed, best_dir = table.val_speed_RMSE.idxmin(), table.val_dir_CMAE_fast.idxmin()
    val_pred = {"ws": preds[best_speed]["ws"], "sin": preds[best_dir]["sin"], "cos": preds[best_dir]["cos"]}
    return SarimaxTuning(table, best_speed, best_dir, val_pred, grid)


def backtest_sarimax(ed: EvalData, tuning: SarimaxTuning) -> Pred:
    """Held-out block: parameters fitted on data ending at test_start only."""
    sp = sarimax_predict(ed, tuning.grid[tuning.best_speed], ed.test_start, ed.test_origins, targets=("ws",))
    dp = sarimax_predict(ed, tuning.grid[tuning.best_dir], ed.test_start, ed.test_origins, targets=("sin", "cos"))
    return {"ws": sp["ws"], "sin": dp["sin"], "cos": dp["cos"]}
