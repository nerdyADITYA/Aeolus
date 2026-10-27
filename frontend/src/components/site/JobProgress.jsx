import { useSite } from '../../state/SiteContext.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import Badge from '../common/Badge.jsx';

const TITLES = { setup: 'Preparing the site', forecast: 'Running the forecast', refresh: 'Refreshing data' };

/** Progress of the background job (polled every 2 s by useJob). Failed jobs stay visible until dismissed. */
export default function JobProgress() {
  const { job, jobId, pollError, dismissJob } = useSite();
  if (!jobId) return null;
  const pct = Math.round((job?.progress ?? 0) * 100);
  const failed = job?.status === 'failed';
  const done = job?.status === 'done';
  return (
    <div className="card stack" aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>{TITLES[job?.type] || 'Working'}</h3>
          <div className="sub mono" style={{ margin: 0 }}>job {jobId}</div>
        </div>
        <Badge tone={failed ? 'bad' : done ? 'good' : 'neutral'}>{job?.status || 'queued'}</Badge>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Job progress">
        <i style={{ width: `${pct}%`, background: failed ? 'var(--bad)' : undefined }} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{failed ? 'Stopped' : job?.message || 'Waiting for the backend…'}</span>
        <span className="mono">{pct}%</span>
      </div>
      {failed && <ErrorBanner error={job.error} onDismiss={dismissJob} />}
      {pollError && !failed && !done && <ErrorBanner error={pollError} tone="warn" />}
    </div>
  );
}
