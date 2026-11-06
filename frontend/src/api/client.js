// Thin fetch wrapper. Every failure becomes an ApiError so components can show one consistent message.

export class ApiError extends Error {
  constructor(status, detail, hint = null) {
    super(detail);
    this.name = 'ApiError';
    this.status = status; // HTTP status, or 0 when the backend could not be reached
    this.detail = detail;
    this.hint = hint;
  }
}

/** FastAPI returns a string `detail`, or a list of {loc, msg} for validation errors. */
export function formatDetail(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body' && p !== 'query').join('.') : '';
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join('; ');
  }
  return 'Unexpected error';
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the backend. Is it running?', 'Start it with .\\start.ps1');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    // The dev proxy answers 502/504 with no JSON body when the backend is down or still starting.
    if ([502, 503, 504].includes(res.status) && data === null) {
      throw new ApiError(0, 'Cannot reach the backend. Is it running?', 'Start it with .\\start.ps1, or wait a few seconds if it is starting');
    }
    throw new ApiError(res.status, formatDetail(data?.detail ?? res.statusText), data?.hint ?? null);
  }
  return data;
}

export const isAbort = (err) => err?.name === 'AbortError';
