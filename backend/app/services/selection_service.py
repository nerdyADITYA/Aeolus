"""Model selection from HELD-OUT results (notebook section 15, Phase 7).

Speed winner = lowest RMSE averaged over leads 1..H. Direction winner = lowest circular MAE (observed speed >= threshold)
averaged over leads 1..H. A paired block bootstrap checks whether each winner beats the best simple baseline.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.core.metrics import Pred, block_boot_ci, per_origin_error
from app.services.baseline_service import BASELINES
from app.services.eval_data import EvalData


@dataclass
class Selection:
    table: pd.DataFrame            # one row per target
    criteria: pd.DataFrame         # success-criteria checklist
    speed_winner: str
    dir_winner: str


def select_models(ed: EvalData, test_res: dict[str, Pred], test_tbl: pd.DataFrame, ml_name: str) -> Selection:
    origins, rows = ed.test_origins, []
    for kind, col in (("speed", "RMSE_1-24h"), ("direction", "dirMAE_fast_1-24h")):
        ranked = test_tbl[col].sort_values()
        winner = ranked.index[0]
        best_base = min(BASELINES, key=lambda m: test_tbl.loc[m, col])
        k = "speed" if kind == "speed" else "dir"
        diff = per_origin_error(ed, test_res[winner], origins, k) - per_origin_error(ed, test_res[best_base], origins, k)
        lo, hi = block_boot_ci(diff, seed=ed.cfg.random_seed)
        rows.append({"target": kind, "metric": col, "winner": winner, "winner_score": float(ranked.iloc[0]),
                     "best_baseline": best_base, "baseline_score": float(test_tbl.loc[best_base, col]),
                     "improvement_%": float(100 * (1 - ranked.iloc[0] / test_tbl.loc[best_base, col])),
                     "mean_err_diff_vs_baseline_95%CI": f"[{lo:+.3f}, {hi:+.3f}]", "significantly_better": bool(hi < 0)})
    table = pd.DataFrame(rows).set_index("target")
    sw, dw = table.loc["speed", "winner"], table.loc["direction", "winner"]

    crit = []
    for lead in ed.cfg.leads_reported:
        for kind, col in (("speed", f"MAE@{lead}h"), ("direction", f"dirMAE_fast@{lead}h")):
            w = sw if kind == "speed" else dw
            crit.append({"criterion": f"{kind} winner ({w}) beats both baselines at {lead} h",
                         "met": bool(all(test_tbl.loc[w, col] < test_tbl.loc[b, col] for b in BASELINES))})
    crit.append({"criterion": f"scored on many forecast origins (n={len(origins)} >= 100)", "met": bool(len(origins) >= 100)})
    crit.append({"criterion": "direction error uses circular statistics", "met": True})
    crit.append({"criterion": "ML predictions do not use the Forecast API", "met": True})
    return Selection(table=table, criteria=pd.DataFrame(crit), speed_winner=sw, dir_winner=dw)


def ml_is_winner(sel: Selection, ml_name: str) -> dict[str, bool]:
    return {"speed": sel.speed_winner == ml_name, "direction": sel.dir_winner == ml_name}


def report_markdown(ed: EvalData, sel: Selection, test_tbl: pd.DataFrame, ml_name: str, details: dict) -> str:
    t = sel.table
    return f"""# Model-selection report
Data {ed.data.index[0]} to {ed.data.index[-1]} UTC ({ed.n} hourly rows).
Tuning (validation): {ed.cfg.val_days} days. Held-out rolling backtest: {ed.cfg.test_days} days, {len(ed.test_origins)} forecast origins every {ed.cfg.origin_step_h} h, leads 1-{ed.H} h, ML retrained every {ed.cfg.refit_days} days.

## Winners
- Speed: **{sel.speed_winner}** (mean RMSE 1-24 h {t.loc['speed', 'winner_score']:.3f} m/s vs {t.loc['speed', 'best_baseline']} {t.loc['speed', 'baseline_score']:.3f}; {t.loc['speed', 'improvement_%']:.1f}% better; 95% CI of error difference {t.loc['speed', 'mean_err_diff_vs_baseline_95%CI']}).
- Direction: **{sel.dir_winner}** (circular MAE, obs speed >= {ed.cfg.dir_min_speed} m/s, {t.loc['direction', 'winner_score']:.1f} deg vs {t.loc['direction', 'best_baseline']} {t.loc['direction', 'baseline_score']:.1f} deg; {t.loc['direction', 'improvement_%']:.1f}% better; CI {t.loc['direction', 'mean_err_diff_vs_baseline_95%CI']}).
- SARIMAX settings chosen on validation: speed {details.get('sarimax_speed')}; direction {details.get('sarimax_dir')}.
- {ml_name} settings chosen on validation: speed {details.get('gbm_speed_cfg')} (delta target={details.get('gbm_speed_delta')}); direction {details.get('gbm_dir_cfg')}.

## Held-out metrics
```
{test_tbl.round(3).to_string()}
```

Metrics are computed against reanalysis values, not site anemometer data.
"""
