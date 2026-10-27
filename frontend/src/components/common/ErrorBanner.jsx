import PropTypes from 'prop-types';

/** Shows an ApiError (or any Error/string) with the backend's hint, if any. */
export default function ErrorBanner({ error, onDismiss, tone = 'error' }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.detail || error.message;
  const hint = typeof error === 'object' ? error.hint : null;
  return (
    <div className={`banner ${tone}`} role="alert">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div>
          <div>{message}</div>
          {hint && <div className="hint">{hint}</div>}
        </div>
        {onDismiss && (
          <button type="button" className="btn ghost" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
ErrorBanner.propTypes = {
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  onDismiss: PropTypes.func,
  tone: PropTypes.oneOf(['error', 'warn']),
};
