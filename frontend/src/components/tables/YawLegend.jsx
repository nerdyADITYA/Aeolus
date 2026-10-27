import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { COLUMN_HELP, YAW_TONE, countYawKinds, yawLegend } from '../../utils/yaw.js';
import Badge from '../common/Badge.jsx';

/**
 * Key for the 24-hour table, written for someone who has never worked with turbines: what "yaw", "track", "hold" and
 * "deadband" mean, what to do for each, and how many hours of THIS forecast fall into each kind. Open by default, collapsible.
 */
export default function YawLegend({ hours, deadband, confMin, minSpeed }) {
  const rows = useMemo(() => yawLegend({ deadband, confMin, minSpeed }), [deadband, confMin, minSpeed]);
  const counts = useMemo(() => countYawKinds(hours), [hours]);
  const total = hours.length;
  return (
    <details className="chart-info table-key" open>
      <summary>
        <span aria-hidden="true" className="chart-info-icon">ⓘ</span> How to read this table
      </summary>

      <p className="key-intro">
        <strong>Yaw</strong> means turning the <strong>nacelle</strong> (the housing on top of the tower that holds the rotor) so the rotor faces the wind.
        The <strong>Yaw</strong> column tells you what the system advises for each hour. It is advice only: nothing is sent to a turbine.
      </p>

      <div className="scroll" style={{ maxHeight: 'none' }} tabIndex={0} role="region" aria-label="Yaw label key">
        <table className="data-table yaw-key">
          <thead>
            <tr>
              <th><span className="th-btn">Label in the table</span></th>
              <th><span className="th-btn">What it means</span></th>
              <th><span className="th-btn">What to do</span></th>
              <th className="n"><span className="th-btn">This forecast</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind}>
                <td>
                  <Badge tone={YAW_TONE[r.kind]}>{r.badge}</Badge>{' '}
                  {r.detail && <span className="muted">{r.detail}</span>}
                </td>
                <td>{r.meaning}</td>
                <td>{r.advice}</td>
                <td className="n mono">{counts[r.kind]} of {total} h</td>
              </tr>
            ))}
            {counts.other > 0 && (
              <tr>
                <td><span className="muted">other</span></td>
                <td>Advice with a wording this key does not know yet.</td>
                <td>See the Yaw column.</td>
                <td className="n mono">{counts.other} of {total} h</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h4 className="list-title" style={{ marginTop: 16 }}>The other columns</h4>
      <dl className="glossary">
        {COLUMN_HELP.map(([term, text]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
YawLegend.propTypes = {
  hours: PropTypes.array.isRequired,
  deadband: PropTypes.number,
  confMin: PropTypes.number,
  minSpeed: PropTypes.number,
};
