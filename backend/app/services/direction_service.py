"""Direction confidence analysis (notebook section 17, Phase 6).

The model predicts sine and cosine separately; direction = atan2(sin, cos). The vector magnitude R = sqrt(sin^2 + cos^2)
(capped at 1) is a confidence proxy: when the components are small or cancel, direction is ill-defined. R and observed
speed are related to the realised circular error on held-out data, and the reliability threshold is chosen on VALIDATION.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.circular import circ_err, mean_res_len, to_deg
from app.core.metrics import Pred
from app.services.eval_data import EvalData

R_CANDIDATES = np.round(np.arange(0.1, 0.95, 0.05), 2)


def flat_errors(ed: EvalData, pred: Pred, origins: np.ndarray) -> pd.DataFrame:
    """One row per (origin, lead): confidence R, circular error, observed and predicted speed."""
    H = ed.H
    yt = {k: ed.Y[k][origins] for k in ("ws", "sin", "cos")}
    return pd.DataFrame({
        "lead_h": np.tile(np.arange(1, H + 1), len(origins)),
        "R": mean_res_len(pred["sin"], pred["cos"]).ravel(),
        "err": circ_err(to_deg(pred["sin"], pred["cos"]), to_deg(yt["sin"], yt["cos"])).ravel(),
        "obs_speed": yt["ws"].ravel(), "pred_speed": pred["ws"].ravel()})


def select_conf_threshold(dv: pd.DataFrame, min_coverage: float = 0.5, error_ratio: float = 0.8, default: float = 0.5) -> float:
    """Smallest R whose retained hours have error <= `error_ratio` x overall error while keeping >= `min_coverage` of hours."""
    overall = dv.err.mean()
    for c in R_CANDIDATES:
        kept = dv[dv.R >= c]
        if len(kept) / len(dv) >= min_coverage and kept.err.mean() <= error_ratio * overall:
            return float(c)
    return float(default)


def diagnostics(dt: pd.DataFrame, conf_min: float, dir_min_speed: float) -> dict:
    """Tables for the dashboard: threshold sweep, error by R bin, error by observed-speed bin, headline summary."""
    d = dt.copy()
    thresholds = sorted({float(c) for c in R_CANDIDATES[::2]} | {float(conf_min)})     # always include the chosen threshold
    sweep = pd.DataFrame([{"R_threshold": c, "coverage_%": 100 * float((d.R >= c).mean()),
                           "circ_MAE_kept_deg": float(d[d.R >= c].err.mean())} for c in thresholds])
    d["R_bin"] = pd.cut(d.R, [0, 0.2, 0.4, 0.6, 0.8, 1.0001], include_lowest=True)
    d["speed_bin"] = pd.cut(d.obs_speed, [0, 2, dir_min_speed, 5, 8, 100], include_lowest=True)
    by_r = d.groupby("R_bin", observed=True).err.agg(["count", "mean", "median"])
    by_speed = d.groupby("speed_bin", observed=True).err.agg(["count", "mean", "median"])
    fast = d.obs_speed >= dir_min_speed
    summary = {"all hours": d.err.mean(), f"obs speed >= {dir_min_speed} m/s": d[fast].err.mean(),
               f"R >= {conf_min}": d[d.R >= conf_min].err.mean(), "both": d[fast & (d.R >= conf_min)].err.mean()}
    return {"sweep": sweep, "by_confidence": by_r.reset_index().astype({"R_bin": str}),
            "by_speed": by_speed.reset_index().astype({"speed_bin": str}),
            "summary": {k: float(v) for k, v in summary.items()}, "corr_R_error": float(d.R.corr(d.err))}
