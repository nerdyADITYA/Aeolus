"""Evaluation data model: chronological splits, forecast origins and realised-value matrices (notebook section 8).

An origin at position t may use data up to t; its H targets are t+1..t+H. All models are scored on the same origins.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.services.feature_service import build_features


@dataclass
class EvalConfig:
    forecast_hours: int = 24
    val_days: int = 90
    test_days: int = 150
    origin_step_h: int = 6
    refit_days: int = 30
    dir_min_speed: float = 3.0
    local_tz: str = "Asia/Kolkata"
    random_seed: int = 42
    leads_reported: tuple[int, ...] = (1, 6, 12, 24)
    sarimax_fit_days: int = 180
    sarimax_filter_days: int = 14


@dataclass
class EvalData:
    cfg: EvalConfig
    data: pd.DataFrame
    ws: np.ndarray
    sn: np.ndarray
    cs: np.ndarray
    X: np.ndarray
    feature_cols: list[str]
    Y: dict[str, np.ndarray]          # realised values at t+h        [t, h-1]
    S: dict[str, np.ndarray]          # seasonal-naive values t+h-24  [t, h-1]
    ok: np.ndarray                    # origin usable (all inputs/targets valid)
    val_start: int
    test_start: int
    val_origins: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    test_origins: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))

    @property
    def H(self) -> int:
        return self.cfg.forecast_hours

    @property
    def n(self) -> int:
        return len(self.data)

    @property
    def arrays(self) -> dict[str, np.ndarray]:
        return {"ws": self.ws, "sin": self.sn, "cos": self.cs}

    # ---------------------------------------------------------------------------------------- construction
    @classmethod
    def build(cls, data: pd.DataFrame, cfg: EvalConfig | None = None) -> "EvalData":
        cfg = cfg or EvalConfig()
        n, H = len(data), cfg.forecast_hours
        test_start = n - cfg.test_days * 24
        val_start = test_start - cfg.val_days * 24
        if val_start < 24 * 60:
            raise ValueError(f"Not enough history: {n} rows leave only {val_start} h for training "
                             f"(need at least {24 * 60}). Reduce val_days/test_days or fetch more years.")
        ws, sn, cs = (data.ws.to_numpy(), data.dir_sin.to_numpy(), data.dir_cos.to_numpy())
        feats = build_features(data, cfg.local_tz)
        Y = {"ws": _future_matrix(ws, H), "sin": _future_matrix(sn, H), "cos": _future_matrix(cs, H)}
        S = {"ws": _seasonal_matrix(ws, H), "sin": _seasonal_matrix(sn, H), "cos": _seasonal_matrix(cs, H)}
        ok = (~np.isnan(Y["ws"]).any(1) & ~np.isnan(Y["sin"]).any(1) & ~np.isnan(Y["cos"]).any(1)
              & ~np.isnan(S["ws"]).any(1) & ~np.isnan(S["sin"]).any(1)
              & ~np.isnan(ws) & ~np.isnan(sn) & ~np.isnan(cs))
        ed = cls(cfg=cfg, data=data, ws=ws, sn=sn, cs=cs, X=feats.to_numpy(dtype=float),
                 feature_cols=list(feats.columns), Y=Y, S=S, ok=ok, val_start=val_start, test_start=test_start)
        ed.val_origins = ed.origin_set(val_start, test_start - 1 - H)      # targets stay inside validation
        ed.test_origins = ed.origin_set(test_start, n - 1 - H)
        return ed

    def origin_set(self, lo: int, hi: int) -> np.ndarray:
        pos = np.arange(lo, hi + 1)
        pos = pos[(pos - lo) % self.cfg.origin_step_h == 0]
        return pos[self.ok[pos]]

    def split_summary(self) -> dict:
        d = self.data.index
        return {"train": [str(d[0]), str(d[self.val_start - 1])], "validation": [str(d[self.val_start]), str(d[self.test_start - 1])],
                "test": [str(d[self.test_start]), str(d[-1])],
                "val_origins": int(len(self.val_origins)), "test_origins": int(len(self.test_origins))}


def _future_matrix(a: np.ndarray, H: int) -> np.ndarray:
    n = len(a)
    M = np.full((n, H), np.nan)
    for h in range(1, H + 1):
        M[: n - h, h - 1] = a[h:]
    return M


def _seasonal_matrix(a: np.ndarray, H: int) -> np.ndarray:
    n = len(a)
    M = np.full((n, H), np.nan)
    for h in range(1, H + 1):
        k = 24 - h
        if k < n:
            M[k:, h - 1] = a[: n - k]
    return M
