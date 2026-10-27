import { useReports } from '../../state/ReportsContext.jsx';

// Shown even before the backend report loads, so the caveats are never hidden behind a request.
const CONVENTIONS = [
  'Wind direction is meteorological wind-from degrees (0 = north, clockwise); a conventional upwind turbine faces the wind, so heading = wind-from direction.',
  'Charts use UTC; the forecast table also shows local time. A forecast date D predicts that UTC day from the origin D−1 23:00.',
  'Wind speed is at 100 m. If the turbine hub differs by more than 5 m, a power-law shear correction (estimated from 10 m and 100 m data) is applied.',
  'Point forecasts only: there are no prediction intervals yet.',
];

/** Assumptions and limitations, always on the page. The data-specific list comes from the backend evaluation. */
export default function AssumptionsPanel() {
  const { report } = useReports();
  const limits = report.data?.limitations || [];
  return (
    <div className="card">
      <details open>
        <summary><h3 style={{ display: 'inline' }}>Assumptions and limitations</h3></summary>
        <p className="sub" style={{ marginTop: 8 }}>Read these before relying on any number on this page.</p>
        <div className="grid g-2">
          <div>
            <h4 className="list-title">Data and models</h4>
            <ul className="plain">
              {limits.length ? limits.map((l) => <li key={l}>{l}</li>) : <li className="muted">Loading the evaluation notes…</li>}
            </ul>
          </div>
          <div>
            <h4 className="list-title">Conventions</h4>
            <ul className="plain">
              {CONVENTIONS.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
