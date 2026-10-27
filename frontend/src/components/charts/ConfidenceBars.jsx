import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { buildConfidenceSeries, confidenceTooltipRows, tickLabel, timeAxis } from '../../utils/forecast.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ChartTooltip from './ChartTooltip.jsx';

/**
 * Direction confidence R = length of the predicted direction vector (1 = clear, 0 = direction undefined).
 * A direction is acted on only when R is at least the threshold AND the speed is above the usable minimum.
 */
export default function ConfidenceBars({ hours, threshold, minSpeed }) {
  const c = useChartColors();
  const data = useMemo(
    () => buildConfidenceSeries(hours).map((d) => ({ ...d, ok: d.reliable ? d.confidence : 0, low: d.reliable ? 0 : d.confidence })),
    [hours],
  );
  const axis = useMemo(() => timeAxis(data.map((d) => d.t)), [data]);
  const reliableCount = data.filter((d) => d.reliable).length;
  const legend = [
    { label: 'Reliable', color: c.accent, kind: 'dot' },
    { label: 'Not acted on', color: c.muted, kind: 'dot' },
    ...(threshold != null ? [{ label: `Threshold R ≥ ${threshold}`, color: c.warn, kind: 'dash' }] : []),
  ];
  return (
    <ChartCard title="Direction confidence" sub={`${reliableCount} of ${data.length} hours are reliable (R ≥ ${threshold ?? '—'} and speed ≥ ${minSpeed ?? 3} m/s)`} legend={legend} about={CHART_INFO.confidence}
      label={`Direction confidence chart: ${reliableCount} of ${data.length} hours reliable`}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={axis.domain} ticks={axis.ticks} tickFormatter={tickLabel} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} padding={{ left: 8, right: 8 }} />
          <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTooltip rows={(p) => confidenceTooltipRows(p, { threshold, minSpeed: minSpeed ?? 3 })} />} />
          {threshold != null ? <ReferenceLine y={threshold} stroke={c.warn} strokeDasharray="5 4" /> : null}
          <Bar dataKey="ok" stackId="c" fill={c.accent} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="low" stackId="c" fill={c.muted} fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
ConfidenceBars.propTypes = { hours: PropTypes.array.isRequired, threshold: PropTypes.number, minSpeed: PropTypes.number };
