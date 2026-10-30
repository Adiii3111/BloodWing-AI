import { useEffect, useState } from 'react';

export type Route = 'home' | 'mission' | 'sentinel' | 'pulse' | 'orbit' | 'dispatch' | 'inventory' | 'fleet' | 'lab' | 'research' | 'impact' | 'about' | 'pitch' | 'demo';

export const ROUTES: Route[] = ['home', 'mission', 'sentinel', 'pulse', 'orbit', 'dispatch', 'inventory', 'fleet', 'lab', 'research', 'impact', 'about', 'pitch', 'demo'];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(h) ? h : 'home';
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(r: Route) {
  window.location.hash = r === 'home' ? '/' : `/${r}`;
}

export const href = (r: Route) => (r === 'home' ? '#/' : `#/${r}`);
