import PropTypes from 'prop-types';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtUtc } from '../../utils/format.js';

function statusChip(site, job, error) {
  if (error) return { tone: 'err', text: 'backend unreachable' };
  if (!site) return { tone: '', text: 'connecting…' };
  if (!site.configured) return { tone: '', text: 'no site yet' };
  if (job && (job.status === 'queued' || job.status === 'running')) return { tone: 'busy', text: `${job.type} · ${Math.round(job.progress * 100)}%` };
  if (site.status === 'ready') return { tone: 'ok', text: `data to ${fmtUtc(site.dataset?.end_utc)}` };
  if (site.status === 'error') return { tone: 'err', text: 'setup failed' };
  return { tone: 'busy', text: 'preparing' };
}

export default function TopBar({ theme, onToggleTheme }) {
  const { site, job, error } = useSite();
  const chip = statusChip(site, job, error);
  return (
    <header className="topbar">
      <div className="logo">
        <i aria-hidden="true" />
        WINDKRAFT
      </div>
      {site?.configured && <span className="chip">{site.name}</span>}
      <span className="chip mono" role="status">
        <span className={`dot ${chip.tone}`} aria-hidden="true" />
        {chip.text}
      </span>
      <div className="spacer" />
      <button type="button" className="btn" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        ◐ {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </header>
  );
}
TopBar.propTypes = { theme: PropTypes.oneOf(['dark', 'light']).isRequired, onToggleTheme: PropTypes.func.isRequired };
