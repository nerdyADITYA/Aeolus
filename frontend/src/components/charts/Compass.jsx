import PropTypes from 'prop-types';
import { useChartColors } from '../../hooks/useChartColors.js';
import { cardinal, compassFor, noteDetail, shortNote, utcTime, toMs } from '../../utils/forecast.js';
import Badge from '../common/Badge.jsx';
import ChartInfo from './ChartInfo.jsx';
import { CHART_INFO } from './chartInfo.js';

const C = 100;
const R = 78;
const rad = (deg) => (deg * Math.PI) / 180;
const pt = (deg, r) => [C + Math.sin(rad(deg)) * r, C - Math.cos(rad(deg)) * r];

/**
 * Compass for one forecast hour. The needle points to where the wind comes FROM (a conventional upwind turbine faces it).
 * The accent marker on the ring is the advisory nacelle heading; it stays put while the direction is unreliable or the
 * change is inside the deadband. A slider picks the forecast hour.
 */
export default function Compass({ hours, lead, onLeadChange }) {
  const c = useChartColors();
  const view = compassFor(hours, lead);
  if (!view) return null;
  const needleColor = view.reliable ? c.accent : c.muted;
  return (
    <div className="card compass-card">
      <h3>Recommended heading</h3>
      <p className="sub">Needle = wind comes from here. Marker = advisory nacelle heading.</p>
      <svg viewBox="0 0 200 200" className="compass" role="img" aria-label={`Compass at +${view.lead} hours: wind from ${Math.round(view.predicted)} degrees ${cardinal(view.predicted)}`}>
        <circle cx={C} cy={C} r={R} fill="none" stroke={c.border} strokeWidth="1.5" />
        <circle cx={C} cy={C} r={R - 24} fill="none" stroke={c.grid} />
        {Array.from({ length: 12 }, (_, i) => i * 30).map((a) => {
          const [x1, y1] = pt(a, R);
          const [x2, y2] = pt(a, R - (a % 90 ? 4 : 9));
          return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.muted} />;
        })}
        {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([n, a]) => {
          const [x, y] = pt(a, R + 15);
          return <text key={n} x={x} y={y + 4} textAnchor="middle" fill={c.muted} fontSize="11">{n}</text>;
        })}
        <g transform={`rotate(${view.predicted} ${C} ${C})`}>
          <line x1={C} y1={C - 2} x2={C} y2={C + R - 30} stroke={needleColor} strokeOpacity="0.35" strokeDasharray="3 4" />
          <path d={`M${C} ${C - R + 8}L${C + 7} ${C + 6}L${C} ${C - 2}L${C - 7} ${C + 6}Z`} fill={needleColor} />
        </g>
        {view.heading != null && (
          <g transform={`rotate(${view.heading} ${C} ${C})`} data-testid="heading-marker">
            <path d={`M${C} ${C - R - 6}L${C + 5} ${C - R - 15}L${C - 5} ${C - R - 15}Z`} fill={c.accent2} />
          </g>
        )}
        <circle cx={C} cy={C} r="4" fill={needleColor} />
      </svg>
      <div className="compass-read">
        <div className="mono big">{Math.round(view.predicted)}° <span className="muted">{cardinal(view.predicted)}</span></div>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <Badge tone={view.reliable ? 'good' : 'neutral'}>{view.reliable ? 'reliable' : 'not acted on'}</Badge>
          <span className="muted">R {view.confidence.toFixed(2)} · {view.speed.toFixed(2)} m/s</span>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Heading <strong className="mono" style={{ color: 'var(--text)', fontWeight: 500 }}>{view.heading != null ? `${Math.round(view.heading)}°` : '—'}</strong>
          {' · '}{shortNote(view.note)}{noteDetail(view.note) ? ` (${noteDetail(view.note)})` : ''}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="compass-hour">Forecast hour: +{view.lead} h · {utcTime(toMs(view.timestamp_utc))} UTC</label>
        <input id="compass-hour" type="range" min={1} max={hours.length} step={1} value={view.lead} onChange={(e) => onLeadChange(Number(e.target.value))} />
      </div>
      <ChartInfo about={CHART_INFO.compass} />
    </div>
  );
}
Compass.propTypes = { hours: PropTypes.array.isRequired, lead: PropTypes.number.isRequired, onLeadChange: PropTypes.func.isRequired };
