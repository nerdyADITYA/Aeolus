import { cloneElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import ModelVsApiChart from './ModelVsApiChart.jsx';
import { CHART_INFO } from './chartInfo.js';
import { fixtures } from '../../test/mockApi.js';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => cloneElement(children, { width: 700, height: 320 }) };
});

const { hours } = fixtures.apiComparison;

describe('ModelVsApiChart', () => {
  it('draws exactly two lines, one per forecaster, with a legend and a screen-reader description', () => {
    const { container } = render(<ModelVsApiChart hours={hours} sub="same 24 hours" />);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    expect(screen.getByText('Our model', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText('Open-Meteo forecast (issued the day before)', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Our model and the Open-Meteo forecast of wind speed for the same 24 hours/ })).toBeInTheDocument();
    expect(screen.getByText('same 24 hours')).toBeInTheDocument();
  });

  it('draws the Open-Meteo line dashed and the model line solid, so they stay distinguishable', () => {
    const { container } = render(<ModelVsApiChart hours={hours} />);
    const curves = [...container.querySelectorAll('.recharts-line-curve')];
    expect(curves.filter((c) => c.getAttribute('stroke-dasharray'))).toHaveLength(1);
    expect(curves.find((c) => !c.getAttribute('stroke-dasharray'))).toBeDefined();
  });

  it('carries its explanation, including that it is not an accuracy score', () => {
    const { container } = render(<ModelVsApiChart hours={hours} />);
    const panel = container.querySelector('.chart-info');
    expect(within(panel).getByText(CHART_INFO.modelVsApi.shows)).toBeInTheDocument();
    expect(within(panel).getByText(/does not say which one is right/)).toBeInTheDocument();
  });

  it('still draws when Open-Meteo is missing some hours or all of them', () => {
    const gaps = hours.map((h, i) => (i % 3 === 0 ? { ...h, api_speed: null } : h));
    expect(() => render(<ModelVsApiChart hours={gaps} />)).not.toThrow();
    const none = hours.map((h) => ({ ...h, api_speed: null }));
    const { container } = render(<ModelVsApiChart hours={none} />);
    expect(container.querySelectorAll('.recharts-line-curve').length).toBeGreaterThanOrEqual(1);   // our model is still there
    expect(() => render(<ModelVsApiChart hours={[]} />)).not.toThrow();
  });
});
