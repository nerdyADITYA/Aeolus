import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useChartColors.js';
import { buildModelVsApiSeries, modelVsApiRows, tickLabel, timeAxis } from '../../utils/forecast.js';
import ChartCard from './ChartCard.jsx';
import { CHART_INFO } from './chartInfo.js';
import ChartTooltip from './ChartTooltip.jsx';

/** Our model's wind-speed forecast and Open-Meteo's forecast for the same 24 hours, one line each. */
export default function ModelVsApiChart({ hours, sub }) {
  const c = useChartColors();
  const data = useMemo(() => buildModelVsApiSeries(hours), [hours]);
  const axis = useMemo(() => timeAxis(data.map((d) => d.t)), [data]);
  const legend = [
    { label: 'Our model', color: c.accent },
    { label: 'Open-Meteo forecast (issued the day before)', color: c.warn, kind: 'dash' },
  ];
  return (
    <ChartCard title="Wind speed forecast: our model vs Open-Meteo" sub={sub} legend={legend} about={CHART_INFO.modelVsApi}
      label={`Our model and the Open-Meteo forecast of wind speed for the same ${hours.length} hours`}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={axis.domain} ticks={axis.ticks} tickFormatter={tickLabel} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} width={44} label={{ value: 'm/s', angle: -90, position: 'insideLeft', fill: c.muted, fontSize: 11, dx: 14 }} />
          <Tooltip cursor={{ stroke: c.muted, strokeDasharray: '3 3' }}
            content={<ChartTooltip rows={(p) => modelVsApiRows(p).map((r) => ({ ...r, color: r.kind === 'model' ? c.accent : r.kind === 'api' ? c.warn : undefined }))} />} />
          <Line name="Our model" dataKey="model" stroke={c.accent} strokeWidth={2.6} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line name="Open-Meteo" dataKey="api" stroke={c.warn} strokeWidth={2.2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
ModelVsApiChart.propTypes = {
  hours: PropTypes.arrayOf(PropTypes.shape({ timestamp_utc: PropTypes.string, model_speed: PropTypes.number, api_speed: PropTypes.number })).isRequired,
  sub: PropTypes.string,
};
