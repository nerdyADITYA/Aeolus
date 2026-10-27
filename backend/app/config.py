"""Central settings. Defaults mirror the validated notebook configuration (wind_prediction_engine.ipynb, section 2)."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINDKRAFT_", env_file=".env", extra="ignore")

    # ---- site defaults ----
    latitude: float = 23.0225
    longitude: float = 72.5714
    local_tz: str = "Asia/Kolkata"

    # ---- data ----
    historical_years: int = 3
    wind_var_height_m: int = 100
    archive_safety_days: int = 5
    max_interp_gap_h: int = 3

    # ---- forecasting / evaluation ----
    forecast_hours: int = 24
    val_days: int = 90
    test_days: int = 150
    origin_step_h: int = 6
    refit_days: int = 30
    dir_min_speed: float = 3.0
    random_seed: int = 42

    # ---- turbine / yaw ----
    turbine_name: str = "2023NREL_Bespoke_3.3MW_148"
    turbine_group: str = "onshore"
    yaw_deadband_deg: float = 8.0
    min_history_hours: int = 24 * 365        # a forecast date needs at least this much history before it

    # ---- runtime ----
    data_dir: Path = BACKEND_ROOT / "data"
    models_dir: Path = BACKEND_ROOT / "models"
    reports_dir: Path = BACKEND_ROOT / "reports"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    api_host: str = "127.0.0.1"          # local only (plan section 3.7)
    api_port: int = 8000
    rate_limit_per_min: int = 60             # per-IP limit on PUT/POST/PATCH; 0 disables

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.models_dir, self.reports_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
