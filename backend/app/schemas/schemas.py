"""Request bodies and a few shared response shapes. Validation here is the main protection for an unauthenticated local API."""
from __future__ import annotations

import re
from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field, field_validator

ORIGIN_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$")
Group = Literal["onshore", "offshore", "distributed"]


def _check_tz(name: str) -> str:
    try:
        pd.Timestamp("2026-01-01").tz_localize("UTC").tz_convert(name)
    except Exception as exc:                                        # noqa: BLE001
        raise ValueError(f"Unknown time zone '{name}' (use an IANA name such as Asia/Kolkata)") from exc
    return name


class SiteIn(BaseModel):
    latitude: float = Field(ge=-90, le=90, description="Degrees north")
    longitude: float = Field(ge=-180, le=180, description="Degrees east")
    name: str = Field("My site", min_length=1, max_length=120)
    turbine_name: str | None = Field(None, description="NREL turbine-models entry; default from settings")
    turbine_group: Group = "onshore"
    local_tz: str | None = Field(None, description="IANA time zone for local time display and diurnal features")

    @field_validator("local_tz")
    @classmethod
    def _tz(cls, v):
        return _check_tz(v) if v else v


class SitePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    turbine_name: str | None = None
    turbine_group: Group | None = None
    nacelle_heading: float | None = Field(None, ge=0, lt=360, description="Current nacelle heading in degrees (wind-from convention)")
    clear_nacelle_heading: bool = False
    yaw_deadband_deg: float | None = Field(None, ge=0, le=45)


class ForecastIn(BaseModel):
    origin: str | None = Field(None, description="Forecast start: a date 'YYYY-MM-DD' (forecasts that UTC day) or an origin timestamp. "
                                                 "Omit for the latest available.")

    @field_validator("origin")
    @classmethod
    def _origin(cls, v):
        if v is not None and not ORIGIN_RE.match(v):
            raise ValueError("origin must look like 2026-10-22 or 2026-10-21T23:00")
        return v


class JobOut(BaseModel):
    id: str
    type: str
    status: Literal["queued", "running", "done", "failed"]
    progress: float
    message: str | None = None
    result: dict | None = None
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
