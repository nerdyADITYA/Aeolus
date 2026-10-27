"""Advisory nacelle-heading plan from predicted wind direction (notebook section 17, Phase 6).

Convention: conventional upwind horizontal-axis turbine, heading = wind-FROM direction in degrees (0 = north, clockwise).
The plan follows the prediction only when it is reliable (confidence and speed gates) and ignores changes smaller than a
deadband, so the recommendation does not hunt. Advisory only: nothing here sends turbine commands.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.circular import signed_angle_difference


def yaw_plan(fc: pd.DataFrame, current_heading: float | None, deadband_deg: float, conf_min: float, speed_min: float) -> pd.DataFrame:
    """`fc` needs columns pred_speed_100m_ms, pred_direction_deg, direction_confidence (indexed by time)."""
    cmd = current_heading
    rows = []
    for _, r in fc.iterrows():
        reliable = bool((r.direction_confidence >= conf_min) and (r.pred_speed_100m_ms >= speed_min))
        note = "hold: low confidence or below cut-in/low-speed" if not reliable else "track predicted wind direction"
        if reliable:
            if cmd is None or abs(signed_angle_difference(r.pred_direction_deg, cmd)) > deadband_deg:
                cmd = float(r.pred_direction_deg)
            else:
                note = "hold: within deadband"
        rows.append({"direction_reliable": reliable, "recommended_nacelle_heading_deg": cmd, "yaw_note": note})
    yaw = pd.DataFrame(rows, index=fc.index)
    yaw["recommended_nacelle_heading_deg"] = yaw["recommended_nacelle_heading_deg"].astype(float)
    yaw["yaw_change_vs_prev_hour_deg"] = yaw.recommended_nacelle_heading_deg.diff().map(
        lambda v: np.nan if pd.isna(v) else (v + 180) % 360 - 180)
    if current_heading is not None:
        yaw["yaw_change_from_current_deg"] = [signed_angle_difference(h, current_heading) if pd.notna(h) else np.nan
                                              for h in yaw.recommended_nacelle_heading_deg]
    return yaw
