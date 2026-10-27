import { approachAngle, bearingToXZ, headingToRotationY, rotorRpm, RPM_MAX, RPM_MIN, sceneFor, stateLabel, TURBINE_PARTS, turbineSize, turbineState, webglAvailable } from './turbine3d.js';

const T = { cut_in_ms: 3.25, cut_out_ms: 25, rated_kw: 3300, hub_height_m: 100, rotor_diameter_m: 148 };
const hour = (o = {}) => ({
  lead_h: 3, pred_speed_100m_ms: 6, pred_speed_hub_ms: 6, pred_direction_deg: 90, direction_confidence: 0.9, direction_reliable: true,
  recommended_nacelle_heading_deg: 85, yaw_note: 'track predicted wind direction', power_kw: 1650, ...o,
});

describe('turbineSize', () => {
  it('converts metres to scene units (10 m per unit)', () => {
    const s = turbineSize(T);
    expect(s.hub).toBe(10);
    expect(s.bladeLength).toBe(7.4);
    expect(s.estimated).toBe(false);
  });
  it('follows the selected turbine: a taller hub and a bigger rotor', () => {
    const s = turbineSize({ hub_height_m: 120, rotor_diameter_m: 200 });
    expect([s.hub, s.bladeLength]).toEqual([12, 10]);
  });
  it('falls back to typical sizes and says it estimated them', () => {
    const none = turbineSize({});
    expect(none.hubM).toBe(100);
    expect(none.rotorM).toBe(120);
    expect(none.estimated).toBe(true);
    const noRotor = turbineSize({ hub_height_m: 80, rotor_diameter_m: null });
    expect([noRotor.rotorM, noRotor.estimated]).toEqual([96, true]);
    expect(turbineSize({ hub_height_m: -5, rotor_diameter_m: 0 }).hubM).toBe(100);   // nonsense values are not used
  });
});

describe('turbineState', () => {
  it('is idle below cut-in, running from cut-in, shut down from cut-out', () => {
    expect(turbineState(3.24, 3.25, 25)).toBe('idle');
    expect(turbineState(3.25, 3.25, 25)).toBe('running');
    expect(turbineState(24.99, 3.25, 25)).toBe('running');
    expect(turbineState(25, 3.25, 25)).toBe('shutdown');
    expect(turbineState(40, 3.25, 25)).toBe('shutdown');
  });
  it('treats a missing speed as idle rather than crashing', () => {
    expect(turbineState(null, 3.25, 25)).toBe('idle');
    expect(turbineState(NaN, 3.25, 25)).toBe('idle');
  });
});

describe('rotorRpm', () => {
  it('is zero unless running', () => {
    expect(rotorRpm('idle', 500, 3300)).toBe(0);
    expect(rotorRpm('shutdown', 3300, 3300)).toBe(0);
  });
  it('rises with power between the minimum and maximum', () => {
    expect(rotorRpm('running', 0, 3300)).toBe(RPM_MIN);
    expect(rotorRpm('running', 3300, 3300)).toBe(RPM_MAX);
    expect(rotorRpm('running', 1650, 3300)).toBeCloseTo((RPM_MIN + RPM_MAX) / 2);
    expect(rotorRpm('running', 5000, 3300)).toBe(RPM_MAX);        // never faster than the maximum
  });
  it('stays at the minimum when the rating is unknown', () => {
    expect(rotorRpm('running', 1000, undefined)).toBe(RPM_MIN);
    expect(rotorRpm('running', 1000, 0)).toBe(RPM_MIN);
  });
});

