import PropTypes from 'prop-types';

export default function Badge({ tone = 'neutral', children, title }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}
Badge.propTypes = { tone: PropTypes.oneOf(['good', 'warn', 'bad', 'neutral']), children: PropTypes.node, title: PropTypes.string };
