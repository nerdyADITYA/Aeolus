"""Circular (wind-direction) helpers. Directions are meteorological wind-FROM degrees, 0 = north, clockwise."""
import numpy as np


def circ_err(pred_deg, true_deg):
    """Absolute circular error in degrees, in [0, 180]. 359 vs 1 -> 2."""
    return np.abs((np.asarray(pred_deg) - np.asarray(true_deg) + 180) % 360 - 180)


def signed_angle_difference(target_deg, current_deg):
    """Signed shortest rotation from current to target, in (-180, 180]."""
    return (target_deg - current_deg + 180) % 360 - 180


def to_deg(sin_v, cos_v):
    """Direction in [0, 360) from sine/cosine components."""
    return (np.rad2deg(np.arctan2(sin_v, cos_v)) + 360) % 360


def mean_res_len(sin_v, cos_v):
    """Vector magnitude used as direction confidence, capped at 1.

    The notebook did not cap this, so separately-clipped sin/cos predictions could give values slightly above 1
    (observed 1.0057). Near 0 means the direction is ill-defined.
    """
    return np.minimum(1.0, np.hypot(sin_v, cos_v))
