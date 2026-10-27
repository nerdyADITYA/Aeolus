"""Forecast metrics (notebook "Evaluation helpers").

Speed: MAE and RMSE (m/s). Direction: circular absolute error in degrees, overall and for hours where the OBSERVED speed
is at least `dir_min_speed`. Everything is reported per lead time. `pred` is always {"ws", "sin", "cos"} -> (n_origins, H).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.circular import circ_err, to_deg
from app.services.eval_data import EvalData

Pred = dict[str, np.ndarray]


def score(ed: EvalData, pred: Pred, origins: np.ndarray) -> pd.DataFrame:
    """Per-lead metrics, index lead_h = 1..H."""
    H = ed.H
    yt = {k: ed.Y[k][origins] for k in ed.Y}
    e = pred["ws"] - yt["ws"]
    d_err = circ_err(to_deg(pred["sin"], pred["cos"]), to_deg(yt["sin"], yt["cos"]))
    fast = yt["ws"] >= ed.cfg.dir_min_speed
    return pd.DataFrame({
        "speed_MAE": np.abs(e).mean(0),
        "speed_RMSE": np.sqrt((e ** 2).mean(0)),
        "dir_CMAE_all": d_err.mean(0),
        "dir_CMAE_fast": [d_err[fast[:, h], h].mean() if fast[:, h].any() else np.nan for h in range(H)],
    }, index=pd.RangeIndex(1, H + 1, name="lead_h"))


def summarize(ed: EvalData, results: dict[str, Pred], origins: np.ndarray) -> pd.DataFrame:
    """One row per model: errors at the reported leads and averaged over leads 1..H."""
    leads = ed.cfg.leads_reported
    rows = []
    for name, pred in results.items():
        s = score(ed, pred, origins)
        row = {"model": name}
        for L in leads:
            row[f"MAE@{L}h"] = s.speed_MAE[L]
        for L in leads:
            row[f"RMSE@{L}h"] = s.speed_RMSE[L]
        row["MAE_1-24h"], row["RMSE_1-24h"] = s.speed_MAE.mean(), s.speed_RMSE.mean()
        for L in leads:
            row[f"dirMAE_fast@{L}h"] = s.dir_CMAE_fast[L]
        row["dirMAE_all_1-24h"], row["dirMAE_fast_1-24h"] = s.dir_CMAE_all.mean(), s.dir_CMAE_fast.mean()
        rows.append(row)
    return pd.DataFrame(rows).set_index("model")


def per_origin_error(ed: EvalData, pred: Pred, origins: np.ndarray, kind: str) -> np.ndarray:
    """Mean error per origin over the horizon (speed: MAE; direction: circular MAE on fast hours)."""
    if kind == "speed":
        return np.abs(pred["ws"] - ed.Y["ws"][origins]).mean(1)
    e = circ_err(to_deg(pred["sin"], pred["cos"]), to_deg(ed.Y["sin"][origins], ed.Y["cos"][origins]))
    fast = ed.Y["ws"][origins] >= ed.cfg.dir_min_speed
    return np.where(fast.sum(1) > 0, (e * fast).sum(1) / np.maximum(fast.sum(1), 1), np.nan)


def block_boot_ci(diff: np.ndarray, block: int = 4, nboot: int = 2000, seed: int = 42) -> tuple[float, float]:
    """95% moving-block bootstrap CI of the mean of `diff` (blocks respect autocorrelation between nearby origins)."""
    diff = np.asarray(diff, float)
    diff = diff[~np.isnan(diff)]
    rng = np.random.default_rng(seed)
    nb = int(np.ceil(len(diff) / block))
    starts = np.arange(0, len(diff) - block + 1)
    means = [np.concatenate([diff[s:s + block] for s in rng.choice(starts, nb)])[:len(diff)].mean() for _ in range(nboot)]
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(lo), float(hi)
