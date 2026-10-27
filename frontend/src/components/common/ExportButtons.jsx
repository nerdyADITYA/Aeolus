import PropTypes from 'prop-types';
import { exportUrl } from '../../api/endpoints.js';

/** Plain download links: the backend sends the file with a Content-Disposition header. */
export default function ExportButtons({ origin }) {
  return (
    <div className="row">
      <a className="btn" href={exportUrl('csv', origin)} download>Export CSV</a>
      <a className="btn" href={exportUrl('json', origin)} download>Export JSON</a>
    </div>
  );
}
ExportButtons.propTypes = { origin: PropTypes.string };
