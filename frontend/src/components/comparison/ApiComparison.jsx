import { getApiComparison } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtNumber, fmtUtc } from '../../utils/format.js';
import ModelVsApiChart from '../charts/ModelVsApiChart.jsx';
import EmptyState from '../common/EmptyState.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import Skeleton from '../common/Skeleton.jsx';

/**
 * Our model's forecast next to Open-Meteo's forecast for the SAME 24 hours as the forecast shown above. No inputs: it follows the
 * selected forecast date and fetches automatically. It compares two forecasts with each other; it is not an accuracy score.
 */
export default function ApiComparison() {
  const { site, selectedDate, forecastVersion } = useSite();
  const ready = site?.status === 'ready';
  const { data, error, loading, reload } = useApi((o) => getApiComparison(selectedDate, o), [selectedDate, forecastVersion], { enabled: ready });

  if (!ready) return null;
  if (loading && !data) return <div className="card"><Skeleton height={340} /></div>;
  if (error?.status === 404) {
    return <div className="card"><EmptyState title="No forecast for this date yet">{error.hint || 'Run a forecast for the chosen date.'}</EmptyState></div>;
  }
  if (error) {
    return (
      <div className="stack">
        <ErrorBanner error={error} />
        <div><button type="button" className="btn" onClick={reload}>Try again</button></div>
      </div>
    );
  }

  const first = data.hours[0]?.timestamp_utc;
  const diff = data.mean_abs_difference_ms;
  const sub = [
    `The same 24 hours as the forecast above, starting ${fmtUtc(first)}.`,
    diff != null ? `On average the two differ by ${fmtNumber(diff, 2)} m/s.` : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ModelVsApiChart hours={data.hours} sub={sub} />
      {data.message && <div className="banner" role="note">{data.message} The chart shows only our model for these hours.</div>}
      <ul className="plain note-list">
        {data.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
