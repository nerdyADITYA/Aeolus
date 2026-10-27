import { cloneElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BinErrorChart from '../charts/BinErrorChart.jsx';
import CurveChart from '../charts/CurveChart.jsx';
import LeadChart from '../charts/LeadChart.jsx';
import ValueTooltip from '../charts/ValueTooltip.jsx';
import AsyncBlock from '../common/AsyncBlock.jsx';
import DirectionAnalysis from './DirectionAnalysis.jsx';
import MetricsTable from './MetricsTable.jsx';
import SelectionPanel from './SelectionPanel.jsx';
import { fixtures } from '../../test/mockApi.js';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => cloneElement(children, { width: 640, height: 300 }) };
});

const { report, direction, curve } = fixtures;

describe('SelectionPanel', () => {
  it('shows both winners with the improvement, scores and interval from the backend', () => {
    render(<SelectionPanel selection={report.selection} criteria={report.criteria} split={report.split} />);
    expect(screen.getByRole('heading', { name: 'Speed winner' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Direction winner' })).toBeInTheDocument();
    expect(screen.getAllByText('LightGBM', { selector: '.stat-big' })).toHaveLength(2);
    expect(screen.getByText(/16\.8% lower error than Seasonal naive/)).toBeInTheDocument();
    expect(screen.getByText('1.143 m/s')).toBeInTheDocument();
    expect(screen.getByText('[-0.201, -0.108]')).toBeInTheDocument();
    expect(screen.getAllByText('significantly better')).toHaveLength(2);
    for (const b of screen.getAllByText('significantly better')) expect(b).toHaveClass('good');
  });
  it('lists every success criterion with a pass or fail mark and states the held-out scope', () => {
    render(<SelectionPanel selection={report.selection} criteria={report.criteria} split={report.split} />);
    expect(screen.getByText('all met')).toBeInTheDocument();
    expect(screen.getAllByText(/^Met:$/)).toHaveLength(report.criteria.length);
    expect(screen.getByText(/Scored on 596 forecast origins between 2026-05-25 and 2026-10-21/)).toBeInTheDocument();
  });
  it('does not hide a failed criterion or a non-significant winner', () => {
    const criteria = report.criteria.map((c, i) => (i === 2 ? { ...c, met: false } : c));
    const selection = report.selection.map((s) => ({ ...s, significantly_better: false }));
    render(<SelectionPanel selection={selection} criteria={criteria} split={report.split} />);
    expect(screen.getByText('some not met')).toBeInTheDocument();
    expect(screen.getAllByText(/^Not met:$/)).toHaveLength(1);
    expect(screen.getAllByText('not significant')).toHaveLength(2);
    for (const b of screen.getAllByText('not significant')) expect(b).toHaveClass('warn');            // a weak result is not shown in green
    expect(screen.getByText('some not met')).toHaveClass('warn');
  });
});

describe('MetricsTable', () => {
  const setup = () => render(<MetricsTable rows={report.test_table} selection={report.selection} mlName="LightGBM" />);
  const row = (name) => screen.getByRole('row', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });

  it('shows one row per model and highlights the lowest value in each speed column', () => {
    setup();
    expect(screen.getAllByRole('row')).toHaveLength(2 + 4);                              // two header rows + four models
    const lgbm = row('LightGBM');
    expect(within(lgbm).getByText('selected')).toBeInTheDocument();
    const best = lgbm.querySelectorAll('td.best');
    expect(best).toHaveLength(10);                                                         // LightGBM wins all ten speed columns
    expect(within(row('Persistence')).queryAllByText(/./).some((n) => n.classList?.contains('best'))).toBe(false);
  });
  it('switches to the direction view with its own columns and winner', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Direction (°)' }));
    expect(screen.getByText('Circular MAE, wind ≥ 3 m/s')).toBeInTheDocument();
    expect(screen.getByText('All hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Direction (°)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row('LightGBM')).getByText('selected')).toBeInTheDocument();
    expect(within(row('SARIMAX')).queryByText('selected')).toBeNull();
  });
  it('marks the best model, not the ML model, when a baseline wins', () => {
    const selection = report.selection.map((s) => (s.target === 'speed' ? { ...s, winner: 'Seasonal naive (24h)' } : s));
    render(<MetricsTable rows={report.test_table} selection={selection} mlName="LightGBM" />);
    expect(within(screen.getByRole('row', { name: /^Seasonal naive/ })).getByText('selected')).toBeInTheDocument();
  });
});

describe('DirectionAnalysis', () => {
  it('shows the headline errors, readable bins and the threshold trade-off', () => {
    render(<DirectionAnalysis direction={direction} />);
    expect(screen.getByRole('heading', { name: 'Direction reliability (LightGBM)' })).toBeInTheDocument();
    expect(screen.getByText(/R ≥ 0\.75 and the speed is at least 3 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/Correlation between R and error: -0\.46/)).toBeInTheDocument();
    expect(screen.getByText('all hours')).toBeInTheDocument();
    expect(screen.getByText('R >= 0.75')).toBeInTheDocument();
    const sweep = screen.getByRole('region', { name: 'Confidence threshold sweep' });
    expect(within(sweep).getAllByRole('row').length).toBe(direction.sweep.length + 1);
  });
  it('highlights the chosen threshold when the sweep contains it', () => {
    const withChosen = { ...direction, sweep: [...direction.sweep, { R_threshold: 0.75, 'coverage_%': 80, circ_MAE_kept_deg: 19.1 }].sort((a, b) => a.R_threshold - b.R_threshold) };
    render(<DirectionAnalysis direction={withChosen} />);
    expect(screen.getByText('0.75 (chosen)')).toBeInTheDocument();
  });
});

describe('charts', () => {
  it('lead chart draws one line per model with the ML model thicker', () => {
    const { container } = render(<LeadChart title="Speed MAE by lead" byLead={report.by_lead} metricKey="speed_MAE" mlName="LightGBM" unit="m/s" />);
    const lines = container.querySelectorAll('.recharts-line-curve');
    expect(lines).toHaveLength(4);
    const widths = [...lines].map((l) => Number(l.getAttribute('stroke-width')));
    expect(widths.filter((w) => w > 2)).toHaveLength(1);
    expect(screen.getByText('LightGBM', { selector: 'li' })).toBeInTheDocument();
    expect(container.textContent).toMatch(/24 h/);
  });
  it('bin chart labels prettified bins and describes itself for screen readers', () => {
    const { container } = render(<BinErrorChart title="Error by predicted confidence" rows={direction.by_confidence} binKey="R_bin" xLabel="Confidence R" />);
    expect(container.textContent).toContain('0.8–1');
    expect(screen.getByRole('img', { name: /Error by predicted confidence: 0–0\.2 70 degrees/ })).toBeInTheDocument();
  });
  it('curve chart marks cut-in, rated and cut-out', () => {
    const { container } = render(<CurveChart curve={curve.curve} turbine={curve.turbine} />);
    expect(screen.getByText('Cut-in 3.25 m/s')).toBeInTheDocument();
    expect(screen.getByText('Cut-out 25 m/s')).toBeInTheDocument();
    expect(screen.getByText('Rated 3,300 kW')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(3);
  });
  it('value tooltip formats rows and stays hidden when inactive', () => {
    const { container, rerender } = render(
      <ValueTooltip active payload={[{ dataKey: 'a', name: 'LightGBM', value: 0.8123, color: 'red', payload: { median: 1 } }]} label={6}
        title={(l) => `+${l} h lead`} format={(v) => `${v.toFixed(2)} m/s`} extra={(p) => `median ${p.median}`} />,
    );
    expect(screen.getByText('+6 h lead')).toBeInTheDocument();
    expect(screen.getByText('0.81 m/s')).toBeInTheDocument();
    expect(screen.getByText('median 1')).toBeInTheDocument();
    rerender(<ValueTooltip active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AsyncBlock', () => {
  const render_ = (state) => render(<AsyncBlock state={state} emptyTitle="Nothing yet">{(d) => <p>loaded {d.x}</p>}</AsyncBlock>);
  it('shows the loaded data, a skeleton while loading, a hint for 404 and an error banner otherwise', () => {
    const { container, unmount } = render_({ data: { x: 1 }, loading: false });
    expect(screen.getByText('loaded 1')).toBeInTheDocument();
    unmount();
    const loading = render_({ data: null, loading: true });
    expect(loading.container.querySelector('.skeleton')).toBeInTheDocument();
    loading.unmount();
    const notFound = render_({ data: null, loading: false, error: { status: 404, detail: 'none', hint: 'run it first' } });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText('run it first')).toBeInTheDocument();
    notFound.unmount();
    render_({ data: null, loading: false, error: { status: 500, detail: 'boom' } });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(container).toBeDefined();
  });
  it('keeps showing stale data while a reload is in flight', () => {
    render_({ data: { x: 2 }, loading: true });
    expect(screen.getByText('loaded 2')).toBeInTheDocument();
  });
});
