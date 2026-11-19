// Foil finishes: the printed patterns each finish has (stars, waves, shards, ...) are painted once on
// canvases and handed to the stylesheet as CSS variables. The light that moves over them is plain CSS,
// and the pointer tilts it while you hover a foil card.
import { makeNoise, rng } from './three/noise';

let painted = false;

/** Paint every foil pattern once (shortly after the first foil card appears). */
export function ensureFoilTextures(): void {
  if (painted || typeof document === 'undefined') return;
  painted = true;
  const run = () => {
    const root = document.documentElement.style;
    for (const [name, paint] of Object.entries(PATTERNS)) {
      try {
        root.setProperty(`--fx-${name}`, `url("${paint()}")`);
      } catch {
        /* a missing pattern only makes that finish plainer */
      }
    }
  };
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 0);
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Fill a canvas pixel by pixel: f returns [r, g, b] in 0..1 (alpha is always opaque). */
function pixels(size: number, f: (x: number, y: number) => [number, number, number]): string {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = g * 255;
      img.data[i + 2] = b * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const hsl = (h: number, s: number, l: number): [number, number, number] => {
  h = ((h % 1) + 1) % 1;
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};

/** A four-pointed glint: a soft core and two thin spikes. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, color = '255,255,255') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, len * 0.35);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - len, y - len, len * 2, len * 2);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const s = ctx.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
    s.addColorStop(0, `rgba(${color},0)`);
    s.addColorStop(0.5, `rgba(${color},.95)`);
    s.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = s;
    if (dx) ctx.fillRect(x - len, y - 0.6, len * 2, 1.2);
    else ctx.fillRect(x - 0.6, y - len, 1.2, len * 2);
  }
}

const PATTERNS: Record<string, () => string> = {
  /** Galaxy: a dense field of tiny stars, some tinted, a few bright ones. */
  stars() {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    const R = rng(41);
    for (let i = 0; i < 1400; i++) {
      const v = 0.35 + R() * 0.65;
      const tint = R();
      ctx.fillStyle = tint < 0.15 ? `rgba(180,200,255,${v})` : tint < 0.25 ? `rgba(255,200,240,${v})` : `rgba(255,255,255,${v})`;
      const r = 0.35 + R() * R() * 1.3;
      ctx.beginPath();
      ctx.arc(R() * 512, R() * 512, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 26; i++) sparkle(ctx, R() * 512, R() * 512, 4 + R() * 6);
    return c.toDataURL('image/png');
  },
  /** Bright four-pointed glints (galaxy twinkle, raised highlights). */
  sparkles() {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    const R = rng(7);
    for (let i = 0; i < 22; i++) sparkle(ctx, R() * 512, R() * 512, 7 + R() * 10);
    return c.toDataURL('image/png');
  },
  /** Confetti: little coloured flecks scattered at every angle. */
  confetti() {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    const R = rng(19);
    for (let i = 0; i < 520; i++) {
      const [r, g, b] = hsl(R(), 0.95, 0.55 + R() * 0.2);
      ctx.save();
      ctx.translate(R() * 512, R() * 512);
      ctx.rotate(R() * Math.PI);
      ctx.fillStyle = `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${0.6 + R() * 0.4})`;
      const w = 1.6 + R() * 2.2;
      if (R() < 0.3) {
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-w / 2, -w * 1.3, w, w * 2.6);
      ctx.restore();
    }
    return c.toDataURL('image/png');
  },
  /** Sparse soft points of light that wink on and off. */
  glints() {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    const R = rng(23);
    for (let i = 0; i < 60; i++) sparkle(ctx, R() * 512, R() * 512, 3 + R() * 5);
    return c.toDataURL('image/png');
  },
  /** Surge: rolling bands across the card (tileable). */
  waves() {
    const S = 256;
    return pixels(S, (x, y) => {
      const t = y / 32 + 0.6 * Math.sin((2 * Math.PI * x) / 128) + 0.25 * Math.sin((2 * Math.PI * x) / 64 + 1);
      const v = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t), 4);
      return [v, v, v];
    });
  },
  /** Halo: interlocking rings swirling out from the middle. */
  swirl() {
    const S = 384;
    return pixels(S, (x, y) => {
      const dx = x - S / 2;
      const dy = y - S * 0.45;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const v1 = 0.5 + 0.5 * Math.sin(r * 0.22 + 5 * Math.sin(a * 3 + r * 0.015));
      const v2 = 0.5 + 0.5 * Math.sin(r * 0.17 - 4 * Math.sin(a * 5 - r * 0.02));
      const v = Math.pow(Math.max(v1, v2), 3);
      return [v, v, v];
    });
  },
  /** Ripple: rings spreading from a point low on the card, fading out. */
  rings() {
    const S = 384;
    return pixels(S, (x, y) => {
      const r = Math.hypot(x - S * 0.32, y - S * 0.62);
      const r2 = Math.hypot(x - S * 0.8, y - S * 0.2);
      const v = Math.max(Math.pow(0.5 + 0.5 * Math.cos(r / 6.5), 3) * (0.35 + 0.65 * Math.exp(-r / 260)), 0.6 * Math.pow(0.5 + 0.5 * Math.cos(r2 / 5.5), 3) * Math.exp(-r2 / 120));
      return [v, v, v];
    });
  },
  /** Textured foil: a raised, swirling pattern, lit from the top left (mid grey = flat). */
  relief() {
    const S = 384;
    const N = makeNoise(13);
    const hgt = (x: number, y: number) => {
      const h = N.fbm(x / 70, y / 70, 3) * 4 + N.noise(x / 22, y / 22) * 0.3;
      const f = h * 3 - Math.floor(h * 3);
      return Math.pow(Math.sin(f * Math.PI), 6);
    };
    return pixels(S, (x, y) => {
      const d = (hgt(x + 1, y + 1) - hgt(x - 1, y - 1)) * 1.3;
      const v = Math.max(0, Math.min(1, 0.5 - d));
      return [v, v, v];
    });
  },
  /** Etched: fine engraved hatching (white = untouched, grey lines). */
  etch() {
    const S = 128;
    return pixels(S, (x, y) => {
      const a = (x + y) % 4 === 0 ? 0.55 : 1;
      const b = (x - y + 512) % 8 === 0 ? 0.8 : 1;
      const v = a * b;
      return [v, v, v];
    });
  },
  /** Fracture: shattered facets, each catching a different colour, with bright edges. */
  shards() {
    const S = 384;
    const R = rng(31);
    const seeds = Array.from({ length: 38 }, () => ({ x: R() * S, y: R() * S, h: R(), l: 0.35 + R() * 0.3 }));
    return pixels(S, (x, y) => {
      let best = Infinity;
      let second = Infinity;
      let k = 0;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        let dx = Math.abs(x - s.x);
        let dy = Math.abs(y - s.y);
        dx = Math.min(dx, S - dx);
        dy = Math.min(dy, S - dy);
        const d = dx * dx + dy * dy;
        if (d < best) {
          second = best;
          best = d;
          k = i;
        } else if (d < second) second = d;
      }
      const edge = Math.sqrt(second) - Math.sqrt(best);
      const s = seeds[k];
      // Each facet carries a slight gradient, like a tilted mirror.
      const [r, g, b] = hsl(s.h + (x - s.x) / 900, 0.9, s.l + (y - s.y) / 900);
      const e = edge < 1.4 ? 1 : 0;
      return e ? [1, 1, 1] : [r, g, b];
    });
  },
  /** Oil slick: thin-film colours swirling like oil on water. */
  oil() {
    const S = 256;
    const N = makeNoise(5);
    return pixels(S, (x, y) => {
      const w = N.fbm(x / 60, y / 60, 3);
      const h = N.fbm(x / 45 + w * 1.6, y / 45 - w * 1.2, 4);
      return hsl(h * 1.3 + 0.6, 0.8, 0.36);
    });
  },
};

