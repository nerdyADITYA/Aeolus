import {
  buildConfidenceSeries, buildDirectionSeries, buildModelVsApiSeries, confidenceTooltipRows, modelVsApiRows, powerTooltipRows, zeroPowerRuns, buildEnergySeries, buildSpeedSeries, cardinal, compassFor, noteDetail, shortNote,
  sortRows, tickLabel, timeAxis, toMs, turn, utcStamp, utcTime,
} from './forecast.js';
import { makeHistory, makeHours } from '../test/mockApi.js';

describe('time helpers', () => {
  it('formats UTC times and stamps', () => {
    const ms = toMs('2026-10-22T05:00:00Z');
    expect(utcTime(ms)).toBe('05:00');
    expect(utcStamp(ms)).toBe('22 Oct 05:00 UTC');
  });
  it('labels midnight ticks with the date and other ticks with the time', () => {
    expect(tickLabel(toMs('2026-10-22T00:00:00Z'))).toBe('22 Oct');
    expect(tickLabel(toMs('2026-10-22T12:00:00Z'))).toBe('12:00');
  });
  it('builds hour-aligned ticks whose step grows with the span', () => {
    const day = timeAxis([toMs('2026-10-22T00:00:00Z'), toMs('2026-10-22T23:00:00Z')]);
    expect(day.ticks.map(utcTime)).toEqual(['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
    const three = timeAxis([toMs('2026-10-20T01:00:00Z'), toMs('2026-10-22T23:00:00Z')]);
    expect(three.ticks.map(utcTime)).toEqual(['12:00', '00:00', '12:00', '00:00', '12:00']);   // 12 h step over ~70 h
    expect(three.ticks.every((t) => t >= three.domain[0] && t <= three.domain[1])).toBe(true);
    expect(timeAxis([]).ticks).toBeUndefined();
  });
});

describe('direction helpers', () => {
  it('maps degrees to compass points, wrapping at north', () => {
    expect([cardinal(0), cardinal(58), cardinal(90), cardinal(200), cardinal(359), cardinal(360), cardinal(-10)]).toEqual(['N', 'ENE', 'E', 'SSW', 'N', 'N', 'N']);
    expect(cardinal(null)).toBe('');
  });
  it('computes the signed shortest turn across north', () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
    expect(turn(0, 180)).toBe(-180);
  });
});

describe('series builders', () => {
  const hours = makeHours();
  const history = makeHistory();

  it('merges observed history and forecast on one sorted time axis', () => {
    const rows = buildSpeedSeries(history, hours);
    expect(rows).toHaveLength(48 + 24);
    expect(rows.every((r, i) => i === 0 || r.t >= rows[i - 1].t)).toBe(true);
    expect(rows.slice(0, 48).every((r) => r.observed !== undefined && r.forecast === undefined)).toBe(true);
    expect(rows.slice(48).every((r) => r.forecast !== undefined && r.observed === undefined)).toBe(true);
  });
  it('skips history hours with no observation', () => {
    expect(buildSpeedSeries([{ timestamp_utc: '2026-10-21T22:00:00Z', speed: null }], [])).toEqual([]);
  });
  it('splits direction by reliability and never joins points', () => {
    const d = buildDirectionSeries(history, hours);
    expect(d.reliable.length + d.unreliable.length).toBe(24);
    expect(d.reliable.length).toBe(hours.filter((h) => h.direction_reliable).length);
    expect(d.observed).toHaveLength(48);
    expect(d.unreliable.every((p) => p.conf < 0.75 || hours.find((h) => h.pred_direction_deg === p.y).pred_speed_100m_ms < 3)).toBe(true);
  });
  it('keeps confidence and reliability per hour', () => {
    const c = buildConfidenceSeries(hours);
    expect(c).toHaveLength(24);
    expect(c[5]).toMatchObject({ lead: 6, confidence: 0.45, reliable: false });
  });
  it('accumulates energy hour by hour', () => {
    const e = buildEnergySeries(hours);
    expect(e[e.length - 1].cumulative).toBe(hours.reduce((a, h) => a + h.energy_kwh, 0));
    expect(e.every((r, i) => i === 0 || r.cumulative >= e[i - 1].cumulative)).toBe(true);
  });
  it('returns empty series for empty input', () => {
    expect(buildEnergySeries([])).toEqual([]);
    expect(buildDirectionSeries([], [])).toEqual({ observed: [], reliable: [], unreliable: [] });
  });
});

describe('compassFor', () => {
  const hours = makeHours();
  it('returns the requested hour and falls back to the first', () => {
    expect(compassFor(hours, 7).lead).toBe(7);
    expect(compassFor(hours, 99).lead).toBe(1);
    expect(compassFor([], 1)).toBeNull();
  });
  it('carries the heading and reliability for that hour', () => {
    const v = compassFor(hours, 6);
    expect(v.reliable).toBe(false);
    expect(v.confidence).toBe(0.45);
    expect(compassFor(hours, 1).heading).toBe(60);
  });
});

describe('sortRows', () => {
  const rows = [{ k: 3, s: 'b' }, { k: null, s: 'a' }, { k: 1, s: 'c' }, { k: 2, s: undefined }];
  it('sorts numbers both ways with missing values always last', () => {
    expect(sortRows(rows, 'k', 1).map((r) => r.k)).toEqual([1, 2, 3, null]);
    expect(sortRows(rows, 'k', -1).map((r) => r.k)).toEqual([3, 2, 1, null]);
  });
  it('sorts strings and does not mutate its input', () => {
    const copy = [...rows];
    expect(sortRows(rows, 's', 1).map((r) => r.s)).toEqual(['a', 'b', 'c', undefined]);
    expect(rows).toEqual(copy);
  });
});

describe('yaw note helpers', () => {
  it('splits backend notes into a short label and detail', () => {
    expect(shortNote('track predicted wind direction')).toBe('track');
    expect(shortNote('hold: within deadband')).toBe('hold');
    expect(noteDetail('hold: within deadband')).toBe('within deadband');
    expect(noteDetail('track predicted wind direction')).toBe('');
  });
});

describe('confidenceTooltipRows (why an hour is or is not acted on)', () => {
  const opts = { threshold: 0.75, minSpeed: 3 };
  const asObject = (rows) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

  it('shows an hour that just misses the speed limit as a failure, not as "3.0" (real 22 Oct 06:00 values)', () => {
    const rows = asObject(confidenceTooltipRows({ confidence: 0.9716, speed: 2.9817, reliable: false }, opts));
    expect(rows['Confidence R (≥ 0.75)']).toBe('0.97 ✓');
    expect(rows['Wind speed (≥ 3 m/s)']).toBe('2.98 m/s ✗');            // two decimals: the audience can see why it fails
    expect(rows['Acted on']).toBe('no');
  });
  it('shows an hour just above the limit as a pass, and the two near-3.0 hours look different', () => {
    const fail = asObject(confidenceTooltipRows({ confidence: 0.9716, speed: 2.9817, reliable: false }, opts));
    const pass = asObject(confidenceTooltipRows({ confidence: 0.9273, speed: 3.0092, reliable: true }, opts));
    expect(pass['Wind speed (≥ 3 m/s)']).toBe('3.01 m/s ✓');
    expect(pass['Acted on']).toBe('yes');
    expect(pass['Wind speed (≥ 3 m/s)']).not.toBe(fail['Wind speed (≥ 3 m/s)']);
  });
  it('marks the confidence rule when that is what fails, and both when both fail', () => {
    const lowConf = asObject(confidenceTooltipRows({ confidence: 0.62, speed: 5.1, reliable: false }, opts));
    expect(lowConf['Confidence R (≥ 0.75)']).toBe('0.62 ✗');
    expect(lowConf['Wind speed (≥ 3 m/s)']).toBe('5.10 m/s ✓');
    const both = asObject(confidenceTooltipRows({ confidence: 0.4, speed: 1.2, reliable: false }, opts));
    expect(both['Confidence R (≥ 0.75)']).toBe('0.40 ✗');
    expect(both['Wind speed (≥ 3 m/s)']).toBe('1.20 m/s ✗');
  });
  it('treats values exactly on the limit as passing (the backend uses >=)', () => {
    const rows = asObject(confidenceTooltipRows({ confidence: 0.75, speed: 3, reliable: true }, opts));
    expect(rows['Confidence R (≥ 0.75)']).toBe('0.75 ✓');
    expect(rows['Wind speed (≥ 3 m/s)']).toBe('3.00 m/s ✓');
  });
  it('still works without limits or with missing values', () => {
    const rows = confidenceTooltipRows({ confidence: 0.9, speed: 4, reliable: true });
    expect(rows.map((r) => r.label)).toEqual(['Confidence R', 'Wind speed', 'Acted on']);
    expect(confidenceTooltipRows({ reliable: false }, opts).slice(0, 2).map((r) => r.value)).toEqual([null, null]);
  });
});

// The real 22 Oct 2026 forecast for the default turbine (cut-in 3.25 m/s): hours 05:00 to 10:00 UTC have no power.
const REAL = [[5.217, 708.9], [5.307, 745.8], [5.289, 738.5], [5.332, 756.6], [3.834, 244.3], [3.209, 0], [2.982, 0], [2.886, 0], [3.009, 0], [3.100, 0], [3.226, 0],
  [3.429, 163.1], [3.475, 169.5], [3.422, 162.1], [3.334, 149.8], [3.612, 195.4], [3.880, 255.7], [3.786, 232.1], [4.175, 336.4], [4.420, 413.7], [4.946, 602.9],
  [5.058, 645.8], [5.066, 649.1], [4.934, 598.1]];
const realHours = (rows = REAL) => rows.map(([v, p], i) => ({ timestamp_utc: `2026-10-22T${String(i).padStart(2, '0')}:00:00Z`, lead_h: i + 1, pred_speed_hub_ms: v, power_kw: p, energy_kwh: p }));

describe('zero-power hours (bars that are missing from the power chart)', () => {
  it('carries the hub wind speed on each point of the energy series', () => {
    const s = buildEnergySeries(realHours());
    expect(s[6]).toMatchObject({ power: 0, speed: 2.982 });
  });
  it('finds the single stretch 05:00 to 10:00 in the real forecast, as whole hours', () => {
    const runs = zeroPowerRuns(buildEnergySeries(realHours()));
    expect(runs).toHaveLength(1);
    expect(runs[0].hours).toBe(6);
    expect(utcTime(runs[0].from)).toBe('04:30');                          // half an hour before the first zero hour (05:00)
    expect(utcTime(runs[0].to)).toBe('10:30');                            // half an hour after the last (10:00)
  });
  it('finds separate stretches, one at the very start and one at the very end', () => {
    const rows = [[2, 0], [2, 0], [5, 500], [2, 0], [5, 500], [2, 0]];
    const runs = zeroPowerRuns(buildEnergySeries(realHours(rows)));
    expect(runs.map((r) => r.hours)).toEqual([2, 1, 1]);
    expect(runs[0].from).toBe(toMs('2026-10-22T00:00:00Z') - 1800e3);
    expect(runs[2].to).toBe(toMs('2026-10-22T05:00:00Z') + 1800e3);
  });
  it('reports nothing when every hour produces power, or when there are no hours', () => {
    expect(zeroPowerRuns(buildEnergySeries(realHours([[5, 400], [6, 700]])))).toEqual([]);
    expect(zeroPowerRuns([])).toEqual([]);
  });
});

describe('powerTooltipRows', () => {
  const rowsFor = (hourIndex, opts = { cutIn: 3.25, cutOut: 25 }) => {
    const s = buildEnergySeries(realHours());
    return Object.fromEntries(powerTooltipRows(s[hourIndex], opts).map((r) => [r.label, r.value]));
  };
  it('explains an hour with no bar: the wind is below cut-in', () => {
    const r = rowsFor(6);                                                  // 06:00, 2.98 m/s
    expect(r.Power).toBe('0 kW');
    expect(r['Wind at hub (cut-in 3.25 m/s)']).toBe('2.98 m/s ✗');
    expect(r['Why no power']).toBe('below cut-in');
  });
  it('explains the near miss at 05:00 (3.21 m/s) without rounding it up past the limit', () => {
    expect(rowsFor(5)['Wind at hub (cut-in 3.25 m/s)']).toBe('3.21 m/s ✗');
  });
  it('shows a normal hour without any warning', () => {
    const r = rowsFor(3);
    expect(r.Power).toBe('757 kW');
    expect(r['Wind at hub']).toBe('5.33 m/s');
    expect(r['Why no power']).toBeUndefined();
  });
  it('handles a shutdown above cut-out, and a missing cut-in', () => {
    const storm = { power: 0, energy: 0, cumulative: 10, speed: 26 };
    const r = Object.fromEntries(powerTooltipRows(storm, { cutIn: 3.25, cutOut: 25 }).map((x) => [x.label, x.value]));
    expect(r['Why no power']).toBe('above cut-out');
    expect(r['Wind at hub (cut-out 25 m/s)']).toBe('26.00 m/s ✗');
    const none = powerTooltipRows({ power: 0, energy: 0, cumulative: 0, speed: 1 });
    expect(none.map((x) => x.label)).toEqual(['Power', 'Energy this hour', 'Cumulative', 'Wind at hub']);   // nothing to compare against
  });
  it('tags the rows the chart colours', () => {
    const kinds = powerTooltipRows(buildEnergySeries(realHours())[3], { cutIn: 3.25 }).map((r) => r.kind);
    expect(kinds).toEqual(['power', undefined, 'cumulative', undefined]);
  });
});

describe('model vs Open-Meteo helpers', () => {
  const hours = [
    { timestamp_utc: '2026-10-22T00:00:00Z', lead_h: 1, model_speed: 5.217, api_speed: 5.39 },
    { timestamp_utc: '2026-10-22T01:00:00Z', lead_h: 2, model_speed: 5.307, api_speed: null },
  ];
  it('puts both forecasts on one time axis and keeps a missing Open-Meteo value empty (never zero)', () => {
    const s = buildModelVsApiSeries(hours);
    expect(s).toEqual([{ t: toMs('2026-10-22T00:00:00Z'), model: 5.217, api: 5.39 }, { t: toMs('2026-10-22T01:00:00Z'), model: 5.307, api: null }]);
    expect(buildModelVsApiSeries([])).toEqual([]);
    expect(buildModelVsApiSeries([{ timestamp_utc: '2026-10-22T00:00:00Z', model_speed: 3 }])[0].api).toBeNull();      // field absent
  });
  it('shows both speeds and the difference as model minus Open-Meteo, with an explicit sign', () => {
    const rows = Object.fromEntries(modelVsApiRows({ model: 5.217, api: 5.39 }).map((r) => [r.label, r.value]));
    expect(rows['Our model']).toBe('5.22 m/s');
    expect(rows['Open-Meteo']).toBe('5.39 m/s');
    expect(rows['Difference (model − Open-Meteo)']).toBe('−0.17 m/s');           // the model is lower
    const higher = Object.fromEntries(modelVsApiRows({ model: 4.934, api: 4.15 }).map((r) => [r.label, r.value]));
    expect(higher['Difference (model − Open-Meteo)']).toBe('+0.78 m/s');
    expect(Object.fromEntries(modelVsApiRows({ model: 3, api: 3 }).map((r) => [r.label, r.value]))['Difference (model − Open-Meteo)']).toBe('+0.00 m/s');
  });
  it('says so when Open-Meteo has no value for the hour, and gives no difference', () => {
    const rows = Object.fromEntries(modelVsApiRows({ model: 5.3, api: null }).map((r) => [r.label, r.value]));
    expect(rows['Open-Meteo']).toBe('no forecast stored');
    expect(rows['Difference (model − Open-Meteo)']).toBeNull();
  });
  it('tags the rows the chart colours', () => {
    expect(modelVsApiRows({ model: 1, api: 2 }).map((r) => r.kind)).toEqual(['model', 'api', undefined]);
  });
});
