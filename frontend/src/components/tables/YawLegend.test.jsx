import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import YawLegend from './YawLegend.jsx';
import ForecastTable from './ForecastTable.jsx';
import { COLUMN_HELP, countYawKinds, yawHint, yawKind, yawLegend, yawTone } from '../../utils/yaw.js';
import { noteDetail, shortNote } from '../../utils/forecast.js';
import { makeHours } from '../../test/mockApi.js';

const TRACK = 'track predicted wind direction';
const DEADBAND = 'hold: within deadband';
const LOW = 'hold: low confidence or below cut-in/low-speed';

// The real yaw notes of the 22 Oct 2026 forecast (24 hours): 6 track, 9 within deadband, 9 low confidence.
const REAL_NOTES = [TRACK, DEADBAND, DEADBAND, DEADBAND, TRACK, DEADBAND, LOW, LOW, DEADBAND, DEADBAND, TRACK, DEADBAND, TRACK,
  LOW, LOW, LOW, LOW, LOW, LOW, LOW, DEADBAND, TRACK, DEADBAND, TRACK];
const realHours = () => makeHours().map((h, i) => ({ ...h, yaw_note: REAL_NOTES[i] }));

describe('yaw note helpers', () => {
  it('classifies the three notes the backend produces, and anything unknown as "other"', () => {
    expect(yawKind(TRACK)).toBe('track');
    expect(yawKind(DEADBAND)).toBe('deadband');
    expect(yawKind(LOW)).toBe('unreliable');
    expect(yawKind('hold: some future reason')).toBe('other');
    expect(yawKind('')).toBe('other');
    expect(yawKind()).toBe('other');
  });
  it('counts the real forecast correctly', () => {
    expect(countYawKinds(realHours())).toEqual({ track: 6, deadband: 9, unreliable: 9, other: 0 });
    expect(countYawKinds([])).toEqual({ track: 0, deadband: 0, unreliable: 0, other: 0 });
    expect(countYawKinds([{ yaw_note: 'brand new wording' }]).other).toBe(1);
  });
  it('describes each kind with exactly the label and detail the table shows (so the key matches the rows)', () => {
    for (const [kind, note] of [['track', TRACK], ['deadband', DEADBAND], ['unreliable', LOW]]) {
      const entry = yawLegend().find((k) => k.kind === kind);
      expect(entry.badge).toBe(shortNote(note));
      expect(entry.detail).toBe(noteDetail(note));
    }
  });
  it('puts the live limits into the wording, not fixed numbers', () => {
    const [track, deadband, unreliable] = yawLegend({ deadband: 5, confMin: 0.6, minSpeed: 4 });
    expect(track.meaning).toContain('more than 5°');
    expect(deadband.meaning).toContain('5° or less');
    expect(unreliable.meaning).toContain('below 0.6');
    expect(unreliable.meaning).toContain('lighter than 4 m/s');
    expect(yawLegend()[1].meaning).toContain('8° or less');                                 // sensible defaults
  });
  it('gives each table label a hover hint, and none for an unknown note', () => {
    expect(yawHint(TRACK)).toMatch(/Follow the wind/);
    expect(yawHint(DEADBAND, { deadband: 6 })).toMatch(/within 6°/);
    expect(yawHint(LOW)).toMatch(/not trustworthy/);
    expect(yawHint('mystery')).toBeUndefined();
  });
  it('explains every column of the table, in table order', () => {
    expect(COLUMN_HELP.map(([term]) => term)).toEqual(['Lead', 'Local time', 'Speed m/s', 'Direction', 'Conf. R', 'Heading °', 'Yaw', 'Power kW', 'Energy kWh']);
    for (const [, text] of COLUMN_HELP) expect(text.length).toBeGreaterThan(30);
  });
});

