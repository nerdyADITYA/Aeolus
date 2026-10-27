"""Saving and loading trained model bundles (joblib) with a small JSON sidecar describing them.

Joblib files are Python pickles: only load bundles this application wrote itself.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import joblib


@dataclass
class GbmSpec:
    """Hyperparameters chosen on validation (see gbm_service.tune_gbm)."""
    speed_cfg: str
    speed_delta: bool
    dir_cfg: str
    params: dict                     # {cfg name: {n, lr, leaves, mcs}} for the two chosen configs


@dataclass
class ModelBundle:
    model_id: str
    backend: str                     # lightgbm / xgboost / sklearn-hist
    model_name: str
    spec: GbmSpec
    forecast_hours: int
    cutoff_pos: int                  # position (hour index) of the last observation the models were trained on
    trained_through_utc: str
    feature_cols: list[str]
    models: dict                     # {"ws": {("ws", h): model}, "dir": {("sin"|"cos", h): model}}
    site: dict = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def meta(self) -> dict:
        d = asdict(self)
        d.pop("models")
        d["n_models"] = sum(len(m) for m in self.models.values())
        return d


def save_bundle(bundle: ModelBundle, root: Path) -> Path:
    folder = Path(root) / bundle.model_id
    folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, folder / "model.joblib", compress=3)
    (folder / "meta.json").write_text(json.dumps(bundle.meta(), indent=2, default=str), encoding="utf-8")
    return folder


def load_bundle(folder: Path, root: Path) -> ModelBundle:
    """Load a bundle this application saved. joblib uses pickle, which can execute code on load, so the folder must lie
    inside `root` (the application's own models directory); files from anywhere else are refused."""
    folder, root = Path(folder).resolve(), Path(root).resolve()
    if root not in folder.parents:
        raise ValueError(f"Refusing to load a model outside {root}")
    obj = joblib.load(folder / "model.joblib")  # trusted: written only by save_bundle into `root`
    if not isinstance(obj, ModelBundle):
        raise ValueError(f"{folder} does not contain a ModelBundle")
    return obj


def list_bundles(root: Path) -> list[dict]:
    out = []
    for meta in sorted(Path(root).glob("*/meta.json")):
        try:
            out.append(json.loads(meta.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return out
