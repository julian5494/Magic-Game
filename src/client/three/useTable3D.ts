import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { PropSet, TableScene } from './TableScene';

const PROPS_KEY = 'commander-arena-props';

/**
 * The table is always the full-quality 3D tavern. It falls back to the flat table only when the browser
 * can't do WebGL; `?flat=1` in the address also forces it (for automated tests on machines without a GPU).
 */
const forceFlat = () => {
  try {
    return new URLSearchParams(location.search).has('flat');
  } catch {
    return false;
  }
};

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

/** The table's prop set, remembered in this browser. */
export function useTableSettings() {
  const [propSet, setP] = useState<PropSet>(() => read<PropSet>(PROPS_KEY, ['candle', 'lantern'], 'candle'));
  return {
    propSet,
    setPropSet: (p: PropSet) => {
      setP(p);
      write(PROPS_KEY, p);
    },
  };
}

/**
 * Load and run the 3D tavern behind the board. Returns the scene once it is ready (null while loading,
 * or when the browser has no WebGL), plus the element the board should be rendered into.
 */
export function useTable3D(container: RefObject<HTMLDivElement>) {
  const boardEl = useMemo(() => {
    const el = document.createElement('div');
    el.className = 'board3d';
    return el;
  }, []);
  const [scene, setScene] = useState<TableScene | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (forceFlat() || !container.current) return;
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
        s = new mod.TableScene(container.current, boardEl);
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
  }, [container, boardEl]);
  return { scene, boardEl, failed };
}
