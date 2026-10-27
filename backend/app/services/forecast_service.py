"""Model-only 24 h forecast, yaw and energy (notebook section 16 and 19, Phase 8).

Everything here uses historical (archive) data only. The Forecast API is never read. A forecast for origin t trains the
final models with cutoff = t, so it is always out-of-sample for the hours it predicts.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

import numpy as np
import pandas as pd

from app.core.circular import mean_res_len, to_deg
from app.core.registry import GbmSpec, ModelBundle
from app.services import gbm_service as gbm
from app.services.eval_data import EvalConfig, EvalData
from app.services.feature_service import build_features
from app.services.turbine_service import Turbine, estimate_energy
from app.services.yaw_service import yaw_plan


class ForecastError(ValueError):
    """The requested origin is unusable (missing data, too little history, ...)."""


def spec_from_tuning(t: gbm.GbmTuning) -> GbmSpec:
    return GbmSpec(speed_cfg=t.speed_cfg, speed_delta=bool(t.speed_delta), dir_cfg=t.dir_cfg,
                   params={t.speed_cfg: t.grid[t.speed_cfg], t.dir_cfg: t.grid[t.dir_cfg]})


def _tuning_from_spec(spec: GbmSpec) -> gbm.GbmTuning:
    return gbm.GbmTuning(table=None, speed_cfg=spec.speed_cfg, speed_delta=spec.speed_delta, dir_cfg=spec.dir_cfg,
                         val_pred=None, grid=spec.params)


# ------------------------------------------------------------------------------------------------ origin
def resolve_origin(data: pd.DataFrame, origin=None, min_history_h: int = 24 * 365) -> int:
    """Position of the forecast origin (the last observed hour before the 24 h being predicted).

    None -> latest hour with a valid observation. A date ('2026-10-22' or a date object) means "forecast that UTC day",
    so the origin is 23:00 on the previous day. A full timestamp is used as the origin itself.
    """
    valid = data[["ws", "dir_sin", "dir_cos"]].notna().all(axis=1).to_numpy()
    if origin is None:
        pos = int(np.where(valid)[0][-1])
    else:
        ts = pd.Timestamp(origin)
        is_date = (isinstance(origin, str) and len(origin) <= 10) or \
                  (isinstance(origin, date) and not isinstance(origin, datetime))      # pd.Timestamp is a datetime
        if is_date:
            ts = ts.normalize() - pd.Timedelta(hours=1)
        if ts not in data.index:
            raise ForecastError(f"Origin {ts} is outside the available data ({data.index[0]} to {data.index[-1]})")
        pos = int(data.index.get_loc(ts))
        if not valid[pos]:
            raise ForecastError(f"No valid observation at origin {ts}")
    if pos + 1 < min_history_h:
        raise ForecastError(f"Origin {data.index[pos]} has only {pos + 1} h of history; at least {min_history_h} h are required")
    return pos


# ------------------------------------------------------------------------------------------------ training
def train_bundle(data: pd.DataFrame, cfg: EvalConfig, spec: GbmSpec, cutoff_pos: int, site: dict | None = None,
                 ed: EvalData | None = None) -> ModelBundle:
    """Train the 72 direct models with knowledge up to `cutoff_pos` (inclusive)."""
    ed = ed or EvalData.build(data, cfg)
    models = gbm.fit_final(ed, _tuning_from_spec(spec), cutoff_pos)
    ts = str(data.index[cutoff_pos])
    return ModelBundle(model_id=f"{gbm.model_name().lower()}-{pd.Timestamp(ts):%Y%m%dT%H}-{uuid.uuid4().hex[:6]}",
                       backend=gbm.gbm_backend(), model_name=gbm.model_name(), spec=spec, forecast_hours=cfg.forecast_hours,
                       cutoff_pos=cutoff_pos, trained_through_utc=ts, feature_cols=ed.feature_cols, models=models,
                       site=site or {})


# ------------------------------------------------------------------------------------------------ inference
def predict_from_bundle(bundle: ModelBundle, data: pd.DataFrame, origin_pos: int, local_tz: str = "Asia/Kolkata") -> pd.DataFrame:
    """Forecast H hours after `origin_pos` using only features at that origin (which use data up to it)."""
    if origin_pos < bundle.cutoff_pos:
        raise ForecastError("Origin is earlier than the model's training cutoff; the forecast would be in-sample")
    feats = build_features(data.iloc[: origin_pos + 1], local_tz)          # truncated: cannot see beyond the origin
    if list(feats.columns) != bundle.feature_cols:
        raise ForecastError("Feature set differs from the one the model was trained with")
    x = feats.iloc[[-1]].to_numpy(dtype=float)
    ws0 = float(data.ws.iloc[origin_pos])
    H, delta = bundle.forecast_hours, bundle.spec.speed_delta
    speed = np.array([bundle.models["ws"][("ws", h)].predict(x)[0] for h in range(1, H + 1)])
    if delta:
        speed = speed + ws0
    speed = np.clip(speed, 0, None)
    s = np.clip([bundle.models["dir"][("sin", h)].predict(x)[0] for h in range(1, H + 1)], -1, 1)
    c = np.clip([bundle.models["dir"][("cos", h)].predict(x)[0] for h in range(1, H + 1)], -1, 1)
    idx = pd.date_range(data.index[origin_pos] + pd.Timedelta(hours=1), periods=H, freq="h", name="timestamp_utc")
    fc = pd.DataFrame({"pred_speed_100m_ms": speed, "pred_direction_deg": to_deg(s, c),
                       "direction_confidence": mean_res_len(s, c)}, index=idx)
    fc.insert(0, "timestamp_local", idx.tz_localize("UTC").tz_convert(local_tz).strftime("%Y-%m-%d %H:%M"))
    fc.insert(1, "lead_h", np.arange(1, H + 1))
    fc.attrs["origin_utc"] = str(data.index[origin_pos])
    return fc


# ------------------------------------------------------------------------------------------------ assembly
def assemble_output(fc: pd.DataFrame, turbine: Turbine, conf_min: float, speed_min: float, deadband_deg: float,
                    current_heading: float | None = None, ref_height_m: float = 100.0, shear_alpha: float = 0.14) -> tuple[pd.DataFrame, dict]:
    """Add yaw recommendation and hourly power/energy. Returns (final table, summary)."""
    yaw = yaw_plan(fc, current_heading, deadband_deg, conf_min, speed_min)
    energy, summ = estimate_energy(fc.pred_speed_100m_ms.to_numpy(), turbine, ref_height_m, shear_alpha, index=fc.index)
    final = pd.concat([fc, yaw, energy], axis=1)
    final.insert(0, "forecast_origin_utc", fc.attrs.get("origin_utc"))
    summ.update({"reliable_hours": int(yaw.direction_reliable.sum()), "mean_speed_ms": float(fc.pred_speed_100m_ms.mean()),
                 "turbine": turbine.name, "conf_min": conf_min, "speed_min": speed_min})
    return final, summ


def make_forecast(data: pd.DataFrame, cfg: EvalConfig, spec: GbmSpec, turbine: Turbine, conf_min: float, speed_min: float,
                  deadband_deg: float, origin=None, current_heading: float | None = None, min_history_h: int = 24 * 365,
                  site: dict | None = None, shear_alpha: float = 0.14) -> tuple[pd.DataFrame, dict, ModelBundle]:
    """Train with cutoff = origin, predict the next H hours, add yaw and energy."""
    pos = resolve_origin(data, origin, min_history_h)
    bundle = train_bundle(data, cfg, spec, pos, site)
    fc = predict_from_bundle(bundle, data, pos, cfg.local_tz)
    final, summ = assemble_output(fc, turbine, conf_min, speed_min, deadband_deg, current_heading, shear_alpha=shear_alpha)
    return final, summ, bundle
