"""SQLite tables (plan section 3.3). Single-site v1: the `site` table holds one row (id = 1).

Forecast hours are stored as one JSON document per run (`base_json`) instead of one row per hour: they are always read
and written as a whole, and the turbine/yaw/energy columns are recomputed on read so switching turbines needs no retraining.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "site"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(120), default="My site")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    local_tz: Mapped[str] = mapped_column(String(64))
    turbine_name: Mapped[str] = mapped_column(String(120))
    turbine_group: Mapped[str] = mapped_column(String(32), default="onshore")
    nacelle_heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    yaw_deadband_deg: Mapped[float] = mapped_column(Float, default=8.0)
    status: Mapped[str] = mapped_column(String(16), default="preparing")   # preparing | ready | error
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    conf_min: Mapped[float | None] = mapped_column(Float, nullable=True)   # direction reliability threshold (chosen on validation)
    spec_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # chosen GBM hyperparameters
    shear_alpha: Mapped[float] = mapped_column(Float, default=0.14)
    eval_stale: Mapped[bool] = mapped_column(Boolean, default=False)       # data refreshed after the evaluation ran
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class DatasetVersion(Base):
    __tablename__ = "dataset_version"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"), default=1)
    start_utc: Mapped[str] = mapped_column(String(32))
    end_utc: Mapped[str] = mapped_column(String(32))
    rows: Mapped[int] = mapped_column(Integer)
    interpolated_hours: Mapped[int] = mapped_column(Integer)
    remaining_missing_hours: Mapped[int] = mapped_column(Integer)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ModelVersion(Base):
    __tablename__ = "model_version"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"), default=1)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset_version.id"))
    model_name: Mapped[str] = mapped_column(String(64))
    backend: Mapped[str] = mapped_column(String(32))
    selection_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ForecastRun(Base):
    __tablename__ = "forecast_run"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"), default=1)
    model_version_id: Mapped[int | None] = mapped_column(ForeignKey("model_version.id"), nullable=True)
    origin_utc: Mapped[str] = mapped_column(String(32), index=True)
    model_dir: Mapped[str | None] = mapped_column(String(200), nullable=True)      # saved bundle folder name (if kept)
    trained_through_utc: Mapped[str] = mapped_column(String(32))
    base_json: Mapped[list] = mapped_column(JSON)                                  # model-only hourly forecast
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Job(Base):
    __tablename__ = "job"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="queued")             # queued | running | done | failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
