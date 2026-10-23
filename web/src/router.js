import { useEffect, useState } from 'react';

/** 极简 hash 路由：#/ 首页，#/wf/<id> 画布 */
export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function go(path) {
  window.location.hash = path;
}
