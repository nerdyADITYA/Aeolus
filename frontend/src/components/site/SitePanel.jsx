import { useEffect, useMemo, useRef, useState } from 'react';
import { useSite } from '../../state/SiteContext.jsx';
import { fmtCoord, parseCoord } from '../../utils/format.js';
import Field from '../common/Field.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import SiteMap from './SiteMap.jsx';

/** Coordinate entry + interactive map. Typing and clicking edit the same draft values. */
export default function SitePanel() {
  const { site, startSetup, jobId, job, actionError, clearActionError } = useSite();
  const configured = !!site?.configured;
  const busy = !!jobId && job?.status !== 'failed' && job?.status !== 'done';

  const [lat, setLat] = useState('23.0225');
  const [lon, setLon] = useState('72.5714');
  const [name, setName] = useState('My site');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const seeded = useRef(false);

  // Seed the form from the saved site once it loads.
  useEffect(() => {
    if (configured && !seeded.current) {
      seeded.current = true;
      setLat(fmtCoord(site.latitude));
      setLon(fmtCoord(site.longitude));
      setName(site.name);
    }
  }, [configured, site]);

  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  const latP = useMemo(() => parseCoord(lat, -90, 90), [lat]);
  const lonP = useMemo(() => parseCoord(lon, -180, 180), [lon]);
  const valid = latP.error === null && lonP.error === null && name.trim().length > 0;
  const changedFromSaved = configured && (latP.value !== site.latitude || lonP.value !== site.longitude);

  const pick = (la, lo) => {
    setLat(la.toFixed(4));
    setLon(lo.toFixed(4));
    setTouched(true);
    setConfirming(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (configured && site.status === 'ready' && !confirming) {
      setConfirming(true); // replacing the site discards its results: ask once
      return;
    }
    setConfirming(false);
    await startSetup({ latitude: latP.value, longitude: lonP.value, name: name.trim() });
  };

  return (
    <div className="grid g-site">
      <div className="card">
        <h3>Site location</h3>
        <p className="sub">Click the map or type coordinates. The marker shows the entered point; it does not prove a turbine exists there.</p>
        <SiteMap lat={latP.value ?? undefined} lon={lonP.value ?? undefined} onPick={pick} disabled={busy} />
      </div>

      <form className="card stack" onSubmit={submit} noValidate aria-label="Site coordinates">
        <div>
          <h3>{configured ? 'Site setup' : 'Set your site'}</h3>
          <p className="sub">Downloads 3 years of hourly wind data, evaluates the models with a full tuning search (about 20 minutes) and creates the first forecast.</p>
        </div>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field id="lat" label="Latitude" error={touched ? latP.error : null}>
            <input id="lat" className="mono" inputMode="decimal" value={lat} disabled={busy} aria-invalid={touched && !!latP.error}
              aria-describedby={latP.error ? 'lat-error' : undefined} onChange={(e) => { setLat(e.target.value); setTouched(true); }} />
          </Field>
          <Field id="lon" label="Longitude" error={touched ? lonP.error : null}>
            <input id="lon" className="mono" inputMode="decimal" value={lon} disabled={busy} aria-invalid={touched && !!lonP.error}
              aria-describedby={lonP.error ? 'lon-error' : undefined} onChange={(e) => { setLon(e.target.value); setTouched(true); }} />
          </Field>
        </div>
        <Field id="name" label="Site name" error={touched && !name.trim() ? 'Required' : null}>
          <input id="name" value={name} maxLength={120} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorBanner error={actionError} onDismiss={clearActionError} />
        {confirming && (
          <div className="banner" role="alert">
            Replacing the site discards its results{changedFromSaved ? ' (the location changed)' : ''}. Press the button again to confirm.
          </div>
        )}
        <button type="submit" className="btn primary" disabled={busy || (touched && !valid)}>
          {busy ? 'Working…' : configured ? (confirming ? 'Confirm: replace site' : 'Replace site and re-run') : 'Prepare site'}
        </button>
      </form>
    </div>
  );
}
