import PropTypes from 'prop-types';

export default function KpiCard({ label, value, unit }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value mono">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}
KpiCard.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.node.isRequired, unit: PropTypes.string };
