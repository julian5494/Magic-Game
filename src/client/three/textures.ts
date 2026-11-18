// Procedural textures painted on canvases: aged oak planks, leather, resin dice, card backs, felt, stone.
// Nothing is downloaded; everything is generated once when the table is built.
import * as THREE from 'three';
import { clamp, makeNoise, mix, rng, smooth } from './noise';

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas unavailable');
  return x;
}

export function tex(c: HTMLCanvasElement, { srgb = true, repeat = false } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Turn a height field into a tangent-space normal map. */
function normalFromHeight(hf: Float32Array, w: number, h: number, strength: number): THREE.CanvasTexture {
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + Math.max(0, x - 1)];
      const r = hf[y * w + Math.min(w - 1, x + 1)];
      const u = hf[Math.max(0, y - 1) * w + x];
      const d = hf[Math.min(h - 1, y + 1) * w + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (0.5 / len + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

export interface OakAtlas {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
  strips: number;
}

/**
 * Aged oak: an atlas of `strips` planks. Growth rings warped by noise, dark latewood lines, pores along the grain,
 * knots with rings swirling around them, stains, scratches and worn edges.
 */
export function oakAtlas({ strips = 8, stripH = 128, w = 1536, seed = 7 } = {}): OakAtlas {
  const light = [134, 90, 54];
  const dark = [36, 21, 11];
  const H = strips * stripH;
  const N = makeNoise(seed);
  const R = rng(seed * 13 + 1);
  const col = canvas(w, H);
  const cctx = ctx2d(col);
  const img = cctx.createImageData(w, H);
  const hf = new Float32Array(w * H);
  const rough = new Uint8ClampedArray(w * H * 4);
  const sx = 2048 / w;
  const sy = 192 / stripH;
  for (let s = 0; s < strips; s++) {
    const off = R() * 100;
    const off2 = R() * 100;
    const ringScale = 13 + R() * 9;
    const knots: { x: number; y: number; r: number }[] = [];
    const nk = Math.floor(R() * 3);
    for (let k = 0; k < nk; k++) knots.push({ x: (150 + R() * (2048 - 300)) / sx, y: stripH * (0.25 + R() * 0.5), r: (7 + R() * 9) / sy });
    const tint = 0.78 + R() * 0.22;
    for (let y = 0; y < stripH; y++) {
      const ny = y / stripH;
      for (let x = 0; x < w; x++) {
        const X = x * sx;
        const Y = y * sy;
        const warp = N.fbm(X / 1150 + off, ny * 0.9 + off2, 4) * 2.6 + N.fbm(X / 260 + off2, ny * 3, 2) * 0.35;
        let t = ny * ringScale + warp;
        let core = 0;
        for (const k of knots) {
          const dx = (x - k.x) / (k.r * 3.2);
          const dy = (y - k.y) / k.r;
          const d = Math.sqrt(dx * dx + dy * dy);
          t += Math.exp(-d * d * 0.35) * (4 / (d + 0.5));
          core = Math.max(core, 1 - smooth(0.35, 0.75, d));
        }
        const ring = t - Math.floor(t);
        const late = Math.exp(-(((ring - 0.1) / 0.045) ** 2)) * 0.8 + 0.25 * Math.exp(-(((ring - 0.5) / 0.08) ** 2));
        const pores = Math.pow(N.fbm(X / 5 + off, Y / 1.1, 2) * 0.5 + 0.5, 1.6);
        const tone = N.fbm(X / 340 + off2, ny * 2.5, 3) * 0.5 + 0.5;
        const stain = smooth(0.62, 0.85, N.fbm(X / 160 + off * 2, ny * 4, 2) * 0.5 + 0.5);
        const v = clamp(late * 0.6 + (1 - tone) * 0.42 + pores * 0.32 + stain * 0.3 + core * 0.9);
        const p = (s * stripH + y) * w + x;
        const i = p * 4;
        img.data[i] = mix(light[0], dark[0], v) * tint;
        img.data[i + 1] = mix(light[1], dark[1], v) * tint;
        img.data[i + 2] = mix(light[2], dark[2], v) * tint;
        img.data[i + 3] = 255;
        hf[p] = 1 - late * 0.3 - pores * 0.45 - core * 0.6;
        const rv = clamp(0.55 + late * 0.18 + pores * 0.12 - stain * 0.05) * 255;
        rough[i] = rough[i + 1] = rough[i + 2] = rv;
        rough[i + 3] = 255;
      }
    }
  }
  cctx.putImageData(img, 0, 0);
  // scratches and nicks; lighter where the finish is worn through
  for (let i = 0; i < 220; i++) {
    const x = R() * w;
    const y = R() * H;
    const len = (20 + R() * 160) / sx;
    const a = R() < 0.8 ? (R() - 0.5) * 0.4 : (R() - 0.5) * 3;
    cctx.strokeStyle = R() < 0.7 ? `rgba(230,190,140,${0.05 + R() * 0.12})` : `rgba(15,6,2,${0.2 + R() * 0.25})`;
    cctx.lineWidth = 0.5 + R() * 1.1;
    cctx.beginPath();
    cctx.moveTo(x, y);
    cctx.quadraticCurveTo(x + (len / 2) * Math.cos(a), y + (len / 2) * Math.sin(a) + (R() - 0.5) * 4, x + len * Math.cos(a), y + len * Math.sin(a));
    cctx.stroke();
  }
  const rc = canvas(w, H);
  const rctx = ctx2d(rc);
  const rimg = rctx.createImageData(w, H);
  rimg.data.set(rough);
  rctx.putImageData(rimg, 0, 0);
  return { map: tex(col), roughnessMap: tex(rc, { srgb: false }), normalMap: normalFromHeight(hf, w, H, 1.1), strips };
}

/** Pebbled leather with faint creases. */
export function leather({ w = 512, h = 512, seed = 3, color = [30, 74, 50], creaseAmt = 1 } = {}) {
  const N = makeNoise(seed);
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  const hf = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const peb = 1 - Math.abs(N.noise(x / 2.2, y / 2.2));
      const peb2 = 1 - Math.abs(N.noise(x / 5 + 40, y / 5 + 40));
      const crease = Math.abs(N.fbm(x / 140, y / 140, 3));
      const cr = smooth(0.0, 0.012, crease);
      const patch = N.fbm(x / 260 + 9, y / 260, 2) * 0.5 + 0.5;
      const v = 0.78 + peb * 0.14 + peb2 * 0.08 - (1 - cr) * 0.1 * creaseAmt + (patch - 0.5) * 0.3;
      const i = (y * w + x) * 4;
      img.data[i] = color[0] * v;
      img.data[i + 1] = color[1] * v;
      img.data[i + 2] = color[2] * v;
      img.data[i + 3] = 255;
      hf[y * w + x] = peb * 0.5 + peb2 * 0.3 + cr * 0.4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normalMap: normalFromHeight(hf, w, h, 1.2), canvas: c };
}

/** A grey, tileable pebble pattern for the HTML playmats (blended over their color). */
export function leatherGrainDataUrl(size = 256, seed = 4): string {
  const N = makeNoise(seed);
  const c = canvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  // Sample a torus so the pattern tiles seamlessly.
  const R1 = size / (2 * Math.PI);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const nx = Math.cos(a) * R1;
      const ny = Math.sin(a) * R1;
      const nz = Math.cos(b) * R1;
      const nw = Math.sin(b) * R1;
      const peb = 1 - Math.abs(N.noise(nx / 2.2 + nz / 2.2, ny / 2.2 + nw / 2.2));
      const peb2 = 1 - Math.abs(N.noise(nx / 5 + 40 + nz / 7, ny / 5 + nw / 7));
      // Shadows in the pebble's hollows, a faint sheen on the bumps (no blend mode needed).
      const v = clamp(0.5 + (peb - 0.6) * 0.5 + (peb2 - 0.6) * 0.35);
      const i = (y * size + x) * 4;
      const light = v > 0.5;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 0;
      img.data[i + 3] = light ? (v - 0.5) * 120 : (0.5 - v) * 260;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Resin marble used under the numbers of a die. */
export function resinCanvas(base: number, w = 1280, h = 1024, seed = 2): HTMLCanvasElement {
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const N = makeNoise(seed);
  const img = ctx.createImageData(w, h);
  const bc = new THREE.Color(base);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const m = N.fbm(x / 160 + N.fbm(x / 90, y / 90, 2) * 2, y / 160, 3);
      const swirl = smooth(0.05, 0.25, Math.abs(m));
      const k = 0.78 + swirl * 0.32;
      const i = (y * w + x) * 4;
      img.data[i] = clamp(bc.r * k + (1 - swirl) * 0.08) * 255;
      img.data[i + 1] = clamp(bc.g * k + (1 - swirl) * 0.08) * 255;
      img.data[i + 2] = clamp(bc.b * k + (1 - swirl) * 0.1) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Atlas cells for the 20 faces of a d20: 5 columns × 4 rows of triangles. */
export function d20Cells(w = 1280, h = 1024): [number, number][][] {
  const cw = w / 5;
  const ch = h / 4;
  const cells: [number, number][][] = [];
  for (let i = 0; i < 20; i++) {
    const cx = (i % 5) * cw;
    const cy = Math.floor(i / 5) * ch;
    const pad = 14;
    const pts: [number, number][] = [
      [cx + cw / 2, cy + pad],
      [cx + pad, cy + ch - pad],
      [cx + cw - pad, cy + ch - pad],
    ];
    cells.push(pts.map(([x, y]) => [x / w, 1 - y / h]));
  }
  return cells;
}

const D20_NUMS = [0, 8, 14, 2, 17, 5, 11, 20, 3, 16, 9, 12, 7, 19, 4, 15, 10, 13, 6, 18];

/** Paint the d20 faces onto `out`: the marble, then the numbers. Face 0 carries the life total. */
export function paintD20(out: HTMLCanvasElement, marble: HTMLCanvasElement, life: number): void {
  const ctx = ctx2d(out);
  const w = out.width;
  const h = out.height;
  ctx.drawImage(marble, 0, 0, w, h);
  const cw = w / 5;
  const ch = h / 4;
  const k = cw / 256; // sizes below are for 256-px cells
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 20; i++) {
    const cx = (i % 5) * cw;
    const cy = Math.floor(i / 5) * ch;
    const n = i === 0 ? String(life) : String(D20_NUMS[i]);
    const size = (i === 0 ? (n.length > 2 ? 64 : n.length > 1 ? 86 : 100) : 52) * k;
    ctx.font = `900 ${size}px Cinzel, Georgia, serif`;
    const tx = cx + cw / 2;
    const ty = cy + ch * 0.66;
    ctx.lineWidth = (i === 0 ? 10 : 7) * k;
    ctx.strokeStyle = i === 0 ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.45)';
    ctx.strokeText(n, tx, ty);
    ctx.fillStyle = i === 0 ? '#fff6dc' : '#f3e9d2';
    ctx.fillText(n, tx, ty);
    if (i !== 0 && (n === '6' || n === '9')) ctx.fillRect(tx - 12 * k, ty + size * 0.45, 24 * k, 4 * k);
  }
}

/** One face of a d6. */
export function d6Face(base: number, n: number | string): THREE.CanvasTexture {
  const c = canvas(256, 256);
  const ctx = ctx2d(c);
  const bc = new THREE.Color(base);
  const g = ctx.createRadialGradient(100, 90, 20, 128, 128, 200);
  g.addColorStop(0, `#${bc.clone().lerp(new THREE.Color('#ffffff'), 0.18).getHexString()}`);
  g.addColorStop(1, `#${bc.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.font = '900 150px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.strokeText(String(n), 128, 140);
  ctx.fillStyle = '#fbf3df';
  ctx.fillText(String(n), 128, 140);
  return tex(c);
}

/** Our own card back (not the official one). */
export function cardBack(): THREE.CanvasTexture {
  const c = canvas(256, 356);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, 256, 356);
  const g = ctx.createRadialGradient(128, 178, 10, 128, 178, 200);
  g.addColorStop(0, '#7a4220');
  g.addColorStop(1, '#2a1408');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(12, 12, 232, 332, 10);
  ctx.fill();
  ctx.strokeStyle = '#d4a650';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#ffb347';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 178, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(128, 178, 46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    ctx.lineTo(128 + Math.cos(a) * 44, 178 + Math.sin(a) * 44);
  }
  ctx.closePath();
  ctx.stroke();
  return tex(c);
}

export function parchment(w = 512, h = 256, seed = 4): THREE.CanvasTexture {
  const N = makeNoise(seed);
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 0.85 + N.fbm(x / 60, y / 60, 3) * 0.25 - smooth(0.35, 0.5, Math.max(Math.abs(x / w - 0.5), Math.abs(y / h - 0.5))) * 0.25;
      const i = (y * w + x) * 4;
      img.data[i] = 232 * v;
      img.data[i + 1] = 212 * v;
      img.data[i + 2] = 168 * v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(60,36,16,.75)';
  ctx.font = '700 34px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('CHRONICLE', w / 2, h / 2 + 12);
  return tex(c);
}

export function felt(color: number[], seed = 9): THREE.CanvasTexture {
  const N = makeNoise(seed);
  const c = canvas(256, 256);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const v = 0.85 + N.noise(x / 1.5, y / 1.5) * 0.12 + N.fbm(x / 40, y / 40, 2) * 0.15;
      const i = (y * 256 + x) * 4;
      img.data[i] = color[0] * v;
      img.data[i + 1] = color[1] * v;
      img.data[i + 2] = color[2] * v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: true });
}

/** Flagstones for the floor and wall. */
export function stone(seed = 5, w = 512) {
  const N = makeNoise(seed);
  const c = canvas(w, w);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, w);
  const hf = new Float32Array(w * w);
  const tile = w / 4;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const row = Math.floor(y / tile);
      const ox = row % 2 ? tile / 2 : 0;
      const lx = (x + ox) % tile;
      const ly = y % tile;
      const edge = Math.min(lx, ly, tile - lx, tile - ly);
      const grout = 1 - smooth(1, 5, edge);
      const v = 0.55 + N.fbm(x / 35, y / 35, 4) * 0.35 + N.noise(x / 3, y / 3) * 0.06 - grout * 0.45;
      const i = (y * w + x) * 4;
      img.data[i] = 82 * v;
      img.data[i + 1] = 74 * v;
      img.data[i + 2] = 66 * v;
      img.data[i + 3] = 255;
      hf[y * w + x] = v;
    }
  ctx.putImageData(img, 0, 0);
  const normalMap = normalFromHeight(hf, w, w, 3);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map: tex(c, { repeat: true }), normalMap };
}

/** Radial glow sprite (flames, light pools). */
export function glow(inner = '#fff8e0', mid = '#ffb347', size = 128): THREE.CanvasTexture {
  const c = canvas(size, size);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return tex(c);
}

/** Teardrop flame. */
export function flameTex(): THREE.CanvasTexture {
  const c = canvas(128, 256);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(64, 190, 4, 64, 170, 120);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,190,1)');
  g.addColorStop(0.55, 'rgba(255,170,60,.9)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(64, 10);
  ctx.bezierCurveTo(110, 110, 112, 200, 64, 240);
  ctx.bezierCurveTo(16, 200, 18, 110, 64, 10);
  ctx.fill();
  return tex(c);
}

/** Ring stain left by a mug. */
export function ringStain(): THREE.CanvasTexture {
  const c = canvas(256, 256);
  const ctx = ctx2d(c);
  ctx.strokeStyle = 'rgba(20,8,2,.55)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0.3, Math.PI * 1.75);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(20,8,2,.25)';
  ctx.beginPath();
  ctx.arc(128, 128, 94, 0, Math.PI * 2);
  ctx.stroke();
  return tex(c);
}
