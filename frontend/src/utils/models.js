// Pure helpers for the model-quality, accuracy and data views.

/** One colour per model, the same in every chart: ML = accent, persistence = muted, seasonal naive = amber, SARIMAX = violet. */
export function modelColor(name, mlName, c) {
  if (name === mlName) return c.accent;
  if (name === 'Persistence') return c.muted;
  if (name.startsWith('Seasonal')) return c.warn;
  if (name === 'SARIMAX') return c.accent2;
  return c.text;
}

const trim = (x) => String(Number(x.toFixed(2)));

/**
 * pandas interval labels -> readable bins: '(-0.001, 0.2]' -> '0–0.2', '(0.8, 1.0001]' -> '0.8–1', '(8.0, 100.0]' -> '≥ 8'.
 * Unknown formats are returned unchanged.
 */
export function prettyBin(label) {
  const m = /^[([]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[)\]]$/.exec(String(label));
  if (!m) return String(label);
  const lo = Math.max(0, Number(m[1]));
  const hi = Number(m[2]);
  if (hi >= 100) return `≥ ${trim(lo)}`;
  return `${trim(lo < 0.005 ? 0 : lo)}–${trim(hi)}`;
}

/** Lowest value per column (used to highlight the best model in a metrics table). */
export function bestPerColumn(rows, cols) {
  const best = {};
  for (const col of cols) {
    const vals = rows.map((r) => r[col]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    best[col] = vals.length ? Math.min(...vals) : null;
  }
  return best;
}

/** Wide per-lead records {lead_h, speed_MAE, ...} for several models -> [{lead, [model]: value}] for a line chart. */
export function leadSeries(byLead, key) {
  const models = Object.keys(byLead);
  const leads = [...new Set(models.flatMap((m) => byLead[m].map((r) => r.lead_h)))].sort((a, b) => a - b);
  return leads.map((lead) => {
    const row = { lead };
    for (const m of models) row[m] = byLead[m].find((r) => r.lead_h === lead)?.[key];
    return row;
  });
}

/** Pivot energy-proxy rows [{model, lead_h, energy_MAE_kWh}] into {model: {lead: value}}. */
export function pivotEnergyProxy(rows = []) {
  const out = {};
  for (const r of rows) {
    out[r.model] = out[r.model] || {};
    out[r.model][String(r.lead_h)] = r.energy_MAE_kWh;
  }
  return out;
}

export const circErr = (a, b) => Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);

/** 'YYYY-MM-DD' shifted by whole days (UTC, no time-zone surprises). */
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pass/warn/info status for a data-quality check. */
export const STATUS_TONE = { pass: 'good', warn: 'warn', fail: 'bad', info: 'neutral' };

/** Turn the backend's quality report into display rows: [{id, label, value, status, detail?}]. */
export function qualityRows(q) {
  if (!q) return [];
  const v = q.validation;
  const c = q.cleaning;
  const nulls = Object.entries(v.null_counts || {}).filter(([, n]) => n > 0);
  const rows = [
    { id: 'rows', label: 'Hourly rows downloaded', value: v.rows_raw.toLocaleString(), status: 'info', detail: `${c.start_utc.slice(0, 10)} to ${c.end_utc.slice(0, 10)}` },
    { id: 'dups', label: 'Duplicate timestamps', value: v.duplicate_timestamps, status: v.duplicate_timestamps === 0 ? 'pass' : 'warn' },
    { id: 'order', label: 'Timestamps in order', value: v.timestamps_monotonic ? 'yes' : 'no', status: v.timestamps_monotonic ? 'pass' : 'warn' },
    { id: 'missing', label: 'Missing hours (absent timestamps)', value: v.missing_hours_absent_timestamps, status: v.missing_hours_absent_timestamps === 0 ? 'pass' : 'warn' },
    { id: 'offhour', label: 'Off-the-hour timestamps', value: v.off_hour_timestamps, status: v.off_hour_timestamps === 0 ? 'pass' : 'warn' },
    { id: 'units', label: 'Units (wind speed / direction)', value: `${v.units.wind_speed_100m} / ${v.units.wind_direction_100m}`, status: 'pass', detail: 'checked against the API response' },
    { id: 'nulls', label: 'Missing values', value: nulls.length ? nulls.reduce((a, [, n]) => a + n, 0) : 0, status: nulls.length ? 'warn' : 'pass', detail: nulls.map(([k, n]) => `${k}: ${n}`).join(', ') },
    { id: 'speed', label: 'Wind speed range at 100 m', value: `${v.speed_100m_range[0]}–${v.speed_100m_range[1]} m/s`, status: v.negative_speeds === 0 && v.implausible_speeds_gt_60 === 0 ? 'pass' : 'warn', detail: `${v.negative_speeds} negative, ${v.implausible_speeds_gt_60} above 60 m/s` },
    { id: 'direction', label: 'Direction values outside 0–360°', value: v.direction_outside_0_360, status: v.direction_outside_0_360 === 0 ? 'pass' : 'warn' },
    { id: 'height', label: 'Measurement height', value: '100 m (modelled)', status: v.shear_alpha_10_to_100m >= 0.1 && v.shear_alpha_10_to_100m <= 0.5 ? 'pass' : 'warn', detail: `shear exponent 10→100 m = ${v.shear_alpha_10_to_100m.toFixed(2)} (plausible 0.1–0.5)` },
    { id: 'grid', label: 'Grid cell offset from your point', value: `${v.grid_cell_offset_km} km`, status: v.grid_cell_offset_km <= 15 ? 'pass' : 'warn', detail: `cell at ${q.grid_cell?.latitude}, ${q.grid_cell?.longitude}, ${q.grid_cell?.elevation} m` },
    { id: 'fresh', label: 'Data age', value: `${v.data_age_days} days`, status: v.stale ? 'warn' : 'pass', detail: `last valid hour ${v.last_valid_timestamp_utc} UTC; the archive lags real time` },
    { id: 'trail', label: 'Trailing empty hours trimmed', value: v.trailing_null_hours, status: 'info' },
    { id: 'interp', label: 'Interpolated hours (gaps ≤ 3 h)', value: c.interpolated_hours, status: 'info' },
    { id: 'gaps', label: 'Remaining gaps left empty', value: `${c.remaining_missing_hours} h in ${c.remaining_gaps} gap(s)`, status: c.remaining_missing_hours === 0 ? 'pass' : 'warn', detail: 'longer gaps are excluded from training and scoring, never invented' },
    { id: 'leak', label: 'Feature look-ahead test', value: q.feature_leakage_test?.passed ? 'passed' : 'FAILED', status: q.feature_leakage_test?.passed ? 'pass' : 'fail', detail: `${q.feature_leakage_test?.rows_checked ?? 0} random timestamps recomputed from truncated data` },
  ];
  return rows;
}
