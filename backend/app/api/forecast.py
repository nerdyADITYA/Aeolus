from __future__ import annotations

import io
import json
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import ApiError, job_out, ready_site
from app.config import settings
from app.core import artifacts as art
from app.core.jobs import runner
from app.db.models import Job, Site
from app.db.session import get_db
from app.schemas.schemas import ORIGIN_RE, ForecastIn, JobOut
from app.services import pipeline_service as pl

router = APIRouter(prefix="/api", tags=["forecast"])


def _origin_param(origin: str | None) -> str | None:
    if origin is not None and not ORIGIN_RE.match(origin):
        raise ApiError(422, "origin must look like 2026-10-22 or 2026-10-21T23:00")
    return origin


@router.get("/site/forecast", summary="24 h model-only forecast + yaw + energy for a start date (default: latest)")
def get_forecast(origin: str | None = Query(None, description="YYYY-MM-DD (forecast that UTC day) or an origin timestamp"),
                 site: Site = Depends(ready_site), db: Session = Depends(get_db)) -> dict:
    origin = _origin_param(origin)
    data = art.load_clean()
    run, pos = pl.find_run(db, data, origin)
    if run is None:
        raise ApiError(404, f"No forecast has been generated for origin {data.index[pos]} yet",
                       hint="POST /api/site/forecast with this origin to run it (trains with the cutoff at the origin, about 1 minute)")
    return pl.forecast_payload(site, run, data)


@router.post("/site/forecast", status_code=202, summary="Run a forecast for a start date (job). Always out-of-sample for that date")
def run_forecast(body: ForecastIn, site: Site = Depends(ready_site), db: Session = Depends(get_db)) -> JobOut:
    data = art.load_clean()
    pl.fs.resolve_origin(data, body.origin, settings.min_history_hours)       # reject bad dates before queueing a job
    job_id = runner.submit("forecast", pl.run_forecast_job(body.origin))
    return job_out(db.get(Job, job_id))


@router.get("/site/export", summary="Download a stored forecast as CSV or JSON")
def export(format: Literal["csv", "json"] = "csv", origin: str | None = None,
           site: Site = Depends(ready_site), db: Session = Depends(get_db)) -> Response:
    origin = _origin_param(origin)
    data = art.load_clean()
    run, pos = pl.find_run(db, data, origin)
    if run is None:
        raise ApiError(404, f"No forecast for origin {data.index[pos]}", hint="POST /api/site/forecast first")
    payload = pl.forecast_payload(site, run, data)
    stamp = pd.Timestamp(run.origin_utc).strftime("%Y%m%dT%H")
    if format == "json":
        meta = {k: payload[k] for k in ("origin_utc", "trained_through_utc", "summary", "turbine", "limitations")}
        meta.update(site={"latitude": site.latitude, "longitude": site.longitude, "name": site.name},
                    forecast_api_used_for_model_predictions=False, safety_note="Advisory predictions only; no turbine commands are issued.")
        body = json.dumps({"metadata": meta, "predictions": payload["hours"]}, indent=2)
        return Response(body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="windkraft_forecast_{stamp}.json"'})
    buf = io.StringIO()
    pd.DataFrame(payload["hours"]).assign(forecast_origin_utc=payload["origin_utc"]).to_csv(buf, index=False)
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="windkraft_forecast_{stamp}.csv"'})
