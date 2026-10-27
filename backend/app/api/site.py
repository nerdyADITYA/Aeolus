from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import ApiError, current_site, job_out
from app.config import settings
from app.core import artifacts as art
from app.core.jobs import runner
from app.db.models import DatasetVersion, ForecastRun, Job, ModelVersion, Site
from app.db.session import get_db
from app.schemas.schemas import JobOut, SiteIn, SitePatch
from app.services import pipeline_service as pl
from app.services.turbine_service import load_turbine

router = APIRouter(prefix="/api", tags=["site"])


def site_payload(db: Session, site: Site) -> dict:
    out = {"configured": True, "name": site.name, "latitude": site.latitude, "longitude": site.longitude, "local_tz": site.local_tz,
           "status": site.status, "status_message": site.status_message,
           "turbine": {"name": site.turbine_name, "group": site.turbine_group},
           "yaw": {"nacelle_heading": site.nacelle_heading, "deadband_deg": site.yaw_deadband_deg, "direction_conf_min": site.conf_min,
                   "min_speed_ms": settings.dir_min_speed},
           "evaluation_stale": site.eval_stale, "created_at": site.created_at.isoformat(timespec="seconds"),
           "active_job_id": runner.active_job_id()}
    ds = db.scalar(select(DatasetVersion).order_by(DatasetVersion.id.desc()).limit(1))
    if ds is not None:
        out["dataset"] = {"start_utc": ds.start_utc, "end_utc": ds.end_utc, "rows": ds.rows, "interpolated_hours": ds.interpolated_hours,
                          "remaining_missing_hours": ds.remaining_missing_hours, "fetched_at": ds.fetched_at.isoformat(timespec="seconds")}
        if site.status == "ready":
            out["forecast_dates"] = pl.selectable_dates(art.load_clean())
    ev = art.read_json("evaluation.json")
    if ev:
        out["model"] = {"name": ev["ml_name"], "details": ev["details"], "evaluated_at": ev["created_at"]}
    out["forecast_origins_cached"] = [r for r in db.scalars(select(ForecastRun.origin_utc).order_by(ForecastRun.origin_utc.desc()))]
    return out


@router.put("/site", status_code=202, summary="Set the single site and start preparing it (download, evaluate, first forecast)")
def put_site(body: SiteIn, db: Session = Depends(get_db)) -> dict:
    active = runner.active_job_id()
    if active:
        raise ApiError(409, f"Another job is running ({active}); wait for it to finish", hint="GET /api/jobs/{id}")
    turbine = body.turbine_name or settings.turbine_name
    try:
        load_turbine(turbine, body.turbine_group)                      # fail early on an unusable turbine
    except ValueError as exc:
        raise ApiError(422, str(exc), hint="GET /api/turbines for usable names") from exc
    for model in (ForecastRun, ModelVersion, DatasetVersion, Site):    # replace the site: previous results no longer apply
        db.execute(delete(model))
    art.reset_site_dir()
    if settings.models_dir.exists():
        for p in settings.models_dir.iterdir():
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
    db.add(Site(id=1, name=body.name, latitude=body.latitude, longitude=body.longitude, local_tz=body.local_tz or settings.local_tz,
                turbine_name=turbine, turbine_group=body.turbine_group, yaw_deadband_deg=settings.yaw_deadband_deg,
                status="preparing"))
    db.commit()
    job_id = runner.submit("setup", pl.run_setup)
    return {"site": site_payload(db, db.get(Site, 1)), "job": job_out(db.get(Job, job_id)).model_dump()}


@router.get("/site", summary="Site, data coverage, selectable forecast dates, model status")
def get_site(db: Session = Depends(get_db)) -> dict:
    site = db.get(Site, 1)
    return {"configured": False} if site is None else site_payload(db, site)


@router.patch("/site", summary="Change turbine, nacelle heading or yaw deadband (energy/yaw recalculate without retraining)")
def patch_site(body: SitePatch, site: Site = Depends(current_site), db: Session = Depends(get_db)) -> dict:
    new_name = body.turbine_name or site.turbine_name
    new_group = body.turbine_group or site.turbine_group
    if (new_name, new_group) != (site.turbine_name, site.turbine_group):
        try:
            load_turbine(new_name, new_group)
        except ValueError as exc:
            raise ApiError(422, str(exc), hint="GET /api/turbines for usable names") from exc
        site.turbine_name, site.turbine_group = new_name, new_group
    if body.name:
        site.name = body.name
    if body.clear_nacelle_heading:
        site.nacelle_heading = None
    elif body.nacelle_heading is not None:
        site.nacelle_heading = body.nacelle_heading
    if body.yaw_deadband_deg is not None:
        site.yaw_deadband_deg = body.yaw_deadband_deg
    db.commit()
    return site_payload(db, site)


@router.post("/site/data/refresh", status_code=202, summary="Pull newer archive data (job); the evaluation is not recomputed")
def refresh_data(site: Site = Depends(current_site), db: Session = Depends(get_db)) -> JobOut:
    if site.status != "ready":
        raise ApiError(409, "The site is not ready yet")
    job_id = runner.submit("refresh", pl.run_refresh)
    return job_out(db.get(Job, job_id))