describe('YawLegend', () => {
  const setup = (props = {}) => render(<YawLegend hours={realHours()} deadband={8} confMin={0.75} minSpeed={3} {...props} />);

  it('explains the jargon first: yaw, nacelle and that it is advice only', () => {
    setup();
    expect(screen.getByText('How to read this table')).toBeInTheDocument();
    const intro = document.querySelector('.key-intro');
    expect(intro).toHaveTextContent(/Yaw means turning the nacelle/);
    expect(intro).toHaveTextContent(/housing on top of the tower/);
    expect(intro).toHaveTextContent(/advice only: nothing is sent to a turbine/);
  });
  it('has one row per kind of advice with what it means, what to do, and how many hours of this forecast', () => {
    setup();
    const key = screen.getByRole('region', { name: 'Yaw label key' });
    const rows = within(key).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('track')).toHaveClass('good');
    expect(within(rows[0]).getByText(/Turn the nacelle to the new heading/)).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('6 of 24 h');
    expect(within(rows[1]).getByText('hold')).toHaveClass('warn');                         // yellow: holding because the change is tiny
    expect(within(rows[1]).getByText('within deadband')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('9 of 24 h');
    expect(within(rows[2]).getByText('hold')).toHaveClass('neutral');                      // grey: holding because the direction is not trusted
    expect(within(rows[2]).getByText('low confidence or below cut-in/low-speed')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/lighter than 3 m\/s/)).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('9 of 24 h');
  });
  it('the three counts add up to all the hours', () => {
    setup();
    const counts = [...screen.getByRole('region', { name: 'Yaw label key' }).querySelectorAll('tbody tr td:last-child')].map((td) => Number(td.textContent.split(' ')[0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(24);
  });
  it('follows the live limits', () => {
    setup({ deadband: 12, confMin: 0.9, minSpeed: 5 });
    expect(screen.getByText(/more than 12° away/)).toBeInTheDocument();
    expect(screen.getByText(/below 0\.9, or the wind is lighter than 5 m\/s/)).toBeInTheDocument();
  });
  it('shows a row for wording it does not know, so nothing is silently dropped', () => {
    setup({ hours: [...realHours().slice(0, 23), { ...realHours()[0], yaw_note: 'new backend wording' }] });
    const key = screen.getByRole('region', { name: 'Yaw label key' });
    expect(within(key).getByText('other')).toBeInTheDocument();
    expect(within(key).getAllByRole('row')).toHaveLength(1 + 3 + 1);
  });
  it('lists the other columns in plain language', () => {
    setup();
    for (const [term, text] of COLUMN_HELP) {
      expect(screen.getAllByText(term, { selector: 'dt' }).length).toBe(1);
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
  it('is open by default and can be collapsed', async () => {
    const user = userEvent.setup();
    const { container } = setup();
    expect(container.querySelector('details')).toHaveAttribute('open');
    await user.click(screen.getByText('How to read this table'));
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });
});

describe('yaw label colours', () => {
  it('uses green for track, yellow for hold within deadband, grey for hold with low confidence', () => {
    expect(yawTone(TRACK)).toBe('good');
    expect(yawTone(DEADBAND)).toBe('warn');
    expect(yawTone(LOW)).toBe('neutral');
    expect(yawTone('something new')).toBe('neutral');
  });
  it('shows those colours on the badges of every row in the table', () => {
    render(<ForecastTable hours={realHours()} selectedLead={1} onSelect={() => {}} />);
    const badge = (lead) => within(document.querySelector(`tr[data-lead="${lead}"]`)).getByText(/^(track|hold)$/);
    expect(badge(1)).toHaveClass('good');        // track
    expect(badge(2)).toHaveClass('warn');        // hold, within deadband
    expect(badge(7)).toHaveClass('neutral');     // hold, low confidence
    const all = [...document.querySelectorAll('tbody .badge')];
    expect(all.filter((b) => b.classList.contains('good'))).toHaveLength(6);
    expect(all.filter((b) => b.classList.contains('warn'))).toHaveLength(9);     // exactly the within-deadband hours
    expect(all.filter((b) => b.classList.contains('neutral'))).toHaveLength(9);
  });
});

describe('labels in the table', () => {
  it('carry a hover hint that matches the key', () => {
    render(<ForecastTable hours={realHours()} selectedLead={1} onSelect={() => {}} limits={{ deadband: 8, confMin: 0.75, minSpeed: 3 }} />);
    const first = document.querySelector('tr[data-lead="1"]');                            // track
    expect(within(first).getByText('track')).toHaveAttribute('title', yawHint(TRACK, { deadband: 8 }));
    const second = document.querySelector('tr[data-lead="2"]');                           // hold, within deadband
    expect(within(second).getByText('hold')).toHaveAttribute('title', expect.stringMatching(/within 8°/));
    const seventh = document.querySelector('tr[data-lead="7"]');                          // hold, low confidence
    expect(within(seventh).getByText('hold')).toHaveAttribute('title', expect.stringMatching(/not trustworthy/));
  });
});
