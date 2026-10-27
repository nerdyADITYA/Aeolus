import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TurbineView from './TurbineView.jsx';
import { makeHours } from '../../test/mockApi.js';
import { webglAvailable } from '../../utils/turbine3d.js';

// The real scene needs WebGL, which jsdom does not have: replace it with a stand-in that exposes what it was asked to draw.
vi.mock('./TurbineScene.jsx', () => ({
  default: ({ scene, size, animate, resetKey, highlight }) => (
    <div data-testid="scene" data-lead={scene.lead} data-state={scene.state} data-heading={String(scene.heading)} data-rpm={scene.rpm.toFixed(1)}
      data-hub={size.hub} data-blade={size.bladeLength} data-animate={String(animate)} data-reset={resetKey} data-highlight={highlight ?? 'none'} />
  ),
}));
vi.mock('../../utils/turbine3d.js', async (importOriginal) => ({ ...(await importOriginal()), webglAvailable: vi.fn(() => true) }));

const turbine = { name: '2023NREL_Bespoke_3.3MW_148', rated_kw: 3300, cut_in_ms: 3.25, cut_out_ms: 25, hub_height_m: 100, rotor_diameter_m: 148 };
const hours = makeHours();

function Harness({ turb = turbine, hrs = hours, start = 1 }) {
  const [lead, setLead] = useState(start);
  return <TurbineView hours={hrs} lead={lead} onLeadChange={setLead} turbine={turb} yawLimits={{ deadband: 8, confMin: 0.75, minSpeed: 3 }} />;
}
const scene = () => screen.getByTestId('scene');
const goTo = (lead) => fireEvent.change(screen.getByLabelText(/Turbine hour/), { target: { value: String(lead) } });

