import { useState } from 'react';
import PropTypes from 'prop-types';
import { bestPerColumn } from '../../utils/models.js';
import { fmtNumber } from '../../utils/format.js';
import Badge from '../common/Badge.jsx';

const LEADS = [1, 6, 12, 24];
const VIEWS = {
  speed: {
    label: 'Speed (m/s)', winnerKey: 'speed', digits: 3,
    groups: [
      { title: 'MAE', cols: [...LEADS.map((l) => [`MAE@${l}h`, `${l} h`]), ['MAE_1-24h', '1–24 h']] },
      { title: 'RMSE', cols: [...LEADS.map((l) => [`RMSE@${l}h`, `${l} h`]), ['RMSE_1-24h', '1–24 h']] },
    ],
  },
  direction: {
    label: 'Direction (°)', winnerKey: 'direction', digits: 1,
    groups: [
      { title: 'Circular MAE, wind ≥ 3 m/s', cols: [...LEADS.map((l) => [`dirMAE_fast@${l}h`, `${l} h`]), ['dirMAE_fast_1-24h', '1–24 h']] },
      { title: 'All hours', cols: [['dirMAE_all_1-24h', '1–24 h']] },
    ],
  },
};

/** Held-out metrics per model. The lowest value in each column is highlighted; errors are against reanalysis, not a site sensor. */
export default function MetricsTable({ rows, selection, mlName }) {
  const [view, setView] = useState('speed');
  const v = VIEWS[view];
  const cols = v.groups.flatMap((g) => g.cols.map(([k]) => k));
  const best = bestPerColumn(rows, cols);
  const winner = selection.find((s) => s.target === v.winnerKey)?.winner;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3>Held-out metrics by model</h3>
          <p className="sub" style={{ margin: 0 }}>Lower is better. Highlighted = best in the column.</p>
        </div>
        <div className="seg" role="group" aria-label="Metric view">
          {Object.entries(VIEWS).map(([id, x]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{x.label}</button>
          ))}
        </div>
      </div>
      <div className="scroll" tabIndex={0} role="region" aria-label="Model metrics table">
        <table className="data-table">
          <thead>
            <tr>
              <th rowSpan={2}><span className="th-btn">Model</span></th>
              {v.groups.map((g) => <th key={g.title} colSpan={g.cols.length} className="n group-head"><span className="th-btn">{g.title}</span></th>)}
            </tr>
            <tr>
              {v.groups.flatMap((g) => g.cols.map(([k, label]) => <th key={k} className="n"><span className="th-btn">{label}</span></th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className={r.model === mlName ? 'selected' : ''}>
                <td>
                  {r.model} {r.model === winner && <Badge tone="good">selected</Badge>}
                </td>
                {cols.map((k) => (
                  <td key={k} className={`n mono${r[k] === best[k] ? ' best' : ''}`}>{fmtNumber(r[k], v.digits)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
MetricsTable.propTypes = { rows: PropTypes.array.isRequired, selection: PropTypes.array.isRequired, mlName: PropTypes.string.isRequired };
