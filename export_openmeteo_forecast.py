"""Export the Open-Meteo day-ahead wind forecast to an Excel file.

Uses the same source and settings as the dashboard's "Model vs Open-Meteo" chart: the Previous Runs API,
`*_previous_day1` = the forecast Open-Meteo issued the day before, at 100 m, hourly, UTC, wind speed in m/s.

Run it and answer the prompts, or pass the values as arguments:

    python export_openmeteo_forecast.py
    python export_openmeteo_forecast.py --date 2026-10-22 --lat 51.5 --lon -0.12
    python export_openmeteo_forecast.py --date 2026-10-20 --end-date 2026-10-22 --lat 51.5 --lon -0.12 --out my.xlsx

Needs: pip install requests pandas openpyxl
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

import pandas as pd
import requests

PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def fetch_previous_runs(lat: float, lon: float, start: str, end: str, http=requests, timeout: int = 120) -> pd.DataFrame:
    """Day-ahead (previous_day1) 100 m speed/direction, UTC hourly, indexed by the hour being forecast."""
    r = http.get(PREVIOUS_RUNS_URL, params={
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end, "timezone": "UTC", "wind_speed_unit": "ms",
        "hourly": "wind_speed_100m_previous_day1,wind_direction_100m_previous_day1"}, timeout=timeout)
    r.raise_for_status()
    body = r.json()
    if "hourly" not in body:
        raise SystemExit(f"Open-Meteo returned no data: {str(body)[:200]}")
    h = body["hourly"]
    return pd.DataFrame({"timestamp_utc": pd.to_datetime(h["time"]), "api_speed": h["wind_speed_100m_previous_day1"],
                         "api_dir": h["wind_direction_100m_previous_day1"]}).set_index("timestamp_utc")


def ask(prompt: str, convert, default=None):
    """Prompt until the answer converts; Enter accepts the default if there is one."""
    while True:
        raw = input(f"{prompt}{f' [{default}]' if default is not None else ''}: ").strip()
        if not raw and default is not None:
            return default
        try:
            return convert(raw)
        except (ValueError, TypeError) as exc:
            print(f"  Not valid ({exc}). Try again.")


def to_date(s: str) -> str:
    return date.fromisoformat(s).isoformat()


def to_lat(s: str) -> float:
    v = float(s)
    if not -90 <= v <= 90:
        raise ValueError("latitude must be between -90 and 90")
    return v


def to_lon(s: str) -> float:
    v = float(s)
    if not -180 <= v <= 180:
        raise ValueError("longitude must be between -180 and 180")
    return v


def build_table(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["wind_speed_ms"] = out["api_speed"].round(2)
    out["wind_direction_deg"] = out["api_dir"].round(0)
    out["compass"] = out["api_dir"].map(lambda d: None if pd.isna(d) else COMPASS[int((d % 360) / 22.5 + 0.5) % 16])
    out.index.name = "timestamp_utc"
    out = out[["wind_speed_ms", "wind_direction_deg", "compass"]].reset_index()
    out["timestamp_utc"] = out["timestamp_utc"].dt.strftime("%Y-%m-%d %H:%M")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Export the Open-Meteo day-ahead wind forecast to Excel.")
    ap.add_argument("--date", help="first date, YYYY-MM-DD")
    ap.add_argument("--end-date", help="last date, YYYY-MM-DD (default: same as --date)")
    ap.add_argument("--lat", type=float, help="latitude, -90 to 90")
    ap.add_argument("--lon", type=float, help="longitude, -180 to 180")
    ap.add_argument("--out", help="output .xlsx path (default: openmeteo_forecast_<date>.xlsx)")
    a = ap.parse_args()

    interactive = a.date is None or a.lat is None or a.lon is None
    start = to_date(a.date) if a.date else ask("Date (YYYY-MM-DD)", to_date)
    lat = to_lat(str(a.lat)) if a.lat is not None else ask("Latitude", to_lat)
    lon = to_lon(str(a.lon)) if a.lon is not None else ask("Longitude", to_lon)
    end = to_date(a.end_date) if a.end_date else (ask("End date (Enter = same day)", to_date, default=start) if interactive else start)
    if end < start:
        start, end = end, start

    print(f"Fetching Open-Meteo forecast for {start}..{end} at ({lat}, {lon}) ...")
    try:
        df = fetch_previous_runs(lat, lon, start, end)
    except requests.RequestException as exc:
        print(f"Could not reach Open-Meteo: {exc}", file=sys.stderr)
        return 1
    df = df.dropna(subset=["api_speed"])
    if df.empty:
        print("Open-Meteo has no day-ahead forecast for those dates (very old or future dates are not available).", file=sys.stderr)
        return 1

    table = build_table(df)
    info = pd.DataFrame({"item": ["Source", "What it is", "Latitude", "Longitude", "From", "To", "Height", "Time zone", "Speed unit", "Rows"],
                         "value": ["Open-Meteo Previous Runs API", "The forecast issued the day before (previous_day1)", lat, lon,
                                   start, end, "100 m", "UTC", "m/s", len(table)]})
    path = a.out or f"openmeteo_forecast_{start}.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        table.to_excel(xw, sheet_name="Forecast", index=False)
        info.to_excel(xw, sheet_name="About", index=False)
        for name, frame in (("Forecast", table), ("About", info)):
            ws = xw.sheets[name]
            for i, col in enumerate(frame.columns, start=1):
                width = max(len(str(col)), *(len(str(v)) for v in frame[col])) + 2
                ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(width, 60)
    print(f"Saved {len(table)} hourly rows to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
