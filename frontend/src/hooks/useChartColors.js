import { useEffect, useState } from 'react';

// Recharts draws SVG attributes, which cannot always resolve CSS variables, so read the theme's real colours.
const NAMES = { accent: '--accent', accent2: '--accent-2', text: '--text', muted: '--muted', grid: '--grid', border: '--border', warn: '--warn', good: '--good', bad: '--bad', surface: '--surface' };
const FALLBACK = { accent: '#22d3ee', accent2: '#a78bfa', text: '#e6edf5', muted: '#8a99ad', grid: '#172232', border: '#1e2a3a', warn: '#fbbf24', good: '#34d399', bad: '#f87171', surface: '#111823' };

function read() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [k, cs.getPropertyValue(v).trim() || FALLBACK[k]]));
}

/** Current theme colours; updates when the dark/light toggle changes `data-theme`. */
export function useChartColors() {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setColors(read());
    return () => obs.disconnect();
  }, []);
  return colors;
}