describe('3D turbine view', () => {
  beforeEach(() => { webglAvailable.mockReturnValue(true); });

  it('draws the selected turbine at its real size and says so', async () => {
    render(<Harness />);
    const el = await screen.findByTestId('scene');
    expect(el.dataset.hub).toBe('10');                 // 100 m hub, 10 m per scene unit
    expect(el.dataset.blade).toBe('7.4');              // 148 m rotor
    expect(screen.getByText(/hub 100 m, rotor 148 m/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /3D view of 2023NREL Bespoke 3.3MW 148 at \+1 hours/ })).toBeInTheDocument();
  });

  it('follows a different turbine and flags sizes it had to estimate', async () => {
    const { rerender } = render(<TurbineView hours={hours} lead={1} onLeadChange={() => {}} turbine={{ ...turbine, hub_height_m: 120, rotor_diameter_m: 200 }} />);
    expect((await screen.findByTestId('scene')).dataset.hub).toBe('12');
    expect(scene().dataset.blade).toBe('10');
    expect(screen.queryByText(/estimated/)).toBeNull();
    rerender(<TurbineView hours={hours} lead={1} onLeadChange={() => {}} turbine={{ ...turbine, rotor_diameter_m: null }} />);
    expect(screen.getByText(/rotor 120 m \(estimated/)).toBeInTheDocument();
  });

  it('moves to the chosen hour with the slider and shows that hour\'s numbers', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    expect(screen.getByLabelText(/Turbine hour: \+1 h/)).toHaveAttribute('max', '24');
    goTo(4);
    const h = hours[3];
    expect(scene().dataset.lead).toBe('4');
    expect(screen.getByLabelText(/Turbine hour: \+4 h/)).toBeInTheDocument();
    const readout = within(screen.getByText('Wind speed').closest('dl'));
    expect(readout.getByText(`${h.pred_speed_100m_ms.toFixed(2)} m/s`)).toBeInTheDocument();
    expect(readout.getByText(`${Math.round(h.power_kw)} kW`)).toBeInTheDocument();
  });

  it('shows the advised heading, and a dash while none has been advised', async () => {
    const noHeading = hours.map((h) => ({ ...h, recommended_nacelle_heading_deg: null }));
    const { unmount } = render(<Harness hrs={noHeading} />);
    await screen.findByTestId('scene');
    expect(scene().dataset.heading).toBe('null');
    expect(within(screen.getByText('Nacelle heading').parentElement).getByText('—')).toBeInTheDocument();
    unmount();
    render(<Harness />);
    expect((await screen.findByTestId('scene')).dataset.heading).toBe(String(hours[0].recommended_nacelle_heading_deg));
  });

  it('is idle with a still rotor when the wind is below cut-in, and shut down at cut-out', async () => {
    const calm = hours.map((h) => ({ ...h, pred_speed_100m_ms: 2, pred_speed_hub_ms: 2, power_kw: 0 }));
    const { unmount } = render(<Harness hrs={calm} />);
    expect((await screen.findByTestId('scene')).dataset).toMatchObject({ state: 'idle', rpm: '0.0' });
    expect(screen.getByText(/Idle: wind below the cut-in speed \(3.25 m\/s\)/)).toBeInTheDocument();
    unmount();
    const storm = hours.map((h) => ({ ...h, pred_speed_100m_ms: 27, pred_speed_hub_ms: 27, power_kw: 0 }));
    render(<Harness hrs={storm} />);
    expect((await screen.findByTestId('scene')).dataset.state).toBe('shutdown');
    expect(screen.getByText(/Shut down/)).toBeInTheDocument();
  });

  it('labels the yaw advice for the hour (track or hold)', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    const advice = () => screen.getByText('Yaw advice').parentElement;
    expect(within(advice()).getByText('track')).toBeInTheDocument();
    const holdIdx = hours.findIndex((h) => h.yaw_note.startsWith('hold'));
    goTo(holdIdx + 1);
    expect(within(advice()).getByText('hold')).toBeInTheDocument();
  });

  it('plays through the day and stops when paused or when the slider is used', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Play day' }));
      expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
      for (let i = 0; i < 3; i += 1) await act(async () => { vi.advanceTimersByTime(1200); });      // one step per second or so
      expect(scene().dataset.lead).toBe('4');
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(scene().dataset.lead).toBe('4');                          // paused: no further movement
      fireEvent.click(screen.getByRole('button', { name: 'Play day' }));
      goTo(10);                                                        // using the slider takes over from Play
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(scene().dataset.lead).toBe('10');
      expect(screen.getByRole('button', { name: 'Play day' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps from the last hour back to the first when playing', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness start={24} />);
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Play day' }));
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(scene().dataset.lead).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains each part of the machine in plain words, with the yaw system included', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    const key = within(screen.getByRole('list', { name: 'Parts of the turbine' }));
    for (const part of ['Blades (rotor)', 'Hub', 'Nacelle', 'Yaw system', 'Tower']) expect(key.getByText(part)).toBeInTheDocument();
    expect(key.getByText(/turntable between tower and nacelle/)).toBeInTheDocument();
  });

  it('shows a colour legend over the model, one colour per part, with no name tags drawn on the model itself', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    const legend = screen.getByRole('list', { name: 'Colour legend' });
    const items = within(legend).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Blades (rotor)', 'Hub', 'Nacelle', 'Yaw system', 'Tower']);
    const colours = [...legend.querySelectorAll('i')].map((i) => i.style.background);
    expect(new Set(colours).size).toBe(5);                                       // every part has its own colour
    expect(scene().dataset.labels).toBeUndefined();
    expect(screen.queryByRole('button', { name: /Part labels/ })).toBeNull();
  });

  it('uses the same colours in the legend and in the explanation key', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    const legend = [...screen.getByRole('list', { name: 'Colour legend' }).querySelectorAll('i')].map((i) => i.style.background);
    const key = [...screen.getByRole('list', { name: 'Parts of the turbine' }).querySelectorAll('i')].map((i) => i.style.background);
    expect(key).toEqual(legend);
  });

  it('lights up a part on the model while it is pointed at in the legend or the key', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('scene');
    expect(scene().dataset.highlight).toBe('none');
    const yaw = within(screen.getByRole('list', { name: 'Colour legend' })).getByText('Yaw system');
    await user.hover(yaw);
    expect(scene().dataset.highlight).toBe('yaw');
    await user.unhover(yaw);
    expect(scene().dataset.highlight).toBe('none');
    await user.hover(within(screen.getByRole('list', { name: 'Parts of the turbine' })).getByText('Nacelle'));
    expect(scene().dataset.highlight).toBe('nacelle');
  });

  it('puts the camera back when Reset view is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('scene');
    expect(scene().dataset.reset).toBe('0');
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(scene().dataset.reset).toBe('1');
  });

  it('stops spinning for people who asked for reduced motion', async () => {
    const original = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} });
    try {
      render(<Harness />);
      expect((await screen.findByTestId('scene')).dataset.animate).toBe('false');
    } finally {
      window.matchMedia = original;
    }
  });

  it('spins and turns by default', async () => {
    render(<Harness />);
    expect((await screen.findByTestId('scene')).dataset.animate).toBe('true');
  });

  it('shows the numbers and an explanation when the browser cannot draw 3D', () => {
    webglAvailable.mockReturnValue(false);
    render(<Harness />);
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('3D view unavailable');
    expect(screen.getByText('Wind speed')).toBeInTheDocument();           // the readout and controls still work
    expect(screen.getByLabelText(/Turbine hour/)).toBeInTheDocument();
  });

  it('explains the chart in its About panel and says the spin is illustrative', async () => {
    render(<Harness />);
    await screen.findByTestId('scene');
    expect(screen.getByText('About this chart')).toBeInTheDocument();
    expect(screen.getByText(/not a physical simulation/)).toBeInTheDocument();
    expect(screen.getByText(/Illustrative view of the forecast/)).toBeInTheDocument();
  });

  it('renders nothing without forecast hours for the chosen lead being usable', () => {
    const { container } = render(<TurbineView hours={[]} lead={1} onLeadChange={() => {}} turbine={turbine} />);
    expect(container).toBeEmptyDOMElement();
  });
});
