export const fmtNumber = (v, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPercent = (fraction, digits = 1) => (fraction === null || fraction === undefined ? '—' : `${(fraction * 100).toFixed(digits)}`);

/** '2026-10-21 23:00:00' or ISO string -> '2026-10-21 23:00 UTC' */
export const fmtUtc = (s) => (s ? `${String(s).replace('T', ' ').slice(0, 16)} UTC` : '—');

export const fmtDate = (s) => (s ? String(s).slice(0, 10) : '—');

export const fmtCoord = (v) => (Number.isFinite(v) ? v.toFixed(4) : '');

export function parseCoord(text, min, max) {
  const t = String(text).trim();
  if (t === '') return { value: null, error: 'Required' };
  const v = Number(t);
  if (!Number.isFinite(v)) return { value: null, error: 'Enter a number' };
  if (v < min || v > max) return { value: null, error: `Must be between ${min} and ${max}` };
  return { value: v, error: null };
}

// up to 2 decimals, trailing zeros dropped: 3300 -> '3.3 MW', 1650 -> '1.65 MW', 5000 -> '5 MW'
export const fmtMw = (kw) => (kw >= 1000 ? `${Number((kw / 1000).toFixed(2))} MW` : `${Math.round(kw)} kW`);
