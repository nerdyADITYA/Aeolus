import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { TURBINES, fixtures, forecastPayload, mockFetch, phase7Routes, readySite } from './test/mockApi.js';

const byMethod = (f, method, path) => f.calls.filter((c) => c.method === method && c.path === path);

const routes = (over = {}) => ({
  'GET /api/site': readySite(),
  'GET /api/turbines': TURBINES,
  'GET /api/site/forecast': forecastPayload,
  ...phase7Routes(),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});

describe('page structure', () => {
  it('shows jump links and every section once the site is ready', async () => {
    mockFetch(routes());
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Page sections' })).toBeInTheDocument();
    for (const name of ['Site', 'Forecast', 'Model quality', 'Model vs Open-Meteo', 'Data and turbine', 'Assumptions and limitations']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    const links = within(screen.getByRole('navigation', { name: 'Page sections' })).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#site', '#data-turbine', '#forecast', '#model-quality', '#open-meteo-comparison', '#assumptions']);
    // the page itself follows the same order as the links
    const onPage = [...document.querySelectorAll('section[id]')].map((s) => s.id);
    expect(onPage).toEqual(links.map((a) => a.getAttribute('href').slice(1)));
    for (const a of links) expect(document.getElementById(a.getAttribute('href').slice(1))).not.toBeNull();   // every link has a target
  });
  it('shows only the site section before a site exists', async () => {
    mockFetch({ 'GET /api/site': { configured: false } });
    render(<App />);
    await screen.findByRole('heading', { name: 'Set your site' });
    expect(screen.queryByRole('navigation', { name: 'Page sections' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Model quality' })).toBeNull();
  });
});

describe('chart explanations', () => {
  it('every chart card on the page, and the compass, carries an "About this chart" panel', async () => {
    mockFetch(routes());
    render(<App />);
    await screen.findByText('596 held-out origins');
    await screen.findByRole('heading', { name: 'Direction reliability (LightGBM)' });
    await screen.findByText('curve verified');
    await screen.findByRole('heading', { name: 'Wind speed forecast: our model vs Open-Meteo' });   // fetched automatically, nothing to press
    const cards = [...document.querySelectorAll('.chart-card, .compass-card')];
    expect(cards.length).toBeGreaterThanOrEqual(12);                                       // speed, compass, direction, confidence, power, 3 lead, 2 bin, curve, daily
    const missing = cards.filter((c) => !c.querySelector('.chart-info')).map((c) => c.querySelector('h3')?.textContent);
    expect(missing).toEqual([]);                                                           // a new chart without an explanation fails here
  });
});

describe('model quality section', () => {
  it('loads the real report and direction analysis', async () => {
    mockFetch(routes());
    render(<App />);
    const mq = await screen.findByRole('region', { name: 'Model quality' });
    expect(await within(mq).findByText('596 held-out origins')).toBeInTheDocument();          // inside the detailed results
    expect(within(mq).getByText('all met')).toBeInTheDocument();
    expect(within(mq).getAllByRole('heading', { name: /by lead$/ })).toHaveLength(3);
    expect(within(mq).getByRole('heading', { name: 'Energy error (proxy)' })).toBeInTheDocument();
    expect(await within(mq).findByRole('heading', { name: 'Direction reliability (LightGBM)' })).toBeInTheDocument();
    expect(within(mq).getByText(/NOT accuracy against measured generation/)).toBeInTheDocument();
  });
  it('shows a helpful empty state when no evaluation exists', async () => {
    mockFetch(routes({ 'GET /api/site/models/report': { status: 404, body: { detail: 'No model evaluation yet' } } }));
    render(<App />);
    const mq = await screen.findByRole('region', { name: 'Model quality' });
    expect(await within(mq).findByText('No model evaluation yet', { selector: 'strong' })).toBeInTheDocument();
    expect(within(mq).queryByText('Show detailed results')).toBeNull();
  });
  it('shows a helpful empty state for the direction analysis inside the detailed results', async () => {
    mockFetch(routes({ 'GET /api/site/models/direction': { status: 404, body: { detail: 'No direction analysis yet' } } }));
    const user = userEvent.setup();
    render(<App />);
    const mq = await screen.findByRole('region', { name: 'Model quality' });
    await user.click(await within(mq).findByText('Show detailed results'));
    expect(await within(mq).findByText('No direction analysis yet', { selector: 'strong' })).toBeInTheDocument();
    expect(within(mq).getByText('How accurate are the models?')).toBeInTheDocument();     // the simple table is unaffected
  });
  it('shows ONE simple comparison table first, with the detail collapsed behind a button', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    render(<App />);
    const mq = await screen.findByRole('region', { name: 'Model quality' });
    expect(await within(mq).findByRole('heading', { name: 'How accurate are the models?' })).toBeInTheDocument();
    const details = mq.querySelector('details.detail-more');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');                                           // closed by default: the page stays simple
    expect(details.querySelector('summary')).toHaveTextContent('Show detailed results');
    const table = within(mq).getByRole('region', { name: 'Model comparison table' });
    expect(details.contains(table)).toBe(false);                                           // the simple table is NOT inside the collapsed part
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 4);
    // everything that used to be on the page is still there once opened
    for (const name of ['Speed winner', 'Success criteria', 'Energy error (proxy)']) expect(within(details).getByRole('heading', { name })).toBeInTheDocument();
    expect(within(details).getAllByRole('heading', { name: /by lead$/ })).toHaveLength(3);
    await user.click(within(mq).getByText('Show detailed results'));
    expect(details).toHaveAttribute('open');
    expect(await within(details).findByRole('heading', { name: 'Direction reliability (LightGBM)' })).toBeInTheDocument();
  });

  it('re-reads the report when the turbine changes, because the energy proxy depends on the curve', async () => {
    let turbine = '2023NREL_Bespoke_3.3MW_148';
    const f = mockFetch(routes({
      'GET /api/site': () => readySite({ turbine: { name: turbine, group: 'onshore' } }),
      'PATCH /api/site': ({ body }) => { turbine = body.turbine_name; return readySite({ turbine: { name: turbine, group: 'onshore' } }); },
      'GET /api/turbines/IEA_Reference_3.4MW_130/curve': { ...fixtures.curve, turbine: { ...fixtures.curve.turbine, name: 'IEA_Reference_3.4MW_130' } },
    }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('596 held-out origins');
    const before = byMethod(f, 'GET', '/api/site/models/report').length;
    await user.selectOptions(await screen.findByLabelText('NREL turbine'), 'IEA_Reference_3.4MW_130');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(byMethod(f, 'GET', '/api/site/models/report').length).toBeGreaterThan(before));
    await waitFor(() => expect(byMethod(f, 'GET', '/api/turbines/IEA_Reference_3.4MW_130/curve')).toHaveLength(1));   // the curve panel follows too
  });
  it('flags a stale evaluation after a data refresh', async () => {
    mockFetch(routes({ 'GET /api/site': readySite({ evaluation_stale: true }) }));
    render(<App />);
    const mq = await screen.findByRole('region', { name: 'Model quality' });
    expect(await within(mq).findByText('evaluation stale')).toBeInTheDocument();
  });
});

describe('model vs Open-Meteo', () => {
  const open = async (over = {}) => {
    const f = mockFetch(routes(over));
    const user = userEvent.setup();
    render(<App />);
    const sec = await screen.findByRole('region', { name: 'Model vs Open-Meteo' });
    return { f, user, sec };
  };
  const calls = (f) => byMethod(f, 'GET', '/api/site/api-comparison');

  it('is ONE chart, fetched automatically, with no tabs, buttons or inputs', async () => {
    const { f, sec } = await open();
    expect(await within(sec).findByRole('heading', { name: 'Wind speed forecast: our model vs Open-Meteo' })).toBeInTheDocument();
    expect(calls(f)).toHaveLength(1);
    expect(calls(f)[0].url).toBe('/api/site/api-comparison');                               // latest forecast: no parameters
    expect(within(sec).queryAllByRole('button')).toHaveLength(0);
    expect(within(sec).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(sec).queryAllByRole('combobox')).toHaveLength(0);
    expect(sec.querySelectorAll('input, select')).toHaveLength(0);
    for (const gone of ['Held-out period', 'Date range', 'Single forecast', 'Run comparison']) expect(within(sec).queryByText(gone)).toBeNull();
    expect(within(sec).getByRole('img', { name: /Our model and the Open-Meteo forecast of wind speed for the same 24 hours/ })).toBeInTheDocument();
  });

  it('says it is the same 24 hours as the forecast above and how far apart the two are on average', async () => {
    const { sec } = await open();
    expect(await within(sec).findByText(/The same 24 hours as the forecast above, starting 2026-10-22 00:00 UTC\. On average the two differ by 0\.52 m\/s\./)).toBeInTheDocument();
    expect(within(sec).getByText('Our model', { selector: 'li' })).toBeInTheDocument();
    expect(within(sec).getByText('Open-Meteo forecast (issued the day before)', { selector: 'li' })).toBeInTheDocument();
  });

  it('is honest that it compares two forecasts and is not an accuracy score', async () => {
    const { sec } = await open();
    await within(sec).findByRole('heading', { name: /our model vs Open-Meteo/ });
    const notes = within(sec).getAllByText(/does not say which one is right/);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toBeVisible();                                         // present AND actually shown to the reader
    expect(within(sec).getByText(/never uses it as an input/)).toBeVisible();
  });

  it('follows the forecast date chosen above, with no input of its own', async () => {
    const other = { ...fixtures.apiComparison, hours: fixtures.apiComparison.hours.map((h) => ({ ...h, timestamp_utc: h.timestamp_utc.replace('2026-10-22', '2026-10-16') })), mean_abs_difference_ms: 0.962 };
    const { f, user, sec } = await open({
      'GET /api/site': readySite({ forecast_origins_cached: ['2026-10-21 23:00:00', '2026-10-15 23:00:00'] }),
      'GET /api/site/api-comparison': ({ url }) => (url.includes('origin=2026-10-16') ? other : fixtures.apiComparison),
    });
    await within(sec).findByText(/starting 2026-10-22 00:00 UTC/);
    await user.click(screen.getByRole('button', { name: '2026-10-16' }));                     // the stored-forecast chip in the Forecast section
    expect(await within(sec).findByText(/starting 2026-10-16 00:00 UTC\. On average the two differ by 0\.96 m\/s/)).toBeInTheDocument();
    expect(calls(f).map((c) => c.url)).toEqual(['/api/site/api-comparison', '/api/site/api-comparison?origin=2026-10-16']);
  });

  it('works for the newest forecast date, which has no observations yet (it only needs two forecasts)', async () => {
    const { sec } = await open({ 'GET /api/site': readySite({ dataset: { ...readySite().dataset, end_utc: '2026-10-21 23:00:00' } }) });
    expect(await within(sec).findByRole('heading', { name: /our model vs Open-Meteo/ })).toBeInTheDocument();
    expect(within(sec).queryByText(/No forecast for this date yet/)).toBeNull();
  });

  it('shows only our model, with a plain message, when Open-Meteo has no forecast for those hours', async () => {
    const none = { ...fixtures.apiComparison, matched_hours: 0, mean_abs_difference_ms: null, message: 'Open-Meteo has no forecast stored for these hours.',
      hours: fixtures.apiComparison.hours.map((h) => ({ ...h, api_speed: null })) };
    const { sec } = await open({ 'GET /api/site/api-comparison': none });
    expect(await within(sec).findByText(/Open-Meteo has no forecast stored for these hours\. The chart shows only our model/)).toBeInTheDocument();
    expect(within(sec).queryByText(/On average the two differ/)).toBeNull();                 // no made-up number
  });

  it('explains when there is no stored forecast for the date, using the backend hint', async () => {
    const { sec } = await open({ 'GET /api/site/api-comparison': { status: 404, body: { detail: 'No forecast', hint: 'POST /api/site/forecast with this origin first' } } });
    expect(await within(sec).findByText('No forecast for this date yet')).toBeInTheDocument();
    expect(within(sec).getByText('POST /api/site/forecast with this origin first')).toBeInTheDocument();
  });

  it('reports an Open-Meteo problem and lets you try again', async () => {
    let fail = true;
    const { user, sec } = await open({ 'GET /api/site/api-comparison': () => (fail ? { status: 502, body: { detail: 'Forecast API request failed: timeout' } } : fixtures.apiComparison) });
    expect(await within(sec).findByText('Forecast API request failed: timeout')).toBeInTheDocument();
    expect(within(sec).queryByRole('heading', { name: /our model vs Open-Meteo/ })).toBeNull();
    fail = false;
    await user.click(within(sec).getByRole('button', { name: 'Try again' }));
    expect(await within(sec).findByRole('heading', { name: /our model vs Open-Meteo/ })).toBeInTheDocument();
  });

  it('is not shown before the site is ready', async () => {
    mockFetch({ 'GET /api/site': { configured: false } });
    render(<App />);
    await screen.findByRole('heading', { name: 'Set your site' });
    expect(screen.queryByRole('region', { name: 'Model vs Open-Meteo' })).toBeNull();
  });
});

describe('data and turbine', () => {
  it('shows the data-quality checks and the verified turbine curve', async () => {
    mockFetch(routes());
    render(<App />);
    const dt = await screen.findByRole('region', { name: 'Data and turbine' });
    expect(await within(dt).findByText('all checks ok')).toHaveClass('good');
    expect(within(dt).getByText('Feature look-ahead test')).toBeInTheDocument();
    expect(within(dt).getByText('passed')).toBeInTheDocument();
    expect(await within(dt).findByText('curve verified')).toBeInTheDocument();
    expect(within(dt).getByText('3,300 kW')).toBeInTheDocument();
    expect(within(dt).getByText('3.25 / 25 m/s')).toBeInTheDocument();
    expect(within(dt).getByText('100 m (matches hub, no correction)')).toBeInTheDocument();
    expect(within(dt).getByRole('img', { name: 'Power curve of 2023NREL_Bespoke_3.3MW_148' })).toBeInTheDocument();
    expect(within(dt).getAllByText(/^Passed:$/)).toHaveLength(5);
  });
  it('flags data-quality problems and a shear correction for a different hub height', async () => {
    const q = structuredClone(fixtures.quality);
    q.validation.duplicate_timestamps = 2;
    q.validation.stale = true;
    const c = structuredClone(fixtures.curve);
    c.turbine.hub_height_m = 120;
    mockFetch(routes({ 'GET /api/site/data/quality': q, 'GET /api/turbines/2023NREL_Bespoke_3.3MW_148/curve': c }));
    render(<App />);
    const dt = await screen.findByRole('region', { name: 'Data and turbine' });
    expect(await within(dt).findByText('2 to check')).toHaveClass('warn');
    expect(within(dt).getAllByText('check').length).toBe(2);
    expect(await within(dt).findByText('100 m (shear correction applied)')).toBeInTheDocument();
  });
  it('degrades gracefully when the turbine curve cannot be loaded', async () => {
    mockFetch(routes({ 'GET /api/turbines/2023NREL_Bespoke_3.3MW_148/curve': { status: 404, body: { detail: 'Unknown turbine' } } }));
    render(<App />);
    const dt = await screen.findByRole('region', { name: 'Data and turbine' });
    expect(await within(dt).findByText('Turbine curve unavailable')).toBeInTheDocument();
    expect(within(dt).getByText('all checks ok')).toBeInTheDocument();                      // the other panel is unaffected
  });
});

describe('assumptions', () => {
  it('always shows the conventions, and the evaluation limitations once loaded', async () => {
    mockFetch(routes());
    render(<App />);
    const a = await screen.findByRole('region', { name: 'Assumptions and limitations' });
    expect(within(a).getByText(/meteorological wind-from degrees/)).toBeInTheDocument();
    expect(within(a).getByText(/Point forecasts only/)).toBeInTheDocument();
    expect(await within(a).findByText(/Data are reanalysis/)).toBeInTheDocument();
    expect(within(a).getByText(/no wake, availability, curtailment/)).toBeInTheDocument();
    expect(a.querySelector('details')).toHaveAttribute('open');
  });
  it('still shows the conventions when the report is missing', async () => {
    mockFetch(routes({ 'GET /api/site/models/report': { status: 404, body: { detail: 'none' } } }));
    render(<App />);
    const a = await screen.findByRole('region', { name: 'Assumptions and limitations' });
    expect(within(a).getByText(/meteorological wind-from degrees/)).toBeInTheDocument();
    expect(within(a).getByText('Loading the evaluation notes…')).toBeInTheDocument();
  });
});
