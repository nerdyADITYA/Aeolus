import { useEffect, useState } from 'react';
import { getTurbines } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtMw } from '../../utils/format.js';
import Field from '../common/Field.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import Skeleton from '../common/Skeleton.jsx';

const turbineLabel = (t) => `${t.name.replace(/_/g, ' ')} · ${fmtMw(t.rated_kw)} · hub ${Math.round(t.hub_height_m)} m`;

/** Turbine and yaw settings. Applying them recalculates power, energy and yaw instantly: the wind model is not retrained. */
export default function YawSettings() {
  const { site, applySettings, actionError, clearActionError, jobId } = useSite();
  const { data: turbines, error, loading } = useApi((o) => getTurbines(site?.turbine?.group || 'onshore', o), [site?.turbine?.group]);
  const [turbine, setTurbine] = useState('');
  const [heading, setHeading] = useState('');
  const [deadband, setDeadband] = useState('8');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!site?.configured) return;
    setTurbine(site.turbine.name);
    setHeading(site.yaw.nacelle_heading ?? '');
    setDeadband(String(site.yaw.deadband_deg));
  }, [site?.configured, site?.turbine?.name, site?.yaw?.nacelle_heading, site?.yaw?.deadband_deg]);

  if (!site?.configured) return null;
  const usable = (turbines || []).filter((t) => t.usable);
  const headingNum = heading === '' ? null : Number(heading);
  const headingErr = heading !== '' && !(Number.isFinite(headingNum) && headingNum >= 0 && headingNum < 360) ? '0 to 359.9 degrees' : null;
  const dbNum = Number(deadband);
  const dbErr = !(Number.isFinite(dbNum) && dbNum >= 0 && dbNum <= 45) ? '0 to 45 degrees' : null;

  const apply = async (e) => {
    e.preventDefault();
    if (headingErr || dbErr) return;
    const body = { turbine_name: turbine, yaw_deadband_deg: dbNum };
    if (headingNum === null) body.clear_nacelle_heading = true;
    else body.nacelle_heading = headingNum;
    const ok = await applySettings(body);
    setSaved(!!ok);
  };

  return (
    <form className="card stack" onSubmit={apply} noValidate aria-label="Turbine and yaw settings">
      <div>
        <h3>Turbine and yaw</h3>
        <p className="sub">Power and energy come from the selected NREL power curve. Changes apply instantly (no retraining).</p>
      </div>
      <Field id="turbine" label="NREL turbine" hint={`Hub height is compared with the 100 m data; ${usable.length || '…'} turbines have a verified curve.`}>
        {loading ? <Skeleton height={38} /> : (
          <select id="turbine" value={turbine} onChange={(e) => { setTurbine(e.target.value); setSaved(false); }} disabled={!!jobId}>
            {usable.map((t) => <option key={t.name} value={t.name}>{turbineLabel(t)}</option>)}
            {!usable.some((t) => t.name === turbine) && turbine && <option value={turbine}>{turbine}</option>}
          </select>
        )}
      </Field>
      <div className="grid g-2" style={{ gap: 12 }}>
        <Field id="heading" label="Current nacelle heading (optional)" error={headingErr} hint="Degrees, wind-from convention">
          <input id="heading" className="mono" inputMode="decimal" placeholder="e.g. 60" value={heading} onChange={(e) => { setHeading(e.target.value); setSaved(false); }} />
        </Field>
        <Field id="deadband" label="Yaw deadband (°)" error={dbErr} hint="Smaller turns are ignored">
          <input id="deadband" className="mono" inputMode="decimal" value={deadband} onChange={(e) => { setDeadband(e.target.value); setSaved(false); }} />
        </Field>
      </div>
      <ErrorBanner error={error} />
      <ErrorBanner error={actionError} onDismiss={clearActionError} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={!!headingErr || !!dbErr || !!jobId || !turbine}>Apply</button>
        {saved && <span className="muted" role="status">Applied</span>}
      </div>
    </form>
  );
}
