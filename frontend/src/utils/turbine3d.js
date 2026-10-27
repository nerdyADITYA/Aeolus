// Logic behind the 3D turbine view. No 3D code here: it turns one forecast hour into plain numbers the scene draws,
// so it can be tested without a graphics context.
//
// Scene conventions: 1 scene unit = 10 m. North is -z, east is +x (a map seen from above), y is up.
// The rotor spin is ILLUSTRATIVE (a simple function of the forecast power), not a physical simulation.

export const METRES_PER_UNIT = 10;
const DEG = Math.PI / 180;

/** The parts of the machine. Each has its own colour, used on the 3D model and in the legend, and a plain-words explanation. */
export const TURBINE_PARTS = [
  { id: 'blades', color: '#22d3ee', label: 'Blades (rotor)', what: 'Catch the wind and turn. Their speed here rises with the forecast power.' },
  { id: 'hub', color: '#fb7185', label: 'Hub', what: 'The centre of the rotor that holds the three blades.' },
  { id: 'nacelle', color: '#34d399', label: 'Nacelle', what: 'The housing on top of the tower that holds the generator and gearbox. It is what turns to face the wind.' },
  { id: 'yaw', color: '#fbbf24', label: 'Yaw system', what: 'The turntable between tower and nacelle. It rotates the nacelle so the rotor faces the wind; the yaw advice is about this movement.' },
  { id: 'tower', color: '#94a3b8', label: 'Tower', what: 'Holds everything at hub height (the forecast wind speed is for this height).' },
];

/** Rotor speed range drawn while producing, in revolutions per minute. Typical of a large onshore turbine; illustrative. */
export const RPM_MIN = 5;
export const RPM_MAX = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tower and rotor sizes in scene units. A missing hub height or rotor diameter falls back to a typical value and is flagged. */
export function turbineSize(turbine = {}) {
  const hubKnown = finite(turbine.hub_height_m) && turbine.hub_height_m > 0;
  const rotorKnown = finite(turbine.rotor_diameter_m) && turbine.rotor_diameter_m > 0;
  const hubM = hubKnown ? turbine.hub_height_m : 100;
  const rotorM = rotorKnown ? turbine.rotor_diameter_m : Math.round(hubM * 1.2);
  return {
    hubM, rotorM, estimated: !hubKnown || !rotorKnown,
    hub: hubM / METRES_PER_UNIT, bladeLength: rotorM / 2 / METRES_PER_UNIT,
  };
}

/** What the turbine is doing in a forecast hour: running, idle (wind below cut-in) or shut down (at or above cut-out). */
export function turbineState(speedMs, cutInMs, cutOutMs) {
  if (!finite(speedMs)) return 'idle';
  if (finite(cutOutMs) && speedMs >= cutOutMs) return 'shutdown';
  if (finite(cutInMs) && speedMs < cutInMs) return 'idle';
  return 'running';
}

/** Illustrative rotor speed (rpm): stopped unless running, then RPM_MIN..RPM_MAX in proportion to the power fraction. */
export function rotorRpm(state, powerKw, ratedKw) {
  if (state !== 'running') return 0;
  const frac = finite(powerKw) && finite(ratedKw) && ratedKw > 0 ? clamp(powerKw / ratedKw, 0, 1) : 0;
  return RPM_MIN + (RPM_MAX - RPM_MIN) * frac;
}

/** Everything the scene needs for one forecast hour. `hour` is a record from the forecast payload. */
export function sceneFor(hour, turbine = {}) {
  if (!hour) return null;
  const speed = finite(hour.pred_speed_hub_ms) ? hour.pred_speed_hub_ms : hour.pred_speed_100m_ms;
  const state = turbineState(speed, turbine.cut_in_ms, turbine.cut_out_ms);
  const heading = finite(hour.recommended_nacelle_heading_deg) ? hour.recommended_nacelle_heading_deg : null;
  return {
    lead: hour.lead_h, state, speed, power: hour.power_kw ?? 0,
    rpm: rotorRpm(state, hour.power_kw, turbine.rated_kw),
    heading,                                    // where the nacelle should face (wind-from degrees), null = none advised yet
    windFrom: hour.pred_direction_deg,
    confidence: hour.direction_confidence,
    reliable: !!hour.direction_reliable,
    note: hour.yaw_note || '',
  };
}

/** One line for the badge over the scene, and for screen readers. */
export function stateLabel(scene, turbine = {}) {
  if (!scene) return '';
  if (scene.state === 'shutdown') return `Shut down: wind at or above the cut-out speed (${turbine.cut_out_ms} m/s)`;
  if (scene.state === 'idle') return `Idle: wind below the cut-in speed (${turbine.cut_in_ms} m/s), no power`;
  return `Producing ${Math.round(scene.power)} kW`;
}

/** Nacelle rotation about the vertical axis for a compass heading (0 = north = -z, 90 = east = +x), in radians. */
export const headingToRotationY = (headingDeg) => Math.PI - headingDeg * DEG;

/** Position on a ring of radius r around the tower for a compass bearing (north = -z, east = +x). */
export const bearingToXZ = (bearingDeg, r) => [Math.sin(bearingDeg * DEG) * r, -Math.cos(bearingDeg * DEG) * r];

/** Move an angle (radians) toward a target along the SHORTEST way round, by at most `maxStep`. */
export function approachAngle(current, target, maxStep) {
  const TWO_PI = Math.PI * 2;
  const diff = ((target - current + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  if (Math.abs(diff) <= maxStep) return current + diff;
  return current + Math.sign(diff) * maxStep;
}

/** Can this browser draw WebGL? The page shows the numbers instead when it cannot. */
export function webglAvailable(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return false;
  try {
    const canvas = doc.createElement('canvas');
    return !!(canvas.getContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}
