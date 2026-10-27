"""Application-level orchestration: site setup, data refresh and forecast runs (plan sections 3.2 and 3.5).

These functions run inside the job runner thread (they take a `progress(message, fraction)` callback) and use the pure
services (data, features, evaluation, forecast, turbine, direction) without changing their behaviour.
"""
from __future__ import annotations

import shutil
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, select

from app.config import settings
from app.core import artifacts as art
from app.core.metrics import score
from app.core.registry import GbmSpec, save_bundle
from app.db.models import DatasetVersion, ForecastRun, ModelVersion, Site, utcnow
from app.db.session import session_scope
from app.services import data_service as ds
from app.services import direction_service as dirs
from app.services import forecast_service as fs
from app.services import gbm_service as gbm
from app.services.eval_data import EvalConfig
from app.services.evaluation_service import run_evaluation
from app.services.feature_service import check_no_lookahead
from app.services.turbine_service import Turbine, load_turbine

LIMITATIONS = [
    "Data are reanalysis (Open-Meteo archive, about 9-25 km grid) at 100 m, not a site sensor; errors measure agreement with that dataset.",
    "The archive lags real time by several days, so a forecast covers the 24 h after the chosen start date, not necessarily after today.",
    "Energy comes from a theoretical NREL power curve with no wake, availability, curtailment, turbulence, icing or air-density losses; "
    "no observed generation exists here, so energy accuracy against real output is not measured.",
    "Direction below the speed threshold or with low confidence is not acted on; yaw output is advisory and no turbine commands are sent.",
    "The Forecast API comparison uses the Previous Runs API; observed values come from the same model family as the API, which favours the API.",
    "Backtest covers about 5 months, so seasonal coverage is limited; point forecasts only (no prediction intervals yet).",
]

# Every site is tuned with the full search: all 8 SARIMAX configs and all 3 LightGBM sizes (None = the services' full grids).
# Tests replace this with a tiny grid so that the API flow runs in seconds.
TUNING = dict(sarimax_grid=None, gbm_grid=None)


def eval_config(local_tz: str) -> EvalConfig:
    return EvalConfig(forecast_hours=settings.forecast_hours, val_days=settings.val_days, test_days=settings.test_days,
                      origin_step_h=settings.origin_step_h, refit_days=settings.refit_days, dir_min_speed=settings.dir_min_speed,
                      local_tz=local_tz, random_seed=settings.random_seed)


@lru_cache(maxsize=32)
def get_turbine(name: str, group: str) -> Turbine:
    return load_turbine(name, group)


# ---------------------------------------------------------------------------------------------------------- data steps
def _ingest(site: Site, progress, lo: float, hi: float) -> pd.DataFrame:
    """Download -> store raw unchanged -> validate -> clean (separate dataset) -> store. Returns the clean frame."""
    progress("Downloading historical data", lo)
    raw = ds.fetch_raw(site.latitude, site.longitude, settings.historical_years, settings.archive_safety_days)
    raw.df.to_csv(art.path("raw.csv"), index=False)                      # exactly as returned; never edited
    progress("Validating data", lo + 0.4 * (hi - lo))
    validation = ds.validate_raw(raw.df, raw.meta, site.latitude, site.longitude, settings.archive_safety_days)
    data = ds.clean_history(raw.df, settings.max_interp_gap_h)
    summary = ds.cleaning_summary(data)
    leak_rows = check_no_lookahead(data, site.local_tz)
    data.to_parquet(art.path("clean.parquet"))
    art.write_json("quality.json", {"validation": validation, "cleaning": summary, "request": raw.params,
                                    "grid_cell": {k: raw.meta.get(k) for k in ("latitude", "longitude", "elevation")},
                                    "feature_leakage_test": {"passed": True, "rows_checked": leak_rows},
                                    "fetched_at": utcnow().isoformat(timespec="seconds")})
    with session_scope() as db:
        db.add(DatasetVersion(start_utc=summary["start_utc"], end_utc=summary["end_utc"], rows=summary["rows"],
                              interpolated_hours=summary["interpolated_hours"], remaining_missing_hours=summary["remaining_missing_hours"]))
        s = db.get(Site, 1)
        s.shear_alpha = float(validation["shear_alpha_10_to_100m"])
    progress("Data ready", hi)
    return data


def _map_eval_progress(base: float, span: float):
    """run_evaluation reports per-stage fractions; map them onto one overall bar."""
    def f(stage: str, frac: float) -> tuple[str, float]:
        if stage.startswith("SARIMAX tuning"):
            x = 0.40 * frac
        elif stage.startswith("SARIMAX held-out"):
            x = 0.40
        elif "tuning" in stage:
            x = 0.45 + 0.30 * frac
        elif "backtest" in stage.lower():
            x = 0.75 + 0.25 * frac
        else:
            x = 0.0
        return stage, base + span * x
    return f


