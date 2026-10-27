import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { leadSeries, modelColor } from '../../utils/models.js';
import ChartCard from './ChartCard.jsx';
import ValueTooltip from './ValueTooltip.jsx';

/** Held-out error by lead time for every model (same colours everywhere). Dashed lines mark the reported leads 1/6/12/24. */
export default function LeadChart({ title, sub, about, byLead, metricKey, mlName, unit, digits = 2, reportedLeads = [1, 6, 12, 24] }) {
  const c = useChartColors();
  const data = useMemo(() => leadSeries(byLead, metricKey), [byLead, metricKey]);
  const models = Object.keys(byLead);
  const legend = models.map((m) => ({ label: m, color: modelColor(m, mlName, c) }));
  return (
    <ChartCard title={title} sub={sub} legend={legend} about={about} label={`${title} for ${models.join(', ')}`}>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="lead" type="number" domain={[1, 24]} ticks={[1, 6, 12, 18, 24]} tickFormatter={(v) => `${v} h`} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} width={44} />
          <Tooltip content={<ValueTooltip title={(l) => `+${l} h lead`} format={(v) => `${v.toFixed(digits)} ${unit}`} />} />
          {reportedLeads.map((l) => <ReferenceLine key={l} x={l} stroke={c.border} strokeDasharray="3 4" />)}
          {models.map((m) => (
            <Line key={m} name={m} dataKey={m} stroke={modelColor(m, mlName, c)} strokeWidth={m === mlName ? 2.6 : 1.6} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
LeadChart.propTypes = {
  title: PropTypes.string.isRequired, sub: PropTypes.string, about: PropTypes.object, byLead: PropTypes.object.isRequired, metricKey: PropTypes.string.isRequired,
  mlName: PropTypes.string.isRequired, unit: PropTypes.string.isRequired, digits: PropTypes.number, reportedLeads: PropTypes.arrayOf(PropTypes.number),
};
