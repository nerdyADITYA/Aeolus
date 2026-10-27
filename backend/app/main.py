from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import forecast, health, jobs, reports, site, turbines
from app.api.deps import ApiError
from app.config import settings
from app.core.jobs import JobConflict, runner
from app.core.ratelimit import RateLimitMiddleware
from app.db.session import init_db
from app.services.compare_service import CompareError
from app.services.data_service import DataValidationError
from app.services.forecast_service import ForecastError
from app.services.turbine_service import TurbineError


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    init_db(settings.data_dir / "windkraft.db")
    runner.start()
    yield
    runner.shutdown()


app = FastAPI(title="WindKraft API", version=__version__, lifespan=lifespan,
              description="Local, single-site wind forecasting backend. No authentication: it is meant to run on localhost only. "
                          "Long operations (site setup, forecast for a date, data refresh) are jobs: POST returns 202 with a job id, "
                          "then poll GET /api/jobs/{id}.")
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PUT", "PATCH"], allow_headers=["*"])
for r in (health.router, site.router, jobs.router, forecast.router, reports.router, turbines.router):
    app.include_router(r)


def _err(status: int, detail: str, hint: str | None = None) -> JSONResponse:
    body = {"detail": detail}
    if hint:
        body["hint"] = hint
    return JSONResponse(body, status_code=status)


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return _err(exc.status, exc.detail, exc.hint)


@app.exception_handler(JobConflict)
async def _conflict(_: Request, exc: JobConflict):
    return _err(409, str(exc), "GET /api/jobs/{id} and wait for it to finish")


@app.exception_handler(ForecastError)
@app.exception_handler(TurbineError)
@app.exception_handler(CompareError)
@app.exception_handler(DataValidationError)
async def _unprocessable(_: Request, exc: Exception):
    return _err(422, str(exc))


@app.exception_handler(FileNotFoundError)
async def _not_ready(_: Request, exc: FileNotFoundError):
    return _err(409, "The site has not finished preparing", "Poll GET /api/site")
