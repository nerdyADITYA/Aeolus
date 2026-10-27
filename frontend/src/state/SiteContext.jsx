import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { getSite, patchSite, postForecast, putSite, refreshData } from '../api/endpoints.js';
import { useApi } from '../hooks/useApi.js';
import { useJob } from '../hooks/useJob.js';

const SiteContext = createContext(null);

/** A forecast job's origin ('2026-10-21 23:00:00') means "forecast the next UTC day" -> that day's date. */
export function originToDate(originUtc) {
  if (!originUtc) return null;
  const s = String(originUtc).replace('T', ' ');
  if (!s.includes(' 23:00')) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function SiteProvider({ children }) {
  const { data: site, error, loading, reload } = useApi(getSite, []);
  const [jobId, setJobId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null); // null = latest available
  const [forecastVersion, setForecastVersion] = useState(0);
  const [actionError, setActionError] = useState(null);

  // Adopt a job that is already running on the backend (e.g. after a page reload).
  useEffect(() => {
    if (site?.active_job_id && !jobId) setJobId(site.active_job_id);
  }, [site?.active_job_id, jobId]);

  const { job, pollError } = useJob(jobId, {
    onFinish: (j) => {
      reload();
      setForecastVersion((v) => v + 1);
      if (j.status === 'done' && j.type === 'forecast') setSelectedDate(originToDate(j.result?.origin_utc));
    },
  });

  // A finished job is shown briefly, then cleared. A failed one stays until dismissed.
  useEffect(() => {
    if (job?.status !== 'done') return undefined;
    const t = setTimeout(() => setJobId(null), 4000);
    return () => clearTimeout(t);
  }, [job?.status, job?.id]);

  const run = useCallback(async (fn) => {
    setActionError(null);
    try {
      return await fn();
    } catch (err) {
      setActionError(err);
      return null;
    }
  }, []);

  const startSetup = useCallback(
    (values) =>
      run(async () => {
        const res = await putSite(values);
        setSelectedDate(null);
        setJobId(res.job.id);
        reload();
        return res;
      }),
    [run, reload],
  );

  const applySettings = useCallback(
    (values) =>
      run(async () => {
        await patchSite(values);
        reload();
        setForecastVersion((v) => v + 1); // energy and yaw are recomputed by the backend on read
        return true;
      }),
    [run, reload],
  );

  const runForecast = useCallback(
    (origin) =>
      run(async () => {
        const j = await postForecast(origin);
        setJobId(j.id);
        return j;
      }),
    [run],
  );

  const refresh = useCallback(
    () =>
      run(async () => {
        const j = await refreshData();
        setJobId(j.id);
        return j;
      }),
    [run],
  );

  const value = useMemo(
    () => ({
      site, loading, error, reload,
      job, jobId, pollError, dismissJob: () => setJobId(null),
      actionError, clearActionError: () => setActionError(null),
      startSetup, applySettings, runForecast, refresh,
      selectedDate, setSelectedDate, forecastVersion,
    }),
    [site, loading, error, reload, job, jobId, pollError, actionError, startSetup, applySettings, runForecast, refresh, selectedDate, forecastVersion],
  );
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
SiteProvider.propTypes = { children: PropTypes.node };

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used inside <SiteProvider>');
  return ctx;
}
