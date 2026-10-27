import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { buildSpeedSeries, tickLabel, timeAxis, toMs } from '../../utils/forecast.js';
import { fmtNumber } from '../../utils/format.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ChartTooltip from './ChartTooltip.jsx';

/** Last 48 h observed vs the 24 h ML forecast at 100 m, with the turbine's cut-in speed as a reference. */
export default function SpeedChart({ history, hours, originUtc, cutInMs }) {
  const c = useChartColors();
  const data = useMemo(() => buildSpeedSeries(history, hours), [history, hours]);
  const axis = useMemo(() => timeAxis(data.map((d) => d.t)), [data]);
  const origin = originUtc ? toMs(String(originUtc).replace(' ', 'T') + (String(originUtc).endsWith('Z') ? '' : 'Z')) : null;
  const legend = [
    { label: 'Observed (reanalysis)', color: c.text },
    { label: 'ML forecast', color: c.accent },
    ...(cutInMs ? [{ label: `Cut-in ${cutInMs} m/s`, color: c.muted, kind: 'dash' }] : []),
  ];
  return (
    <ChartCard title="Wind speed at 100 m" sub="Model-only forecast for the next 24 hours; no Forecast API input" legend={legend} about={CHART_INFO.speed}
      label={`Wind speed chart: ${hours.length} forecast hours`}>
      <ResponsiveContainer width="100%" height={330}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={axis.domain} ticks={axis.ticks} tickFormatter={tickLabel} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} unit="" width={44} />
          <Tooltip cursor={{ stroke: c.muted, strokeDasharray: '3 3' }}
            content={<ChartTooltip rows={(p) => [
              { label: 'Observed', value: p.observed !== undefined ? `${fmtNumber(p.observed, 2)} m/s` : null, color: c.text },
              { label: 'Forecast', value: p.forecast !== undefined ? `${fmtNumber(p.forecast, 2)} m/s` : null, color: c.accent },
              { label: 'At hub height', value: p.hub !== undefined && p.hub !== p.forecast ? `${fmtNumber(p.hub, 2)} m/s` : null },
            ]} />} />
          {cutInMs ? <ReferenceLine y={cutInMs} stroke={c.muted} strokeDasharray="5 4" /> : null}
          {origin ? <ReferenceLine x={origin} stroke={c.muted} strokeDasharray="2 4" label={{ value: 'origin', fill: c.muted, fontSize: 10, position: 'insideTopRight' }} /> : null}
          <Line dataKey="observed" stroke={c.text} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          <Area dataKey="forecast" stroke={c.accent} strokeWidth={2.2} fill={c.accent} fillOpacity={0.12} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
SpeedChart.propTypes = {
  history: PropTypes.array.isRequired,
  hours: PropTypes.array.isRequired,
  originUtc: PropTypes.string,
  cutInMs: PropTypes.number,
};
