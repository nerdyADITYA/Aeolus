import PropTypes from 'prop-types';

/** Label + control + hint/error. `children` is the input element, which should use the same `id`. */
export default function Field({ id, label, error, hint, children }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <div className="error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : (
        hint && <div className="hint">{hint}</div>
      )}
    </div>
  );
}
Field.propTypes = { id: PropTypes.string.isRequired, label: PropTypes.string.isRequired, error: PropTypes.string, hint: PropTypes.string, children: PropTypes.node };