describe('sceneFor', () => {
  it('turns a forecast hour into scene values', () => {
    const s = sceneFor(hour(), T);
    expect(s).toMatchObject({ lead: 3, state: 'running', speed: 6, power: 1650, heading: 85, windFrom: 90, reliable: true });
    expect(s.rpm).toBeGreaterThan(RPM_MIN);
  });
  it('uses the hub-height speed that the power was computed from', () => {
    expect(sceneFor(hour({ pred_speed_100m_ms: 2, pred_speed_hub_ms: 6 }), T).state).toBe('running');
    expect(sceneFor(hour({ pred_speed_hub_ms: undefined, pred_speed_100m_ms: 2 }), T).state).toBe('idle');
  });
  it('is idle with a still rotor below cut-in, and keeps the advised heading', () => {
    const s = sceneFor(hour({ pred_speed_hub_ms: 3.21, power_kw: 0 }), T);
    expect(s.state).toBe('idle');
    expect(s.rpm).toBe(0);
    expect(s.heading).toBe(85);
  });
  it('is shut down at cut-out', () => {
    const s = sceneFor(hour({ pred_speed_hub_ms: 26, power_kw: 0 }), T);
    expect(s.state).toBe('shutdown');
    expect(s.rpm).toBe(0);
  });
  it('has no heading when none has been advised yet', () => {
    expect(sceneFor(hour({ recommended_nacelle_heading_deg: null }), T).heading).toBeNull();
    expect(sceneFor(hour({ recommended_nacelle_heading_deg: undefined }), T).heading).toBeNull();
  });
  it('a heading of 0 degrees (north) is a real heading, not a missing one', () => {
    expect(sceneFor(hour({ recommended_nacelle_heading_deg: 0 }), T).heading).toBe(0);
  });
  it('passes the reliability flag through and returns null for no hour', () => {
    expect(sceneFor(hour({ direction_reliable: false }), T).reliable).toBe(false);
    expect(sceneFor(undefined, T)).toBeNull();
  });
});

describe('stateLabel', () => {
  it('says what the turbine is doing, with the limits of this turbine', () => {
    expect(stateLabel(sceneFor(hour(), T), T)).toBe('Producing 1650 kW');
    expect(stateLabel(sceneFor(hour({ pred_speed_hub_ms: 3, power_kw: 0 }), T), T)).toBe('Idle: wind below the cut-in speed (3.25 m/s), no power');
    expect(stateLabel(sceneFor(hour({ pred_speed_hub_ms: 30, power_kw: 0 }), T), T)).toContain('cut-out speed (25 m/s)');
    expect(stateLabel(null, T)).toBe('');
  });
});

describe('compass geometry', () => {
  const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  it('puts north at -z and east at +x', () => {
    near(bearingToXZ(0, 10), [0, -10]);
    near(bearingToXZ(90, 10), [10, 0]);
    near(bearingToXZ(180, 10), [0, 10]);
    near(bearingToXZ(270, 10), [-10, 0]);
  });
  it('a nacelle whose front is local +z faces the compass heading after the rotation', () => {
    for (const deg of [0, 45, 90, 180, 270, 333]) {
      const r = headingToRotationY(deg);
      const front = [Math.sin(r), Math.cos(r)];   // local +z rotated about y lands at (sin r, cos r) in (x, z)
      near(front, bearingToXZ(deg, 1));
    }
  });
});

describe('approachAngle', () => {
  it('moves by at most the step and lands exactly when close enough', () => {
    expect(approachAngle(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(approachAngle(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });
  it('takes the short way round the circle', () => {
    const twoPi = Math.PI * 2;
    expect(approachAngle(0.1, twoPi - 0.1, 0.05)).toBeCloseTo(0.05);            // just past north to just before: go backwards, not 6 rad forwards
    expect(approachAngle(twoPi - 0.1, 0.1, 0.05)).toBeCloseTo(twoPi - 0.05);
  });
  it('does not move when already there', () => {
    expect(approachAngle(2, 2, 0.5)).toBe(2);
  });
});

describe('TURBINE_PARTS', () => {
  it('names the five parts once each, with a plain explanation', () => {
    expect(TURBINE_PARTS.map((p) => p.id)).toEqual(['blades', 'hub', 'nacelle', 'yaw', 'tower']);
    expect(new Set(TURBINE_PARTS.map((p) => p.label)).size).toBe(5);
    for (const p of TURBINE_PARTS) expect(p.what.length).toBeGreaterThan(30);
    expect(new Set(TURBINE_PARTS.map((p) => p.color)).size).toBe(5);                  // each part has its own colour
    for (const p of TURBINE_PARTS) expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('webglAvailable', () => {
  const docWith = (getContext) => ({ createElement: () => ({ getContext }) });
  it('is true when a WebGL context can be made', () => {
    expect(webglAvailable(docWith((k) => (k === 'webgl2' ? {} : null)))).toBe(true);
    expect(webglAvailable(docWith((k) => (k === 'webgl' ? {} : null)))).toBe(true);
  });
  it('is false without a context, when creating one throws, or with no document', () => {
    expect(webglAvailable(docWith(() => null))).toBe(false);
    expect(webglAvailable(docWith(() => { throw new Error('no gl'); }))).toBe(false);
    expect(webglAvailable(null)).toBe(false);
  });
});
