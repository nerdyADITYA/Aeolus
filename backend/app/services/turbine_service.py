"""NREL turbine power curves and hourly energy (notebook sections 18-19, Phase 8).

The curve comes from the installed `turbine-models` package and is verified before use: strictly increasing wind speeds,
non-negative power, peak equal to the spec's rated power, zero power outside cut-in/cut-out, known hub height.
Energy is idealised: no wake, availability, curtailment, turbulence, icing or air-density corrections.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
import turbine_models
import yaml
from turbine_models.parser import Turbines


class TurbineError(ValueError):
    """Unknown turbine or a power curve that fails verification."""


@dataclass
class Turbine:
    name: str
    group: str
    rated_kw: float
    cut_in_ms: float
    cut_out_ms: float
    hub_height_m: float
    rotor_diameter_m: float | None
    curve_type: str | None
    origin: str | None
    package_version: str
    curve_speed: np.ndarray
    curve_power: np.ndarray
    checks: dict

    def meta(self) -> dict:
        d = asdict(self)
        d.pop("curve_speed"); d.pop("curve_power")
        return d


def _spec(name: str, group: str) -> dict:
    path = os.path.join(os.path.dirname(turbine_models.__file__), "specs", group.capitalize(), f"{name}.yaml")
    if not os.path.exists(path):
        raise TurbineError(f"No spec file for turbine '{name}' in group '{group}'")
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _hub_height(raw) -> float | None:
    """Spec hub height may be a number, a list of options, or missing. A list is reduced to its median."""
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)):
        vals = [float(v) for v in raw if v is not None]
        return float(np.median(vals)) if vals else None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def load_turbine(name: str, group: str = "onshore") -> Turbine:
    T = Turbines()
    try:
        table = T.table(name, group)
    except (KeyError, ValueError, IndexError) as exc:
        raise TurbineError(f"Unknown turbine '{name}' in group '{group}'") from exc
    if "power_kw" not in table.columns:
        raise TurbineError(f"Turbine '{name}' only has a normalized power curve (no absolute power_kw)")
    curve = table[["wind_speed_ms", "power_kw"]].dropna().sort_values("wind_speed_ms").reset_index(drop=True)
    spec = _spec(name, group)
    nz = curve[curve.power_kw > 0]
    cut_in = spec.get("cut_in_wind_speed") or float(nz.wind_speed_ms.iloc[0])      # spec value, else derived from the curve
    cut_out = spec.get("cut_out_wind_speed") or float(nz.wind_speed_ms.iloc[-1])
    rated = spec.get("rated_power") or float(curve.power_kw.max())
    hub = _hub_height(spec.get("hub_height"))
    checks = {
        "wind speeds strictly increasing": bool((np.diff(curve.wind_speed_ms) > 0).all()),
        "power non-negative (tiny standby dips tolerated)": bool((curve.power_kw >= -0.01 * rated).all()),
        "peak power == spec rated power (within 1%)": bool(np.isclose(curve.power_kw.max(), rated, rtol=0.01)),
        "curve starts at or just above cut-in (<= 0.5 m/s)": bool(curve.wind_speed_ms.iloc[0] <= cut_in + 0.5),
        "hub height known": hub is not None,
    }
    if not all(checks.values()):
        failed = [k for k, v in checks.items() if not v]
        raise TurbineError(f"Turbine curve '{name}' failed verification: {failed}")
    return Turbine(name=name, group=group, rated_kw=float(rated), cut_in_ms=float(cut_in), cut_out_ms=float(cut_out),
                   hub_height_m=hub, rotor_diameter_m=spec.get("rotor_diameter"), curve_type=spec.get("power_curve_type"),
                   origin=spec.get("origin"), package_version=turbine_models.__version__,
                   curve_speed=curve.wind_speed_ms.to_numpy(float), curve_power=curve.power_kw.to_numpy(float), checks=checks)


def list_turbines(group: str = "onshore") -> list[dict]:
    """Turbines in a group with a flag saying whether they can be used (curve verifies)."""
    out = []
    for name in Turbines().turbines(group).values():
        try:
            t = load_turbine(name, group)
            out.append({"name": name, "group": group, "rated_kw": t.rated_kw, "hub_height_m": t.hub_height_m,
                        "rotor_diameter_m": t.rotor_diameter_m, "usable": True, "reason": None})
        except TurbineError as exc:
            out.append({"name": name, "group": group, "rated_kw": None, "hub_height_m": None,
                        "rotor_diameter_m": None, "usable": False, "reason": str(exc)})
    return out


def to_hub_speed(v_ref, hub_height_m: float, ref_height_m: float = 100.0, shear_alpha: float = 0.14) -> np.ndarray:
    """Power-law extrapolation, applied only when the hub differs from the data height by more than 5 m."""
    v = np.asarray(v_ref, float)
    if abs(hub_height_m - ref_height_m) <= 5:
        return v
    return v * (hub_height_m / ref_height_m) ** shear_alpha


def power_kw(v, t: Turbine) -> np.ndarray:
    """Curve interpolation; zero below cut-in and at/above cut-out (np.interp alone would hold the end values)."""
    v = np.asarray(v, float)
    p = np.maximum(np.interp(v, t.curve_speed, t.curve_power), 0.0)
    return np.where((v < t.cut_in_ms) | (v >= t.cut_out_ms), 0.0, p)


def estimate_energy(speed_ref, t: Turbine, ref_height_m: float = 100.0, shear_alpha: float = 0.14,
                    index: pd.Index | None = None) -> tuple[pd.DataFrame, dict]:
    """Hourly mean power (kW) x 1 h = kWh for speeds at the reference height. Returns (frame, summary)."""
    hub = to_hub_speed(speed_ref, t.hub_height_m, ref_height_m, shear_alpha)
    p = power_kw(hub, t)
    df = pd.DataFrame({"pred_speed_hub_ms": hub, "power_kw": p, "energy_kwh": p * 1.0}, index=index)
    total = float(df.energy_kwh.sum())
    summary = {"total_kwh": total, "capacity_factor": total / (t.rated_kw * len(df)) if len(df) else float("nan"),
               "peak_kw": float(df.power_kw.max()) if len(df) else float("nan"), "hours": int(len(df))}
    return df, summary


def energy_error_proxy(pred_ws: dict[str, np.ndarray], true_ws: np.ndarray, t: Turbine, leads=(1, 6, 12, 24),
                       ref_height_m: float = 100.0, shear_alpha: float = 0.14) -> pd.DataFrame:
    """Energy error PROXY: curve energy from predicted wind vs curve energy from observed (reanalysis) wind, kWh per hour.
    This isolates wind-forecast error; it is not accuracy against measured generation, which is unavailable here."""
    true_p = power_kw(to_hub_speed(true_ws, t.hub_height_m, ref_height_m, shear_alpha), t)
    rows = []
    for model, ws in pred_ws.items():
        e = power_kw(to_hub_speed(ws, t.hub_height_m, ref_height_m, shear_alpha), t) - true_p
        for L in leads:
            rows.append({"model": model, "lead_h": L, "energy_MAE_kWh": float(np.abs(e[:, L - 1]).mean()),
                         "energy_RMSE_kWh": float(np.sqrt((e[:, L - 1] ** 2).mean()))})
        tot = e.sum(1)
        rows.append({"model": model, "lead_h": "24h total", "energy_MAE_kWh": float(np.abs(tot).mean()),
                     "energy_RMSE_kWh": float(np.sqrt((tot ** 2).mean()))})
    return pd.DataFrame(rows)
