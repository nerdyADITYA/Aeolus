import { render, screen, within } from '@testing-library/react';
import SimpleModelTable from './SimpleModelTable.jsx';
import { fixtures } from '../../test/mockApi.js';

const { report } = fixtures;      // real numbers from a live run (see test/fixtures)

const setup = (props = {}) =>
  render(<SimpleModelTable rows={report.test_table} selection={report.selection} mlName="LightGBM" split={report.split} {...props} />);
const body = () => within(screen.getByRole('region', { name: 'Model comparison table' }));
const rowFor = (name) => body().getByText(name, { exact: false }).closest('tr');
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

describe('SimpleModelTable', () => {
  it('is a single table with one row per model, best (lowest RMSE) first', () => {
    setup();
    const rows = body().getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    const names = rows.map((r) => r.querySelector('td div').textContent.replace('best', '').trim());
    expect(names).toEqual(['LightGBM', 'SARIMAX', 'Seasonal naive (24h)', 'Persistence']);
  });

  it('shows the real MAE, RMSE and direction error of every model', () => {
    setup();
    const values = Object.fromEntries(['Persistence', 'Seasonal naive (24h)', 'SARIMAX', 'LightGBM'].map((m) => [m, cells(rowFor(m)).slice(1)]));
    expect(values.Persistence).toEqual(['1.18', '1.52', '28.0']);
    expect(values['Seasonal naive (24h)']).toEqual(['1.04', '1.37', '22.8']);
    expect(values.SARIMAX).toEqual(['0.99', '1.29', '34.0']);
    expect(values.LightGBM[0]).toMatch(/^0\.8[89]$/);                       // 0.885 sits on a rounding edge
    expect(values.LightGBM.slice(1)).toEqual(['1.14', expect.stringMatching(/^20\.[45]$/)]);
  });

  it('labels the columns with their units and says lower is better', () => {
    setup();
    for (const label of ['Speed error: MAE (m/s)', 'Speed error: RMSE (m/s)', 'Direction error (°)']) {
      expect(body().getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('Lower is better.')).toBeInTheDocument();
  });

  it('highlights the best value in each column and marks only the overall best model', () => {
    setup();
    const lgbm = rowFor('LightGBM');
    expect(lgbm.querySelectorAll('td.best')).toHaveLength(3);               // LightGBM wins all three scores
    expect(within(lgbm).getByText('best')).toHaveClass('good');
    for (const other of ['Persistence', 'Seasonal naive (24h)', 'SARIMAX']) {
      expect(rowFor(other).querySelectorAll('td.best')).toHaveLength(0);
      expect(within(rowFor(other)).queryByText('best')).toBeNull();
    }
    expect(screen.getAllByText('best')).toHaveLength(1);
  });

  it('does not crown a model that wins only one of speed and direction', () => {
    const split = report.selection.map((s) => (s.target === 'direction' ? { ...s, winner: 'Seasonal naive (24h)' } : s));
    setup({ selection: split });
    expect(screen.queryByText('best')).toBeNull();                          // no single "best" when the winners differ
    expect(rowFor('LightGBM').querySelectorAll('td.best').length).toBeGreaterThan(0);   // the per-column highlights still show who wins what
  });

  it('describes each model in one plain sentence, and the ML model as the one this app uses', () => {
    setup();
    expect(screen.getByText('Assumes the wind stays exactly as it is now')).toBeInTheDocument();
    expect(screen.getByText('Assumes it will be like the same hour yesterday')).toBeInTheDocument();
    expect(screen.getByText('A classic statistics model')).toBeInTheDocument();
    expect(screen.getByText('Machine-learning model used by this app')).toBeInTheDocument();
  });

  it('states what was scored: how many past forecasts, which dates, how far ahead', () => {
    setup();
    expect(screen.getByText(/1 to 24 hours ahead, on 596 past forecasts the models never saw/)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-25 to 2026-10-21/)).toBeInTheDocument();
  });

  it('explains MAE, RMSE (and its link to MSE) and direction error in plain words', () => {
    setup();
    expect(screen.getByText('MAE', { selector: 'dt' }).nextSibling).toHaveTextContent(/typical size of a miss/);
    expect(screen.getByText('RMSE', { selector: 'dt' }).nextSibling).toHaveTextContent(/square root of the MSE/);
    expect(screen.getByText('Direction error', { selector: 'dt' }).nextSibling).toHaveTextContent(/359° versus 1° counts as 2°/);
  });

  it('says why there is no single accuracy percentage, and what the errors are measured against', () => {
    setup();
    expect(screen.getByText(/single .accuracy %. is not used/)).toBeInTheDocument();
    expect(screen.getByText(/against reanalysis data, not a sensor at the turbine/)).toBeInTheDocument();
  });

  it('shows the stale badge only when the evaluation is stale', () => {
    const { unmount } = setup();
    expect(screen.queryByText('evaluation stale')).toBeNull();
    unmount();
    setup({ stale: true });
    expect(screen.getByText('evaluation stale')).toHaveClass('warn');
  });

  it('copes with an unknown model name and does not mutate its input', () => {
    const rows = [...report.test_table, { ...report.test_table[0], model: 'Prophet', 'RMSE_1-24h': 9 }];
    const before = rows.map((r) => r.model);
    setup({ rows });
    expect(body().getAllByRole('row')).toHaveLength(1 + 5);
    expect(rows.map((r) => r.model)).toEqual(before);                       // sorted a copy
    expect(cells(rowFor('Prophet'))[0].trim()).toBe('Prophet');
  });
});
