from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ApiError, job_out
from app.db.models import Job
from app.db.session import get_db
from app.schemas.schemas import JobOut

router = APIRouter(prefix="/api", tags=["jobs"])


@router.get("/jobs/{job_id}", summary="Job status and progress (poll every ~2 s)")
def get_job(job_id: str, db: Session = Depends(get_db)) -> JobOut:
    job = db.get(Job, job_id)
    if job is None:
        raise ApiError(404, f"No job '{job_id}'")
    return job_out(job)


@router.get("/jobs", summary="Most recent jobs")
def list_jobs(limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)) -> list[JobOut]:
    return [job_out(j) for j in db.scalars(select(Job).order_by(Job.created_at.desc()).limit(limit))]
