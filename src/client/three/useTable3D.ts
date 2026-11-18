import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { PropSet, Quality, TableScene } from './TableScene';

export type Quality3D = Quality | 'off';
const QUALITY_KEY = 'commander-arena-3d';
const PROPS_KEY = 'commander-arena-props';

function read<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/** The 3D quality and prop set, remembered in this browser. */
export function useTableSettings() {
  const [quality, setQ] = useState<Quality3D>(() => read<Quality3D>(QUALITY_KEY, ['high', 'low', 'off'], 'high'));
  const [propSet, setP] = useState<PropSet>(() => read<PropSet>(PROPS_KEY, ['candle', 'lantern'], 'candle'));
  return {
    quality,
    propSet,
    setQuality: (q: Quality3D) => {
      setQ(q);
      write(QUALITY_KEY, q);
    },
    setPropSet: (p: PropSet) => {
      setP(p);
      write(PROPS_KEY, p);
    },
  };
}

/**
 * Load and run the 3D tavern behind the board. Returns the scene once it is ready (null while loading,
 * when 3D is off, or when the browser has no WebGL), plus the element the board should be rendered into.
 */
export function useTable3D(container: RefObject<HTMLDivElement>, quality: Quality3D) {
  const boardEl = useMemo(() => {
    const el = document.createElement('div');
    el.className = 'board3d';
    return el;
  }, []);
  const [scene, setScene] = useState<TableScene | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (quality === 'off' || !container.current) return;
    let alive = true;
    let s: TableScene | null = null;
    (async () => {
      try {
        const mod = await import('./TableScene');
        if (!alive || !container.current) return;
        if (!mod.webglAvailable()) {
          setFailed(true);
          return;
        }
        s = new mod.TableScene(container.current, boardEl, quality);
        await s.build();
        if (alive) setScene(s);
        else s.dispose();
      } catch (e) {
        console.warn('3D table unavailable, using the flat table:', e);
        s?.dispose();
        s = null;
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      s?.dispose();
      setScene(null);
    };
  }, [quality, container, boardEl]);
  return { scene, boardEl, failed };
}
