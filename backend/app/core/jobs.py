"""Single-worker background job runner with persisted progress (plan section 3.5).

Training takes minutes, so it runs off the request thread. Only one job may be queued or running at a time (a PC-local
app with one site): a second request gets JobConflict (HTTP 409). Jobs left running by a crash are marked failed on start.
"""
from __future__ import annotations

import logging
import secrets
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from sqlalchemy import select, update

from app.db import session as dbs
from app.db.models import Job, utcnow

log = logging.getLogger("windkraft.jobs")
Progress = Callable[[str, float], None]


class JobConflict(RuntimeError):
    def __init__(self, active: str):
        super().__init__(f"Another job is already active ({active})")
        self.active = active


class JobRunner:
    def __init__(self) -> None:
        self._pool: ThreadPoolExecutor | None = None

    def start(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="windkraft-job")
        with dbs.session_scope() as s:                       # anything still "running" belonged to a previous process
            s.execute(update(Job).where(Job.status.in_(["queued", "running"]))
                      .values(status="failed", error="Interrupted by application restart", finished_at=utcnow()))

    def shutdown(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._pool = None

    def active_job_id(self) -> str | None:
        with dbs.session_scope() as s:
            return s.scalar(select(Job.id).where(Job.status.in_(["queued", "running"])).limit(1))

    def submit(self, job_type: str, fn: Callable[[Progress], dict | None]) -> str:
        if self._pool is None:
            raise RuntimeError("Job runner not started")
        active = self.active_job_id()
        if active:
            raise JobConflict(active)
        job_id = secrets.token_hex(6)
        with dbs.session_scope() as s:
            s.add(Job(id=job_id, type=job_type, status="queued", message="Queued"))
        self._pool.submit(self._run, job_id, fn)
        return job_id

    def _run(self, job_id: str, fn: Callable[[Progress], dict | None]) -> None:
        def progress(message: str, fraction: float) -> None:
            with dbs.session_scope() as s:
                s.execute(update(Job).where(Job.id == job_id).values(message=message[:300], progress=float(min(max(fraction, 0), 1))))

        with dbs.session_scope() as s:
            s.execute(update(Job).where(Job.id == job_id).values(status="running", started_at=utcnow(), message="Starting"))
        try:
            result = fn(progress) or {}
            with dbs.session_scope() as s:
                s.execute(update(Job).where(Job.id == job_id).values(status="done", progress=1.0, message="Done",
                                                                      result_json=result, finished_at=utcnow()))
        except Exception as exc:                              # noqa: BLE001 - any failure must end the job, not the worker
            log.error("Job %s failed:\n%s", job_id, traceback.format_exc())
            with dbs.session_scope() as s:
                s.execute(update(Job).where(Job.id == job_id).values(status="failed", error=f"{type(exc).__name__}: {exc}"[:1000],
                                                                      finished_at=utcnow()))

    def wait(self, job_id: str, timeout: float = 60.0, poll: float = 0.1) -> str:
        """Block until the job ends (used by tests); returns its final status."""
        end = time.time() + timeout
        while time.time() < end:
            with dbs.session_scope() as s:
                st = s.scalar(select(Job.status).where(Job.id == job_id))
            if st in ("done", "failed"):
                return st
            time.sleep(poll)
        raise TimeoutError(f"Job {job_id} still active after {timeout}s")


runner = JobRunner()
