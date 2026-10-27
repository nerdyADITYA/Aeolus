import PropTypes from 'prop-types';
import { useReports } from '../../state/ReportsContext.jsx';
import { useSite } from '../../state/SiteContext.jsx';
import { pivotEnergyProxy } from '../../utils/models.js';
import { fmtNumber } from '../../utils/format.js';
import LeadChart from '../charts/LeadChart.jsx';
import { CHART_INFO } from '../charts/chartInfo.js';
import AsyncBlock from '../common/AsyncBlock.jsx';
import Badge from '../common/Badge.jsx';
import DirectionAnalysis from './DirectionAnalysis.jsx';
import MetricsTable from './MetricsTable.jsx';
import SelectionPanel from './SelectionPanel.jsx';
import SimpleModelTable from './SimpleModelTable.jsx';

const PROXY_COLS = [['1', '1 h'], ['6', '6 h'], ['12', '12 h'], ['24', '24 h'], ['24h total', '24 h total']];

function EnergyProxy({ proxy }) {
  const pivot = pivotEnergyProxy(proxy.rows);
  return (
    <div className="card">
      <h3>Energy error (proxy)</h3>
      <p className="sub">{proxy.note} Turbine: {proxy.turbine.replace(/_/g, ' ')}. Mean absolute error in kWh.</p>
      <div className="scroll" style={{ maxHeight: 260 }} tabIndex={0} role="region" aria-label="Energy error proxy table">
        <table className="data-table">
          <thead>
            <tr><th><span className="th-btn">Model</span></th>{PROXY_COLS.map(([k, l]) => <th key={k} className="n"><span className="th-btn">{l}</span></th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(pivot).map(([model, vals]) => (
              <tr key={model}>
                <td>{model}</td>
                {PROXY_COLS.map(([k]) => <td key={k} className="n mono">{fmtNumber(vals[k], 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
EnergyProxy.propTypes = { proxy: PropTypes.shape({ rows: PropTypes.array.isRequired, note: PropTypes.string, turbine: PropTypes.string.isRequired }).isRequired };

/**
 * Model quality. Up top: ONE simple table comparing every model. Everything else (winners, success criteria, metrics by lead
 * time, charts, direction reliability, energy proxy) is kept, but behind a "Show detailed results" button, closed by default.
 */
export default function ModelQuality() {
  const { site } = useSite();
  const { report, direction } = useReports();
  return (
    <AsyncBlock state={report} height={220} emptyTitle="No model evaluation yet">
      {(r) => (
        <div className="stack" style={{ gap: 16 }}>
          <SimpleModelTable rows={r.test_table} selection={r.selection} mlName={r.ml_name} split={r.split} stale={!!site.evaluation_stale} />

          <details className="detail-more">
            <summary>Show detailed results</summary>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
              Winners and success criteria, metrics by forecast lead time, error charts, direction reliability and the energy-error proxy.
            </p>
            <div className="stack" style={{ gap: 16, marginTop: 16 }}>
              <div className="row">
                <Badge tone="neutral">{r.split.test_origins} held-out origins</Badge>
                <Badge tone="neutral">leads 1–24 h</Badge>
                <Badge tone="neutral">{r.ml_name} retrained {r.refit_log.length}× during the backtest</Badge>
              </div>
              <SelectionPanel selection={r.selection} criteria={r.criteria} split={r.split} />
              <MetricsTable rows={r.test_table} selection={r.selection} mlName={r.ml_name} />
              <div className="grid g-3">
                <LeadChart title="Speed MAE by lead" sub="Typical error, m/s" about={CHART_INFO.leadSpeedMae} byLead={r.by_lead} metricKey="speed_MAE" mlName={r.ml_name} unit="m/s" />
                <LeadChart title="Speed RMSE by lead" sub="Penalises larger misses, m/s" about={CHART_INFO.leadSpeedRmse} byLead={r.by_lead} metricKey="speed_RMSE" mlName={r.ml_name} unit="m/s" />
                <LeadChart title="Direction error by lead" sub="Circular MAE, degrees, wind ≥ 3 m/s" about={CHART_INFO.leadDirection} byLead={r.by_lead} metricKey="dir_CMAE_fast" mlName={r.ml_name} unit="°" digits={1} />
              </div>
              {r.energy_error_proxy && <EnergyProxy proxy={r.energy_error_proxy} />}
              <AsyncBlock state={direction} height={220} emptyTitle="No direction analysis yet">
                {(d) => <DirectionAnalysis direction={d} />}
              </AsyncBlock>
            </div>
          </details>
        </div>
      )}
    </AsyncBlock>
  );
}
