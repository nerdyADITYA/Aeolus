from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.models import Job, Site
from app.db.session import get_db
from app.schemas.schemas import JobOut


class ApiError(Exception):
    def __init__(self, status: int, detail: str, hint: str | None = None):
        super().__init__(detail)
        self.status, self.detail, self.hint = status, detail, hint


def current_site(db: Session = Depends(get_db)) -> Site:
    site = db.get(Site, 1)
    if site is None:
        raise ApiError(404, "No site configured", hint="PUT /api/site with latitude and longitude")
    return site


def ready_site(site: Site = Depends(current_site)) -> Site:
    if site.status == "preparing":
        raise ApiError(409, "The site is still being prepared (data download and model evaluation)", hint="Poll GET /api/jobs/{id}")
    if site.status == "error":
        raise ApiError(409, f"Site preparation failed: {site.status_message}", hint="PUT /api/site to start again")
    return site


def job_out(j: Job) -> JobOut:
    iso = lambda d: d.isoformat(timespec="seconds") if d else None
    return JobOut(id=j.id, type=j.type, status=j.status, progress=round(j.progress, 3), message=j.message, result=j.result_json,
                  error=j.error, created_at=iso(j.created_at), started_at=iso(j.started_at), finished_at=iso(j.finished_at))