def run_setup(progress) -> dict:
    """Job body: data -> evaluation (baselines, SARIMAX, LightGBM, backtest, selection) -> persist -> first forecast."""
    with session_scope() as db:
        site = db.get(Site, 1)
        tz = site.local_tz
        site_copy = Site(latitude=site.latitude, longitude=site.longitude, local_tz=tz)
    try:
        data = _ingest(site_copy, progress, 0.02, 0.10)
        mapper = _map_eval_progress(0.10, 0.78)
        res = run_evaluation(data, eval_config(tz), TUNING["sarimax_grid"], TUNING["gbm_grid"],
                             progress=lambda stage, frac: progress(*mapper(stage, frac)))
        progress("Saving results", 0.89)
        _persist_evaluation(res, data)
        progress("Generating the first forecast", 0.91)
        out = _forecast(None, lambda m, f: progress(m, 0.91 + 0.08 * f))
        with session_scope() as db:
            s = db.get(Site, 1)
            s.status, s.status_message, s.eval_stale = "ready", None, False
        return {"model": res.ml_name, "speed_winner": res.selection.speed_winner, "direction_winner": res.selection.dir_winner,
                "latest_origin_utc": out["origin_utc"]}
    except Exception as exc:
        with session_scope() as db:
            s = db.get(Site, 1)
            s.status, s.status_message = "error", f"{type(exc).__name__}: {exc}"[:500]
        raise


def _persist_evaluation(res, data: pd.DataFrame) -> None:
    ed, ml = res.ed, res.ml_name
    order = list(res.test_res)
    by_lead = {m: art.records(score(ed, p, ed.test_origins).reset_index()) for m, p in res.test_res.items()}
    evaluation = {
        "created_at": utcnow().isoformat(timespec="seconds"), "ml_name": ml, "model_order": order,
        "split": ed.split_summary(), "config": asdict(ed.cfg),
        "test_table": art.records(res.test_table.reset_index()), "val_table": art.records(res.val_table.reset_index()),
        "by_lead": by_lead, "selection": art.records(res.selection.table.reset_index()),
        "criteria": art.records(res.selection.criteria), "details": res.details, "refit_log": res.refit_log,
        "sarimax_tuning": art.records(res.sarimax.table.reset_index()) if res.sarimax is not None else [],
        "gbm_tuning": art.records(res.gbm.table), "report_md": res.report_md, "limitations": LIMITATIONS}
    art.write_json("evaluation.json", evaluation)
    (art.path("report.md")).write_text(res.report_md, encoding="utf-8")

    dt = dirs.flat_errors(ed, res.test_res[ml], ed.test_origins)
    dv = dirs.flat_errors(ed, res.val_res[ml], ed.val_origins)
    conf_min = dirs.select_conf_threshold(dv)
    diag = dirs.diagnostics(dt, conf_min, ed.cfg.dir_min_speed)
    art.write_json("direction.json", {"model": ml, "conf_min": conf_min, "dir_min_speed": ed.cfg.dir_min_speed,
                                      "sweep": art.records(diag["sweep"]), "by_confidence": art.records(diag["by_confidence"]),
                                      "by_speed": art.records(diag["by_speed"]), "summary": diag["summary"],
                                      "corr_R_error": diag["corr_R_error"]})
    art.save_backtest(data.index[ed.test_origins], res.test_res, {k: ed.Y[k][ed.test_origins] for k in ("ws", "sin", "cos")}, order)

    spec = fs.spec_from_tuning(res.gbm)
    with session_scope() as db:
        site = db.get(Site, 1)
        site.conf_min, site.spec_json = float(conf_min), asdict(spec)
        ds_id = db.scalar(select(DatasetVersion.id).order_by(DatasetVersion.id.desc()).limit(1))
        db.add(ModelVersion(dataset_id=ds_id, model_name=ml, backend=gbm.gbm_backend(),
                            selection_json={"speed": res.selection.speed_winner, "direction": res.selection.dir_winner,
                                            "details": res.details}))


def run_refresh(progress) -> dict:
    """Job body: pull newer archive data so later forecast dates become selectable. The evaluation is not recomputed."""
    with session_scope() as db:
        site = db.get(Site, 1)
        site_copy = Site(latitude=site.latitude, longitude=site.longitude, local_tz=site.local_tz)
    data = _ingest(site_copy, progress, 0.02, 0.95)
    with session_scope() as db:
        db.get(Site, 1).eval_stale = True
    return {"end_utc": str(data.index[-1]), "rows": int(len(data))}


