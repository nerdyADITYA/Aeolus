import { bestPerColumn, circErr, leadSeries, modelColor, pivotEnergyProxy, prettyBin, qualityRows, shiftDate } from './models.js';
import { fixtures } from '../test/mockApi.js';

const colors = { accent: 'A', accent2: 'V', text: 'T', muted: 'M', warn: 'W' };

describe('modelColor', () => {
  it('gives every model one fixed colour, and the ML model the accent', () => {
    expect(modelColor('LightGBM', 'LightGBM', colors)).toBe('A');
    expect(modelColor('Persistence', 'LightGBM', colors)).toBe('M');
    expect(modelColor('Seasonal naive (24h)', 'LightGBM', colors)).toBe('W');
    expect(modelColor('SARIMAX', 'LightGBM', colors)).toBe('V');
    expect(modelColor('Something else', 'LightGBM', colors)).toBe('T');
  });
});

describe('prettyBin', () => {
  it('turns pandas intervals into readable bins using the real backend labels', () => {
    const labels = [...fixtures.direction.by_confidence.map((r) => r.R_bin), ...fixtures.direction.by_speed.map((r) => r.speed_bin)];
    expect(labels.map(prettyBin)).toEqual(['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1', '0–2', '2–3', '3–5', '5–8', '≥ 8']);
  });
  it('leaves unknown formats alone', () => {
    expect(prettyBin('high')).toBe('high');
    expect(prettyBin('')).toBe('');
  });
});

describe('table and series helpers', () => {
  it('finds the lowest value per column and ignores missing values', () => {
    const rows = [{ a: 3, b: null }, { a: 1, b: 5 }, { a: 2, b: NaN }];
    expect(bestPerColumn(rows, ['a', 'b'])).toEqual({ a: 1, b: 5 });
    expect(bestPerColumn([{ a: null }], ['a'])).toEqual({ a: null });
  });
  it('builds one row per lead with a value for every model', () => {
    const rows = leadSeries(fixtures.report.by_lead, 'speed_MAE');
    expect(rows).toHaveLength(24);
    expect(rows[0].lead).toBe(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['LightGBM', 'Persistence', 'SARIMAX', 'Seasonal naive (24h)', 'lead']);
    expect(rows[23].lead).toBe(24);
  });
  it('pivots the energy proxy by model and lead', () => {
    const p = pivotEnergyProxy(fixtures.report.energy_error_proxy.rows);
    expect(Object.keys(p)).toHaveLength(4);
    expect(Object.keys(p.LightGBM).sort()).toEqual(['1', '12', '24', '24h total', '6']);
    expect(p.LightGBM['24h total']).toBeGreaterThan(0);
  });
  it('computes circular error and date shifts', () => {
    expect(circErr(359, 1)).toBe(2);
    expect(circErr(90, 270)).toBe(180);
    expect(shiftDate('2026-10-21', -6)).toBe('2026-10-15');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('qualityRows', () => {
  it('turns the real backend report into rows that all pass or inform', () => {
    const rows = qualityRows(fixtures.quality);
    expect(rows.length).toBeGreaterThan(12);
    expect(rows.every((r) => r.status === 'pass' || r.status === 'info')).toBe(true);
    expect(rows.find((r) => r.id === 'rows').value).toBe('26,328');
    expect(rows.find((r) => r.id === 'height').detail).toMatch(/0\.24/);
    expect(rows.find((r) => r.id === 'leak').value).toBe('passed');
  });
  it('flags duplicates, gaps, stale data, odd shear and a failed leakage test', () => {
    const q = structuredClone(fixtures.quality);
    q.validation.duplicate_timestamps = 3;
    q.validation.null_counts.temperature_2m = 5;
    q.validation.stale = true;
    q.validation.shear_alpha_10_to_100m = 0.9;
    q.validation.grid_cell_offset_km = 40;
    q.cleaning.remaining_missing_hours = 7;
    q.cleaning.remaining_gaps = 2;
    q.feature_leakage_test.passed = false;
    const by = Object.fromEntries(qualityRows(q).map((r) => [r.id, r]));
    expect(by.dups.status).toBe('warn');
    expect(by.nulls).toMatchObject({ status: 'warn', value: 5 });
    expect(by.nulls.detail).toBe('temperature_2m: 5');
    expect(by.fresh.status).toBe('warn');
    expect(by.height.status).toBe('warn');
    expect(by.grid.status).toBe('warn');
    expect(by.gaps.status).toBe('warn');
    expect(by.leak).toMatchObject({ status: 'fail', value: 'FAILED' });
  });
  it('returns nothing without a report', () => {
    expect(qualityRows(null)).toEqual([]);
  });
});
