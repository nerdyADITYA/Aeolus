"""Phase 2 baselines every more complex model must beat."""
from __future__ import annotations

import numpy as np

from app.core.metrics import Pred
from app.services.eval_data import EvalData

PERSISTENCE = "Persistence"
SEASONAL_NAIVE = "Seasonal naive (24h)"
BASELINES = (PERSISTENCE, SEASONAL_NAIVE)


def persistence(ed: EvalData, origins: np.ndarray) -> Pred:
    """Every lead repeats the latest observation (speed and the unit direction vector)."""
    H = ed.H
    return {"ws": np.repeat(ed.ws[origins][:, None], H, 1),
            "sin": np.repeat(ed.sn[origins][:, None], H, 1),
            "cos": np.repeat(ed.cs[origins][:, None], H, 1)}


def seasonal_naive(ed: EvalData, origins: np.ndarray) -> Pred:
    """Hour t+h is predicted by the observation 24 h earlier (t+h-24), which is always known at the origin."""
    return {k: ed.S[k][origins].copy() for k in ("ws", "sin", "cos")}
