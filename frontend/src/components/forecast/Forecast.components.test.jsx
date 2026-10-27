import { cloneElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Compass from '../charts/Compass.jsx';
import ChartTooltip from '../charts/ChartTooltip.jsx';
import ConfidenceBars from '../charts/ConfidenceBars.jsx';
import DirectionChart from '../charts/DirectionChart.jsx';
import PowerEnergyChart from '../charts/PowerEnergyChart.jsx';
import SpeedChart from '../charts/SpeedChart.jsx';
import ExportButtons from '../common/ExportButtons.jsx';
import ForecastTable from '../tables/ForecastTable.jsx';
import { useChartColors } from '../../hooks/useChartColors.js';
import { makeHistory, makeHours } from '../../test/mockApi.js';

// ResponsiveContainer measures the DOM, which jsdom cannot; give the real chart a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => cloneElement(children, { width: 640, height: 300 }) };
});

const hours = makeHours();
const history = makeHistory();

describe('ForecastTable', () => {
  const setup = () => {
    const onSelect = vi.fn();
    render(<ForecastTable hours={hours} selectedLead={3} onSelect={onSelect} />);
    return { onSelect, user: userEvent.setup() };
  };
  const leads = () => screen.getAllByRole('row').slice(1, -1).map((r) => r.dataset.lead);

  it('shows all 24 hours with a total row, in lead order by default', () => {
    setup();
    expect(leads()).toHaveLength(24);
    expect(leads()[0]).toBe('1');
    const total = hours.reduce((a, h) => a + h.energy_kwh, 0);
    expect(within(screen.getAllByRole('row').at(-1)).getByText(total.toLocaleString())).toBeInTheDocument();
  });
  it('highlights the selected lead and reports clicks on a lead', async () => {
    const { onSelect, user } = setup();
    expect(document.querySelector('tr.selected').dataset.lead).toBe('3');
    await user.click(screen.getByRole('button', { name: 'Show +9 hours on the compass' }));
    expect(onSelect).toHaveBeenCalledWith(9);
  });
  it('sorts by a column, flips on the second click, and exposes aria-sort', async () => {
    const { user } = setup();
    const power = screen.getByRole('button', { name: /Power kW/ });
    await user.click(power);
    expect(screen.getByRole('columnheader', { name: /Power kW/ })).toHaveAttribute('aria-sort', 'ascending');
    const asc = leads().map((l) => hours[l - 1].power_kw);
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);
    await user.click(power);
    expect(screen.getByRole('columnheader', { name: /Power kW/ })).toHaveAttribute('aria-sort', 'descending');
    const desc = leads().map((l) => hours[l - 1].power_kw);
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);
  });
  it('shows hold and track badges and a dash when no heading exists yet', () => {
    const early = makeHours().map((h, i) => (i === 0 ? { ...h, direction_reliable: false, recommended_nacelle_heading_deg: null, yaw_note: 'hold: low confidence or below cut-in/low-speed' } : h));
    render(<ForecastTable hours={early} selectedLead={1} onSelect={() => {}} />);
    const first = document.querySelector('tr[data-lead="1"]');
    expect(within(first).getByText('hold')).toBeInTheDocument();
    expect(within(first).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('Compass', () => {
  it('shows the chosen hour, the marker for the advisory heading, and moves with the slider', () => {
    const onLead = vi.fn();
    const { rerender } = render(<Compass hours={hours} lead={1} onLeadChange={onLead} />);
    expect(screen.getByText(/Forecast hour: \+1 h/)).toBeInTheDocument();
    expect(screen.getByText('reliable')).toBeInTheDocument();
    expect(screen.getByTestId('heading-marker')).toHaveAttribute('transform', 'rotate(60 100 100)');
    act(() => {
      const slider = screen.getByLabelText(/Forecast hour/);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '6');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onLead).toHaveBeenCalledWith(6);
    rerender(<Compass hours={hours} lead={6} onLeadChange={onLead} />);
    expect(screen.getByText('not acted on')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Compass at \+6 hours/ })).toBeInTheDocument();
  });
  it('keeps the heading marker at the advisory heading while the needle follows the wind', () => {
    // hour +2: wind from 63 deg, but the heading is held at 60 deg (inside the 8 deg deadband)
    const { container } = render(<Compass hours={hours} lead={2} onLeadChange={() => {}} />);
    expect(hours[1].pred_direction_deg).toBe(63);
    expect(hours[1].recommended_nacelle_heading_deg).toBe(60);
    expect(screen.getByTestId('heading-marker')).toHaveAttribute('transform', 'rotate(60 100 100)');
    const needle = [...container.querySelectorAll('g[transform]')].find((g) => !g.dataset.testid);
    expect(needle).toHaveAttribute('transform', 'rotate(63 100 100)');
    expect(screen.getByText(/hold \(within deadband\)/)).toBeInTheDocument();
  });
  it('shows the wind speed to two decimals, so 2.98 m/s is not displayed as 3.0', () => {
    const near = hours.map((h, i) => (i === 0 ? { ...h, pred_speed_100m_ms: 2.9817, direction_confidence: 0.9716, direction_reliable: false } : h));
    render(<Compass hours={near} lead={1} onLeadChange={() => {}} />);
    expect(screen.getByText(/R 0\.97 · 2\.98 m\/s/)).toBeInTheDocument();
    expect(screen.getByText('not acted on')).toBeInTheDocument();
  });
  it('omits the heading marker until a reliable heading exists', () => {
    const none = hours.map((h) => ({ ...h, direction_reliable: false, recommended_nacelle_heading_deg: null }));
    render(<Compass hours={none} lead={1} onLeadChange={() => {}} />);
    expect(screen.queryByTestId('heading-marker')).toBeNull();
  });
});

describe('charts', () => {
  it('speed chart draws observed and forecast series with a UTC axis and a legend', () => {
    const { container } = render(<SpeedChart history={history} hours={hours} originUtc="2026-10-21 23:00:00" cutInMs={3.25} />);
    expect(screen.getByRole('img', { name: /Wind speed chart: 24 forecast hours/ })).toBeInTheDocument();
    expect(screen.getByText('Cut-in 3.25 m/s')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-line-curve, .recharts-area-curve').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toMatch(/22 Oct/);                                  // the midnight tick carries the date
  });
  it('direction chart draws dots only (never a line) and counts reliable vs hollow hours', () => {
    const { container } = render(<DirectionChart history={history} hours={hours} />);
    const reliable = hours.filter((h) => h.direction_reliable).length;
    expect(screen.getByRole('img', { name: new RegExp(`${reliable} reliable and ${24 - reliable} low-confidence`) })).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(0);
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(48 + 24);
    expect(container.querySelectorAll('circle[fill="none"]')).toHaveLength(24 - reliable);
    expect(container.textContent).toMatch(/N 0°/);
  });
  describe('direction chart tooltips', () => {
    // Regression: the tooltip once worked only for the observed (white) dots, because a ComposedChart builds its hover
    // positions from the first series; and hollow dots (fill none) could not be hit in their empty centre.
    const symbols = (container) => [...container.querySelectorAll('.recharts-scatter-symbol')];
    const hover = (el) => { fireEvent.mouseOver(el); fireEvent.mouseEnter(el); };
    const tipText = (container) => container.querySelector('.tip')?.textContent ?? null;

    it('draws one hover symbol per dot: observed, reliable and low-confidence', () => {
      const { container } = render(<DirectionChart history={history} hours={hours} />);
      const reliable = hours.filter((h) => h.direction_reliable).length;
      expect(symbols(container)).toHaveLength(48 + 24);
      expect(reliable).toBeGreaterThan(0);
      expect(reliable).toBeLessThan(24);
    });

    it('every dot has a hover target larger than itself, so a hollow dot is hoverable in its middle', () => {
      const { container } = render(<DirectionChart history={history} hours={hours} />);
      for (const sym of symbols(container)) {
        const [hit, dot] = sym.querySelectorAll('circle');
        expect(hit.getAttribute('fill')).toBe('transparent');                                // painted, so it receives the mouse
        expect(Number(hit.getAttribute('r'))).toBeGreaterThan(Number(dot.getAttribute('r')));
        expect(Number(hit.getAttribute('r'))).toBeGreaterThanOrEqual(8);
      }
      expect(container.querySelectorAll('circle[fill="none"]')).toHaveLength(hours.filter((h) => !h.direction_reliable).length);
    });

    it.each([
      ['an observed (white) dot', (c) => symbols(c)[10], /Observed/],
      ['a reliable forecast (purple) dot', (c) => symbols(c)[48 + 1], /Forecast(?! \(low)/],
      ['a low-confidence forecast (hollow) dot', (c) => symbols(c).at(-1), /Forecast \(low confidence\)/],
    ])('shows a tooltip when hovering %s', (_name, pick, label) => {
      const { container } = render(<DirectionChart history={history} hours={hours} />);
      expect(tipText(container)).toBeNull();
      hover(pick(container));
      const text = tipText(container);
      expect(text, 'no tooltip appeared').not.toBeNull();
      expect(text).toMatch(label);
      expect(text).toMatch(/\d+° [NESW]{1,3}/);                                              // direction in degrees with a compass point
    });

    it('shows the confidence for forecast dots', () => {
      const { container } = render(<DirectionChart history={history} hours={hours} />);
      hover(symbols(container)[48 + 2]);
      expect(tipText(container)).toMatch(/Confidence\s*0\.\d\d/);
    });
  });

  it('confidence chart states how many hours pass the threshold', () => {
    render(<ConfidenceBars hours={hours} threshold={0.75} minSpeed={3} />);
    const reliable = hours.filter((h) => h.direction_reliable).length;
    expect(screen.getByText(`${reliable} of 24 hours are reliable (R ≥ 0.75 and speed ≥ 3 m/s)`)).toBeInTheDocument();
    expect(screen.getByText('Threshold R ≥ 0.75')).toBeInTheDocument();
  });
  it('power chart reports the energy total in its description', () => {
    render(<PowerEnergyChart hours={hours} ratedKw={3300} turbineName="2023NREL Bespoke 3.3MW 148" />);
    const total = hours.reduce((a, h) => a + h.energy_kwh, 0);
    expect(screen.getByRole('img', { name: `Power and energy chart: ${total.toLocaleString()} kWh over 24 hours` })).toBeInTheDocument();
    expect(screen.getByText('Rated 3,300 kW')).toBeInTheDocument();
  });
  describe('power chart: hours with no bar', () => {
    const real = [5.2, 5.3, 3.8, 3.2, 3.0, 2.9, 3.0, 3.5, 4.2, 5.0].map((v, i) => ({
      timestamp_utc: `2026-10-22T${String(i).padStart(2, '0')}:00:00Z`, lead_h: i + 1, pred_speed_hub_ms: v, power_kw: v < 3.25 ? 0 : v * 100, energy_kwh: v < 3.25 ? 0 : v * 100,
    }));
    it('shades each zero-power stretch and says why in the legend', () => {
      const { container } = render(<PowerEnergyChart hours={real} ratedKw={3300} turbineName="T" cutInMs={3.25} cutOutMs={25} />);
      expect(container.querySelectorAll('.recharts-reference-area')).toHaveLength(1);        // 03:00 to 06:00 is one stretch
      expect(screen.getByText('No bar = no power (wind below cut-in 3.25 m/s)')).toBeInTheDocument();
      expect(container.textContent).toMatch(/below cut-in/);                                  // the label on the shaded area
    });
    it('shows no shading and no extra legend entry when every hour produces power', () => {
      const windy = real.map((h) => ({ ...h, pred_speed_hub_ms: 6, power_kw: 600, energy_kwh: 600 }));
      const { container } = render(<PowerEnergyChart hours={windy} ratedKw={3300} turbineName="T" cutInMs={3.25} />);
      expect(container.querySelectorAll('.recharts-reference-area')).toHaveLength(0);
      expect(screen.queryByText(/No bar = no power/)).toBeNull();
    });
    it('explains missing bars in the About panel', () => {
      render(<PowerEnergyChart hours={real} ratedKw={3300} turbineName="T" cutInMs={3.25} />);
      expect(screen.getByText(/A gap with no bar is not missing data/)).toBeInTheDocument();
    });
  });

  it('charts tolerate missing history and an empty forecast', () => {
    expect(() => render(<SpeedChart history={[]} hours={[]} />)).not.toThrow();
    expect(() => render(<PowerEnergyChart hours={[]} />)).not.toThrow();
  });
});

describe('ChartTooltip', () => {
  const rows = (p) => [{ label: 'Speed', value: `${p.v} m/s`, color: 'red' }, { label: 'Missing', value: null }];
  it('shows the UTC time and only the rows that have values', () => {
    render(<ChartTooltip active payload={[{ payload: { t: Date.UTC(2026, 9, 22, 5), v: 4.5 } }]} rows={rows} />);
    expect(screen.getByText('22 Oct 05:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('4.5 m/s')).toBeInTheDocument();
    expect(screen.queryByText('Missing')).toBeNull();
  });
  it('renders nothing when inactive or empty', () => {
    const { container, rerender } = render(<ChartTooltip active={false} payload={[]} rows={rows} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChartTooltip active payload={[{ payload: { t: 0 } }]} rows={() => [{ label: 'x', value: null }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ExportButtons', () => {
  it('links to the backend export for this forecast origin', () => {
    render(<ExportButtons origin="2026-10-21 23:00:00" />);
    expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toBe('/api/site/export?format=csv&origin=2026-10-21+23%3A00%3A00');
    expect(screen.getByRole('link', { name: 'Export JSON' })).toHaveAttribute('download');
  });
});

describe('useChartColors', () => {
  function Probe() {
    const c = useChartColors();
    return <span data-testid="accent">{c.accent}</span>;
  }
  it('falls back to defaults and follows the theme variables when they change', async () => {
    render(<Probe />);
    expect(screen.getByTestId('accent')).toHaveTextContent('#22d3ee');                // jsdom has no CSS vars: documented fallback
    await act(async () => {
      document.documentElement.style.setProperty('--accent', '#0891b2');
      document.documentElement.dataset.theme = 'light';                               // the toggle changes data-theme
      await Promise.resolve();
    });
    expect(screen.getByTestId('accent')).toHaveTextContent('#0891b2');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.dataset.theme = 'dark';
  });
});
