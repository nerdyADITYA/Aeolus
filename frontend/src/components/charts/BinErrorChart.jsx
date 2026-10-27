import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { prettyBin } from '../../utils/models.js';
import ChartCard from './ChartCard.jsx';
import ValueTooltip from './ValueTooltip.jsx';

/** Mean circular direction error (degrees) per bin, e.g. by predicted confidence R or by observed wind speed. */
export default function BinErrorChart({ title, sub, about, rows, binKey, xLabel, unit = '', color }) {
  const c = useChartColors();
  const data = useMemo(() => rows.map((r) => ({ bin: prettyBin(r[binKey]), mean: r.mean, median: r.median, count: r.count })), [rows, binKey]);
  return (
    <ChartCard title={title} sub={sub} about={about} label={`${title}: ${data.map((d) => `${d.bin}${unit} ${Math.round(d.mean)} degrees`).join(', ')}`}>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 16, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="bin" stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: c.muted, fontSize: 11 }} />
          <YAxis stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="°" width={48} />
          <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }}
            content={<ValueTooltip title={(l) => `${xLabel}: ${l}${unit}`} format={(v) => `${v.toFixed(1)}°`} extra={(p) => `median ${p.median.toFixed(1)}° · ${p.count.toLocaleString()} hours`} />} />
          <Bar name="Mean error" dataKey="mean" fill={color || c.accent2} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
BinErrorChart.propTypes = {
  title: PropTypes.string.isRequired, sub: PropTypes.string, about: PropTypes.object, rows: PropTypes.array.isRequired, binKey: PropTypes.string.isRequired,
  xLabel: PropTypes.string.isRequired, unit: PropTypes.string, color: PropTypes.string,
};
