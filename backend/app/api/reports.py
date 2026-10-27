from __future__ import annotations

import pandas as pd
import requests
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import ApiError, ready_site
from app.schemas.schemas import ORIGIN_RE
from app.config import settings
from app.core import artifacts as art
from app.db.models import Site
from app.db.session import get_db
from app.services import compare_service as cs
from app.services import pipeline_service as pl
from app.services.turbine_service import energy_error_proxy

router = APIRouter(prefix="/api", tags=["reports"])


@router.get("/site/data/quality", summary="Validation and cleaning report for the stored dataset")
def data_quality(site: Site = Depends(ready_site)) -> dict:
    q = art.read_json("quality.json")
    if q is None:
        raise ApiError(404, "No data-quality report yet")
    return q


@router.get("/site/data/history", summary="Recent cleaned hourly series for charts")
def data_history(days: int = Query(30, ge=1, le=365), site: Site = Depends(ready_site)) -> dict:
    data = art.load_clean().tail(days * 24)
    df = data[["ws", "wind_direction_deg", "was_interpolated"]].rename(columns={"ws": "speed", "wind_direction_deg": "direction_deg"})
    return {"start_utc": str(data.index[0]), "end_utc": str(data.index[-1]), "hours": art.records(df.round(3), index_name="timestamp_utc")}


def _evaluation() -> dict:
    ev = art.read_json("evaluation.json")
    if ev is None:
        raise ApiError(404, "No model evaluation yet")
    return ev


@router.get("/site/models/report", summary="Held-out backtest metrics, error by lead, selection, success criteria, energy proxy")
def models_report(site: Site = Depends(ready_site)) -> dict:
    ev = _evaluation()
    out = {k: ev[k] for k in ("ml_name", "split", "test_table", "val_table", "by_lead", "selection", "criteria", "details",
                              "refit_log", "sarimax_tuning", "gbm_tuning", "report_md", "limitations", "created_at")}
    out["evaluation_stale"] = site.eval_stale
    bt = art.load_backtest(ev["model_order"])
    if bt is not None:
        turbine = pl.get_turbine(site.turbine_name, site.turbine_group)
        proxy = energy_error_proxy({m: p["ws"] for m, p in bt["models"].items()}, bt["obs"]["ws"], turbine,
                                   leads=tuple(ev["config"]["leads_reported"]), shear_alpha=site.shear_alpha)
        out["energy_error_proxy"] = {"turbine": turbine.name, "rows": art.records(proxy),
                                     "note": "Curve energy from predicted wind vs curve energy from observed (reanalysis) wind, kWh per hour. "
                                             "Measures wind-forecast error only, NOT accuracy against measured generation."}
    return out


@router.get("/site/models/direction", summary="Direction confidence analysis (error by confidence and wind speed)")
def models_direction(site: Site = Depends(ready_site)) -> dict:
    d = art.read_json("direction.json")
    if d is None:
        raise ApiError(404, "No direction analysis yet")
    return d


@router.get("/site/compare", summary="Model vs Forecast API (Previous Runs) vs observed, matched timestamps")
def compare(date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Single forecast date (needs a stored forecast for it)"),
            from_: str | None = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
            to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
            site: Site = Depends(ready_site), db: Session = Depends(get_db)) -> dict:
    """`date`: one stored forecast (leads 1-24). `from`/`to` (or neither): like-for-like lead 24 h over the held-out period."""
    clean = art.load_clean()
    try:
        if date is not None:
            run, pos = pl.find_run(db, clean, date)
            if run is None:
                raise ApiError(404, f"No stored forecast for {date}", hint=f"POST /api/site/forecast with origin {date} first")
            return cs.compare_single_forecast(pl.base_frame(run), clean, site.latitude, site.longitude, settings.dir_min_speed,
                                              fetch=cs.fetch_previous_runs)
        ev = _evaluation()
        bt = art.load_backtest(ev["model_order"])
        if bt is None:
            raise ApiError(404, "No backtest predictions stored")
        start = pd.Timestamp(from_) if from_ else None
        end = pd.Timestamp(to) if to else None
        if start is not None and end is not None and end < start:
            raise ApiError(422, "'to' must not be before 'from'")
        return cs.compare_lead24(bt, ev["ml_name"], clean, site.latitude, site.longitude, settings.dir_min_speed, start, end,
                                 fetch=cs.fetch_previous_runs, seed=settings.random_seed)
    except cs.CompareError as exc:
        raise ApiError(422, str(exc)) from exc
    except requests.RequestException as exc:
        raise ApiError(502, f"Forecast API request failed: {exc}") from exc


@router.get("/site/api-comparison", summary="Model forecast next to the Open-Meteo forecast for the same 24 hours (no observations needed)")
def api_comparison(origin: str | None = Query(None, description="Forecast date 'YYYY-MM-DD' or origin timestamp; default = latest stored forecast"),
                   site: Site = Depends(ready_site), db: Session = Depends(get_db)) -> dict:
    """Both series are predictions for the same hours. Open-Meteo's is the forecast it issued the previous day (Previous Runs API)."""
    if origin is not None and not ORIGIN_RE.match(origin):
        raise ApiError(422, "origin must look like 2026-10-22 or 2026-10-21T23:00")
    clean = art.load_clean()
    run, pos = pl.find_run(db, clean, origin)
    if run is None:
        raise ApiError(404, f"No forecast has been generated for origin {clean.index[pos]} yet",
                       hint="POST /api/site/forecast with this origin first")
    try:
        return cs.forecast_vs_api(pl.base_frame(run), site.latitude, site.longitude, fetch=cs.fetch_previous_runs)
    except cs.CompareError as exc:
        raise ApiError(422, str(exc)) from exc
    except requests.RequestException as exc:
        raise ApiError(502, f"Forecast API request failed: {exc}") from exc
