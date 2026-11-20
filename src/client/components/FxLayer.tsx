// Reusable spell and combat animations drawn over the table (flat or 3D): fire bolts, shattering, exile, board wipes,
// counterspells, life drain, a commander's arrival, big creatures landing, combat lunges.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameView } from '../../engine/view';
import { fxFor, type Anchor, type Fx } from '../gameFx';

type Box = { x: number; y: number; w: number; h: number };
interface Live {
  id: number;
  fx: Fx;
  at?: Box;
  to?: Box;
  from?: Box[];
}

const LIFETIME: Record<Fx['kind'], number> = {
  bolt: 1000, shatter: 1100, crumble: 1200, exile: 1300, wipe: 1300, counter: 900, drain: 1300, sparkle: 1100, pillar: 1600, slam: 900, puff: 800, lunge: 0,
};

const selector = (a: Anchor) => ('card' in a ? `[data-card-id="${a.card}"]` : 'player' in a ? `[data-player-id="${a.player}"]` : `[data-stack-id="${a.stack}"]`);
const keyOf = (a: Anchor) => ('card' in a ? `c:${a.card}` : 'player' in a ? `p:${a.player}` : `s:${a.stack}`);
const boxOf = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

/** Where every anchor-able thing is right now (cards, life dice, stack entries). */
function snapshotBoxes(): Map<string, Box> {
  const m = new Map<string, Box>();
  const put = (k: string, el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && !m.has(k)) m.set(k, boxOf(r));
  };
  document.querySelectorAll('[data-card-id]').forEach((el) => put(`c:${el.getAttribute('data-card-id')}`, el));
  document.querySelectorAll('[data-player-id]').forEach((el) => put(`p:${el.getAttribute('data-player-id')}`, el));
  document.querySelectorAll('[data-stack-id]').forEach((el) => put(`s:${el.getAttribute('data-stack-id')}`, el));
  return m;
}

let nextId = 1;

export function FxLayer({ view, calm }: { view: GameView; calm: boolean }) {
  const [live, setLive] = useState<Live[]>([]);
  const prev = useRef<GameView | null>(null);
  const last = useRef<Map<string, Box>>(new Map());

  useLayoutEffect(() => {
    const events = fxFor(prev.current, view);
    const now = snapshotBoxes();
    // Something that just left the table is found where it was last seen.
    const find = (a: Anchor): Box | undefined => now.get(keyOf(a)) ?? last.current.get(keyOf(a));
    const spawn: Live[] = [];
    for (const fx of events) {
      if (calm && (fx.kind === 'lunge' || fx.kind === 'slam')) continue;
      if (fx.kind === 'lunge') {
        lunge(fx.card, find(fx.toward));
        if (fx.clash) {
          const at = find(fx.toward);
          if (at) spawn.push({ id: nextId++, fx: { kind: 'puff', at: fx.toward, color: '#ffd76a' }, at });
        }
        continue;
      }
      const item: Live = { id: nextId++, fx };
      if ('at' in fx) item.at = find(fx.at);
      if (fx.kind === 'bolt') {
        item.at = find(fx.from);
        item.to = find(fx.to);
        if (!item.to) continue;
      }
      if (fx.kind === 'drain') {
        item.to = find(fx.to);
        item.from = fx.from.map(find).filter((b): b is Box => !!b);
        if (!item.to || !item.from.length) continue;
      }
      if ('at' in fx && !item.at) continue;
      if (fx.kind === 'slam' || fx.kind === 'wipe') shake(fx.kind === 'wipe' ? 9 : 4 + 6 * fx.size);
      spawn.push(item);
    }
    if (spawn.length) {
      setLive((l) => [...l, ...spawn]);
      for (const s of spawn) window.setTimeout(() => setLive((l) => l.filter((x) => x.id !== s.id)), LIFETIME[s.fx.kind] + 200);
    }
    last.current = now;
    prev.current = view;
  }, [view]);

  return (
    <div className="fx-layer" aria-hidden>
      {live.map((l) => (
        <FxItem key={l.id} l={l} />
      ))}
    </div>
  );
}

/** The attacker jumps at its target and back (added on top of whatever transform it already has). */
function lunge(cardId: string, to: Box | undefined) {
  const el = document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`);
  if (!el || !to) return;
  const r = el.getBoundingClientRect();
  const scale = r.width / (el.offsetWidth || r.width);
  const dx = (to.x + to.w / 2 - (r.left + r.width / 2)) / scale;
  const dy = (to.y + to.h / 2 - (r.top + r.height / 2)) / scale;
  const len = Math.hypot(dx, dy) || 1;
  const reach = Math.min(len * 0.45, 90);
  const ux = (dx / len) * reach;
  const uy = (dy / len) * reach;
  el.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${-ux * 0.12}px, ${-uy * 0.12}px)`, offset: 0.25 },
      { transform: `translate(${ux}px, ${uy}px)`, offset: 0.5 },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 520, easing: 'cubic-bezier(.3,.1,.3,1)', composite: 'add' },
  );
}

