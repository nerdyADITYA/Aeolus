import { useMemo } from 'react';
import { useReports } from '../../state/ReportsContext.jsx';
import { STATUS_TONE, qualityRows } from '../../utils/models.js';
import AsyncBlock from '../common/AsyncBlock.jsx';
import Badge from '../common/Badge.jsx';

const LABEL = { pass: 'ok', warn: 'check', fail: 'failed', info: 'info' };

function Rows({ q }) {
  const rows = useMemo(() => qualityRows(q), [q]);
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h3>Data quality</h3>
          <p className="sub" style={{ margin: 0 }}>Validation of the downloaded hourly history. The raw file is kept unchanged; cleaning produces a separate dataset.</p>
        </div>
        <Badge tone={counts.warn || counts.fail ? 'warn' : 'good'}>{counts.warn || counts.fail ? `${(counts.warn || 0) + (counts.fail || 0)} to check` : 'all checks ok'}</Badge>
      </div>
      <table className="kv quality">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.label}
                {r.detail && <div className="muted" style={{ fontSize: 12 }}>{r.detail}</div>}
              </td>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                {r.value}{' '}
                <Badge tone={STATUS_TONE[r.status]}>{LABEL[r.status]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
Rows.propTypes = { q: (props, name) => (props[name]?.validation ? null : new Error('q.validation is required')) };

export default function DataQuality() {
  const { quality } = useReports();
  return (
    <AsyncBlock state={quality} height={280} emptyTitle="No data-quality report yet">
      {(q) => <Rows q={q} />}
    </AsyncBlock>
  );
}
