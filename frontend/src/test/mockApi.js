import { vi } from 'vitest';
import report from './fixtures/report.json';
import direction from './fixtures/direction.json';
import quality from './fixtures/quality.json';
import curve from './fixtures/curve.json';
import apiComparison from './fixtures/api_comparison.json';

// Real backend payloads (captured from a live run, then trimmed): the shapes the views are built against.
export const fixtures = { report, direction, quality, curve, apiComparison };

/** Routes for the Phase 7 sections; spread into a test's route table. */
export const phase7Routes = (over = {}) => ({
  'GET /api/site/models/report': report,
  'GET /api/site/models/direction': direction,
  'GET /api/site/data/quality': quality,
  'GET /api/turbines/2023NREL_Bespoke_3.3MW_148/curve': curve,
  'GET /api/site/api-comparison': apiComparison,
  ...over,
});

/** Route-table fetch mock. Keys are 'METHOD /path'; values are a body, {status, body}, or a function returning either. */
export function mockFetch(routes) {
  const calls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = String(url).split('?')[0];
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, url: String(url), body });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ detail: `no mock for ${method} ${path}` }), { status: 404 });
    const out = await (typeof handler === 'function' ? handler({ url: String(url), body }) : handler);   // handlers may be async
    const { status = 200, body: payload } = out && typeof out === 'object' && 'status' in out && 'body' in out ? out : { status: 200, body: out };
    return new Response(JSON.stringify(payload), { status });
  });
  fn.calls = calls;
  globalThis.fetch = fn;
  return fn;
}

export const TURBINES = [
  { name: '2023NREL_Bespoke_3.3MW_148', group: 'onshore', rated_kw: 3300, hub_height_m: 100, usable: true, reason: null },
  { name: 'IEA_Reference_3.4MW_130', group: 'onshore', rated_kw: 3370, hub_height_m: 110, usable: true, reason: null },
  { name: 'IEC_Class1_Normalized_Industry_Composite', group: 'onshore', rated_kw: null, hub_height_m: null, usable: false, reason: 'normalized' },
];

export const readySite = (over = {}) => ({
  configured: true, name: 'Ahmedabad', latitude: 23.0225, longitude: 72.5714, local_tz: 'Asia/Kolkata', status: 'ready', status_message: null,
  turbine: { name: '2023NREL_Bespoke_3.3MW_148', group: 'onshore' },
  yaw: { nacelle_heading: null, deadband_deg: 8, direction_conf_min: 0.75, min_speed_ms: 3 }, evaluation_stale: false,
  created_at: '2026-10-26T10:00:00', active_job_id: null,
  dataset: { start_utc: '2023-10-21 00:00:00', end_utc: '2026-10-21 23:00:00', rows: 26328, interpolated_hours: 12, remaining_missing_hours: 0, fetched_at: '2026-10-26T10:00:00' },
  forecast_dates: { earliest_date: '2024-10-20', latest_date: '2026-10-22', latest_origin_utc: '2026-10-21 23:00:00' },
  model: { name: 'LightGBM', details: {}, evaluated_at: '2026-10-26T10:05:00' },
  forecast_origins_cached: ['2026-10-21 23:00:00'], ...over,
});

const ORIGIN_MS = Date.UTC(2026, 9, 21, 23);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const powerAt = (v) => (v < 3.25 ? 0 : Math.min(3300, Math.round(((v - 3.25) / 7) ** 2 * 3300 + 150)));

/** 24 deterministic forecast hours shaped like the backend's `hours` records (a few low-confidence/hold hours included). */
export function makeHours(n = 24) {
  let heading = null;
  return Array.from({ length: n }, (_, i) => {
    const t = ORIGIN_MS + (i + 1) * 3600e3;
    const speed = 4 + 2 * Math.sin(i / 3.5);
    const conf = i % 7 === 5 ? 0.45 : 0.95 - (i % 5) * 0.03;
    const dir = (60 + i * 3) % 360;
    const reliable = conf >= 0.75 && speed >= 3;
    let note = 'hold: low confidence or below cut-in/low-speed';
    if (reliable) {
      if (heading === null || Math.abs(dir - heading) > 8) { heading = dir; note = 'track predicted wind direction'; } else note = 'hold: within deadband';
    }
    const power = powerAt(speed);
    return {
      timestamp_utc: iso(t), timestamp_local: new Date(t + 19800e3).toISOString().slice(0, 16).replace('T', ' '), lead_h: i + 1,
      pred_speed_100m_ms: speed, pred_direction_deg: dir, direction_confidence: conf, direction_reliable: reliable,
      recommended_nacelle_heading_deg: heading, yaw_note: note, yaw_change_vs_prev_hour_deg: null,
      pred_speed_hub_ms: speed, power_kw: power, energy_kwh: power,
    };
  });
}

export const makeHistory = (n = 48) =>
  Array.from({ length: n }, (_, i) => ({ timestamp_utc: iso(ORIGIN_MS - (n - 1 - i) * 3600e3), speed: 3 + 2 * Math.cos(i / 6), direction_deg: (40 + i * 2) % 360 }));

export function makeForecast(over = {}) {
  const hours = over.hours ?? makeHours();
  const total = hours.reduce((a, h) => a + h.energy_kwh, 0);
  return {
    origin_utc: '2026-10-21 23:00:00', trained_through_utc: '2026-10-21 23:00:00', created_at: '2026-10-26T10:06:00',
    summary: { total_kwh: total, capacity_factor: total / (3300 * hours.length), peak_kw: Math.max(...hours.map((h) => h.power_kw)),
      mean_speed_ms: hours.reduce((a, h) => a + h.pred_speed_100m_ms, 0) / hours.length, reliable_hours: hours.filter((h) => h.direction_reliable).length, hours: hours.length },
    hours, history: makeHistory(), turbine: { name: '2023NREL_Bespoke_3.3MW_148', rated_kw: 3300, cut_in_ms: 3.25, cut_out_ms: 25, hub_height_m: 100 },
    limitations: [], ...over,
  };
}

export const forecastPayload = makeForecast();
