import { useSite } from '../../state/SiteContext.jsx';
import { fmtDate, fmtNumber, fmtUtc } from '../../utils/format.js';
import Badge from '../common/Badge.jsx';
import Skeleton from '../common/Skeleton.jsx';

const STATUS = { ready: ['good', 'ready'], preparing: ['neutral', 'preparing'], error: ['bad', 'setup failed'] };

export default function SiteSummary() {
  const { site, loading, refresh, jobId } = useSite();
  if (loading && !site) {
    return (
      <div className="card stack">
        <Skeleton height={18} width="40%" />
        <Skeleton height={14} />
        <Skeleton height={14} />
      </div>
    );
  }
  if (!site?.configured) return null;
  const [tone, label] = STATUS[site.status] || ['neutral', site.status];
  const ds = site.dataset;
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>{site.name}</h3>
          <div className="sub mono" style={{ margin: 0 }}>
            {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} · {site.local_tz}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {site.evaluation_stale && <Badge tone="warn" title="Data was refreshed after the model evaluation ran">evaluation stale</Badge>}
          <Badge tone={tone}>{label}</Badge>
        </div>
      </div>
      {site.status === 'error' && <div className="banner error" role="alert">{site.status_message}</div>}
      {ds && (
        <table className="kv">
          <tbody>
            <tr><td>Data coverage</td><td className="mono">{fmtDate(ds.start_utc)} → {fmtDate(ds.end_utc)}</td></tr>
            <tr><td>Hourly rows</td><td className="mono">{fmtNumber(ds.rows)}</td></tr>
            <tr><td>Interpolated (gaps ≤ 3 h)</td><td className="mono">{fmtNumber(ds.interpolated_hours)}</td></tr>
            <tr><td>Still missing</td><td className="mono">{fmtNumber(ds.remaining_missing_hours)}</td></tr>
            {site.model && <tr><td>Selected model</td><td className="mono">{site.model.name}</td></tr>}
            {site.forecast_dates && <tr><td>Forecast dates</td><td className="mono">{fmtDate(site.forecast_dates.earliest_date)} → {fmtDate(site.forecast_dates.latest_date)}</td></tr>}
            <tr><td>Last observation</td><td className="mono">{fmtUtc(site.forecast_dates?.latest_origin_utc || ds.end_utc)}</td></tr>
          </tbody>
        </table>
      )}
      {site.status === 'ready' && (
        <div className="row">
          <button type="button" className="btn" onClick={refresh} disabled={!!jobId}>Refresh data</button>
          <span className="muted" style={{ fontSize: 12 }}>Pulls newer archive hours (it lags real time by about 5 days)</span>
        </div>
      )}
    </div>
  );
}
