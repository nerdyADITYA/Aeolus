import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useChartColors } from '../../hooks/useChartColors.js';
import { cardinal, toMs, utcTime } from '../../utils/forecast.js';
import { sceneFor, stateLabel, TURBINE_PARTS, turbineSize, webglAvailable } from '../../utils/turbine3d.js';
import { yawKind, yawLegend, YAW_TONE } from '../../utils/yaw.js';
import Badge from '../common/Badge.jsx';
import Skeleton from '../common/Skeleton.jsx';
import ChartInfo from '../charts/ChartInfo.jsx';
import { CHART_INFO } from '../charts/chartInfo.js';

// Loaded on demand: three.js is large and most visits never scroll to this card.
const TurbineScene = lazy(() => import('./TurbineScene.jsx'));

const PLAY_MS = 1200;

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * Interactive 3D turbine driven by the forecast: pick an hour (slider or Play) and it turns to the advised heading, shows
 * the wind direction and spins at a rotor speed derived from the forecast power. `lead` is shared with the compass and table.
 */
export default function TurbineView({ hours, lead, onLeadChange, turbine, yawLimits, large = false }) {
  const colors = useChartColors();
  const reduced = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [highlight, setHighlight] = useState(null);   // the part being pointed at in the legend
  const gl = useMemo(() => webglAvailable(), []);

  const hour = hours.find((h) => h.lead_h === lead) ?? hours[0];
  const scene = useMemo(() => sceneFor(hour, turbine), [hour, turbine]);
  const size = useMemo(() => turbineSize(turbine), [turbine]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => onLeadChange(lead >= hours.length ? 1 : lead + 1), PLAY_MS);
    return () => clearInterval(id);
  }, [playing, lead, hours.length, onLeadChange]);

  if (!scene) return null;
  const kind = yawKind(scene.note);
  const status = stateLabel(scene, turbine);
  const turbineName = String(turbine.name || '').replace(/_/g, ' ');
  const aria = `3D view of ${turbineName} at +${scene.lead} hours: ${status}. Wind from ${Math.round(scene.windFrom)} degrees ${cardinal(scene.windFrom)}.`;

  const legendItem = (p) => (
    <li key={p.id} className={`part-${p.id}`} onMouseEnter={() => setHighlight(p.id)} onMouseLeave={() => setHighlight(null)}>
      <i style={{ background: p.color }} aria-hidden="true" />{p.label}
    </li>
  );
  const legendOverlay = <ul className="parts-legend" aria-label="Colour legend">{TURBINE_PARTS.map(legendItem)}</ul>;

  const readout = (
    <dl className="turbine-readout">
        <div><dt>Wind speed</dt><dd className="mono">{scene.speed.toFixed(2)} m/s</dd></div>
        <div><dt>Wind from</dt><dd className="mono">{Math.round(scene.windFrom)}° {cardinal(scene.windFrom)}</dd></div>
        <div><dt>Confidence R</dt><dd className="mono">{scene.confidence.toFixed(2)}</dd></div>
        <div><dt>Nacelle heading</dt><dd className="mono">{scene.heading === null ? '—' : `${Math.round(scene.heading)}°`}</dd></div>
        <div><dt>Power</dt><dd className="mono">{Math.round(scene.power)} kW</dd></div>
        <div><dt>Yaw advice</dt><dd><Badge tone={YAW_TONE[kind]} title={yawLegend(yawLimits).find((k) => k.kind === kind)?.hint}>{kind === 'track' ? 'track' : 'hold'}</Badge></dd></div>
    </dl>
  );

  return (
    <div className={`card chart-card turbine-card${large ? ' large' : ''}`}>
      <h3>3D turbine view</h3>
      <p className="sub">
        {turbineName}: hub {size.hubM} m, rotor {size.rotorM} m{size.estimated ? ' (estimated: the data lacks one of these sizes)' : ''}. Illustrative view of the forecast.
      </p>

      <div className="turbine-stage" role="img" aria-label={aria}>
        {gl ? (
          <Suspense fallback={<Skeleton height={380} />}>
            <TurbineScene scene={scene} size={size} colors={colors} animate={!reduced} resetKey={resetKey} large={large} highlight={highlight} />
          </Suspense>
        ) : (
          <div className="turbine-fallback" role="note">
            <strong>3D view unavailable</strong>
            <span>This browser cannot draw 3D graphics. The numbers still describe the turbine for this hour.</span>
          </div>
        )}
        {large && readout}
        {legendOverlay}
        <div className="turbine-badge"><Badge tone={scene.state === 'running' ? 'good' : scene.state === 'shutdown' ? 'bad' : 'neutral'}>{status}</Badge></div>
      </div>

      <div className="turbine-controls">
        <button type="button" className="btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? 'Pause' : 'Play day'}</button>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="turbine-hour">Turbine hour: +{scene.lead} h · {hour.timestamp_local} local · {utcTime(toMs(hour.timestamp_utc))} UTC</label>
          <input id="turbine-hour" type="range" min={1} max={hours.length} step={1} value={scene.lead}
            onChange={(e) => { setPlaying(false); onLeadChange(Number(e.target.value)); }} />
        </div>
        <button type="button" className="btn ghost" onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
      </div>

      {!large && readout}
      <ul className="parts-key" aria-label="Parts of the turbine">
        {TURBINE_PARTS.map((p) => (
          <li key={p.id} className={`part-${p.id}`} onMouseEnter={() => setHighlight(p.id)} onMouseLeave={() => setHighlight(null)}>
            <i style={{ background: p.color }} aria-hidden="true" /><span><strong>{p.label}</strong> {p.what}</span>
          </li>
        ))}
      </ul>
      <ChartInfo about={CHART_INFO.turbine3d} />
    </div>
  );
}
TurbineView.propTypes = {
  hours: PropTypes.array.isRequired,
  lead: PropTypes.number.isRequired,
  onLeadChange: PropTypes.func.isRequired,
  turbine: PropTypes.object.isRequired,
  yawLimits: PropTypes.object,
  large: PropTypes.bool,
};
