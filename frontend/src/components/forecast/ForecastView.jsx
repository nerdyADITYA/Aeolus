import { useEffect, useState } from 'react';
import { getForecast } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtNumber, fmtPercent, fmtUtc } from '../../utils/format.js';
import { ENERGY_TARGET_KWH, energyTone } from '../../utils/forecast.js';
import Compass from '../charts/Compass.jsx';
import ConfidenceBars from '../charts/ConfidenceBars.jsx';
import DirectionChart from '../charts/DirectionChart.jsx';
import PowerEnergyChart from '../charts/PowerEnergyChart.jsx';
import SpeedChart from '../charts/SpeedChart.jsx';
import EmptyState from '../common/EmptyState.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import ExportButtons from '../common/ExportButtons.jsx';
import Skeleton from '../common/Skeleton.jsx';
import KpiCard from '../kpi/KpiCard.jsx';
import ForecastTable from '../tables/ForecastTable.jsx';
import YawLegend from '../tables/YawLegend.jsx';

/** Everything for the selected forecast: headline numbers, charts, compass and the 24-hour table (one fetch). */
export default function ForecastView() {
  const { site, selectedDate, forecastVersion } = useSite();
  const ready = site?.status === 'ready';
  const { data, error, loading } = useApi((o) => getForecast(selectedDate, o), [selectedDate, forecastVersion, site?.turbine?.name], { enabled: ready });
  const [lead, setLead] = useState(1);
  useEffect(() => setLead(1), [data?.origin_utc]);

  if (!ready) return null;
  if (loading && !data) {
    return (
      <div className="stack">
        <div className="grid g-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><Skeleton height={60} /></div>)}</div>
        <div className="card"><Skeleton height={300} /></div>
      </div>
    );
  }
  if (error?.status === 404) {
    return <div className="card"><EmptyState title="No forecast for this date yet">{error.hint || 'Run a forecast for the chosen date.'}</EmptyState></div>;
  }
  if (error) return <ErrorBanner error={error} />;

  const s = data.summary;
  const hours = data.hours || [];
  const threshold = site.yaw?.direction_conf_min ?? undefined;
  const yawLimits = { deadband: site.yaw?.deadband_deg ?? undefined, confMin: threshold, minSpeed: site.yaw?.min_speed_ms ?? undefined };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid g-4">
        <KpiCard label="Expected energy" value={fmtNumber(s.total_kwh)} unit="kWh" tone={energyTone(s.total_kwh)}
          note={energyTone(s.total_kwh) === 'good' ? `At or above ${fmtNumber(ENERGY_TARGET_KWH)} kWh` : energyTone(s.total_kwh) === 'bad' ? `Below ${fmtNumber(ENERGY_TARGET_KWH)} kWh` : undefined} />
        <KpiCard label="Capacity factor" value={fmtPercent(s.capacity_factor)} unit="%" />
        <KpiCard label="Peak power" value={fmtNumber(s.peak_kw)} unit="kW" />
        <KpiCard label="Mean speed @100 m" value={fmtNumber(s.mean_speed_ms, 1)} unit="m/s" />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Origin {fmtUtc(data.origin_utc)} · {s.reliable_hours} of {hours.length || 24} hours have reliable direction · {data.turbine.name.replace(/_/g, ' ')} · model only, no Forecast API input
      </p>

      {hours.length > 0 && (
        <>
          <div className="grid g-chart">
            <SpeedChart history={data.history || []} hours={hours} originUtc={data.origin_utc} cutInMs={data.turbine.cut_in_ms} />
            <Compass hours={hours} lead={lead} onLeadChange={setLead} />
          </div>
          <div className="card row turbine-link">
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3>3D turbine view</h3>
              <p className="sub" style={{ margin: 0 }}>See this forecast on a 3D {data.turbine.name.replace(/_/g, ' ')}: it turns, spins and follows the hour you choose.</p>
            </div>
            <a className="btn primary" href="#/turbine">Open the 3D view →</a>
          </div>
          <div className="grid g-2">
            <DirectionChart history={data.history || []} hours={hours} />
            <ConfidenceBars hours={hours} threshold={threshold} minSpeed={site.yaw?.min_speed_ms} />
          </div>
          <PowerEnergyChart hours={hours} ratedKw={data.turbine.rated_kw} cutInMs={data.turbine.cut_in_ms} cutOutMs={data.turbine.cut_out_ms} turbineName={data.turbine.name.replace(/_/g, ' ')} />
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h3>24-hour forecast</h3>
                <p className="sub" style={{ margin: 0 }}>Times in local time ({site.local_tz}); charts use UTC. Advisory only, no turbine commands are sent.</p>
              </div>
              <ExportButtons origin={data.origin_utc} />
            </div>
            <ForecastTable hours={hours} selectedLead={lead} onSelect={setLead} limits={yawLimits} />
            <YawLegend hours={hours} {...yawLimits} />
          </div>
        </>
      )}
    </div>
  );
}
