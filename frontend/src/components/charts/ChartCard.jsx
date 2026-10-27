import PropTypes from 'prop-types';
import ChartInfo from './ChartInfo.jsx';

/** Card shell for a chart: title, one-line explanation, the chart, and a colour legend. */
export default function ChartCard({ title, sub, legend = [], label, about, children }) {
  return (
    <div className="card chart-card">
      <h3>{title}</h3>
      {sub && <p className="sub">{sub}</p>}
      <div className="chart" role="img" aria-label={label || title}>
        {children}
      </div>
      {legend.length > 0 && (
        <ul className="legend">
          {legend.map((l) => (
            <li key={l.label}>
              <i className={l.kind || 'line'} style={{ background: l.kind === 'dot' || l.kind === 'ring' ? undefined : l.color, color: l.color, borderColor: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <ChartInfo about={about} />
    </div>
  );
}
ChartCard.propTypes = {
  title: PropTypes.string.isRequired,
  sub: PropTypes.string,
  label: PropTypes.string,
  about: PropTypes.shape({ shows: PropTypes.string, use: PropTypes.string, read: PropTypes.string }),
  legend: PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string.isRequired, color: PropTypes.string.isRequired, kind: PropTypes.oneOf(['line', 'dot', 'ring', 'dash']) })),
  children: PropTypes.node,
};
