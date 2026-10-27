"""API smoke test and parity with the validated notebook outputs."""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import data_service as ds
from app.services.feature_service import check_no_lookahead

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "outputs" / "raw_history_unmodified.csv"
CLEAN = REPO / "outputs" / "clean_hourly_dataset.csv"


def test_health_endpoint():
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["gbm_backend"] == "lightgbm"


def test_cors_allows_only_local_frontend():
    c = TestClient(app)
    ok = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
    bad = c.get("/api/health", headers={"Origin": "http://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


@pytest.mark.skipif(not (RAW.exists() and CLEAN.exists()), reason="notebook outputs not present")
def test_cleaning_reproduces_notebook_clean_dataset():
    raw = pd.read_csv(RAW, parse_dates=["timestamp_utc"])
    expected = pd.read_csv(CLEAN, index_col="timestamp_utc", parse_dates=True)
    got = ds.clean_history(raw, max_gap=3)
    assert list(got.columns) == list(expected.columns)
    assert len(got) == len(expected) and (got.index == expected.index).all()
    for c in got.columns:
        if c == "was_interpolated":
            assert (got[c].astype(bool).values == expected[c].astype(bool).values).all()
        else:
            assert np.allclose(got[c].values, expected[c].values, equal_nan=True, atol=1e-6), c
    # the raw file must still be what the API returned (not de-duplicated / filled)
    assert raw["timestamp_utc"].is_monotonic_increasing and len(raw) >= len(got)


@pytest.mark.skipif(not CLEAN.exists(), reason="notebook outputs not present")
def test_features_on_real_data_have_no_lookahead():
    data = pd.read_csv(CLEAN, index_col="timestamp_utc", parse_dates=True)
    assert check_no_lookahead(data, n=8) == 8
