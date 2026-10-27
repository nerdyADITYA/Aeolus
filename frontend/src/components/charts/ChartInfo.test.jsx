import { cloneElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChartInfo from './ChartInfo.jsx';
import ChartCard from './ChartCard.jsx';
import Compass from './Compass.jsx';
import ConfidenceBars from './ConfidenceBars.jsx';
import CurveChart from './CurveChart.jsx';
import DirectionChart from './DirectionChart.jsx';
import LeadChart from './LeadChart.jsx';
import BinErrorChart from './BinErrorChart.jsx';
import PowerEnergyChart from './PowerEnergyChart.jsx';
import SpeedChart from './SpeedChart.jsx';
import ModelVsApiChart from './ModelVsApiChart.jsx';
import { CHART_INFO } from './chartInfo.js';
import { fixtures, makeHistory, makeHours } from '../../test/mockApi.js';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => cloneElement(children, { width: 640, height: 300 }) };
});

const hours = makeHours();
const history = makeHistory();
const { report, direction, curve, apiComparison } = fixtures;

describe('the explanation text', () => {
  const entries = Object.entries(CHART_INFO);

  it('covers every chart in the app', () => {
    expect(Object.keys(CHART_INFO).sort()).toEqual([
      'compass', 'confidence', 'curve', 'direction', 'errorByConfidence', 'errorBySpeed',
      'leadDirection', 'leadSpeedMae', 'leadSpeedRmse', 'modelVsApi', 'power', 'speed', 'turbine3d',
    ]);
  });
  it.each(entries)('%s explains what it shows, what it is for and how to read it, in real sentences', (_id, info) => {
    for (const key of ['shows', 'use', 'read']) {
      expect(info[key], key).toBeTypeOf('string');
      expect(info[key].length, `${key} is too short to be useful`).toBeGreaterThan(40);
      expect(info[key].trim().endsWith('.') || info[key].trim().endsWith(')'), `${key} should end like a sentence`).toBe(true);
      expect(info[key]).not.toMatch(/\bTODO\b|lorem|undefined/i);
    }
  });
  it('never reuses the same wording for two charts', () => {
    const all = entries.flatMap(([, i]) => [i.shows, i.use, i.read]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('ChartInfo panel', () => {
  it('shows the three parts under clear headings, open by default', () => {
    const { container } = render(<ChartInfo about={{ shows: 'S text', use: 'U text', read: 'R text' }} />);
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByText('About this chart')).toBeInTheDocument();
    expect(screen.getByText('What it shows').nextSibling).toHaveTextContent('S text');
    expect(screen.getByText('What it is for').nextSibling).toHaveTextContent('U text');
    expect(screen.getByText('How to read it').nextSibling).toHaveTextContent('R text');
  });
  it('can be collapsed and reopened by keyboard-accessible summary', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChartInfo about={{ shows: 'S text', use: 'U text' }} />);
    const details = container.querySelector('details');
    await user.click(screen.getByText('About this chart'));
    expect(details).not.toHaveAttribute('open');
    await user.click(screen.getByText('About this chart'));
    expect(details).toHaveAttribute('open');
  });
  it('omits a missing part and renders nothing without text', () => {
    const { container, rerender } = render(<ChartInfo about={{ shows: 'S text', use: 'U text' }} />);
    expect(screen.queryByText('How to read it')).toBeNull();
    rerender(<ChartInfo />);
    expect(container).toBeEmptyDOMElement();
  });
  it('is part of every ChartCard that is given text, and absent otherwise', () => {
    const { rerender } = render(<ChartCard title="T" about={{ shows: 'S', use: 'U' }}>x</ChartCard>);
    expect(screen.getByText('About this chart')).toBeInTheDocument();
    rerender(<ChartCard title="T">x</ChartCard>);
    expect(screen.queryByText('About this chart')).toBeNull();
  });
});

describe('every chart shows its own explanation', () => {
  const cases = [
    ['speed chart', () => <SpeedChart history={history} hours={hours} originUtc="2026-10-21 23:00:00" cutInMs={3.25} />, 'speed'],
    ['compass', () => <Compass hours={hours} lead={1} onLeadChange={() => {}} />, 'compass'],
    ['direction chart', () => <DirectionChart history={history} hours={hours} />, 'direction'],
    ['confidence chart', () => <ConfidenceBars hours={hours} threshold={0.75} minSpeed={3} />, 'confidence'],
    ['power chart', () => <PowerEnergyChart hours={hours} ratedKw={3300} turbineName="T" />, 'power'],
    ['speed MAE chart', () => <LeadChart title="Speed MAE by lead" about={CHART_INFO.leadSpeedMae} byLead={report.by_lead} metricKey="speed_MAE" mlName="LightGBM" unit="m/s" />, 'leadSpeedMae'],
    ['speed RMSE chart', () => <LeadChart title="Speed RMSE by lead" about={CHART_INFO.leadSpeedRmse} byLead={report.by_lead} metricKey="speed_RMSE" mlName="LightGBM" unit="m/s" />, 'leadSpeedRmse'],
    ['direction lead chart', () => <LeadChart title="Direction error by lead" about={CHART_INFO.leadDirection} byLead={report.by_lead} metricKey="dir_CMAE_fast" mlName="LightGBM" unit="°" />, 'leadDirection'],
    ['error by confidence', () => <BinErrorChart title="Error by predicted confidence" about={CHART_INFO.errorByConfidence} rows={direction.by_confidence} binKey="R_bin" xLabel="Confidence R" />, 'errorByConfidence'],
    ['error by speed', () => <BinErrorChart title="Error by observed wind speed" about={CHART_INFO.errorBySpeed} rows={direction.by_speed} binKey="speed_bin" xLabel="Wind speed" />, 'errorBySpeed'],
    ['power curve', () => <CurveChart curve={curve.curve} turbine={curve.turbine} />, 'curve'],
    ['model vs Open-Meteo chart', () => <ModelVsApiChart hours={apiComparison.hours} />, 'modelVsApi'],
  ];
  it.each(cases)('%s', (_name, ui, id) => {
    const { container } = render(ui());
    const panel = container.querySelector('.chart-info');
    expect(panel, 'no About panel on this chart').not.toBeNull();
    expect(within(panel).getByText(CHART_INFO[id].shows)).toBeInTheDocument();
    expect(within(panel).getByText(CHART_INFO[id].use)).toBeInTheDocument();
    expect(within(panel).getByText(CHART_INFO[id].read)).toBeInTheDocument();
  });
});
