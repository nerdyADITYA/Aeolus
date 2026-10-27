import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '../api/client.js';

/**
 * Runs `fn(options)` (an endpoint function) and tracks {data, error, loading}.
 * Re-runs when `deps` change or `reload()` is called; an in-flight request is aborted when superseded.
 * `fn` receives `{ signal }`. Pass `enabled: false` to skip the call.
 */
export function useApi(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current({ signal: ctrl.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (!isAbort(error)) setState({ data: null, error, loading: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