// ---------------------------------------------------------------- pointer light

/**
 * While the pointer is over a foil card (or the card you're previewing), the light follows it:
 * the card gets --mx/--my (0..1) and --glare, and so does the big preview.
 */
export function trackFoilPointer(): () => void {
  let raf = 0;
  let last: HTMLElement | null = null;
  let ev: PointerEvent | null = null;
  const clear = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
    el.style.removeProperty('--glare');
  };
  const set = (el: HTMLElement, mx: number, my: number) => {
    el.style.setProperty('--mx', mx.toFixed(3));
    el.style.setProperty('--my', my.toFixed(3));
    el.style.setProperty('--glare', '1');
  };
  const frame = () => {
    raf = 0;
    if (!ev) return;
    const target = ev.target instanceof Element ? ev.target : null;
    const card = target?.closest<HTMLElement>('[data-card-id]') ?? null;
    const hasFoil = !!card?.querySelector('.foil');
    const preview = document.querySelector<HTMLElement>('.preview-img');
    if (last && last !== card) {
      clear(last);
      if (preview) clear(preview);
    }
    last = hasFoil ? card : null;
    if (!card || !hasFoil) return;
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const mx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const my = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    set(card, mx, my);
    if (preview) set(preview, mx, my);
  };
  const onMove = (e: PointerEvent) => {
    ev = e;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    document.removeEventListener('pointermove', onMove);
    if (raf) cancelAnimationFrame(raf);
    clear(last);
  };
}

/** A small stable number per card, so foils on the table don't all shimmer in step. */
export function foilSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 97;
}

/** Which layers make up each finish. Each inner list is one blended group; see the .fx-* styles. */
export const FOIL_LAYERS: Record<string, string[][]> = {
  foil: [['spec'], ['sheen']],
  etched: [['metal', 'etch'], ['pastel'], ['sheen']],
  galaxy: [['spec'], ['spec', 'stars'], ['stars'], ['sparkles']],
  surge: [['spec', 'waves'], ['spec'], ['sheen']],
  halo: [['spec', 'swirl'], ['pastel'], ['sheen']],
  confetti: [['spec'], ['confetti'], ['glints']],
  textured: [['spec', 'art'], ['relief'], ['sheen']],
  oilslick: [['ink'], ['dim'], ['oil'], ['gloss']],
  gilded: [['goldtint'], ['gold'], ['sheen']],
  rainbow: [['spec2'], ['spec3'], ['sheen']],
  fracture: [['shards'], ['spec'], ['sheen']],
  ripple: [['spec', 'rings'], ['spec'], ['sheen']],
  raised: [['spec'], ['spec', 'art'], ['sparkles'], ['sheen']],
  neon: [['spec'], ['neon', 'art'], ['sheen']],
};

/** Neon ink comes in a few colours; each card gets one. */
export const NEON = ['#ff2bd6', '#f6ff2b', '#2bffb1', '#2bc8ff', '#ff5a2b'];
