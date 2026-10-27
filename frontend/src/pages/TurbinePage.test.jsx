import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App.jsx';
import { routeFromHash } from '../hooks/useRoute.js';
import { TURBINES, forecastPayload, makeForecast, mockFetch, phase7Routes, readySite } from '../test/mockApi.js';

const routes = (over = {}) => ({
  'GET /api/site': readySite(),
  'GET /api/turbines': TURBINES,
  'GET /api/site/forecast': forecastPayload,
  ...phase7Routes(),
  ...over,
});
const go = async (hash) => { await act(async () => { window.location.hash = hash; }); };

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  window.location.hash = '';
});
afterEach(() => { window.location.hash = ''; });

describe('routeFromHash', () => {
  it('only the exact 3D address opens the 3D page; jump links and anything else stay on the dashboard', () => {
    expect(routeFromHash('#/turbine')).toBe('turbine');
    for (const h of ['', '#', '#/', '#forecast', '#/turbine/', '#/unknown', '#/Turbine']) expect(routeFromHash(h)).toBe('dashboard');
  });
});

describe('dashboard', () => {
  it('no longer carries the 3D scene; it offers a link to the 3D page instead', async () => {
    mockFetch(routes());
    render(<App />);
    const link = await screen.findByRole('link', { name: /Open the 3D view/ }, { timeout: 4000 });
    expect(link).toHaveAttribute('href', '#/turbine');
    expect(document.querySelector('.turbine-card')).toBeNull();
    expect(screen.queryByLabelText(/Turbine hour/)).toBeNull();
  });

  it('has a page menu with the dashboard marked as the current page', async () => {
    mockFetch(routes());
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '3D turbine' })).toHaveAttribute('href', '#/turbine');
    expect(within(nav).getByRole('link', { name: '3D turbine' })).not.toHaveAttribute('aria-current');
  });

  it('hides the page menu until a site is ready', async () => {
    mockFetch(routes({ 'GET /api/site': { configured: false } }));
    render(<App />);
    await screen.findByRole('heading', { name: 'Set your site' });
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });
});

describe('3D turbine page', () => {
  it('opens at #/turbine as a large view with the dashboard sections gone', async () => {
    window.location.hash = '#/turbine';
    const f = mockFetch(routes());
    render(<App />);
    expect(await screen.findByRole('heading', { name: '3D turbine view' })).toBeInTheDocument();
    expect(document.querySelector('.turbine-card.large')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '3D turbine' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Page sections' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Forecast' })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: '3D turbine' })).toHaveAttribute('aria-current', 'page');
    expect(f.calls.some((c) => c.path === '/api/site/forecast')).toBe(true);
    expect(screen.getByText(/Forecast from origin 2026-10-21 23:00 UTC/)).toBeInTheDocument();
  });

  it('puts the readout inside the big stage and keeps the hour slider working', async () => {
    window.location.hash = '#/turbine';
    mockFetch(routes());
    render(<App />);
    const stage = (await screen.findByRole('img', { name: /3D view of/ }));
    expect(within(stage).getByText('Wind speed')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Turbine hour/), { target: { value: '9' } });
    expect(screen.getByLabelText(/Turbine hour: \+9 h/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /at \+9 hours/ })).toBeInTheDocument();
  });

  it('switches between the pages when the address changes, and back to the dashboard', async () => {
    mockFetch(routes());
    render(<App />);
    await screen.findByRole('region', { name: 'Forecast' });
    await go('#/turbine');
    await waitFor(() => expect(document.querySelector('.turbine-card.large')).not.toBeNull());   // (the dashboard link card has a heading of the same name)
    expect(screen.queryByRole('region', { name: 'Forecast' })).toBeNull();
    await go('#/');
    expect(await screen.findByRole('region', { name: 'Forecast' })).toBeInTheDocument();
    expect(document.querySelector('.turbine-card')).toBeNull();
  });

  it('has a way back to the dashboard', async () => {
    window.location.hash = '#/turbine';
    mockFetch(routes());
    render(<App />);
    expect(await screen.findByRole('link', { name: /← Dashboard/ })).toHaveAttribute('href', '#/');
  });

  it('asks for a site first when none is ready', async () => {
    window.location.hash = '#/turbine';
    mockFetch(routes({ 'GET /api/site': readySite({ status: 'preparing' }) }));
    render(<App />);
    expect(await screen.findByText('Prepare a site first')).toBeInTheDocument();
    expect(document.querySelector('.turbine-card')).toBeNull();
  });

  it('says so when there is no forecast for the date, instead of failing', async () => {
    window.location.hash = '#/turbine';
    mockFetch(routes({ 'GET /api/site/forecast': { status: 404, body: { detail: 'No forecast', hint: 'Run one first.' } } }));
    render(<App />);
    expect(await screen.findByText('No forecast for this date yet')).toBeInTheDocument();
  });

  it('lets you choose among stored forecasts and loads the chosen date', async () => {
    window.location.hash = '#/turbine';
    const f = mockFetch(routes({
      'GET /api/site': readySite({ forecast_origins_cached: ['2026-10-21 23:00:00', '2026-10-15 23:00:00'] }),
      'GET /api/site/forecast': ({ url }) => (url.includes('origin=2026-10-16') ? makeForecast({ origin_utc: '2026-10-15 23:00:00' }) : forecastPayload),
    }));
    render(<App />);
    const select = await screen.findByLabelText('Forecast date');
    expect([...select.options].map((o) => o.value)).toEqual(['2026-10-22', '2026-10-16']);
    fireEvent.change(select, { target: { value: '2026-10-16' } });
    await waitFor(() => expect(screen.getByText(/Forecast from origin 2026-10-15 23:00 UTC/)).toBeInTheDocument());
    expect(f.calls.some((c) => c.url.includes('origin=2026-10-16'))).toBe(true);
  });

  it('shows no date picker when only one forecast is stored', async () => {
    window.location.hash = '#/turbine';
    mockFetch(routes());
    render(<App />);
    await screen.findByRole('heading', { name: '3D turbine view' });
    expect(screen.queryByLabelText('Forecast date')).toBeNull();
  });
});
