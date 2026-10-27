import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { TURBINES, forecastPayload, makeForecast, mockFetch, readySite } from './test/mockApi.js';

let mapClick;
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ center }) => <i data-testid="marker" data-center={center.join(',')} />,
  useMap: () => ({ flyTo: vi.fn(), getZoom: () => 9 }),
  useMapEvents: (h) => {
    mapClick = h.click;
    return null;
  },
}));

const job = (over = {}) => ({ id: 'j1', type: 'setup', status: 'running', progress: 0.4, message: 'SARIMAX tuning', result: null, error: null, created_at: 'x', ...over });
const calls = (f, method, path) => f.calls.filter((c) => c.method === method && c.path === path);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});

describe('first run (no site)', () => {
  it('shows the setup form with defaults and validates before calling the backend', async () => {
    const f = mockFetch({ 'GET /api/site': { configured: false } });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Set your site' })).toBeInTheDocument();
    expect(screen.getByLabelText('Latitude')).toHaveValue('23.0225');
    expect(screen.getByText('no site yet')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Latitude'));
    await user.type(screen.getByLabelText('Latitude'), '123');
    expect(await screen.findByText('Must be between -90 and 90')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prepare site' }));
    expect(calls(f, 'PUT', '/api/site')).toHaveLength(0);
  });

  it('clicking the map fills the coordinates', async () => {
    mockFetch({ 'GET /api/site': { configured: false } });
    render(<App />);
    await screen.findByRole('heading', { name: 'Set your site' });
    mapClick({ latlng: { lat: 12.34567, lng: 77.1 } });
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toHaveValue('12.3457'));
    expect(screen.getByLabelText('Longitude')).toHaveValue('77.1000');
    expect(screen.getByTestId('marker').dataset.center).toBe('12.3457,77.1');
  });

  it('submits the site, then shows live job progress', async () => {
    const f = mockFetch({
      'GET /api/site': { configured: false },
      'PUT /api/site': { status: 202, body: { site: readySite({ status: 'preparing' }), job: job({ progress: 0.02, message: 'Downloading historical data' }) } },
      'GET /api/jobs/j1': job(),
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Prepare site' })).toBeInTheDocument();
    expect(screen.queryByText('Model search')).toBeNull();                            // no Quick/Full choice: every site is tuned fully
    expect(screen.queryByRole('button', { name: /quick/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Prepare site' }));
    expect(calls(f, 'PUT', '/api/site')[0].body).toEqual({ latitude: 23.0225, longitude: 72.5714, name: 'My site' });
    const bar = await screen.findByRole('progressbar', { name: 'Job progress' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '40'));
    expect(screen.getByText('SARIMAX tuning')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preparing the site' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();       // no second submission while busy
    expect(screen.getByLabelText('Latitude')).toBeDisabled();
  });

  it('shows the backend message and hint when the request is rejected', async () => {
    mockFetch({
      'GET /api/site': { configured: false },
      'PUT /api/site': { status: 409, body: { detail: 'Another job is running (abc)', hint: 'GET /api/jobs/{id}' } },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Prepare site' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Another job is running (abc)');
    expect(alert).toHaveTextContent('GET /api/jobs/{id}');
  });
});

describe('failure states', () => {
  it('reports an unreachable backend and offers a retry', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Cannot reach the backend/)).toBeInTheDocument();
    expect(screen.getByText('backend unreachable')).toBeInTheDocument();
    globalThis.fetch = mockFetch({ 'GET /api/site': { configured: false } });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Set your site' })).toBeInTheDocument();
  });

  it('keeps a failed setup visible with its error', async () => {
    mockFetch({
      'GET /api/site': readySite({ status: 'error', status_message: 'DataValidationError: Archive download failed', active_job_id: 'j1', dataset: undefined }),
      'GET /api/jobs/j1': job({ status: 'failed', progress: 0.1, error: 'DataValidationError: Archive download failed' }),
    });
    render(<App />);
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect((await screen.findAllByText(/Archive download failed/)).length).toBeGreaterThan(0);
    expect(screen.getByText('setup failed', { selector: '.badge' })).toBeInTheDocument();
  });

  it('adopts a job that is already running after a page reload', async () => {
    mockFetch({ 'GET /api/site': readySite({ status: 'preparing', active_job_id: 'j1', dataset: undefined }), 'GET /api/jobs/j1': job({ progress: 0.7 }) });
    render(<App />);
    const bar = await screen.findByRole('progressbar');
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '70'));
  });
});

describe('ready site', () => {
  const routes = (over = {}) => ({
    'GET /api/site': readySite(),
    'GET /api/turbines': TURBINES,
    'GET /api/site/forecast': forecastPayload,
    ...over,
  });

  it('shows the summary, headline numbers and only verified turbines', async () => {
    mockFetch(routes());
    render(<App />);
    const kpi = (label) => screen.findByText(label).then((el) => el.closest('.kpi'));
    const s = forecastPayload.summary;
    expect(await kpi('Expected energy')).toHaveTextContent(Math.round(s.total_kwh).toLocaleString());
    expect(await kpi('Capacity factor')).toHaveTextContent((s.capacity_factor * 100).toFixed(1));
    expect(await kpi('Peak power')).toHaveTextContent(String(s.peak_kw));
    expect(screen.getByText(new RegExp(`${s.reliable_hours} of 24 hours have reliable direction`))).toBeInTheDocument();
    expect(screen.getByText('26,328')).toBeInTheDocument();                         // dataset rows
    expect(screen.getByText('LightGBM', { selector: 'td' })).toBeInTheDocument();
    const select = await screen.findByLabelText('NREL turbine');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(2);                                                // the normalized-only curve is hidden
    expect(options[0]).toMatch(/3\.3 MW · hub 100 m/);
  });

  it('applies a new turbine and yaw settings without starting a job', async () => {
    const f = mockFetch(routes({ 'PATCH /api/site': ({ body }) => readySite({ turbine: { name: body.turbine_name, group: 'onshore' } }) }));
    const user = userEvent.setup();
    render(<App />);
    const select = await screen.findByLabelText('NREL turbine');
    await user.selectOptions(select, 'IEA_Reference_3.4MW_130');
    await user.type(screen.getByLabelText('Current nacelle heading (optional)'), '95');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(calls(f, 'PATCH', '/api/site')[0].body).toEqual({ turbine_name: 'IEA_Reference_3.4MW_130', yaw_deadband_deg: 8, nacelle_heading: 95 });
    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(calls(f, 'POST', '/api/site/forecast')).toHaveLength(0);                 // no retraining
    await waitFor(() => expect(calls(f, 'GET', '/api/site/forecast').length).toBeGreaterThan(1)); // energy numbers re-read
  });

  it('rejects an invalid nacelle heading locally', async () => {
    const f = mockFetch(routes());
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Current nacelle heading (optional)'), '400');
    expect(await screen.findByText('0 to 359.9 degrees')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(calls(f, 'PATCH', '/api/site')).toHaveLength(0);
  });

  it('runs a forecast for a chosen date and then shows its result', async () => {
    let origin = null;
    const f = mockFetch(routes({
      'POST /api/site/forecast': ({ body }) => { origin = body.origin; return { status: 202, body: job({ id: 'j2', type: 'forecast', progress: 0.1, message: 'Training models' }) }; },
      'GET /api/jobs/j2': () => job({ id: 'j2', type: 'forecast', status: 'done', progress: 1, result: { origin_utc: '2026-10-15 23:00:00' } }),
      'GET /api/site/forecast': ({ url }) => (url.includes('origin=2026-10-16') ? { ...forecastPayload, origin_utc: '2026-10-15 23:00:00', summary: { ...forecastPayload.summary, total_kwh: 5120 } } : forecastPayload),
    }));
    const user = userEvent.setup();
    render(<App />);
    const date = await screen.findByLabelText('Date');
    expect(date).toHaveValue('2026-10-22');                                         // default: latest available
    expect(date).toHaveAttribute('min', '2024-10-20');
    fireDateChange(date, '2026-10-16');
    expect(await screen.findByText(/Not run yet for this date/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run forecast' }));
    await waitFor(() => expect(origin).toBe('2026-10-16'));
    const energy = await screen.findByText('Expected energy');
    await waitFor(() => expect(energy.closest('.kpi')).toHaveTextContent('5,120'));    // selected date switched to the new forecast
    await waitFor(() => expect(calls(f, 'GET', '/api/site/forecast').some((c) => c.url.includes('origin=2026-10-16'))).toBe(true));
  });

  it('refuses dates outside the available range', async () => {
    const f = mockFetch(routes());
    render(<App />);
    fireDateChange(await screen.findByLabelText('Date'), '2030-01-01');
    expect(await screen.findByText(/Choose a date from 2024-10-20 to 2026-10-22/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Run|Re-run) forecast$/ })).toBeDisabled();
    expect(calls(f, 'POST', '/api/site/forecast')).toHaveLength(0);
  });

  it('asks for confirmation before replacing a ready site', async () => {
    const f = mockFetch(routes({ 'PUT /api/site': { status: 202, body: { site: readySite({ status: 'preparing' }), job: job() } }, 'GET /api/jobs/j1': job() }));
    const user = userEvent.setup();
    render(<App />);
    await user.clear(await screen.findByLabelText('Latitude'));
    await user.type(screen.getByLabelText('Latitude'), '12.9');
    await user.click(screen.getByRole('button', { name: 'Replace site and re-run' }));
    expect(await screen.findByText(/discards its results/)).toBeInTheDocument();
    expect(calls(f, 'PUT', '/api/site')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm: replace site' }));
    await waitFor(() => expect(calls(f, 'PUT', '/api/site')).toHaveLength(1));
    expect(calls(f, 'PUT', '/api/site')[0].body.latitude).toBe(12.9);
  });

  it('explains a missing forecast with the backend hint', async () => {
    mockFetch(routes({ 'GET /api/site/forecast': { status: 404, body: { detail: 'No forecast', hint: 'POST /api/site/forecast with this origin' } } }));
    render(<App />);
    expect(await screen.findByText('No forecast for this date yet')).toBeInTheDocument();
    expect(screen.getByText('POST /api/site/forecast with this origin')).toBeInTheDocument();
  });

  it('flags stale evaluation and can refresh the data', async () => {
    const f = mockFetch(routes({
      'GET /api/site': readySite({ evaluation_stale: true }),
      'POST /api/site/data/refresh': { status: 202, body: job({ id: 'j3', type: 'refresh', progress: 0.3, message: 'Downloading' }) },
      'GET /api/jobs/j3': job({ id: 'j3', type: 'refresh', progress: 0.3, message: 'Downloading' }),
    }));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('evaluation stale')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(await screen.findByRole('heading', { name: 'Refreshing data' })).toBeInTheDocument();
    expect(calls(f, 'POST', '/api/site/data/refresh')).toHaveLength(1);
  });
});

describe('forecast view', () => {
  const routes = (over = {}) => ({ 'GET /api/site': readySite(), 'GET /api/turbines': TURBINES, 'GET /api/site/forecast': forecastPayload, ...over });

  it('shows the charts, compass, 24-hour table and export links for the selected forecast', async () => {
    mockFetch(routes());
    render(<App />);
    for (const title of ['Wind speed at 100 m', 'Recommended heading', 'Wind direction (from)', 'Direction confidence', 'Hourly power and energy', '24-hour forecast']) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: '24-hour forecast table' }).querySelectorAll('tbody tr')).toHaveLength(24);
    expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toContain('origin=2026-10-21');
    expect(screen.getByText(/model only, no Forecast API input/)).toBeInTheDocument();
  });

  it('explains the yaw labels under the table, using the limits from the site settings (not fixed numbers)', async () => {
    // deliberately NOT the defaults (8 degrees, 0.75, 3 m/s), so the test can tell the page passes the real settings through
    const yaw = { nacelle_heading: null, deadband_deg: 5, direction_conf_min: 0.6, min_speed_ms: 4 };
    mockFetch(routes({ 'GET /api/site': readySite({ yaw }) }));
    render(<App />);
    await screen.findByRole('heading', { name: '24-hour forecast' });
    expect(screen.getByText('How to read this table')).toBeInTheDocument();
    const key = screen.getByRole('region', { name: 'Yaw label key' });
    expect(within(key).getAllByRole('row')).toHaveLength(1 + 3);
    expect(within(key).getByText(/more than 5° away/)).toBeInTheDocument();
    expect(within(key).getByText(/below 0\.6, or the wind is lighter than 4 m\/s/)).toBeInTheDocument();
    const counts = [...key.querySelectorAll('tbody tr td:last-child')].map((td) => Number(td.textContent.split(' ')[0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(24);                                     // every hour of the fixture is accounted for
    const firstHold = document.querySelector('.data-table tbody .badge.neutral');
    expect(firstHold.getAttribute('title')).toMatch(/5°|not trustworthy/);                  // hover hints use the same live limits
  });

  it('the power chart explains its missing bars using the turbine cut-in speed from the forecast', async () => {
    mockFetch(routes());
    render(<App />);
    await screen.findByRole('heading', { name: 'Hourly power and energy' });
    const zeroHours = forecastPayload.hours.filter((h) => h.power_kw === 0).length;
    expect(zeroHours).toBeGreaterThan(0);                                                   // the fixture has hours below cut-in
    expect(screen.getByText('No bar = no power (wind below cut-in 3.25 m/s)')).toBeInTheDocument();
  });

  it('clicking a lead in the table moves the compass to that hour', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Forecast hour: \+1 h/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show +12 hours on the compass' }));
    expect(screen.getByText(/Forecast hour: \+12 h/)).toBeInTheDocument();
    expect(document.querySelector('tr.selected').dataset.lead).toBe('12');
  });

  it('resets the compass to the first hour when a different forecast loads', async () => {
    let origin2 = false;
    mockFetch(routes({
      'GET /api/site/forecast': () => (origin2 ? makeForecast({ origin_utc: '2026-10-15 23:00:00' }) : forecastPayload),
      'PATCH /api/site': () => readySite(),
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Show +8 hours on the compass' }));
    expect(screen.getByText(/Forecast hour: \+8 h/)).toBeInTheDocument();
    origin2 = true;
    await user.click(screen.getByRole('button', { name: 'Apply' }));               // re-reads the forecast (new origin in the response)
    await waitFor(() => expect(screen.getByText(/Forecast hour: \+1 h/)).toBeInTheDocument());
  });

  it('hides the detailed views but still shows headline numbers when the forecast has no hours', async () => {
    mockFetch(routes({ 'GET /api/site/forecast': { ...forecastPayload, hours: [], history: [], summary: { ...forecastPayload.summary, hours: 0 } } }));
    render(<App />);
    expect(await screen.findByText('Expected energy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '24-hour forecast' })).toBeNull();
  });
});

describe('theme', () => {
  it('toggles dark and light and remembers the choice', async () => {
    mockFetch({ 'GET /api/site': { configured: false } });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Switch to light theme/ }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('wk-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
  });
});

// <input type="date"> cannot be typed into reliably in jsdom: set the value the way the browser does.
function fireDateChange(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
