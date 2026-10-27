import importlib.util
import platform

from fastapi import APIRouter

from app import __version__
from app.config import settings

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "python": platform.python_version(),
        "gbm_backend": "lightgbm" if importlib.util.find_spec("lightgbm") else "unavailable",
        "site_default": {"latitude": settings.latitude, "longitude": settings.longitude},
        "data_dir": str(settings.data_dir),
    }
