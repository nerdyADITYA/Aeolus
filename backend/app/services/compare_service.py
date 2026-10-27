"""Forecast API comparison (plan section 3.8). The ONLY module that talks to a forecast service.

Why Previous Runs: for past dates the regular Forecast API and the Historical Forecast API return values identical to the
archive (their recent 100 m values are the same model analysis), so comparing against them measures nothing. The Previous
Runs API stores the forecast actually issued the day before (`*_previous_day1`), which is a genuine forecast.

Rules: match by UTC timestamp (inner join); errors are always computed against OBSERVED values (never model vs API);
the API is never an input to training, features or inference. "Observed" is reanalysis from the same weather-model family
as the API, which structurally favours the API; this is a benchmark, not a site-sensor measurement.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import requests

from app.core.circular import circ_err, to_deg
from app.core.metrics import block_boot_ci

PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FAIRNESS_NOTES = [
    "Errors are measured against observed (reanalysis) values; the Forecast API is not ground truth.",
    "Observed values come from the same weather-model family as the API, which favours the API.",
    "The API forecast is the run issued the previous day; the model forecast never uses the Forecast API.",
    "A single date is anecdotal; use the multi-day option for conclusions.",
]


class CompareError(ValueError):
    """The comparison cannot be made (no data for the dates, outside the held-out period, ...)."""


def fetch_previous_runs(lat: float, lon: float, start: str, end: str, http=requests, timeout: int = 120) -> pd.DataFrame:
    """Day-ahead (previous_day1) 100 m speed/direction, UTC hourly, indexed by the hour being forecast."""
    r = http.get(PREVIOUS_RUNS_URL, params={
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end, "timezone": "UTC", "wind_speed_unit": "ms",
        "hourly": "wind_speed_100m_previous_day1,wind_direction_100m_previous_day1"}, timeout=timeout)
    r.raise_for_status()
    body = r.json()
    if "hourly" not in body:
        raise CompareError(f"Previous Runs API returned no data: {str(body)[:200]}")
    h = body["hourly"]
    return pd.DataFrame({"timestamp_utc": pd.to_datetime(h["time"]), "api_speed": h["wind_speed_100m_previous_day1"],
                         "api_dir": h["wind_direction_100m_previous_day1"]}).set_index("timestamp_utc")


def metrics(df: pd.DataFrame, speed_col: str, dir_col: str, dir_min_speed: float) -> dict[str, float]:
    e = df[speed_col] - df.obs_speed
    de = circ_err(df[dir_col], df.obs_dir)
    fast = df.obs_speed >= dir_min_speed
    return {"hours": int(len(df)), "speed_MAE": float(e.abs().mean()), "speed_RMSE": float(np.sqrt((e ** 2).mean())),
            "dir_CMAE_all": float(de.mean()), "dir_CMAE_fast": float(de[fast].mean()) if fast.any() else None}


def _closer(a: dict, b: dict) -> dict[str, str]:
    out = {}
    for k in ("speed_MAE", "speed_RMSE", "dir_CMAE_all", "dir_CMAE_fast"):
        if a.get(k) is None or b.get(k) is None:
            out[k] = "n/a"
        else:
            out[k] = "model" if a[k] < b[k] else "api" if b[k] < a[k] else "tie"
    return out


def compare_single_forecast(base_fc: pd.DataFrame, clean: pd.DataFrame, lat: float, lon: float, dir_min_speed: float,
                            fetch=fetch_previous_runs) -> dict[str, Any]:
    """One saved model forecast (leads 1-24 from its origin) vs the API's previous-day forecast vs observed, same timestamps."""
    start, end = str(base_fc.index.min().date()), str(base_fc.index.max().date())
    api = fetch(lat, lon, start, end)
    obs = pd.DataFrame({"obs_speed": clean.ws, "obs_dir": clean.wind_direction_deg}).loc[lambda d: d.index.isin(base_fc.index)]
    df = (base_fc[["pred_speed_100m_ms", "pred_direction_deg"]].rename(columns={"pred_speed_100m_ms": "model_speed", "pred_direction_deg": "model_dir"})
          .join(api, how="inner").join(obs, how="inner").dropna())
    res: dict[str, Any] = {"mode": "single_forecast", "origin_utc": base_fc.attrs.get("origin_utc"), "forecast_hours": int(len(base_fc)),
                           "matched_hours": int(len(df)), "notes": FAIRNESS_NOTES + [
                               "The model uses leads 1-24 h from its origin while the API forecast is the previous-day run (older information); "
                               "the multi-day lead-24 comparison is the like-for-like one."]}
    if df.empty:
        res.update(model=None, api=None, closer=None, rows=[],
                   message="No hours with API forecast and observations at matching timestamps yet (observations may not be available).")
        return res
    m, a = metrics(df, "model_speed", "model_dir", dir_min_speed), metrics(df, "api_speed", "api_dir", dir_min_speed)
    res.update(model=m, api=a, closer=_closer(m, a), rows=_rows(df))
    return res


