import { getTurbineCurve } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtNumber } from '../../utils/format.js';
import CurveChart from '../charts/CurveChart.jsx';
import AsyncBlock from '../common/AsyncBlock.jsx';
import Badge from '../common/Badge.jsx';

const DATA_HEIGHT_M = 100;

/** Power curve and spec of the selected NREL turbine, with the checks the curve passed before it was allowed to be used. */
export default function TurbinePanel() {
  const { site } = useSite();
  const { name, group } = site.turbine;
  const state = useApi((o) => getTurbineCurve(name, group, o), [name, group]);
  return (
    <AsyncBlock state={state} height={320} emptyTitle="Turbine curve unavailable">
      {({ turbine, curve }) => {
        const shear = Math.abs(turbine.hub_height_m - DATA_HEIGHT_M) > 5;
        return (
          <div className="stack" style={{ gap: 16 }}>
            <CurveChart curve={curve} turbine={turbine} />
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <h3>{turbine.name.replace(/_/g, ' ')}</h3>
                  <p className="sub" style={{ margin: 0 }}>NREL turbine-models {turbine.package_version} · {turbine.curve_type} curve · {turbine.origin}</p>
                </div>
                <Badge tone="good">curve verified</Badge>
              </div>
              <table className="kv">
                <tbody>
                  <tr><td>Rated power</td><td className="mono">{fmtNumber(turbine.rated_kw)} kW</td></tr>
                  <tr><td>Cut-in / cut-out speed</td><td className="mono">{turbine.cut_in_ms} / {turbine.cut_out_ms} m/s</td></tr>
                  <tr><td>Hub height / rotor diameter</td><td className="mono">{turbine.hub_height_m} m / {turbine.rotor_diameter_m ?? '—'} m</td></tr>
                  <tr>
                    <td>Wind data height</td>
                    <td className="mono">{DATA_HEIGHT_M} m {shear ? '(shear correction applied)' : '(matches hub, no correction)'}</td>
                  </tr>
                </tbody>
              </table>
              <ul className="checklist" aria-label="Curve verification checks" style={{ marginTop: 10 }}>
                {Object.entries(turbine.checks).map(([k, ok]) => (
                  <li key={k} className={ok ? 'met' : 'unmet'}><span aria-hidden="true">{ok ? '✓' : '✗'}</span><span className="sr-only">{ok ? 'Passed: ' : 'Failed: '}</span>{k}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      }}
    </AsyncBlock>
  );
}
