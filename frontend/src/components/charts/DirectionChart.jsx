import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { buildDirectionSeries, cardinal, tickLabel, timeAxis } from '../../utils/forecast.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ChartTooltip from './ChartTooltip.jsx';

/**
 * Dot marker that Recharts clones with cx/cy. `fill="none"` gives the hollow low-confidence dots.
 * A larger transparent circle sits underneath as the hover target: an SVG circle with fill="none" cannot be hit in its
 * empty centre, and the small dots (r = 2) are hard to hover. Recharts' tooltip events bubble up from either circle.
 */
function Dot({ cx, cy, fill, stroke, r }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={Math.max(r + 5, 8)} fill="transparent" />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={1.6} />
    </g>
  );
}
Dot.propTypes = { cx: PropTypes.number, cy: PropTypes.number, fill: PropTypes.string, stroke: PropTypes.string, r: PropTypes.number };

const TICKS = [0, 90, 180, 270, 360];
const AXIS_LABEL = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' };

/** Wind-from direction as dots (a circular quantity must never be joined by a line). Hollow dots = low-confidence hours. */
export default function DirectionChart({ history, hours }) {
  const c = useChartColors();
  const s = useMemo(() => buildDirectionSeries(history, hours), [history, hours]);
  const axis = useMemo(() => timeAxis([...s.observed, ...s.reliable, ...s.unreliable].map((d) => d.t)), [s]);
  const legend = [
    { label: 'Observed', color: c.text, kind: 'dot' },
    { label: 'Forecast (reliable)', color: c.accent2, kind: 'dot' },
    { label: 'Forecast (low confidence)', color: c.muted, kind: 'ring' },
  ];
  const tip = (label, color) => (p) => [{ label, value: `${Math.round(p.y)}° ${cardinal(p.y)}`, color }, { label: 'Confidence', value: p.conf !== undefined ? p.conf.toFixed(2) : null }];
  return (
    <ChartCard title="Wind direction (from)" sub="Degrees clockwise from north; hollow dots are hours the model is not confident about" legend={legend} about={CHART_INFO.direction}
      label={`Wind direction chart: ${s.reliable.length} reliable and ${s.unreliable.length} low-confidence forecast hours`}>
      <ResponsiveContainer width="100%" height={250}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>   {/* a scatter chart gives every dot its own tooltip; a ComposedChart only hovers the first series */}
          <CartesianGrid stroke={c.grid} />
          <XAxis dataKey="t" type="number" domain={axis.domain} ticks={axis.ticks} tickFormatter={tickLabel} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis dataKey="y" type="number" domain={[0, 360]} ticks={TICKS} tickFormatter={(v) => `${AXIS_LABEL[v]} ${v % 360}°`} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
          <Tooltip cursor={false} content={<ChartTooltip rows={(p) => (p.kind ? tip(p.kind, p.color)(p) : [])} />} />
          <Scatter name="Observed" data={s.observed.map((d) => ({ ...d, kind: 'Observed', color: c.text }))} shape={<Dot fill={c.text} stroke={c.text} r={2} />} isAnimationActive={false} />
          <Scatter name="Reliable" data={s.reliable.map((d) => ({ ...d, kind: 'Forecast', color: c.accent2 }))} shape={<Dot fill={c.accent2} stroke={c.accent2} r={4} />} isAnimationActive={false} />
          <Scatter name="Low confidence" data={s.unreliable.map((d) => ({ ...d, kind: 'Forecast (low confidence)', color: c.muted }))} shape={<Dot fill="none" stroke={c.muted} r={4} />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
DirectionChart.propTypes = { history: PropTypes.array.isRequired, hours: PropTypes.array.isRequired };