def compare_lead24(bt: dict, ml_name: str, clean: pd.DataFrame, lat: float, lon: float, dir_min_speed: float,
                   start: pd.Timestamp | None = None, end: pd.Timestamp | None = None, fetch=fetch_previous_runs,
                   max_hourly_rows_days: int = 14, seed: int = 42) -> dict[str, Any]:
    """Like-for-like lead 24 h over held-out origins: model(origin T-24h) vs API previous-day forecast for T vs observed at T."""
    tgt = bt["origins"] + pd.Timedelta(hours=24)
    models = bt["models"]
    base = pd.DataFrame({
        "model_speed": models[ml_name]["ws"][:, 23], "model_dir": to_deg(models[ml_name]["sin"][:, 23], models[ml_name]["cos"][:, 23]),
        "persist_speed": models["Persistence"]["ws"][:, 23], "persist_dir": to_deg(models["Persistence"]["sin"][:, 23], models["Persistence"]["cos"][:, 23]),
        "obs_speed": bt["obs"]["ws"][:, 23], "obs_dir": to_deg(bt["obs"]["sin"][:, 23], bt["obs"]["cos"][:, 23])},
        index=pd.DatetimeIndex(tgt, name="timestamp_utc"))
    lo = start if start is not None else base.index.min()
    hi = (end + pd.Timedelta(hours=23)) if end is not None else base.index.max()
    sel = base.loc[(base.index >= lo) & (base.index <= hi)]
    if sel.empty:
        raise CompareError(f"No held-out forecasts for {lo.date()} to {hi.date()}. The held-out period is "
                           f"{base.index.min().date()} to {base.index.max().date()}.")
    api = fetch(lat, lon, str(sel.index.min().date()), str(sel.index.max().date()))
    df = sel.join(api, how="inner").dropna()
    res: dict[str, Any] = {"mode": "lead24_heldout", "from": str(df.index.min().date()) if len(df) else None,
                           "to": str(df.index.max().date()) if len(df) else None, "matched_hours": int(len(df)),
                           "heldout_period": [str(base.index.min().date()), str(base.index.max().date())], "notes": FAIRNESS_NOTES}
    if df.empty:
        res.update(model=None, api=None, persistence=None, closer=None, rows=[], daily=[], message="No matched hours.")
        return res
    m, a, p = (metrics(df, "model_speed", "model_dir", dir_min_speed), metrics(df, "api_speed", "api_dir", dir_min_speed),
               metrics(df, "persist_speed", "persist_dir", dir_min_speed))
    d = (df.model_speed - df.obs_speed).abs().to_numpy() - (df.api_speed - df.obs_speed).abs().to_numpy()
    ci_lo, ci_hi = block_boot_ci(d, block=4, seed=seed) if len(d) >= 8 else (float("nan"), float("nan"))
    verdict = ("insufficient data" if len(d) < 8 else "model closer" if ci_hi < 0 else "API closer" if ci_lo > 0 else "no significant difference")
    daily = pd.DataFrame({"model_MAE": (df.model_speed - df.obs_speed).abs(), "api_MAE": (df.api_speed - df.obs_speed).abs()}).resample("D").mean().dropna()
    daily.index = daily.index.strftime("%Y-%m-%d")
    res.update(model=m, api=a, persistence=p, closer=_closer(m, a),
               speed_abs_err_diff_model_minus_api={"mean": float(d.mean()), "ci95": [float(ci_lo), float(ci_hi)], "verdict": verdict},
               daily=[{"date": k, **v} for k, v in daily.round(4).to_dict("index").items()],
               rows=_rows(df) if (df.index.max() - df.index.min()).days < max_hourly_rows_days else [])
    return res


API_SOURCE = "Open-Meteo Previous Runs: the forecast it issued the day before"


def forecast_vs_api(base_fc: pd.DataFrame, lat: float, lon: float, fetch=fetch_previous_runs) -> dict[str, Any]:
    """The model's forecast next to Open-Meteo's forecast for the SAME hours. No observations are needed, so it works for the
    newest forecast date too. It shows how far apart two forecasts are; it is not an accuracy score (that needs observations).

    The API series is the Previous Runs forecast issued the day before. (The regular Forecast API returns the model analysis for
    past dates, which equals what happened, so it would not be a forecast at all.)
    """
    idx = base_fc.index
    api = fetch(lat, lon, str(idx.min().date()), str(idx.max().date()))
    api = api[~api.index.duplicated(keep="first")]
    api_speed = api["api_speed"].reindex(idx)
    rows, diffs = [], []
    for ts, model in base_fc["pred_speed_100m_ms"].items():
        a = api_speed.loc[ts]
        a = None if pd.isna(a) else float(a)
        rows.append({"timestamp_utc": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "lead_h": int(base_fc.loc[ts, "lead_h"]),
                     "model_speed": round(float(model), 3), "api_speed": None if a is None else round(a, 3)})
        if a is not None:
            diffs.append(abs(float(model) - a))
    out: dict[str, Any] = {
        "origin_utc": base_fc.attrs.get("origin_utc"), "api_source": API_SOURCE, "hours": rows, "matched_hours": len(diffs),
        "mean_abs_difference_ms": round(sum(diffs) / len(diffs), 3) if diffs else None,
        "notes": ["This compares two forecasts with each other. It does not say which one is right: that needs observed values.",
                  "The Open-Meteo series is the forecast it issued the day before; our model never uses it as an input."]}
    if not diffs:
        out["message"] = "Open-Meteo has no forecast stored for these hours."
    return out


def _rows(df: pd.DataFrame) -> list[dict]:
    out = []
    for ts, r in df.iterrows():
        out.append({"timestamp_utc": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "obs_speed": round(float(r.obs_speed), 3), "model_speed": round(float(r.model_speed), 3),
                    "api_speed": round(float(r.api_speed), 3), "obs_dir": round(float(r.obs_dir), 1), "model_dir": round(float(r.model_dir), 1),
                    "api_dir": round(float(r.api_dir), 1)})
    return out
