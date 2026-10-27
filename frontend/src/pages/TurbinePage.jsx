import { useEffect, useMemo, useState } from 'react';
import { getForecast } from '../api/endpoints.js';
import { useApi } from '../hooks/useApi.js';
import { originToDate, useSite } from '../state/SiteContext.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import Skeleton from '../components/common/Skeleton.jsx';
import TurbineView from '../components/turbine3d/TurbineView.jsx';
import { fmtUtc } from '../utils/format.js';

/** Full-page 3D turbine for the selected forecast. The hour is local to this page; the forecast date follows the dashboard. */
export default function TurbinePage() {
  const { site, selectedDate, setSelectedDate, forecastVersion } = useSite();
  const ready = site?.status === 'ready';
  const { data, error } = useApi((o) => getForecast(selectedDate, o), [selectedDate, forecastVersion, site?.turbine?.name], { enabled: ready });
  const [lead, setLead] = useState(1);
  useEffect(() => setLead(1), [data?.origin_utc]);

  const cached = useMemo(() => (site?.forecast_origins_cached || []).map(originToDate), [site?.forecast_origins_cached]);
  const current = selectedDate || site?.forecast_dates?.latest_date || '';

  let body;
  if (!site) body = <div className="card"><Skeleton height={420} /></div>;
  else if (!ready) {
    body = <div className="card"><EmptyState title="Prepare a site first">The 3D view needs a forecast. Set up your site on the dashboard.</EmptyState></div>;
  } else if (error?.status === 404) {
    body = <div className="card"><EmptyState title="No forecast for this date yet">{error.hint || 'Run a forecast for the chosen date on the dashboard.'}</EmptyState></div>;
  } else if (error) body = <ErrorBanner error={error} />;
  else if (!data) body = <div className="card"><Skeleton height={520} /></div>;   // first render after the site becomes ready: nothing fetched yet
  else {
    body = (
      <TurbineView large hours={data.hours || []} lead={lead} onLeadChange={setLead} turbine={data.turbine}
        yawLimits={{ deadband: site.yaw?.deadband_deg ?? undefined, confMin: site.yaw?.direction_conf_min ?? undefined, minSpeed: site.yaw?.min_speed_ms ?? undefined }} />
    );
  }

  return (
    <div className="stack" style={{ gap: 16, marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>3D turbine</h2>
          {data && <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Forecast from origin {fmtUtc(data.origin_utc)} · model only, no Forecast API input</p>}
        </div>
        <div className="row" style={{ gap: 12 }}>
          {ready && cached.length > 1 && (
            <label className="row" style={{ gap: 8, fontSize: 12 }}>
              <span className="muted">Forecast date</span>
              <select value={current} onChange={(e) => setSelectedDate(e.target.value)} aria-label="Forecast date">
                {!cached.includes(current) && <option value={current}>{current}</option>}
                {cached.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}
          <a className="btn ghost" href="#/">← Dashboard</a>
        </div>
      </div>
      {body}
    </div>
  );
}
