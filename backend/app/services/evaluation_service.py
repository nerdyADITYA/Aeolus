"""Orchestrates Phases 2-5 and 7: baselines -> SARIMAX -> gradient boosting -> rolling backtest -> selection.

`run_evaluation` is what the Phase 4 job runner will call; it reports progress through an optional callback.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from app.core.metrics import Pred, summarize
from app.services import baseline_service as bl
from app.services import gbm_service as gbm
from app.services import sarimax_service as sar
from app.services import selection_service as sel
from app.services.eval_data import EvalConfig, EvalData

Progress = Callable[[str, float], None]


@dataclass
class EvaluationResult:
    ed: EvalData
    ml_name: str
    val_res: dict[str, Pred]
    test_res: dict[str, Pred]
    val_table: pd.DataFrame
    test_table: pd.DataFrame
    sarimax: sar.SarimaxTuning | None
    gbm: gbm.GbmTuning
    refit_log: list[dict]
    selection: sel.Selection
    report_md: str
    details: dict = field(default_factory=dict)


def run_evaluation(data: pd.DataFrame, cfg: EvalConfig | None = None, sarimax_grid: dict | None = None,
                   gbm_grid: dict | None = None, include_sarimax: bool = True,
                   progress: Progress | None = None) -> EvaluationResult:
    ed = EvalData.build(data, cfg)
    note = progress or (lambda stage, frac: None)
    ml_name = gbm.model_name()

    note("Baselines", 0.0)
    val_res: dict[str, Pred] = {bl.PERSISTENCE: bl.persistence(ed, ed.val_origins),
                                bl.SEASONAL_NAIVE: bl.seasonal_naive(ed, ed.val_origins)}
    test_res: dict[str, Pred] = {bl.PERSISTENCE: bl.persistence(ed, ed.test_origins),
                                 bl.SEASONAL_NAIVE: bl.seasonal_naive(ed, ed.test_origins)}

    sar_tuning = None
    if include_sarimax:
        note("SARIMAX tuning", 0.0)
        sar_tuning = sar.tune_sarimax(ed, sarimax_grid, progress)
        val_res["SARIMAX"] = sar_tuning.val_pred
        note("SARIMAX held-out backtest", 0.0)
        test_res["SARIMAX"] = sar.backtest_sarimax(ed, sar_tuning)

    note(f"{ml_name} tuning", 0.0)
    g_tuning = gbm.tune_gbm(ed, gbm_grid, progress)
    val_res[ml_name] = g_tuning.val_pred
    note(f"{ml_name} rolling backtest", 0.0)
    test_res[ml_name], refit_log = gbm.rolling_backtest_gbm(ed, g_tuning, progress)

    val_table = summarize(ed, val_res, ed.val_origins)
    test_table = summarize(ed, test_res, ed.test_origins)
    selection = sel.select_models(ed, test_res, test_table, ml_name)
    details = {"sarimax_speed": sar_tuning.best_speed if sar_tuning else None,
               "sarimax_dir": sar_tuning.best_dir if sar_tuning else None,
               "gbm_speed_cfg": g_tuning.speed_cfg, "gbm_speed_delta": g_tuning.speed_delta, "gbm_dir_cfg": g_tuning.dir_cfg}
    report = sel.report_markdown(ed, selection, test_table, ml_name, details)
    note("Done", 1.0)
    return EvaluationResult(ed=ed, ml_name=ml_name, val_res=val_res, test_res=test_res, val_table=val_table,
                            test_table=test_table, sarimax=sar_tuning, gbm=g_tuning, refit_log=refit_log,
                            selection=selection, report_md=report, details=details)
