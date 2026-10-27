import { useMemo, useState } from 'react';
import { useSite, originToDate } from '../../state/SiteContext.jsx';
import Field from '../common/Field.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import { fmtDate } from '../../utils/format.js';

/**
 * Forecast start-date picker. A date D forecasts that UTC day from the origin D-1 23:00. The archive lags real time,
 * so dates up to `latest_date` are offered. Each run trains with the cutoff at the origin (always out-of-sample).
 */
export default function ForecastControls() {
  const { site, selectedDate, setSelectedDate, runForecast, jobId, actionError, clearActionError } = useSite();
  const range = site?.forecast_dates;
  const latest = range?.latest_date;
  const date = selectedDate || latest || '';
  const [draft, setDraft] = useState(null); // the typed date, before the user presses Run
  const shown = draft ?? date;

  const cachedDates = useMemo(
    () => (site?.forecast_origins_cached || []).map((o) => ({ origin: o, date: originToDate(o) })),
    [site?.forecast_origins_cached],
  );
  const isCached = cachedDates.some((c) => c.date === shown);
  const inRange = !!shown && range?.earliest_date && shown >= range.earliest_date && shown <= latest;
  const busy = !!jobId;

  const choose = (d) => {
    setDraft(null);
    setSelectedDate(d);
  };
  const run = async () => {
    const ok = await runForecast(shown === latest ? null : shown); // null = latest origin
    if (ok) setDraft(null);
  };

  return (
    <div className="card stack">
      <div>
        <h3>Forecast date</h3>
        <p className="sub">Pick the UTC day to forecast. Each run trains only on data before that day, so the result is never in-sample.</p>
      </div>
      <Field id="forecast-date" label="Date" error={shown && !inRange ? `Choose a date from ${fmtDate(range?.earliest_date)} to ${fmtDate(latest)}` : null}
        hint={!shown ? undefined : isCached ? 'A forecast for this date is stored; running again re-trains it.' : 'Not run yet for this date (takes about a minute).'}>
        <input id="forecast-date" type="date" className="mono" value={shown} min={range?.earliest_date} max={latest} disabled={busy}
          onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <div className="row">
        <button type="button" className="btn primary" onClick={run} disabled={busy || !inRange}>
          {isCached ? 'Re-run forecast' : 'Run forecast'}
        </button>
        {isCached && (
          <button type="button" className="btn" onClick={() => choose(shown)} disabled={busy}>Show stored</button>
        )}
      </div>
      {cachedDates.length > 0 && (
        <div>
          <div className="sub" style={{ marginBottom: 6 }}>Stored forecasts</div>
          <div className="chips">
            {cachedDates.map((c) => (
              <button key={c.origin} type="button" className="chip-btn mono" aria-pressed={c.date === date} onClick={() => choose(c.date === latest ? null : c.date)}>
                {c.date || c.origin.slice(0, 16)}
              </button>
            ))}
          </div>
        </div>
      )}
      <ErrorBanner error={actionError} onDismiss={clearActionError} />
    </div>
  );
}
