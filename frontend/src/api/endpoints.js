// One function per backend route (see /docs on the backend for the full contract). All paths go through the dev proxy.
import { request } from './client.js';

const qs = (params = {}) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

export const getHealth = (o) => request('/api/health', o);

// site
export const getSite = (o) => request('/api/site', o);
export const putSite = (body) => request('/api/site', { method: 'PUT', body });
export const patchSite = (body) => request('/api/site', { method: 'PATCH', body });
export const refreshData = () => request('/api/site/data/refresh', { method: 'POST' });

// jobs
export const getJob = (id, o) => request(`/api/jobs/${encodeURIComponent(id)}`, o);
export const listJobs = (limit = 10, o) => request(`/api/jobs${qs({ limit })}`, o);

// forecast
export const getForecast = (origin, o) => request(`/api/site/forecast${qs({ origin })}`, o);
export const postForecast = (origin) => request('/api/site/forecast', { method: 'POST', body: origin ? { origin } : {} });
export const getApiComparison = (origin, o) => request(`/api/site/api-comparison${qs({ origin })}`, o);
export const exportUrl = (format, origin) => `/api/site/export${qs({ format, origin })}`;

// reports
export const getQuality = (o) => request('/api/site/data/quality', o);
export const getHistory = (days = 30, o) => request(`/api/site/data/history${qs({ days })}`, o);
export const getModelReport = (o) => request('/api/site/models/report', o);
export const getDirection = (o) => request('/api/site/models/direction', o);
export const getCompare = (params, o) => request(`/api/site/compare${qs(params)}`, o);

// turbines
export const getTurbines = (group = 'onshore', o) => request(`/api/turbines${qs({ group })}`, o);
export const getTurbineCurve = (name, group = 'onshore', o) =>
  request(`/api/turbines/${encodeURIComponent(name)}/curve${qs({ group })}`, o);
