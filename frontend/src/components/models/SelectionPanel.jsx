import PropTypes from 'prop-types';
import { fmtNumber } from '../../utils/format.js';
import Badge from '../common/Badge.jsx';

const TARGETS = {
  speed: { title: 'Speed winner', unit: 'm/s', digits: 3, metric: 'mean RMSE over leads 1–24 h' },
  direction: { title: 'Direction winner', unit: '°', digits: 1, metric: 'mean circular error over leads 1–24 h, wind ≥ 3 m/s' },
};

/** Which model wins on held-out data, by how much, and whether that gain beats chance (block bootstrap). */
export default function SelectionPanel({ selection, criteria, split }) {
  const allMet = criteria.length > 0 && criteria.every((c) => c.met);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid g-2">
        {selection.map((s) => {
          const t = TARGETS[s.target] || { title: s.target, unit: '', digits: 2, metric: s.metric };
          return (
            <div key={s.target} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{t.title}</h3>
                <Badge tone={s.significantly_better ? 'good' : 'warn'}>{s.significantly_better ? 'significantly better' : 'not significant'}</Badge>
              </div>
              <div>
                <div className="stat-big mono">{s.winner}</div>
                <div className="muted">{fmtNumber(s['improvement_%'], 1)}% lower error than {s.best_baseline}</div>
              </div>
              <table className="kv">
                <tbody>
                  <tr><td>{s.winner}</td><td className="mono">{fmtNumber(s.winner_score, t.digits)} {t.unit}</td></tr>
                  <tr><td>{s.best_baseline} (best baseline)</td><td className="mono">{fmtNumber(s.baseline_score, t.digits)} {t.unit}</td></tr>
                  <tr><td>95% interval of the error difference</td><td className="mono">{s['mean_err_diff_vs_baseline_95%CI']}</td></tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12 }}>Score: {t.metric}. An interval entirely below zero means the winner is closer on average than the baseline.</p>
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <h3>Success criteria</h3>
            <p className="sub" style={{ margin: 0 }}>
              Scored on {split.test_origins} forecast origins between {split.test[0].slice(0, 10)} and {split.test[1].slice(0, 10)} (held out). Tuning used {split.val_origins} validation origins before that.
            </p>
          </div>
          <Badge tone={allMet ? 'good' : 'warn'}>{allMet ? 'all met' : 'some not met'}</Badge>
        </div>
        <ul className="checklist">
          {criteria.map((c) => (
            <li key={c.criterion} className={c.met ? 'met' : 'unmet'}>
              <span aria-hidden="true">{c.met ? '✓' : '✗'}</span>
              <span className="sr-only">{c.met ? 'Met: ' : 'Not met: '}</span>
              {c.criterion}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
SelectionPanel.propTypes = {
  selection: PropTypes.array.isRequired, criteria: PropTypes.array.isRequired,
  split: PropTypes.shape({ test: PropTypes.array, test_origins: PropTypes.number, val_origins: PropTypes.number }).isRequired,
};
