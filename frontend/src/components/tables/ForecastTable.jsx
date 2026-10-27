import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { cardinal, noteDetail, shortNote, sortRows } from '../../utils/forecast.js';
import { fmtNumber } from '../../utils/format.js';
import { yawHint, yawTone } from '../../utils/yaw.js';
import Badge from '../common/Badge.jsx';

const COLUMNS = [
  { key: 'lead_h', label: 'Lead', numeric: false },
  { key: 'timestamp_local', label: 'Local time', numeric: false },
  { key: 'pred_speed_100m_ms', label: 'Speed m/s', numeric: true },
  { key: 'pred_direction_deg', label: 'Direction', numeric: true },
  { key: 'direction_confidence', label: 'Conf. R', numeric: true },
  { key: 'recommended_nacelle_heading_deg', label: 'Heading °', numeric: true },
  { key: 'yaw_note', label: 'Yaw', numeric: false },
  { key: 'power_kw', label: 'Power kW', numeric: true },
  { key: 'energy_kwh', label: 'Energy kWh', numeric: true },
];

/** 24-hour forecast table. Click a header to sort; click a lead to show that hour on the compass. */
export default function ForecastTable({ hours, selectedLead, onSelect, limits }) {
  const [sort, setSort] = useState({ key: 'lead_h', dir: 1 });
  const rows = useMemo(() => sortRows(hours, sort.key, sort.dir), [hours, sort]);
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const totals = useMemo(() => ({ kwh: hours.reduce((a, h) => a + (h.energy_kwh ?? 0), 0) }), [hours]);
  return (
    <div className="scroll" tabIndex={0} role="region" aria-label="24-hour forecast table">
      <table className="data-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className={col.numeric ? 'n' : ''} aria-sort={sort.key === col.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="th-btn" onClick={() => toggle(col.key)}>
                  {col.label}
                  <span aria-hidden="true">{sort.key === col.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lead_h} data-lead={r.lead_h} className={r.lead_h === selectedLead ? 'selected' : ''}>
              <td className="mono">
                <button type="button" className="lead-btn" onClick={() => onSelect(r.lead_h)} aria-label={`Show +${r.lead_h} hours on the compass`}>+{r.lead_h}h</button>
              </td>
              <td className="mono">{r.timestamp_local}</td>
              <td className="n mono">{fmtNumber(r.pred_speed_100m_ms, 2)}</td>
              <td className="n mono">{Math.round(r.pred_direction_deg)}° <span className="muted">{cardinal(r.pred_direction_deg)}</span></td>
              <td className="n mono">{fmtNumber(r.direction_confidence, 2)}</td>
              <td className="n mono">{r.recommended_nacelle_heading_deg != null ? Math.round(r.recommended_nacelle_heading_deg) : '—'}</td>
              <td>
                <Badge tone={yawTone(r.yaw_note)} title={yawHint(r.yaw_note, limits)}>{shortNote(r.yaw_note)}</Badge>{' '}
                <span className="muted">{noteDetail(r.yaw_note)}</span>
              </td>
              <td className="n mono">{fmtNumber(r.power_kw)}</td>
              <td className="n mono">{fmtNumber(r.energy_kwh)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={8} className="muted">Total expected energy</td>
            <td className="n mono">{fmtNumber(totals.kwh)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
ForecastTable.propTypes = {
  hours: PropTypes.array.isRequired, selectedLead: PropTypes.number, onSelect: PropTypes.func.isRequired,
  limits: PropTypes.shape({ deadband: PropTypes.number, confMin: PropTypes.number, minSpeed: PropTypes.number }),
};
