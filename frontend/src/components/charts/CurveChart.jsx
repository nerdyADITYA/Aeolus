import PropTypes from 'prop-types';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { fmtNumber } from '../../utils/format.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ValueTooltip from './ValueTooltip.jsx';

/** Verified NREL power curve with cut-in, rated and cut-out marked. Power is zero below cut-in and at/above cut-out. */
export default function CurveChart({ curve, turbine }) {
  const c = useChartColors();
  const legend = [
    { label: 'Power curve', color: c.accent },
    { label: `Cut-in ${turbine.cut_in_ms} m/s`, color: c.good, kind: 'dash' },
    { label: `Cut-out ${turbine.cut_out_ms} m/s`, color: c.bad, kind: 'dash' },
    { label: `Rated ${fmtNumber(turbine.rated_kw)} kW`, color: c.muted, kind: 'dash' },
  ];
  return (
    <ChartCard title="Power curve" sub="Theoretical curve from the NREL turbine-models package" legend={legend} about={CHART_INFO.curve} label={`Power curve of ${turbine.name}`}>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="wind_speed_ms" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${v}`} unit="" stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} domain={[0, 'auto']} />
          <Tooltip content={<ValueTooltip title={(l) => `${Number(l).toFixed(2)} m/s`} format={(v) => `${fmtNumber(v)} kW`} />} />
          <ReferenceLine x={turbine.cut_in_ms} stroke={c.good} strokeDasharray="5 4" />
          <ReferenceLine x={turbine.cut_out_ms} stroke={c.bad} strokeDasharray="5 4" ifOverflow="hidden" />
          <ReferenceLine y={turbine.rated_kw} stroke={c.muted} strokeDasharray="5 4" />
          <Line name="Power" dataKey="power_kw" stroke={c.accent} strokeWidth={2.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
CurveChart.propTypes = {
  curve: PropTypes.arrayOf(PropTypes.shape({ wind_speed_ms: PropTypes.number, power_kw: PropTypes.number })).isRequired,
  turbine: PropTypes.shape({ name: PropTypes.string, cut_in_ms: PropTypes.number, cut_out_ms: PropTypes.number, rated_kw: PropTypes.number }).isRequired,
};
