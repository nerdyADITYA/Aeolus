import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { buildEnergySeries, powerTooltipRows, tickLabel, timeAxis, zeroPowerRuns } from '../../utils/forecast.js';
import { fmtNumber } from '../../utils/format.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ChartTooltip from './ChartTooltip.jsx';

/** Hourly mean power from the NREL curve (bars; kW x 1 h = kWh) and the running energy total (line, right axis). */
export default function PowerEnergyChart({ hours, ratedKw, turbineName, cutInMs, cutOutMs }) {
  const c = useChartColors();
  const data = useMemo(() => buildEnergySeries(hours), [hours]);
  const axis = useMemo(() => timeAxis(data.map((d) => d.t)), [data]);
  const runs = useMemo(() => zeroPowerRuns(data), [data]);
  const total = data.length ? data[data.length - 1].cumulative : 0;
  const legend = [
    { label: 'Hourly power (kW)', color: c.accent2, kind: 'dot' },
    { label: 'Cumulative energy (kWh)', color: c.accent },
    ...(ratedKw ? [{ label: `Rated ${fmtNumber(ratedKw)} kW`, color: c.muted, kind: 'dash' }] : []),
    ...(runs.length ? [{ label: `No bar = no power${cutInMs ? ` (wind below cut-in ${cutInMs} m/s)` : ''}`, color: c.muted, kind: 'ring' }] : []),
  ];
  return (
    <ChartCard title="Hourly power and energy" sub={`${turbineName || 'NREL turbine'} · idealised curve: no wake, availability or air-density losses · total ${fmtNumber(total)} kWh`} legend={legend} about={CHART_INFO.power}
      label={`Power and energy chart: ${fmtNumber(total)} kWh over ${data.length} hours`}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={axis.domain} ticks={axis.ticks} tickFormatter={tickLabel} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} padding={{ left: 8, right: 8 }} />
          <YAxis yAxisId="kw" stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} allowDecimals={false} width={52} />
          <YAxis yAxisId="kwh" orientation="right" stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} width={56} />
          <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTooltip rows={(p) => powerTooltipRows(p, { cutIn: cutInMs, cutOut: cutOutMs })
            .map((r) => ({ ...r, color: r.kind === 'power' ? c.accent2 : r.kind === 'cumulative' ? c.accent : undefined }))} />} />
          {runs.map((r) => (
            <ReferenceArea key={r.from} yAxisId="kw" x1={r.from} x2={r.to} fill={c.muted} fillOpacity={0.14} stroke={c.muted} strokeOpacity={0.3} strokeDasharray="3 4"
              label={{ value: 'below cut-in', position: 'insideTop', fill: c.muted, fontSize: 10 }} />
          ))}
          {ratedKw ? <ReferenceLine yAxisId="kw" y={ratedKw} stroke={c.muted} strokeDasharray="5 4" ifOverflow="hidden" /> : null}
          <Bar yAxisId="kw" dataKey="power" fill={c.accent2} fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Line yAxisId="kwh" dataKey="cumulative" stroke={c.accent} strokeWidth={2.2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
PowerEnergyChart.propTypes = { hours: PropTypes.array.isRequired, ratedKw: PropTypes.number, turbineName: PropTypes.string, cutInMs: PropTypes.number, cutOutMs: PropTypes.number };
