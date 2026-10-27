"""Feature engineering (notebook section 7, Phase 4).

Every feature in row t uses only observations at or before t (lags, trailing rolling windows, clock of the origin).
`check_no_lookahead` proves it by recomputing features from truncated data.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

LAGS = [0, 1, 3, 6, 12, 24]


def build_features(d: pd.DataFrame, local_tz: str = "Asia/Kolkata") -> pd.DataFrame:
    """`d` is the frame returned by data_service.clean_history()."""
    f = pd.DataFrame(index=d.index)
    for L in LAGS:
        f[f"ws_lag{L}"] = d.ws.shift(L)
        f[f"sin_lag{L}"] = d.dir_sin.shift(L)
        f[f"cos_lag{L}"] = d.dir_cos.shift(L)
    for w in (3, 6, 12, 24):
        f[f"ws_mean{w}"] = d.ws.rolling(w, min_periods=max(2, w // 2)).mean()
        f[f"ws_std{w}"] = d.ws.rolling(w, min_periods=max(2, w // 2)).std()
    for w in (6, 24):
        f[f"sin_mean{w}"] = d.dir_sin.rolling(w, min_periods=w // 2).mean()
        f[f"cos_mean{w}"] = d.dir_cos.rolling(w, min_periods=w // 2).mean()
    f["dir_steadiness24"] = np.hypot(f.sin_mean24, f.cos_mean24)      # 1 = steady direction
    f["ws_delta1"] = d.ws - d.ws.shift(1)
    f["ws_delta3"] = d.ws - d.ws.shift(3)
    f["ws_max24"] = d.ws.rolling(24, min_periods=12).max()

    loc = d.index.tz_localize("UTC").tz_convert(local_tz)             # cyclic clock of the forecast origin
    hr = loc.hour + loc.minute / 60
    doy = loc.dayofyear
    f["hour_sin"], f["hour_cos"] = np.sin(2 * np.pi * hr / 24), np.cos(2 * np.pi * hr / 24)
    f["doy_sin"], f["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)

    f["ws10"] = d.ws10
    f["ws_ratio_100_10"] = d.ws / d.ws10.clip(lower=0.5)
    f["temp"], f["temp_d24"] = d.temp, d.temp - d.temp.shift(24)
    f["pres"], f["pres_d3"], f["pres_d24"] = d.pres, d.pres - d.pres.shift(3), d.pres - d.pres.shift(24)
    f["rh"], f["cloud"] = d.rh, d.cloud
    return f


def check_no_lookahead(d: pd.DataFrame, local_tz: str = "Asia/Kolkata", n: int = 8, seed: int = 42,
                       min_pos: int = 300) -> int:
    """Raise AssertionError if any feature row changes when future data is removed. Returns number of rows checked."""
    full = build_features(d, local_tz)
    rng = np.random.default_rng(seed)
    hi = len(d) - 50
    if hi <= min_pos:
        raise ValueError("Series too short for a leakage check")
    for t in rng.choice(np.arange(min_pos, hi), n, replace=False):
        trunc = build_features(d.iloc[: t + 1], local_tz).iloc[-1]
        if not np.allclose(trunc.values.astype(float), full.iloc[t].values.astype(float), equal_nan=True):
            raise AssertionError(f"Look-ahead detected in features at position {t}")
    return n
