import { useEffect, useRef, useState } from 'react';
import { getJob } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

/**
 * Polls GET /api/jobs/{id} until the job is done or failed (the backend runs long work as background jobs).
 * `onFinish(job)` is called once per job id. Pass a null id to stop. Transient network errors are retried.
 */
export function useJob(jobId, { onFinish, intervalMs = 2000 } = {}) {
  const [job, setJob] = useState(null);
  const [pollError, setPollError] = useState(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    setJob(null);
    setPollError(null);
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const j = await getJob(jobId);
        if (cancelled) return;
        setJob(j);
        setPollError(null);
        if (j.status === 'done' || j.status === 'failed') {
          onFinishRef.current?.(j);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setPollError(err);
          return; // the job no longer exists (e.g. data was reset); stop polling
        }
        setPollError(err); // backend briefly unreachable: keep trying
      }
      timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  return { job, pollError, active: !!job && (job.status === 'queued' || job.status === 'running') };
}
