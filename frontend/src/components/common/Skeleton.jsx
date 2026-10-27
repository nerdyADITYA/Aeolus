import PropTypes from 'prop-types';

export default function Skeleton({ height = 16, width = '100%' }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}
Skeleton.propTypes = { height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]), width: PropTypes.oneOfType([PropTypes.number, PropTypes.string]) };
