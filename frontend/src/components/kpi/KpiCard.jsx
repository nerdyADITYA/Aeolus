import PropTypes from 'prop-types';

/** `tone` (good or bad) colours the card; `note` says in words what the colour means, so colour is never the only signal. */
export default function KpiCard({ label, value, unit, tone, note }) {
  return (
    <div className={`card kpi${tone ? ` ${tone}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value mono">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}
KpiCard.propTypes = {
  label: PropTypes.string.isRequired, value: PropTypes.node.isRequired, unit: PropTypes.string,
  tone: PropTypes.oneOf(['good', 'bad']), note: PropTypes.string,
};
