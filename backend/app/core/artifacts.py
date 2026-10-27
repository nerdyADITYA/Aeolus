"""Files the pipeline writes for the single site (under settings.data_dir/site). Raw data is never overwritten in place by
cleaning: raw.csv is exactly what the API returned; the cleaned dataset is a separate parquet file."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from app.config import settings


def site_dir() -> Path:
    d = settings.data_dir / "site"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path(name: str) -> Path:
    return site_dir() / name


def reset_site_dir() -> None:
    d = settings.data_dir / "site"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True, exist_ok=True)


def write_json(name: str, obj) -> None:
    path(name).write_text(json.dumps(obj, indent=1, default=str), encoding="utf-8")


def read_json(name: str):
    p = path(name)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_clean() -> pd.DataFrame:
    p = path("clean.parquet")
    if not p.exists():
        raise FileNotFoundError("No cleaned dataset yet; the site has not finished preparing")
    return pd.read_parquet(p)


def records(df: pd.DataFrame, index_name: str | None = None) -> list[dict]:
    """DataFrame -> JSON-safe records (NaN -> None, timestamps -> ISO-8601 with Z)."""
    d = df.copy()
    if index_name is not None:
        d = d.reset_index().rename(columns={d.index.name or "index": index_name})
    for c in d.columns:
        if pd.api.types.is_datetime64_any_dtype(d[c]):
            d[c] = d[c].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return json.loads(d.to_json(orient="records"))


def save_backtest(origins: pd.DatetimeIndex, preds: dict[str, dict[str, np.ndarray]], obs: dict[str, np.ndarray], order: list[str]) -> None:
    # ISO strings, not int64: pandas 3 may hold timestamps in us or ns, and a raw integer would silently be misread
    arrays = {"origins": np.array(list(origins.strftime("%Y-%m-%dT%H:%M:%S")), dtype="U19"), **{f"obs_{k}": v for k, v in obs.items()}}
    for i, m in enumerate(order):
        for k in ("ws", "sin", "cos"):
            arrays[f"m{i}_{k}"] = preds[m][k]
    np.savez_compressed(path("backtest_preds.npz"), **arrays)


def load_backtest(order: list[str]) -> dict | None:
    p = path("backtest_preds.npz")
    if not p.exists():
        return None
    z = np.load(p)
    return {"origins": pd.DatetimeIndex(pd.to_datetime(z["origins"])),
            "obs": {k: z[f"obs_{k}"] for k in ("ws", "sin", "cos")},
            "models": {m: {k: z[f"m{i}_{k}"] for k in ("ws", "sin", "cos")} for i, m in enumerate(order)}}
