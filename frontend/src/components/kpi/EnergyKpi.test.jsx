import { render, screen } from '@testing-library/react';
import App from '../../App.jsx';
import KpiCard from './KpiCard.jsx';
import { ENERGY_TARGET_KWH, energyTone } from '../../utils/forecast.js';
import { TURBINES, forecastPayload, makeForecast, makeHours, mockFetch, phase7Routes, readySite } from '../../test/mockApi.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  window.location.hash = '';
});

describe('energyTone', () => {
  it('is red below 2000 kWh and green from 2000 kWh up', () => {
    expect(ENERGY_TARGET_KWH).toBe(2000);
    expect(energyTone(913)).toBe('bad');
    expect(energyTone(1999.9)).toBe('bad');
    expect(energyTone(0)).toBe('bad');
    expect(energyTone(2000)).toBe('good');          // exactly on the line counts as meeting it
    expect(energyTone(7768)).toBe('good');
  });
  it('gives no colour when there is no usable number', () => {
    for (const v of [null, undefined, NaN, Infinity, '2500']) expect(energyTone(v)).toBeUndefined();
  });
});

describe('KpiCard tone', () => {
  it('adds the tone class and a written note, and stays plain without them', () => {
    const { container, rerender } = render(<KpiCard label="Expected energy" value="913" unit="kWh" tone="bad" note="Below 2,000 kWh" />);
    expect(container.firstChild).toHaveClass('kpi', 'bad');
    expect(screen.getByText('Below 2,000 kWh')).toBeInTheDocument();
    rerender(<KpiCard label="Peak power" value="700" unit="kW" />);
    expect(container.firstChild).not.toHaveClass('good');
    expect(container.firstChild).not.toHaveClass('bad');
    expect(container.querySelector('.kpi-note')).toBeNull();
  });
});

describe('Expected energy card on the forecast', () => {
  const routes = (forecast) => ({
    'GET /api/site': readySite(), 'GET /api/turbines': TURBINES, 'GET /api/site/forecast': forecast, ...phase7Routes(),
  });
  const withTotal = (kwhPerHour) => {
    const hours = makeHours().map((h) => ({ ...h, energy_kwh: kwhPerHour }));
    return makeForecast({ hours, summary: { ...forecastPayload.summary, total_kwh: kwhPerHour * hours.length } });
  };
  const card = async () => (await screen.findByText('Expected energy')).closest('.kpi');

  it('is red with a "below" note when the day is under 2000 kWh', async () => {
    mockFetch(routes(withTotal(40)));                // 40 x 24 = 960 kWh
    render(<App />);
    const c = await card();
    expect(c).toHaveClass('bad');
    expect(c).toHaveTextContent('960');
    expect(c).toHaveTextContent('Below 2,000 kWh');
  });

  it('is green with an "at or above" note when the day reaches 2000 kWh', async () => {
    mockFetch(routes(withTotal(100)));               // 100 x 24 = 2400 kWh
    render(<App />);
    const c = await card();
    expect(c).toHaveClass('good');
    expect(c).toHaveTextContent('At or above 2,000 kWh');
  });

  it('colours only the energy card, not the other headline numbers', async () => {
    mockFetch(routes(withTotal(40)));
    render(<App />);
    await card();
    for (const label of ['Capacity factor', 'Peak power']) {
      const other = screen.getByText(label).closest('.kpi');
      expect(other).not.toHaveClass('good');
      expect(other).not.toHaveClass('bad');
    }
  });
});
