import { createContext, useContext, useMemo } from 'react';
import PropTypes from 'prop-types';
import { getDirection, getModelReport, getQuality } from '../api/endpoints.js';
import { useApi } from '../hooks/useApi.js';
import { useSite } from './SiteContext.jsx';

const ReportsContext = createContext(null);

/**
 * Model report, direction analysis and data-quality report, fetched once and shared by the sections that show them.
 * They reload when the evaluation or dataset changes; the report also reloads when the turbine changes because its
 * energy-error proxy depends on the power curve.
 */
export function ReportsProvider({ children }) {
  const { site } = useSite();
  const ready = site?.status === 'ready';
  const report = useApi(getModelReport, [site?.model?.evaluated_at, site?.turbine?.name, site?.evaluation_stale], { enabled: ready });
  const direction = useApi(getDirection, [site?.model?.evaluated_at], { enabled: ready });
  const quality = useApi(getQuality, [site?.dataset?.fetched_at], { enabled: ready });
  const value = useMemo(() => ({ report, direction, quality }), [report, direction, quality]);
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}
ReportsProvider.propTypes = { children: PropTypes.node };

export function useReports() {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside <ReportsProvider>');
  return ctx;
}
