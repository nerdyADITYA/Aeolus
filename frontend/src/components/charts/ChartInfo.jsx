import PropTypes from 'prop-types';

const PARTS = [
  ['shows', 'What it shows'],
  ['use', 'What it is for'],
  ['read', 'How to read it'],
];

/** "About this chart": a short, collapsible explanation at the bottom of a chart card (open by default). */
export default function ChartInfo({ about }) {
  if (!about) return null;
  return (
    <details className="chart-info" open>
      <summary>
        <span aria-hidden="true" className="chart-info-icon">ⓘ</span> About this chart
      </summary>
      <dl>
        {PARTS.filter(([key]) => about[key]).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{about[key]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
ChartInfo.propTypes = { about: PropTypes.shape({ shows: PropTypes.string, use: PropTypes.string, read: PropTypes.string }) };