# ---------------------------------------------------------------------------------------------------------- forecasts
def _forecast(origin, progress) -> dict:
    with session_scope() as db:
        site = db.get(Site, 1)
        if site is None or not site.spec_json:
            raise fs.ForecastError("The site has no trained configuration yet; wait for setup to finish")
        spec = GbmSpec(**site.spec_json)
        tz, lat, lon = site.local_tz, site.latitude, site.longitude
        mv = db.scalar(select(ModelVersion.id).order_by(ModelVersion.id.desc()).limit(1))
    data = art.load_clean()
    cfg = eval_config(tz)
    pos = fs.resolve_origin(data, origin, settings.min_history_hours)
    progress("Training models with cutoff at the forecast origin", 0.05)
    bundle = fs.train_bundle(data, cfg, spec, pos, site={"latitude": lat, "longitude": lon})
    progress("Predicting", 0.85)
    fc = fs.predict_from_bundle(bundle, data, pos, tz)
    origin_utc = fc.attrs["origin_utc"]
    settings.models_dir.mkdir(parents=True, exist_ok=True)
    save_bundle(bundle, settings.models_dir)
    _prune_bundles(settings.models_dir, keep=3)
    base = art.records(fc, index_name="timestamp_utc")
    with session_scope() as db:
        db.execute(delete(ForecastRun).where(ForecastRun.origin_utc == origin_utc))
        db.add(ForecastRun(model_version_id=mv, origin_utc=origin_utc, model_dir=bundle.model_id,
                           trained_through_utc=bundle.trained_through_utc, base_json=base))
    progress("Forecast stored", 1.0)
    return {"origin_utc": origin_utc, "trained_through_utc": bundle.trained_through_utc}


def run_forecast_job(origin: str | None):
    return lambda progress: _forecast(origin, progress)


def _prune_bundles(root: Path, keep: int) -> None:
    folders = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True)
    for old in folders[keep:]:
        shutil.rmtree(old, ignore_errors=True)


def base_frame(run: ForecastRun) -> pd.DataFrame:
    df = pd.DataFrame(run.base_json)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"]).dt.tz_localize(None)
    df = df.set_index("timestamp_utc")
    df.attrs["origin_utc"] = run.origin_utc
    return df


def find_run(db, data: pd.DataFrame, origin) -> tuple[ForecastRun | None, int]:
    pos = fs.resolve_origin(data, origin, settings.min_history_hours)
    run = db.scalar(select(ForecastRun).where(ForecastRun.origin_utc == str(data.index[pos])))
    return run, pos


def forecast_payload(site: Site, run: ForecastRun, data: pd.DataFrame) -> dict:
    """Model-only forecast + yaw + energy using the site's CURRENT turbine/yaw settings (no retraining needed)."""
    turbine = get_turbine(site.turbine_name, site.turbine_group)
    fc = base_frame(run)
    final, summ = fs.assemble_output(fc, turbine, site.conf_min if site.conf_min is not None else 0.5, settings.dir_min_speed,
                                     site.yaw_deadband_deg, site.nacelle_heading, 100.0, site.shear_alpha)
    origin_ts = pd.Timestamp(run.origin_utc)
    hist = data.loc[:origin_ts].tail(48)
    history = [{"timestamp_utc": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "speed": None if pd.isna(r.ws) else round(float(r.ws), 3),
                "direction_deg": None if pd.isna(r.wind_direction_deg) else round(float(r.wind_direction_deg), 1)}
               for ts, r in hist.iterrows()]
    return {"origin_utc": run.origin_utc, "trained_through_utc": run.trained_through_utc, "created_at": run.created_at.isoformat(timespec="seconds"),
            "summary": summ, "hours": art.records(final.drop(columns=["forecast_origin_utc"]), index_name="timestamp_utc"),
            "history": history, "turbine": turbine.meta(), "limitations": LIMITATIONS}


def selectable_dates(data: pd.DataFrame) -> dict:
    """Forecast start dates the picker may offer: a date D forecasts that UTC day from the origin D-1 23:00."""
    valid = data[["ws", "dir_sin", "dir_cos"]].notna().all(axis=1)
    last_valid = valid[valid].index[-1]
    last_origin = last_valid if last_valid.hour == 23 else last_valid.normalize() - pd.Timedelta(hours=1)
    if len(data) < settings.min_history_hours:
        return {"earliest_date": None, "latest_date": str((last_origin + pd.Timedelta(hours=1)).date()), "latest_origin_utc": str(last_valid)}
    first_origin = data.index[settings.min_history_hours - 1]
    first = first_origin if first_origin.hour == 23 else first_origin.normalize() + pd.Timedelta(hours=23)
    return {"earliest_date": str((first + pd.Timedelta(hours=1)).date()), "latest_date": str((last_origin + pd.Timedelta(hours=1)).date()),
            "latest_origin_utc": str(last_valid)}