/** A short jolt of the whole table. */
function shake(px: number) {
  const el = document.querySelector<HTMLElement>('.tavern');
  if (!el) return;
  el.animate(
    [0, 1, 2, 3, 4, 5].map((i) => ({ transform: i === 5 ? 'translate(0,0)' : `translate(${(i % 2 ? -1 : 1) * px * (1 - i / 5)}px, ${(i % 3 === 0 ? 1 : -1) * px * 0.5 * (1 - i / 5)}px)` })),
    { duration: 420, easing: 'ease-out', composite: 'add' },
  );
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function FxItem({ l }: { l: Live }) {
  const { fx, at, to } = l;
  const color = 'color' in fx ? fx.color : '#fff';
  const vars = { '--fx': color } as CSSProperties;
  switch (fx.kind) {
    case 'bolt': {
      const t = center(to!);
      const f = at ? center(at) : { x: t.x, y: window.innerHeight - 80 };
      return (
        <>
          <div className="fx-bolt" style={{ ...vars, left: f.x, top: f.y, ['--dx' as string]: `${t.x - f.x}px`, ['--dy' as string]: `${t.y - f.y}px` }}>
            <i className="core" />
          </div>
          <div className="fx-burst" style={{ ...vars, left: t.x, top: t.y }}>
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} style={{ ['--a' as string]: `${i * 36 + (i % 2) * 9}deg` }} />
            ))}
          </div>
        </>
      );
    }
    case 'shatter':
    case 'crumble':
    case 'exile': {
      const b = at!;
      const img = fx.image ? `url("${fx.image}")` : undefined;
      if (fx.kind === 'shatter') {
        const cols = 3;
        const rows = 4;
        return (
          <div className="fx-shatter" style={{ ...vars, left: b.x, top: b.y, width: b.w, height: b.h }}>
            <i className="sigil" />
            {Array.from({ length: cols * rows }, (_, i) => {
              const cx = i % cols;
              const cy = Math.floor(i / cols);
              const dx = (cx - (cols - 1) / 2) * 60 + (i % 2 ? 14 : -10);
              const dy = (cy - (rows - 1) / 2) * 50 + 30;
              return (
                <i
                  key={i}
                  className="shard"
                  style={{
                    left: `${(cx / cols) * 100}%`,
                    top: `${(cy / rows) * 100}%`,
                    width: `${100 / cols}%`,
                    height: `${100 / rows}%`,
                    backgroundImage: img,
                    backgroundSize: `${b.w}px ${b.h}px`,
                    backgroundPosition: `${(-cx * b.w) / cols}px ${(-cy * b.h) / rows}px`,
                    ['--dx' as string]: `${dx}px`,
                    ['--dy' as string]: `${dy}px`,
                    ['--r' as string]: `${(i % 3) * 40 - 40}deg`,
                  }}
                />
              );
            })}
          </div>
        );
      }
      return (
        <div className={`fx-${fx.kind}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          <i className="ghost" style={{ backgroundImage: img }} />
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} className="mote" style={{ left: `${(i * 37) % 100}%`, ['--d' as string]: `${(i % 5) * 0.06}s`, ['--x' as string]: `${((i * 53) % 40) - 20}px` }} />
          ))}
        </div>
      );
    }
    case 'wipe':
      return (
        <div className="fx-wipe" style={vars}>
          <i className="ring" />
          <i className="flash" />
        </div>
      );
    case 'counter': {
      const c = center(at!);
      return (
        <div className="fx-counter" style={{ left: c.x, top: c.y }}>
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" />
            <circle cx="50" cy="50" r="30" className="inner" />
            <path d="M50 14 L58 50 L50 86 L42 50 Z" />
          </svg>
        </div>
      );
    }
    case 'drain': {
      const t = center(to!);
      return (
        <>
          {l.from!.flatMap((f, i) => {
            const s = center(f);
            const mx = (s.x + t.x) / 2 + (s.y - t.y) * 0.25;
            const my = (s.y + t.y) / 2 - Math.abs(s.x - t.x) * 0.2 - 40;
            return [0, 1, 2].map((k) => (
              <i
                key={`${i}-${k}`}
                className="fx-wisp"
                style={{ ...vars, offsetPath: `path("M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}")`, animationDelay: `${k * 0.12 + i * 0.08}s` }}
              />
            ));
          })}
          <div className="fx-sparkle" style={{ ...vars, left: t.x, top: t.y }}>
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ ['--a' as string]: `${i * 45}deg`, animationDelay: '0.75s' }} />
            ))}
          </div>
        </>
      );
    }
    case 'sparkle': {
      const c = center(at!);
      return (
        <div className="fx-sparkle up" style={{ ...vars, left: c.x, top: c.y }}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${i * 36}deg`, animationDelay: `${(i % 3) * 0.08}s` }} />
          ))}
        </div>
      );
    }
    case 'pillar': {
      const b = at!;
      return (
        <div className="fx-pillar" style={{ ...vars, left: b.x + b.w / 2, top: b.y + b.h / 2 }}>
          <i className="beam" />
          <i className="ring" />
        </div>
      );
    }
    case 'slam': {
      const b = at!;
      return (
        <div className="fx-slam" style={{ left: b.x + b.w / 2, top: b.y + b.h * 0.8, ['--s' as string]: String(1 + fx.size) }}>
          <i className="ring" />
          <i className="ring r2" />
        </div>
      );
    }
    case 'puff': {
      const c = center(at!);
      return (
        <div className="fx-puff" style={{ ...vars, left: c.x, top: c.y }}>
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${i * 51}deg` }} />
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
