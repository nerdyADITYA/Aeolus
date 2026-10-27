import PropTypes from 'prop-types';
import { utcStamp } from '../../utils/forecast.js';

/**
 * Recharts tooltip content. `rows(point)` returns [{label, value, color?}] for the hovered data point;
 * the heading is the UTC time of the point.
 */
export default function ChartTooltip({ active, payload, rows }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const list = rows(point).filter((r) => r.value !== null && r.value !== undefined && r.value !== '');
  if (!list.length) return null;
  return (
    <div className="tip">
      <div className="tip-title mono">{utcStamp(point.t)}</div>
      {list.map((r) => (
        <div key={r.label} className="tip-row">
          <span>
            {r.color && <i style={{ background: r.color }} aria-hidden="true" />}
            {r.label}
          </span>
          <span className="mono">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
ChartTooltip.propTypes = { active: PropTypes.bool, payload: PropTypes.array, rows: PropTypes.func.isRequired };
