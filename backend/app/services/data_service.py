"""Historical data retrieval, validation and cleaning (notebook sections 4-5, Phase 1).

Rules carried over from the notebook:
* raw data is returned and stored unchanged; cleaning produces a separate frame;
* only NaN runs of at most `max_gap` hours are interpolated, longer gaps stay missing;
* wind direction is encoded as unit sine/cosine.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd
import requests

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY_VARS = ["wind_speed_100m", "wind_direction_100m", "wind_speed_10m", "wind_direction_10m",
               "temperature_2m", "surface_pressure", "relative_humidity_2m", "cloud_cover"]
DEGREE_SIGN = "°"


class DataValidationError(ValueError):
    """Raised when the downloaded data is unusable (wrong units, empty response, ...)."""


@dataclass
class RawResult:
    df: pd.DataFrame                  # exactly as returned by the API: no sorting, de-duplication or gap filling
    meta: dict[str, Any]              # grid cell, elevation, units
    params: dict[str, Any]            # request parameters


# --------------------------------------------------------------------------------------------- retrieval
def fetch_raw(lat: float, lon: float, years: float, safety_days: int = 5, timeout: int = 180,
              retries: int = 3, session: requests.Session | None = None) -> RawResult:
    """Download hourly history (UTC, m/s) from the Open-Meteo *archive* API. Never calls the Forecast API."""
    end_date = datetime.now(timezone.utc).date() - timedelta(days=safety_days)
    start_date = end_date - timedelta(days=round(years * 365.25))
    params = {"latitude": lat, "longitude": lon, "start_date": start_date.isoformat(),
              "end_date": end_date.isoformat(), "hourly": ",".join(HOURLY_VARS),
              "timezone": "UTC", "wind_speed_unit": "ms"}
    http = session or requests
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            r = http.get(ARCHIVE_URL, params=params, timeout=timeout)
            r.raise_for_status()
            payload = r.json()
            break
        except (requests.RequestException, ValueError) as exc:
            last_exc = exc
            time.sleep(2 ** attempt)
    else:
        raise DataValidationError(f"Archive download failed after {retries} attempts: {last_exc!r}")
    if "hourly" not in payload:
        raise DataValidationError(f"Unexpected archive response: {str(payload)[:200]}")
    hourly = payload["hourly"]
    df = pd.DataFrame({"timestamp_utc": pd.to_datetime(hourly["time"]), **{v: hourly[v] for v in HOURLY_VARS}})
    meta = {k: payload.get(k) for k in ["latitude", "longitude", "elevation", "timezone", "hourly_units"]}
    return RawResult(df=df, meta=meta, params=params)


# --------------------------------------------------------------------------------------------- validation
def validate_raw(raw: pd.DataFrame, meta: dict[str, Any], lat: float, lon: float,
                 safety_days: int = 5, now_utc: pd.Timestamp | None = None) -> dict[str, Any]:
    """Inspect missing hours, duplicates, timestamps, units, ranges, height and freshness. Does not modify `raw`."""
    units = meta["hourly_units"]
    if units.get("wind_speed_100m") != "m/s":
        raise DataValidationError(f"Unexpected wind speed unit: {units.get('wind_speed_100m')}")
    if units.get("wind_direction_100m") != DEGREE_SIGN:
        raise DataValidationError(f"Unexpected direction unit: {units.get('wind_direction_100m')}")

    rep: dict[str, Any] = {"rows_raw": int(len(raw))}
    rep["duplicate_timestamps"] = int(raw["timestamp_utc"].duplicated().sum())
    rep["timestamps_monotonic"] = bool(raw["timestamp_utc"].is_monotonic_increasing)
    ts = raw["timestamp_utc"].drop_duplicates().sort_values()
    full_idx = pd.date_range(ts.min(), ts.max(), freq="h")
    rep["expected_hours"] = int(len(full_idx))
    rep["missing_hours_absent_timestamps"] = int(len(full_idx.difference(pd.DatetimeIndex(ts))))
    rep["off_hour_timestamps"] = int((ts.dt.minute != 0).sum())
    rep["units"] = {v: units.get(v) for v in HOURLY_VARS}
    rep["null_counts"] = {k: int(v) for k, v in raw[HOURLY_VARS].isna().sum().items()}
    rep["speed_100m_range"] = [float(raw.wind_speed_100m.min()), float(raw.wind_speed_100m.max())]
    rep["direction_100m_range"] = [float(raw.wind_direction_100m.min()), float(raw.wind_direction_100m.max())]
    rep["negative_speeds"] = int((raw.wind_speed_100m < 0).sum())
    rep["implausible_speeds_gt_60"] = int((raw.wind_speed_100m > 60).sum())
    rep["direction_outside_0_360"] = int(((raw.wind_direction_100m < 0) | (raw.wind_direction_100m > 360)).sum())

    pair = raw[["wind_speed_10m", "wind_speed_100m"]].dropna()
    pair = pair[pair.wind_speed_10m > 1]
    alpha = float(np.median(np.log(pair.wind_speed_100m / pair.wind_speed_10m) / np.log(100 / 10)))
    rep["shear_alpha_10_to_100m"] = alpha
    rep["height_check"] = (f"variable=wind_speed_100m (100 m above ground, modelled). Median shear exponent 10->100 m = "
                           f"{alpha:.2f} (plausible 0.1-0.5: {0.1 <= alpha <= 0.5})")

    d_km = np.hypot((meta["latitude"] - lat) * 111.0, (meta["longitude"] - lon) * 111.0 * np.cos(np.deg2rad(lat)))
    rep["grid_cell_offset_km"] = round(float(d_km), 2)

    last_valid = raw.dropna(subset=["wind_speed_100m", "wind_direction_100m"])["timestamp_utc"].max()
    now = now_utc if now_utc is not None else pd.Timestamp.now(tz="UTC").tz_localize(None)
    rep["last_valid_timestamp_utc"] = str(last_valid)
    rep["data_age_days"] = round((now - last_valid).total_seconds() / 86400, 2)
    rep["trailing_null_hours"] = int((ts.max() - last_valid) / pd.Timedelta(hours=1))
    rep["stale"] = bool(rep["data_age_days"] > safety_days + 2)
    return rep


# --------------------------------------------------------------------------------------------- cleaning
def fill_short_gaps(s: pd.Series, max_gap: int) -> pd.Series:
    """Linear-interpolate only NaN runs of length <= max_gap (pandas' limit= would partially fill longer runs)."""
    isna = s.isna()
    run_id = (isna != isna.shift()).cumsum()
    run_len = isna.groupby(run_id).transform("sum")
    filled = s.interpolate(limit_area="inside")
    return s.where(~(isna & (run_len <= max_gap)), filled)


_FILL_COLS = ["wind_speed_100m", "wind_speed_10m", "dir_sin", "dir_cos", "temperature_2m",
              "surface_pressure", "relative_humidity_2m", "cloud_cover"]


def clean_history(raw: pd.DataFrame, max_gap: int = 3) -> pd.DataFrame:
    """Return the modelling frame (columns ws, dir_sin, dir_cos, wind_direction_deg, ws10, temp, pres, rh, cloud,
    was_interpolated) on a regular hourly UTC index. `raw` is not modified."""
    ts = raw["timestamp_utc"].drop_duplicates().sort_values()
    full_idx = pd.date_range(ts.min(), ts.max(), freq="h")
    last_valid = raw.dropna(subset=["wind_speed_100m", "wind_direction_100m"])["timestamp_utc"].max()

    clean = (raw.drop_duplicates("timestamp_utc", keep="first").sort_values("timestamp_utc")
                .set_index("timestamp_utc").reindex(full_idx))
    clean.index.name = "timestamp_utc"
    clean = clean.loc[:last_valid]                      # drop trailing not-yet-available hours

    for c in ("wind_speed_100m", "wind_speed_10m"):
        clean.loc[(clean[c] < 0) | (clean[c] > 60), c] = np.nan
    for c in ("wind_direction_100m", "wind_direction_10m"):
        clean[c] = clean[c] % 360                       # 360 -> 0

    rad = np.deg2rad(clean["wind_direction_100m"])
    clean["dir_sin"], clean["dir_cos"] = np.sin(rad), np.cos(rad)

    before_missing = clean[["wind_speed_100m", "dir_sin", "dir_cos"]].isna().any(axis=1)
    for c in _FILL_COLS:
        clean[c] = fill_short_gaps(clean[c], max_gap)
    mag = np.hypot(clean.dir_sin, clean.dir_cos)
    clean["dir_sin"], clean["dir_cos"] = clean.dir_sin / mag, clean.dir_cos / mag
    clean["wind_direction_deg"] = (np.rad2deg(np.arctan2(clean.dir_sin, clean.dir_cos)) + 360) % 360
    clean["was_interpolated"] = before_missing & clean[["wind_speed_100m", "dir_sin", "dir_cos"]].notna().all(axis=1)

    data = clean.rename(columns={"wind_speed_100m": "ws", "wind_speed_10m": "ws10", "temperature_2m": "temp",
                                 "surface_pressure": "pres", "relative_humidity_2m": "rh", "cloud_cover": "cloud"})
    return data[["ws", "dir_sin", "dir_cos", "wind_direction_deg", "ws10", "temp", "pres", "rh", "cloud", "was_interpolated"]]


def cleaning_summary(data: pd.DataFrame) -> dict[str, Any]:
    rem = data[["ws", "dir_sin", "dir_cos"]].isna().any(axis=1)
    runs = (rem != rem.shift()).cumsum()[rem]
    return {"rows": int(len(data)), "start_utc": str(data.index[0]), "end_utc": str(data.index[-1]),
            "interpolated_hours": int(data.was_interpolated.sum()),
            "remaining_missing_hours": int(rem.sum()), "remaining_gaps": int(runs.nunique())}
