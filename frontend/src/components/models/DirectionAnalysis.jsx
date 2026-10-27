import PropTypes from 'prop-types';
import { useChartColors } from '../../hooks/useChartColors.js';
import { fmtNumber } from '../../utils/format.js';
import BinErrorChart from '../charts/BinErrorChart.jsx';
import { CHART_INFO } from '../charts/chartInfo.js';

/**
 * When can the predicted direction be trusted? The vector magnitude R (confidence) and the observed wind speed
 * both predict the realised circular error; the reliability threshold was chosen on the validation block.
 */
export default function DirectionAnalysis({ direction }) {
  const c = useChartColors();
  const s = direction.summary;
  const entries = Object.entries(s);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <h3>Direction reliability ({direction.model})</h3>
        <p className="sub">
          A direction is acted on only when R ≥ {direction.conf_min} and the speed is at least {direction.dir_min_speed} m/s.
          Correlation between R and error: {fmtNumber(direction.corr_R_error, 2)} (negative = more confident, smaller error).
        </p>
        <div className="grid g-4">
          {entries.map(([label, value]) => (
            <div key={label} className="stat-tile">
              <div className="label">{label}</div>
              <div className="mono value">{fmtNumber(value, 1)}<span className="unit">° error</span></div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid g-2">
        <BinErrorChart title="Error by predicted confidence" sub="Mean circular error per bin of R" about={CHART_INFO.errorByConfidence} rows={direction.by_confidence} binKey="R_bin" xLabel="Confidence R" color={c.accent} />
        <BinErrorChart title="Error by observed wind speed" sub="Direction is unstable in light wind" about={CHART_INFO.errorBySpeed} rows={direction.by_speed} binKey="speed_bin" xLabel="Wind speed" unit=" m/s" color={c.accent2} />
      </div>
      <div className="card">
        <h3>Threshold trade-off</h3>
        <p className="sub">Raising the confidence threshold lowers the error of the hours you keep, but acts on fewer hours.</p>
        <div className="scroll" style={{ maxHeight: 300 }} tabIndex={0} role="region" aria-label="Confidence threshold sweep">
          <table className="data-table">
            <thead>
              <tr><th className="n"><span className="th-btn">Threshold R ≥</span></th><th className="n"><span className="th-btn">Hours kept</span></th><th className="n"><span className="th-btn">Circular error of kept hours</span></th></tr>
            </thead>
            <tbody>
              {direction.sweep.map((r) => (
                <tr key={r.R_threshold} className={r.R_threshold === direction.conf_min ? 'selected' : ''}>
                  <td className="n mono">{r.R_threshold}{r.R_threshold === direction.conf_min && ' (chosen)'}</td>
                  <td className="n mono">{fmtNumber(r['coverage_%'], 1)}%</td>
                  <td className="n mono">{fmtNumber(r.circ_MAE_kept_deg, 1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
DirectionAnalysis.propTypes = {
  direction: PropTypes.shape({
    model: PropTypes.string, conf_min: PropTypes.number, dir_min_speed: PropTypes.number, corr_R_error: PropTypes.number,
    summary: PropTypes.object, by_confidence: PropTypes.array, by_speed: PropTypes.array, sweep: PropTypes.array,
  }).isRequired,
};
