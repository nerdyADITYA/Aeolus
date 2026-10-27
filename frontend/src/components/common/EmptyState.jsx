import PropTypes from 'prop-types';

export default function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 80 80" width="56" aria-hidden="true" style={{ opacity: 0.85 }}>
        <circle cx="40" cy="40" r="30" fill="none" stroke="var(--border)" />
        <path d="M40 40l-4-24h8z" fill="var(--accent)" />
        <path d="M40 40l21 12-4 6zM40 40L19 52l4 6z" fill="var(--accent)" opacity="0.5" />
        <circle cx="40" cy="40" r="3" fill="var(--accent)" />
      </svg>
      <strong style={{ color: 'var(--text)', fontWeight: 500 }}>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}
EmptyState.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node };
