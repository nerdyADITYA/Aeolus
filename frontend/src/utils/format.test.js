import { fmtMw, fmtNumber, fmtPercent, fmtUtc, parseCoord } from './format.js';

describe('format', () => {
  it('parses and validates coordinates', () => {
    expect(parseCoord('23.0225', -90, 90)).toEqual({ value: 23.0225, error: null });
    expect(parseCoord(' 72.5 ', -180, 180).value).toBe(72.5);
    expect(parseCoord('', -90, 90).error).toBe('Required');
    expect(parseCoord('abc', -90, 90).error).toBe('Enter a number');
    expect(parseCoord('91', -90, 90).error).toBe('Must be between -90 and 90');
    expect(parseCoord('-180.5', -180, 180).value).toBeNull();
  });
  it('formats numbers, percentages, power and times', () => {
    expect(fmtNumber(7768)).toBe((7768).toLocaleString());
    expect(fmtNumber(null)).toBe('—');
    expect(fmtNumber(4.04, 1)).toBe('4.0');
    expect(fmtPercent(0.0979)).toBe('9.8');
    expect(fmtMw(3300)).toBe('3.3 MW');
    expect(fmtMw(5000)).toBe('5 MW');
    expect(fmtMw(660)).toBe('660 kW');
    expect(fmtMw(1650)).toBe('1.65 MW');
    expect(fmtMw(2550)).toBe('2.55 MW');
    expect(fmtUtc('2026-10-21T23:00:00Z')).toBe('2026-10-21 23:00 UTC');
    expect(fmtUtc(null)).toBe('—');
  });
});
