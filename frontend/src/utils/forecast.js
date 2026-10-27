// Pure helpers that turn the backend's forecast payload into chart/table data. No React here, so they are easy to test.

export const toMs = (iso) => Date.parse(iso);

const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'HH:mm' in UTC for a millisecond timestamp. */
export const utcTime = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** '22 Oct 05:00' style label in UTC, used in tooltips. */
export const utcStamp = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${utcTime(ms)} UTC`;
};

/** Axis label: 'HH:mm' (UTC), or the date ('22 Oct') on the midnight tick so a multi-day axis stays readable. */
export const tickLabel = (ms) => {
  const d = new Date(ms);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]}` : utcTime(ms);
};

/**
 * Hour-aligned ticks for a time axis: every 3 h for spans up to 30 h, 6 h up to 60 h, otherwise 12 h.
 * Returns {domain: [min, max], ticks}. Steps divide 24 h, so ticks fall on round UTC hours.
 */
export function timeAxis(timestamps) {
  const ts = timestamps.filter((t) => Number.isFinite(t));
  if (!ts.length) return { domain: ['dataMin', 'dataMax'], ticks: undefined };
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const spanH = (max - min) / 3.6e6;
  const stepMs = (spanH <= 30 ? 3 : spanH <= 60 ? 6 : 12) * 3.6e6;
  const ticks = [];
  for (let t = Math.ceil(min / stepMs) * stepMs; t <= max; t += stepMs) ticks.push(t);
  return { domain: [min, max], ticks };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 58 -> 'ENE'. Directions are meteorological wind-FROM degrees. */
export const cardinal = (deg) => (deg === null || deg === undefined || Number.isNaN(deg) ? '' : POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);

/** Observed history + forecast on one time axis: [{t, observed?, forecast?, hub?}] sorted by time. */
export function buildSpeedSeries(history = [], hours = []) {
  const rows = [
    ...history.filter((h) => h.speed !== null && h.speed !== undefined).map((h) => ({ t: toMs(h.timestamp_utc), observed: h.speed })),
    ...hours.map((h) => ({ t: toMs(h.timestamp_utc), forecast: h.pred_speed_100m_ms, hub: h.pred_speed_hub_ms })),
  ];
  return rows.sort((a, b) => a.t - b.t);
}

/**
 * Direction is circular, so it is drawn as dots (never joined by a line: 359 -> 1 must not sweep across the chart).
 * Forecast dots are split by whether the direction is reliable.
 */
export function buildDirectionSeries(history = [], hours = []) {
  return {
    observed: history.filter((h) => h.direction_deg !== null && h.direction_deg !== undefined).map((h) => ({ t: toMs(h.timestamp_utc), y: h.direction_deg })),
    reliable: hours.filter((h) => h.direction_reliable).map((h) => ({ t: toMs(h.timestamp_utc), y: h.pred_direction_deg, conf: h.direction_confidence })),
    unreliable: hours.filter((h) => !h.direction_reliable).map((h) => ({ t: toMs(h.timestamp_utc), y: h.pred_direction_deg, conf: h.direction_confidence })),
  };
}

/** Per-hour confidence for bars, plus the reliability flag used to colour them. */
export const buildConfidenceSeries = (hours = []) =>
  hours.map((h) => ({ t: toMs(h.timestamp_utc), lead: h.lead_h, confidence: h.direction_confidence, reliable: h.direction_reliable, speed: h.pred_speed_100m_ms }));

/** Hourly power (kW, equal to kWh for a one-hour step) and the running energy total. */
export function buildEnergySeries(hours = []) {
  let total = 0;
  return hours.map((h) => {
    total += h.energy_kwh ?? 0;
    return { t: toMs(h.timestamp_utc), lead: h.lead_h, power: h.power_kw, energy: h.energy_kwh, cumulative: total, speed: h.pred_speed_hub_ms };
  });
}

/** What the compass shows for forecast lead `lead` (1-based). Falls back to the first hour. */
export function compassFor(hours = [], lead = 1) {
  const h = hours.find((x) => x.lead_h === lead) ?? hours[0];
  if (!h) return null;
  return {
    lead: h.lead_h,
    timestamp_utc: h.timestamp_utc,
    predicted: h.pred_direction_deg,
    heading: h.recommended_nacelle_heading_deg,
    confidence: h.direction_confidence,
    reliable: h.direction_reliable,
    note: h.yaw_note,
    speed: h.pred_speed_100m_ms,
  };
}

/** Stable sort with missing values last. dir: 1 ascending, -1 descending. */
export function sortRows(rows, key, dir = 1) {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = av === null || av === undefined || Number.isNaN(av);
    const bn = bv === null || bv === undefined || Number.isNaN(bv);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

/** Signed shortest turn from `from` to `to` in degrees, in (-180, 180]. */
export const turn = (from, to) => ((((to - from + 180) % 360) + 360) % 360) - 180;

export const shortNote = (note = '') => (note.startsWith('track') ? 'track' : 'hold');
export const noteDetail = (note = '') => (note.includes(': ') ? note.split(': ').slice(1).join(': ') : '');

/**
 * Tooltip rows for one hour of the direction-confidence chart. Each rule is shown with its limit and a tick or cross, using the
 * UNROUNDED values the backend used. (Showing 2.98 m/s as "3.0" once made an hour that failed the 3 m/s rule look like it passed.)
 */
export function confidenceTooltipRows(p, { threshold, minSpeed } = {}) {
  const confOk = threshold == null || p.confidence >= threshold;
  const speedOk = minSpeed == null || p.speed >= minSpeed;
  return [
    { label: threshold == null ? 'Confidence R' : `Confidence R (≥ ${threshold})`, value: p.confidence == null ? null : `${p.confidence.toFixed(2)} ${confOk ? '✓' : '✗'}` },
    { label: minSpeed == null ? 'Wind speed' : `Wind speed (≥ ${minSpeed} m/s)`, value: p.speed == null ? null : `${p.speed.toFixed(2)} m/s ${speedOk ? '✓' : '✗'}` },
    { label: 'Acted on', value: p.reliable ? 'yes' : 'no' },
  ];
}

/**
 * Stretches of consecutive hours with zero power, as time ranges for shading. A zero-power hour has no bar, so without this the
 * gap looks like missing data. Each range covers whole hours (half an hour either side of the first and last point).
 */
export function zeroPowerRuns(series) {
  const runs = [];
  let start = null;
  series.forEach((p, i) => {
    if (p.power === 0 && start === null) start = i;
    const endsRun = start !== null && (p.power !== 0 || i === series.length - 1);
    if (endsRun) {
      const last = p.power === 0 ? i : i - 1;
      runs.push({ from: series[start].t - 1800e3, to: series[last].t + 1800e3, hours: last - start + 1 });
      start = null;
    }
  });
  return runs;
}

/**
 * Tooltip rows for one hour of the power chart. For a zero-power hour the wind row carries a cross and the cut-in or cut-out
 * limit, so the reason for the missing bar is visible. `kind` lets the chart colour the rows.
 */
export function powerTooltipRows(p, { cutIn, cutOut } = {}) {
  const belowCutIn = cutIn != null && p.speed != null && p.speed < cutIn;
  const aboveCutOut = cutOut != null && p.speed != null && p.speed >= cutOut;
  const windOk = !belowCutIn && !aboveCutOut;
  const windLabel = belowCutIn ? `Wind at hub (cut-in ${cutIn} m/s)` : aboveCutOut ? `Wind at hub (cut-out ${cutOut} m/s)` : 'Wind at hub';
  return [
    { label: 'Power', value: `${Math.round(p.power).toLocaleString()} kW`, kind: 'power' },
    { label: 'Energy this hour', value: `${Math.round(p.energy).toLocaleString()} kWh` },
    { label: 'Cumulative', value: `${Math.round(p.cumulative).toLocaleString()} kWh`, kind: 'cumulative' },
    { label: windLabel, value: p.speed == null ? null : `${p.speed.toFixed(2)} m/s${windOk ? '' : ' ✗'}` },
    ...(p.power === 0 && !windOk ? [{ label: 'Why no power', value: belowCutIn ? 'below cut-in' : 'above cut-out' }] : []),
  ];
}

/** Our model and the Open-Meteo forecast for the same hours, on one time axis: [{t, model, api}] (api is null where Open-Meteo has no value). */
export function buildModelVsApiSeries(hours = []) {
  return hours.map((h) => ({ t: toMs(h.timestamp_utc), model: h.model_speed, api: h.api_speed ?? null }));
}

/** Tooltip rows for one hour. The difference is model minus Open-Meteo, so a positive number means our model predicts stronger wind. */
export function modelVsApiRows(p) {
  const both = p.model != null && p.api != null;
  const diff = both ? p.model - p.api : null;
  return [
    { label: 'Our model', value: p.model == null ? null : `${p.model.toFixed(2)} m/s`, kind: 'model' },
    { label: 'Open-Meteo', value: p.api == null ? 'no forecast stored' : `${p.api.toFixed(2)} m/s`, kind: 'api' },
    { label: 'Difference (model − Open-Meteo)', value: diff == null ? null : `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)} m/s` },
  ];
}
