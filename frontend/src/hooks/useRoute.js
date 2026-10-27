import { useEffect, useState } from 'react';

export const TURBINE_HASH = '#/turbine';

/**
 * Which page is showing. The app has two pages and no router library: the address hash decides.
 * "#/turbine" is the 3D page; anything else (including the dashboard's "#forecast" jump links) is the dashboard.
 */
export const routeFromHash = (hash) => (hash === TURBINE_HASH ? 'turbine' : 'dashboard');

export function useRoute() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
