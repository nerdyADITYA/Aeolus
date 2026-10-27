import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { bestPerColumn } from '../../utils/models.js';
import { fmtNumber } from '../../utils/format.js';
import Badge from '../common/Badge.jsx';

// What each model does, in one plain sentence. The ML model is described by whoever calls this (it is the one the app uses).
const MODEL_NOTES = {
  Persistence: 'Assumes the wind stays exactly as it is now',
  'Seasonal naive (24h)': 'Assumes it will be like the same hour yesterday',
  SARIMAX: 'A classic statistics model',
};

const COLUMNS = [
  { key: 'MAE_1-24h', label: 'Speed error: MAE', unit: 'm/s', digits: 2, help: 'Typical size of the wind-speed error' },
  { key: 'RMSE_1-24h', label: 'Speed error: RMSE', unit: 'm/s', digits: 2, help: 'Like MAE, but big misses count more' },
  { key: 'dirMAE_fast_1-24h', label: 'Direction error', unit: '°', digits: 1, help: 'Average angle the direction is off by (wind ≥ 3 m/s)' },
];

/** One simple table: every model, the standard error scores, best first. Lower is better in every column. */
export default function SimpleModelTable({ rows, selection, mlName, split, stale = false }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => a['RMSE_1-24h'] - b['RMSE_1-24h']), [rows]);
  const best = useMemo(() => bestPerColumn(rows, COLUMNS.map((c) => c.key)), [rows]);
  const speedWinner = selection.find((s) => s.target === 'speed')?.winner;
  const dirWinner = selection.find((s) => s.target === 'direction')?.winner;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>How accurate are the models?</h3>
          <p className="sub" style={{ margin: 0 }}>
            Average error over forecasts 1 to 24 hours ahead, on {split.test_origins} past forecasts the models never saw
            ({split.test[0].slice(0, 10)} to {split.test[1].slice(0, 10)}). <strong>Lower is better.</strong>
          </p>
        </div>
        {stale && <Badge tone="warn" title="Data was refreshed after this evaluation ran">evaluation stale</Badge>}
      </div>

      <div className="scroll" style={{ maxHeight: 'none', marginTop: 12 }} tabIndex={0} role="region" aria-label="Model comparison table">
        <table className="data-table simple-models">
          <thead>
            <tr>
              <th><span className="th-btn">Model</span></th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="n" title={c.help}>
                  <span className="th-btn">{c.label} ({c.unit})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.model} className={r.model === mlName ? 'selected' : ''}>
                <td>
                  <div>
                    {r.model} {r.model === speedWinner && r.model === dirWinner && <Badge tone="good">best</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.model === mlName ? 'Machine-learning model used by this app' : MODEL_NOTES[r.model] || ''}</div>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`n mono${r[c.key] === best[c.key] ? ' best' : ''}`}>{fmtNumber(r[c.key], c.digits)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="score-help">
        <div><dt>MAE</dt><dd>Mean absolute error: the typical size of a miss, in the same units as the measurement.</dd></div>
        <div><dt>RMSE</dt><dd>Root mean squared error (the square root of the MSE): like MAE, but large misses count more, which matters because power rises steeply with wind speed.</dd></div>
        <div><dt>Direction error</dt><dd>How many degrees off the predicted wind direction is, on average. 359° versus 1° counts as 2°, not 358°.</dd></div>
      </dl>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        A single &ldquo;accuracy %&rdquo; is not used: wind speed and direction are continuous numbers, so the size of the error is the meaningful score.
        Errors are measured against reanalysis data, not a sensor at the turbine.
      </p>
    </div>
  );
}
SimpleModelTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  selection: PropTypes.arrayOf(PropTypes.object).isRequired,
  mlName: PropTypes.string.isRequired,
  split: PropTypes.shape({ test: PropTypes.array, test_origins: PropTypes.number }).isRequired,
  stale: PropTypes.bool,
};
