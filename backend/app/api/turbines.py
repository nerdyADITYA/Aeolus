from fastapi import APIRouter, Query

from app.api.deps import ApiError
from app.schemas.schemas import Group
from app.services import turbine_service as ts

router = APIRouter(prefix="/api", tags=["turbines"])


@router.get("/turbines", summary="NREL turbines; `usable` says whether the curve verifies")
def list_turbines(group: Group = "onshore") -> list[dict]:
    return ts.list_turbines(group)


@router.get("/turbines/{name}/curve", summary="Verified power curve and spec for one turbine")
def turbine_curve(name: str, group: Group = Query("onshore")) -> dict:
    try:
        t = ts.load_turbine(name, group)
    except ts.TurbineError as exc:
        raise ApiError(404, str(exc)) from exc
    return {"turbine": t.meta(), "curve": [{"wind_speed_ms": float(v), "power_kw": float(p)} for v, p in zip(t.curve_speed, t.curve_power)]}
