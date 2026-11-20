// 3D models for the tavern: the table, the room, props and dice. Units are centimetres; y is up, you sit at +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeNoise, rng } from './noise';
import * as T from './textures';

export interface Mats {
  oak: T.OakAtlas;
  iron: THREE.MeshStandardMaterial;
  pewter: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  /** Hand-forged iron and hammered pewter: the same metals with dents in them. */
  ironH: THREE.MeshStandardMaterial;
  pewterH: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  /** Struck gold coin faces (use on the caps of a cylinder: [rim, face, face]). */
  coin: THREE.Material[];
}

/** A light that flickers: its intensity and flame sprites are driven each frame. */
export interface Flicker {
  light: THREE.PointLight;
  flame?: THREE.Object3D;
  halo?: THREE.Sprite;
  base: number;
  steady?: boolean;
}

const shadowed = <O extends THREE.Object3D>(o: O, cast = true, receive = true): O => {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
};

export function materials(): Mats {
  const ham = T.hammered();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2724, metalness: 0.85, roughness: 0.55 });
  const pewter = new THREE.MeshStandardMaterial({ color: 0xa7adb5, metalness: 1, roughness: 0.32 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a948, metalness: 1, roughness: 0.28 });
  const face = T.coinFace();
  const coinFaceMat = new THREE.MeshStandardMaterial({ map: face.map, normalMap: face.normalMap, metalness: 1, roughness: 0.38 });
  return {
    oak: T.oakAtlas(),
    iron,
    pewter,
    gold,
    brass: new THREE.MeshStandardMaterial({ color: 0xb8893c, metalness: 1, roughness: 0.4 }),
    ironH: new THREE.MeshStandardMaterial({ color: 0x2e2a26, metalness: 0.8, roughness: 1, roughnessMap: ham.roughnessMap, normalMap: ham.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }),
    pewterH: new THREE.MeshStandardMaterial({ color: 0xa9afb7, metalness: 1, roughness: 0.6, roughnessMap: ham.roughnessMap, normalMap: ham.normalMap, normalScale: new THREE.Vector2(0.45, 0.45) }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd4d8e0, metalness: 0.55, roughness: 0.42 }),
    coin: [gold, coinFaceMat, coinFaceMat],
  };
}

/**
 * What metal and glass reflect: a dim, warm room with the hearth glowing behind the table,
 * the lamp overhead and a couple of candle-lit windows. Rendered once into an environment map.
 */
export function tavernEnvironment(): THREE.Scene {
  const s = new THREE.Scene();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(60, 24, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2a1a10).multiplyScalar(0.35), side: THREE.BackSide }));
  shell.position.y = 8;
  s.add(shell);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x120a06) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.9;
  s.add(floor);
  const glow = (color: number, k: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  glow(0xff7a2a, 3.5, 12, 7, 3, 1, -28); // hearth
  glow(0xffd2a0, 7, 10, 10, -1, 19, 4); // lamp above the table
  glow(0xffb060, 5, 3, 4, -26, 8, -10); // sconce
  glow(0xffb060, 5, 3, 4, 26, 8, -14); // sconce
  glow(0x6a7aa8, 1.6, 8, 10, 28, 9, 16); // cold window light
  return s;
}

/** A material that samples one plank strip of the oak atlas. */
export function plankMaterial(M: Mats, strip: number, rotate = false, u0 = 0, uLen = 1): THREE.MeshStandardMaterial {
  const cl = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(uLen, 1 / M.oak.strips);
    c.offset.set(u0, strip / M.oak.strips);
    if (rotate) {
      c.center.set(0.5, 0.5);
      c.rotation = Math.PI / 2;
    }
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    map: cl(M.oak.map),
    roughnessMap: cl(M.oak.roughnessMap),
    normalMap: cl(M.oak.normalMap),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
  });
}

const lathe = (points: number[][], segs = 48) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);

// ------------------------------------------------------------------ the table
/**
 * Old tavern table: thick oak planks with gaps, a few butt joints, pegged breadboard ends,
 * square iron nails, an apron and legs underneath. Planks sit at slightly different heights.
 */
export function tavernTable(M: Mats, { W = 212, D = 132, rows = 8, seed = 21 } = {}): THREE.Group {
  const R = rng(seed);
  const g = new THREE.Group();
  const thick = 5.5;
  const endW = 14;
  const gap = 0.55;
  const inner = W - endW * 2 - gap * 2;
  const pd = (D - gap * (rows - 1)) / rows;
  let strip = 0;
  const nailGeo = new RoundedBoxGeometry(0.8, 0.35, 0.8, 1, 0.12);
  const nail = (x: number, y: number, z: number) => {
    const n = new THREE.Mesh(nailGeo, M.iron);
    n.position.set(x, y, z);
    n.rotation.y = R() * 0.6;
    g.add(n);
  };
  for (let i = 0; i < rows; i++) {
    const z = -D / 2 + pd / 2 + i * (pd + gap);
    const lift = (R() - 0.5) * 0.16;
    const split = R() < 0.5 ? 0.22 + R() * 0.56 : null;
    const pieces: [number, number][] = split === null ? [[0, 1]] : [[0, split], [split, 1]];
    for (const [a, b] of pieces) {
      const len = inner * (b - a) - (pieces.length > 1 ? gap / 2 : 0);
      const x = -inner / 2 + (inner * (a + b)) / 2;
      const plank = new THREE.Mesh(new RoundedBoxGeometry(len, thick, pd, 3, 0.55), plankMaterial(M, strip++ % M.oak.strips, false, R() * 0.4, len / inner));
      plank.position.set(x, -thick / 2 + lift, z);
      plank.rotation.x = (R() - 0.5) * 0.004;
      g.add(plank);
      for (const ex of [x - len / 2 + 2.2, x + len / 2 - 2.2]) for (const dz of [-pd * 0.25, pd * 0.25]) nail(ex, lift + 0.12, z + dz);
    }
  }
  const pegMat = new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const end = new THREE.Mesh(new RoundedBoxGeometry(endW, thick + 0.3, D + 1.5, 3, 0.7), plankMaterial(M, strip++ % M.oak.strips, true, 0, 0.7));
    end.position.set(sx * (W / 2 - endW / 2), -thick / 2 + 0.15, 0);
    g.add(end);
    for (let i = 0; i < rows; i++) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.3, 16), pegMat);
      peg.position.set(sx * (W / 2 - endW / 2), 0.32, -D / 2 + pd / 2 + i * (pd + gap));
      g.add(peg);
    }
  }
  const apronMat = plankMaterial(M, 3, false, 0.1, 0.8);
  for (const [w, d, x, z] of [[W - 12, 2.5, 0, D / 2 - 6], [W - 12, 2.5, 0, -D / 2 + 6], [2.5, D - 12, W / 2 - 6, 0], [2.5, D - 12, -W / 2 + 6, 0]]) {
    const ap = new THREE.Mesh(new RoundedBoxGeometry(w, 12, d, 2, 0.5), apronMat);
    ap.position.set(x, -thick - 6, z);
    g.add(ap);
  }
  for (const [x, z] of [[-W / 2 + 8, -D / 2 + 8], [W / 2 - 8, -D / 2 + 8], [-W / 2 + 8, D / 2 - 8], [W / 2 - 8, D / 2 - 8]]) {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(8, 74, 8, 2, 1), apronMat);
    leg.position.set(x, -thick - 37, z);
    g.add(leg);
  }
  return shadowed(g);
}

/** Mug rings, a candle burn and wax drips on the wood. */
export function tableWear({ rings = [] as number[][], burn = null as number[] | null, wax = [] as number[][] }): THREE.Group {
  const g = new THREE.Group();
  const ringTex = T.ringStain();
  const R = rng(5);
  for (const [x, z, r] of rings) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4), new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, depthWrite: false, roughness: 0.6 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = R() * 6;
    m.position.set(x, 0.06, z);
    m.receiveShadow = true;
    g.add(m);
  }
  if (burn) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshBasicMaterial({ map: T.glow('rgba(0,0,0,.7)', 'rgba(10,4,1,.35)'), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(burn[0], 0.05, burn[1]);
    g.add(m);
  }
  const waxMat = new THREE.MeshPhysicalMaterial({ color: 0xcdb48a, roughness: 0.55 });
  for (const [x, z, r] of wax) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), waxMat);
    m.scale.y = 0.25;
    m.position.set(x, 0.02, z);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Forged iron corner brackets, wrapped over the edge and riveted, on all four corners. */
export function tableIron(M: Mats, W: number, D: number): THREE.Group {
  const g = new THREE.Group();
  const thick = 5.5;
  const L = 13;
  const bw = 2.8;
  const rivet = new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const c = new THREE.Group();
      // On top: an L along both edges, with a diagonal brace between them.
      const top = 0.48;
      const a = new THREE.Mesh(new RoundedBoxGeometry(L, 0.32, bw, 2, 0.12), M.ironH);
      a.position.set(-L / 2 + 0.4, top, -bw / 2 + 0.4);
      const b = new THREE.Mesh(new RoundedBoxGeometry(bw, 0.32, L, 2, 0.12), M.ironH);
      b.position.set(-bw / 2 + 0.4, top, -L / 2 + 0.4);
      const brace = new THREE.Mesh(new RoundedBoxGeometry(L * 0.62, 0.3, 1.5, 2, 0.1), M.ironH);
      brace.position.set(-L * 0.36, top, -L * 0.36);
      brace.rotation.y = Math.PI / 4;
      // Down the two outer faces.
      const fa = new THREE.Mesh(new RoundedBoxGeometry(L, thick + 1, 0.32, 2, 0.12), M.ironH);
      fa.position.set(-L / 2 + 0.4, -thick / 2 + 0.2, 0.55);
      const fb = new THREE.Mesh(new RoundedBoxGeometry(0.32, thick + 1, L, 2, 0.12), M.ironH);
      fb.position.set(0.55, -thick / 2 + 0.2, -L / 2 + 0.4);
      c.add(a, b, brace, fa, fb);
      for (const t of [0.15, 0.5, 0.85]) {
        const r1 = new THREE.Mesh(rivet, M.iron);
        r1.position.set(-L * t + 0.4, top + 0.15, -bw / 2 + 0.4);
        const r2 = new THREE.Mesh(rivet, M.iron);
        r2.position.set(-bw / 2 + 0.4, top + 0.15, -L * t + 0.4);
        c.add(r1, r2);
      }
      // The bracket is modelled for the (+x, +z) corner; mirror it for the others.
      c.scale.set(sx, 1, sz);
      c.position.set((sx * W) / 2, 0, (sz * (D + 1.5)) / 2);
      g.add(c);
    }
  return shadowed(g, true, true);
}

/** A knife-cut decal lying on the table. */
export function carvedMark(kind: 'tally' | 'rune', size: number): THREE.Mesh {
  const t = T.carving(kind);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/** A dagger stuck point-first in the table. */
export function dagger(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Shape();
  blade.moveTo(0, 0);
  blade.lineTo(0.75, 2.2);
  blade.lineTo(0.95, 12.5);
  blade.lineTo(0.7, 13.6);
  blade.lineTo(-0.7, 13.6);
  blade.lineTo(-0.95, 12.5);
  blade.lineTo(-0.75, 2.2);
  blade.closePath();
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.22, bevelSegments: 2 });
  bg.translate(0, 0, -0.06);
  g.add(new THREE.Mesh(bg, M.steel));
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.28, 8.5, 0.32), new THREE.MeshStandardMaterial({ color: 0xa8acb4, metalness: 0.9, roughness: 0.45 }));
  fuller.position.y = 8.4;
  g.add(fuller);
  const guard = new THREE.Mesh(new RoundedBoxGeometry(6, 0.8, 1.1, 2, 0.3), M.ironH);
  guard.position.y = 14;
  g.add(guard);
  for (const x of [-3.1, 3.1]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), M.brass);
    knob.position.set(x, 14, 0);
    g.add(knob);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 6.6, 14), new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.8 }));
  grip.position.y = 17.7;
  g.add(grip);
  const cord = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.75 });
  const wrap = new THREE.TorusGeometry(0.56, 0.14, 6, 18);
  for (let i = 0; i < 13; i++) {
    const r = new THREE.Mesh(wrap, cord);
    r.rotation.x = Math.PI / 2 + 0.18;
    r.position.y = 14.9 + i * 0.47;
    g.add(r);
  }
  const pommel = new THREE.Mesh(lathe([[0, 0], [0.6, 0.1], [1, 0.6], [0.9, 1.3], [0.4, 1.7], [0, 1.75]], 18), M.brass);
  pommel.position.y = 20.9;
  g.add(pommel);
  // Sunk 2cm into the wood, leaning away from you.
  g.position.y = -2;
  // A glint that runs down the blade when it's touched.
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow('rgba(255,255,255,1)', 'rgba(200,225,255,.35)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  glint.scale.set(4, 4, 1);
  g.add(glint);
  const holder = new THREE.Group();
  holder.add(g);
  holder.userData.glint = (k: number) => {
    // k: 0..1 along the blade, from the guard to the tip.
    glint.position.set(0, 13 - k * 12, 0.3);
    glint.material.opacity = k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI);
    glint.scale.setScalar(3 + Math.sin(k * Math.PI) * 3);
  };
  g.rotation.set(-0.32, 0.5, 0.12);
  return shadowed(holder);
}

/** The opponent's high-backed oak chair, pulled up to the far side of the table. */
export function chair(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const wood = plankMaterial(M, 6, true, 0.15, 0.35);
  const dark = wood.clone();
  dark.color = new THREE.Color(0x8a6a50);
  const seatY = -34;
  const seat = new THREE.Mesh(new RoundedBoxGeometry(46, 4, 44, 3, 1), wood);
  seat.position.y = seatY;
  g.add(seat);
  const legGeo = new RoundedBoxGeometry(4.2, 46, 4.2, 2, 0.8);
  for (const [x, z] of [[-20, -18], [20, -18], [-20, 18], [20, 18]]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(x, -80 + 23, z);
    g.add(leg);
  }
  for (const z of [-18, 18]) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 40, 10), dark);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, -66, z);
    g.add(rung);
  }
  // Back posts with turned finials, a carved top rail and slats. The back is on the far side (-z).
  for (const x of [-20.5, 20.5]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(4.6, 82, 4.6, 2, 0.9), dark);
    post.position.set(x, seatY + 39, -19.5);
    post.rotation.x = -0.08;
    const fin = new THREE.Mesh(lathe([[0, 0], [2.2, 0.4], [2.4, 1.6], [1.4, 2.6], [1.9, 4], [1.2, 5.6], [0, 6.2]], 16), dark);
    fin.position.set(x, seatY + 80, -22.8);
    g.add(post, fin);
  }
  const rail = new THREE.Mesh(new RoundedBoxGeometry(41, 8, 3.2, 3, 1.2), wood);
  rail.position.set(0, seatY + 70, -22);
  rail.rotation.x = -0.08;
  const rail2 = new THREE.Mesh(new RoundedBoxGeometry(41, 4, 2.6, 2, 0.8), wood);
  rail2.position.set(0, seatY + 22, -20.2);
  rail2.rotation.x = -0.08;
  g.add(rail, rail2);
  for (const x of [-10, 0, 10]) {
    const slat = new THREE.Mesh(new RoundedBoxGeometry(5, 44, 1.6, 2, 0.6), wood);
    slat.position.set(x, seatY + 46, -21.2);
    slat.rotation.x = -0.08;
    g.add(slat);
  }
  // A worn red cushion on the seat.
  const cushion = new THREE.Mesh(new RoundedBoxGeometry(40, 4, 38, 4, 1.8), new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.95 }));
  cushion.position.set(0, seatY + 3.6, 1);
  cushion.scale.y = 0.9;
  g.add(cushion);
  return shadowed(g);
}

/** An oak barrel with iron hoops. */
export function barrel(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const prof: number[][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    prof.push([18 + Math.sin(t * Math.PI) * 4, t * 60]);
  }
  const staves = plankMaterial(M, 2, true, 0.2, 0.5);
  staves.map!.repeat.set(1, 3);
  const body = new THREE.Mesh(lathe(prof, 22), staves);
  g.add(body);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(18.6, 22), plankMaterial(M, 3, false, 0.1, 0.2));
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = 58.6;
  g.add(lid);
  for (const t of [0.08, 0.3, 0.7, 0.92]) {
    const r = 18 + Math.sin(t * Math.PI) * 4 + 0.3;
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2.6, 30, 1, true), M.ironH);
    hoop.position.y = t * 60;
    g.add(hoop);
  }
  return shadowed(g);
}

/** Glass inkwell with a brass collar and a goose quill. */
export function inkwell(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.85 });
  const bottle = new THREE.Mesh(lathe([[0, 0], [2.8, 0], [3.2, 0.4], [3.3, 2.6], [2.6, 3.6], [1.3, 4.1], [1.25, 4.6], [0, 4.6]], 32), glass);
  g.add(bottle);
  const ink = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 2.2, 32), new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.1 }));
  ink.position.y = 1.3;
  g.add(ink);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.5, 0.8, 24, 1, true), M.brass);
  collar.position.y = 4.5;
  g.add(collar);
  // The quill: a shaft and a vane, leaning out of the neck.
  const q = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 20, 8), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 }));
  shaft.position.y = 10;
  q.add(shaft);
  const vaneShape = new THREE.Shape();
  vaneShape.moveTo(0, 6);
  vaneShape.bezierCurveTo(1.8, 9, 1.9, 15, 0.2, 20.4);
  vaneShape.lineTo(0, 20);
  vaneShape.bezierCurveTo(-1.1, 15, -1.2, 10, 0, 6);
  const cv = T.canvas(64, 256);
  const cx = cv.getContext('2d')!;
  cx.fillStyle = '#f4ecdc';
  cx.fillRect(0, 0, 64, 256);
  cx.strokeStyle = 'rgba(120,100,80,.35)';
  for (let y = 0; y < 256; y += 3) {
    cx.beginPath();
    cx.moveTo(32, y);
    cx.lineTo(0, y - 18);
    cx.moveTo(32, y);
    cx.lineTo(64, y - 18);
    cx.stroke();
  }
  const vaneMat = new THREE.MeshStandardMaterial({ map: T.tex(cv), roughness: 0.85, side: THREE.DoubleSide });
  const vg = new THREE.ShapeGeometry(vaneShape, 12);
  // ShapeGeometry UVs are in shape units; squeeze them into 0..1.
  const uv = vg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4 + 0.5, uv.getY(i) / 21);
  const vane = new THREE.Mesh(vg, vaneMat);
  vane.rotation.y = 0.4;
  q.add(vane);
  q.position.set(0.3, 1.5, 0);
  q.rotation.set(0.1, 0, -0.42);
  g.add(q);
  shadowed(g);
  bottle.castShadow = true;
  return g;
}

// ------------------------------------------------------------------ the room
/** Stone floor, a back wall with timber framing, a hearth with burning logs, and wall sconces. */
export function room(M: Mats): { group: THREE.Group; fires: Flicker[] } {
  const g = new THREE.Group();
  const fl = T.stone(5);
  fl.map.repeat.set(9, 9);
  fl.normalMap.repeat.set(9, 9);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughness: 0.92, color: 0x7a6a5c }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -80;
  floor.receiveShadow = true;
  g.add(floor);
  const w = T.stone(17);
  w.map.repeat.set(7, 2.4);
  w.normalMap.repeat.set(7, 2.4);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(800, 260), new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughness: 0.95, color: 0x8a7866 }));
  back.position.set(0, 40, -210);
  g.add(back);
  const timber = plankMaterial(M, 4, false, 0.2, 0.6);
  for (const x of [-190, -60, 190]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(12, 260, 10), timber);
    post.position.set(x, 40, -204);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(800, 12, 12), timber);
  beam.position.set(0, 122, -203);
  g.add(beam);
  // hearth
  const hx = 40;
  const arch = new THREE.Mesh(new THREE.BoxGeometry(96, 76, 16), new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, color: 0x6a5a4c, roughness: 0.95 }));
  arch.position.set(hx, -24, -200);
  g.add(arch);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(62, 48), new THREE.MeshBasicMaterial({ color: 0x0a0402 }));
  mouth.position.set(hx, -34, -191.9);
  g.add(mouth);
  const fire = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 50),
    new THREE.MeshBasicMaterial({ map: T.glow('rgba(255,236,180,1)', 'rgba(255,110,30,.85)', 256), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fire.position.set(hx, -40, -191.5);
  g.add(fire);
  const logMat = new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 1, emissive: 0xff4a10, emissiveIntensity: 0.25 });
  for (const [dx, rz] of [[-8, 0.15], [7, -0.2], [0, 0]]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 32, 12), logMat);
    log.rotation.z = Math.PI / 2 + rz;
    log.position.set(hx + dx, -52 + (dx === 0 ? 4.5 : 0), -196);
    g.add(log);
  }
  const mantle = new THREE.Mesh(new THREE.BoxGeometry(110, 6, 22), timber);
  mantle.position.set(hx, 16, -198);
  g.add(mantle);
  const fireLight = new THREE.PointLight(0xff6a20, 30000, 0, 2);
  fireLight.position.set(hx, -26, -165);
  g.add(fireLight);
  const fires: Flicker[] = [{ light: fireLight, base: 30000 }];
  const flame = T.flameTex();
  const halo = T.glow('rgba(255,210,140,.6)', 'rgba(255,140,50,.18)');
  for (const x of [-260, -120, 120, 260]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1, 16), M.iron);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(x, 50, -208);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 8, 8), M.iron);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(x, 50, -204);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.6, 2, 16), M.iron);
    cup.position.set(x, 52, -200);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    f.scale.set(3, 6, 1);
    f.position.set(x, 56.5, -200);
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    h.scale.set(40, 40, 1);
    h.position.set(x, 56, -199);
    const l = new THREE.PointLight(0xff9a40, 16000, 0, 2);
    l.position.set(x, 56, -192);
    g.add(plate, arm, cup, f, h, l);
    fires.push({ light: l, base: 16000 });
  }
  return { group: g, fires };
}

// ------------------------------------------------------------------ light props
function flameSprites(scale: number) {
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flame.scale.set(1.5 * scale, 3 * scale, 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow('rgba(255,220,150,.55)', 'rgba(255,160,60,.18)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  return { flame, halo };
}

/** Pillar candle on an iron dish, with drips and a flickering flame that lights the table. */
export function candle(M: Mats): { group: THREE.Group; flicker: Flicker } {
  const g = new THREE.Group();
  const N = makeNoise(5);
  const wax = new THREE.MeshPhysicalMaterial({ color: 0xe6d3ab, roughness: 0.62, sheen: 0.5, sheenColor: new THREE.Color(0xffe2b0), emissive: 0x2a1404, emissiveIntensity: 0.18 });
  // Light from the flame glows through the top of the wax.
  const glowCv = T.canvas(4, 128);
  const gctx = glowCv.getContext('2d')!;
  const gg = gctx.createLinearGradient(0, 0, 0, 128);
  gg.addColorStop(0, '#c88040');
  gg.addColorStop(0.1, '#5a3010');
  gg.addColorStop(0.3, '#000000');
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, 4, 128);
  const bodyWax = wax.clone();
  bodyWax.emissive = new THREE.Color(0xff8a30);
  bodyWax.emissiveIntensity = 0.7;
  bodyWax.emissiveMap = new THREE.CanvasTexture(glowCv);
  g.add(new THREE.Mesh(lathe([[0, 0], [5.6, 0], [6.4, 0.5], [6.6, 1.1], [6.1, 1.2], [5.6, 0.6], [0, 0.55]]), M.iron));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.35, 12, 24), M.iron);
  handle.position.set(7.2, 0.75, 0);
  handle.rotation.x = Math.PI / 2;
  g.add(handle);
  const body = new THREE.CylinderGeometry(2.3, 2.45, 10, 40, 12, true);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + N.noise(Math.atan2(z, x) * 2, y * 0.3) * 0.04;
    p.setXYZ(i, x * k, y, z * k);
  }
  body.computeVertexNormals();
  const bm = new THREE.Mesh(body, bodyWax);
  bm.position.y = 5.6;
  g.add(bm);
  const top = new THREE.Mesh(lathe([[0, -0.6], [1.6, -0.45], [2.25, 0], [2.4, 0.15], [2.45, -0.1]]), new THREE.MeshPhysicalMaterial({ color: 0xe9d8b2, roughness: 0.4, emissive: 0x6a3410, emissiveIntensity: 0.6 }));
  top.position.y = 10.6;
  g.add(top);
  const R = rng(9);
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    const len = 1.2 + R() * 3.8;
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.3 + R() * 0.15, len, 6, 10), wax);
    d.position.set(Math.cos(a) * 2.3, 10.1 - len / 2, Math.sin(a) * 2.3);
    d.rotation.y = -a;
    d.scale.set(0.55, 1, 1);
    g.add(d);
  }
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  wick.position.y = 10.6;
  g.add(wick);
  const { flame, halo } = flameSprites(1);
  flame.position.y = 12.2;
  halo.scale.set(14, 14, 1);
  halo.position.y = 12;
  g.add(flame, halo);
  const light = new THREE.PointLight(0xffa850, 650, 0, 2);
  light.position.y = 13;
  g.add(light);
  shadowed(g);
  flame.castShadow = halo.castShadow = false;
  // Burning down over the match (0 = new, 1 = a stub): everything at the top moves down; the light stays as bright.
  const drips = g.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.CapsuleGeometry);
  const dripY = drips.map((d) => d.position.y);
  g.userData.burn = (f: number) => {
    const h = 10 * (1 - 0.68 * Math.max(0, Math.min(1, f)));
    const drop = 10 - h;
    bm.scale.y = h / 10;
    bm.position.y = 0.6 + h / 2;
    top.position.y = wick.position.y = 10.6 - drop;
    flame.position.y = 12.2 - drop;
    halo.position.y = 12 - drop;
    light.position.y = 13 - drop;
    drips.forEach((d, i) => {
      d.position.y = dripY[i] - drop;
      d.visible = d.position.y > 1.6;
    });
  };
  return { group: g, flicker: { light, flame, halo, base: 650 } };
}

/** Iron oil lantern with glass panes and a steady flame inside. */
export function lantern(M: Mats): { group: THREE.Group; flicker: Flicker } {
  const g = new THREE.Group();
  const s = 6.2;
  const base = new THREE.Mesh(new RoundedBoxGeometry(s + 1.2, 1.2, s + 1.2, 2, 0.2), M.iron);
  base.position.y = 0.6;
  g.add(base);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffe2b0, roughness: 0.08, transparent: true, opacity: 0.22, depthWrite: false, emissive: 0xff9a40, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const pane = new THREE.Mesh(new THREE.BoxGeometry(s, 10, s), glass);
  pane.position.y = 6.2;
  g.add(pane);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 10.5, 0.55), M.iron);
    bar.position.set((x * s) / 2, 6.2, (z * s) / 2);
    g.add(bar);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(s * 0.82, 4, 4), M.iron);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 13.2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 1.4, 16), M.iron);
  cap.position.y = 15.6;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.28, 10, 24), M.iron);
  ring.position.y = 17.6;
  const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 2.4, 16), M.brass);
  burner.position.y = 2.4;
  g.add(roof, cap, ring, burner);
  const { flame, halo } = flameSprites(1.2);
  flame.position.y = 5.2;
  flame.renderOrder = 2;
  halo.scale.set(20, 20, 1);
  halo.position.y = 6;
  halo.renderOrder = 3;
  g.add(flame, halo);
  const light = new THREE.PointLight(0xffb060, 1100, 0, 2);
  light.position.y = 6.5;
  g.add(light);
  shadowed(g);
  pane.castShadow = false;
  flame.castShadow = halo.castShadow = false;
  return { group: g, flicker: { light, flame, halo, base: 1100, steady: true } };
}

// ------------------------------------------------------------------ drinks
let foamTex: ReturnType<typeof T.foamTexture> | null = null;

/**
 * A head of beer: a domed, bubbly foam (slightly over the rim), breathing gently, with little bubbles that keep
 * rising to the surface and popping. Sets userData.tick on the cup.
 */
function foam(g: THREE.Group, y: number, r: number, seed: number) {
  foamTex ??= T.foamTexture();
  const N = makeNoise(seed);
  const foamMat = new THREE.MeshPhysicalMaterial({ map: foamTex.map, normalMap: foamTex.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.82, sheen: 0.6, sheenColor: new THREE.Color(0xfff6e0), color: 0xfff8ee });
  const geo = new THREE.SphereGeometry(r * 1.04, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const yy = p.getY(i);
    // Lumpy, rising a little higher in the middle, spilling slightly at the rim.
    const lump = 1 + N.fbm(x * 0.6, z * 0.6, 3) * 0.25;
    p.setY(i, yy * 0.42 * lump);
  }
  geo.computeVertexNormals();
  const head = new THREE.Mesh(geo, foamMat);
  head.position.y = y - 0.15;
  g.add(head);
  // Bubbles on the surface: they swell, then pop and come back somewhere else.
  const R = rng(seed);
  const n = 26;
  const bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xfffbf2, roughness: 0.15, transmission: 0.3, transparent: true, opacity: 0.85, clearcoat: 1 });
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bubbleMat, n);
  const state = Array.from({ length: n }, () => ({ a: R() * Math.PI * 2, d: Math.sqrt(R()) * (r - 0.4), phase: R(), speed: 0.25 + R() * 0.5, size: 0.12 + R() * 0.22 }));
  const m = new THREE.Matrix4();
  const place = (t: number) => {
    state.forEach((b, i) => {
      const k = (t * b.speed + b.phase) % 1;
      // Grow for most of the cycle, then pop.
      const sc = k < 0.85 ? b.size * Math.sin((k / 0.85) * Math.PI * 0.5) : 0.0001;
      if (k > 0.99) {
        b.a = R() * Math.PI * 2;
        b.d = Math.sqrt(R()) * (r - 0.4);
      }
      const h = Math.max(0, 1 - (b.d / r) ** 2);
      m.compose(new THREE.Vector3(Math.cos(b.a) * b.d, head.position.y + r * 0.42 * Math.sqrt(h) + sc * 0.3, Math.sin(b.a) * b.d), new THREE.Quaternion(), new THREE.Vector3(sc, sc * 0.8, sc));
      bubbles.setMatrixAt(i, m);
    });
    bubbles.instanceMatrix.needsUpdate = true;
  };
  place(0);
  g.add(bubbles);
  g.userData.tick = (t: number) => {
    head.scale.y = 1 + Math.sin(t * 0.9) * 0.025;
    place(t);
  };
}

/** Hammered pewter tankard with a foam head and its hinged lid flipped open. */
export function tankard(M: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[0, 0], [4.3, 0], [4.55, 0.35], [4.3, 0.8], [4.0, 1.2], [3.85, 9.8], [4.15, 10.3], [4.2, 10.8], [3.95, 10.9], [3.7, 10.3], [3.7, 1.4], [0, 1.4]]), M.pewterH));
  for (const y of [2.4, 8.6]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(3.93, 0.16, 8, 48), M.pewter);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(3.9, 9, 0), new THREE.Vector3(6.8, 9.2, 0), new THREE.Vector3(7.6, 6.2, 0), new THREE.Vector3(6.4, 3.2, 0), new THREE.Vector3(3.9, 2.6, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.62, 12), M.pewter));
  // Hinge on top of the handle, and the lid swung back past upright.
  const post = new THREE.Mesh(new RoundedBoxGeometry(1, 2.2, 1.4, 2, 0.3), M.pewter);
  post.position.set(4.7, 10.2, 0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 14), M.pewter);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(4.7, 11.3, 0);
  g.add(post, barrel);
  const pivot = new THREE.Group();
  pivot.position.set(4.7, 11.3, 0);
  const lid = new THREE.Mesh(lathe([[0, 0.95], [1.4, 0.92], [2.8, 0.7], [3.9, 0.35], [4.35, 0.12], [4.4, 0], [0, 0]], 40), M.pewterH);
  lid.position.set(-4.5, -0.2, 0);
  const knob = new THREE.Mesh(lathe([[0, 0], [0.5, 0.2], [0.55, 0.7], [0.3, 1.2], [0.42, 1.5], [0, 1.9]], 14), M.pewter);
  knob.position.set(-4.5, 0.7, 0);
  const thumb = new THREE.Mesh(lathe([[0, 0], [0.45, 0.3], [0.6, 1], [0.35, 1.6], [0, 1.8]], 14), M.pewter);
  thumb.position.set(0.5, 0.2, 0);
  thumb.rotation.z = -0.5;
  pivot.add(lid, knob, thumb);
  pivot.rotation.z = -1.6;
  g.add(pivot);
  foam(g, 10.5, 3.95, 4);
  return shadowed(g);
}

/** Oak stein with iron hoops. */
export function stein(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const wood = plankMaterial(M, 5, true, 0.2, 0.3);
  g.add(new THREE.Mesh(lathe([[0, 0], [4.4, 0], [4.4, 0.6], [4.0, 10.6], [3.7, 10.6], [3.9, 1.4], [0, 1.4]], 18), wood));
  for (const y of [1.6, 9.2]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(y < 5 ? 4.36 : 4.08, 0.32, 8, 48), M.iron);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(4, 8.6, 0), new THREE.Vector3(7.2, 8.4, 0), new THREE.Vector3(7.6, 5.2, 0), new THREE.Vector3(4.2, 3.2, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.85, 10), wood));
  foam(g, 10.4, 3.9, 8);
  return shadowed(g);
}

// ------------------------------------------------------------------ table dressing
/** Leather (or carved oak) deck box with a brass clasp; the leather one is stitched and strapped. */
export function deckBox(M: Mats, kind: 'leather' | 'carved'): THREE.Group {
  const g = new THREE.Group();
  let mat: THREE.MeshStandardMaterial;
  if (kind === 'leather') {
    const L = T.leather({ w: 256, h: 256, seed: 12, color: [92, 40, 22], creaseAmt: 0.6 });
    mat = new THREE.MeshStandardMaterial({ map: L.map, normalMap: L.normalMap, roughness: 0.7 });
  } else mat = plankMaterial(M, 2, false, 0.3, 0.12);
  const box = new THREE.Mesh(new RoundedBoxGeometry(7.6, 10.2, 5.2, 4, 0.55), mat);
  box.position.y = 5.1;
  const seam = new THREE.Mesh(new THREE.BoxGeometry(7.66, 0.12, 5.26), new THREE.MeshStandardMaterial({ color: 0x140804, roughness: 1 }));
  seam.position.y = 8.2;
  const clasp = new THREE.Mesh(new RoundedBoxGeometry(1.4, 2.2, 0.4, 2, 0.12), M.brass);
  clasp.position.set(0, 8.2, 2.7);
  const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), M.gold);
  rivet.position.set(0, 7.6, 2.95);
  g.add(box, seam, clasp, rivet);
  if (kind === 'carved') {
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.4, 0.18, 80, 8, 2, 3), new THREE.MeshStandardMaterial({ color: 0x3a1c08, roughness: 0.8 }));
    knot.position.set(0, 4.6, 2.62);
    knot.scale.z = 0.25;
    g.add(knot);
    return shadowed(g);
  }
  // Tooled emblem on the front, picked out with a gilt ring.
  const tooled = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ map: mat.map, normalMap: T.tooledEmblem(), normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  tooled.position.set(0, 4.6, 2.605);
  const emb = new THREE.Mesh(new THREE.TorusGeometry(1.87, 0.08, 8, 48), M.gold);
  emb.position.set(0, 4.6, 2.64);
  g.add(tooled, emb);
  // A strap over the lid, buckled at the clasp.
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x3a180c, roughness: 0.65, normalMap: mat.normalMap });
  const s1 = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.16, 5.5, 1, 0.06), strapMat);
  s1.position.set(0, 10.24, 0);
  const s2 = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.1, 0.16, 1, 0.06), strapMat);
  s2.position.set(0, 9.3, 2.68);
  const s3 = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.6, 0.16, 1, 0.06), strapMat);
  s3.position.set(0, 9.0, -2.68);
  g.add(s1, s2, s3);
  // Saddle stitching along the edges and under the lid.
  const thread = new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.8 });
  const stitch = new THREE.CapsuleGeometry(0.05, 0.28, 2, 6);
  const runs: [THREE.Vector3, THREE.Vector3][] = [];
  const hx = 3.8 - 0.42;
  const hz = 2.6 + 0.01;
  for (const z of [hz, -hz]) {
    runs.push([new THREE.Vector3(-hx, 0.45, z), new THREE.Vector3(-hx, 7.8, z)], [new THREE.Vector3(hx, 0.45, z), new THREE.Vector3(hx, 7.8, z)]);
    runs.push([new THREE.Vector3(-hx, 7.82, z), new THREE.Vector3(hx, 7.82, z)]);
  }
  const placed: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [a, b] of runs) {
    const dir = b.clone().sub(a);
    const n = Math.floor(dir.length() / 0.55);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    for (let i = 0; i <= n; i++) placed.push(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, i / n), q, new THREE.Vector3(1, 1, 1)));
  }
  const im = new THREE.InstancedMesh(stitch, thread, placed.length);
  placed.forEach((m, i) => im.setMatrixAt(i, m));
  g.add(im);
  return shadowed(g);
}

/** Leather coin pouch with spilled gold coins. */
export function coinPouch(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const N = makeNoise(3);
  const L = T.leather({ w: 256, h: 256, seed: 6, color: [120, 82, 46], creaseAmt: 1.4 });
  const mat = new THREE.MeshStandardMaterial({ map: L.map, normalMap: L.normalMap, roughness: 0.75 });
  const geo = new THREE.SphereGeometry(4.6, 48, 32);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const k = 1 + N.fbm(x * 0.35, z * 0.35 + y * 0.2, 3) * 0.18;
    y = y < 0 ? y * 0.55 : y * 0.85;
    x *= k * (1 + Math.max(0, -y) * 0.04);
    z *= k;
    if (y > 2.5) {
      const t = (y - 2.5) / 1.4;
      x *= 1 - t * 0.55;
      z *= 1 - t * 0.55;
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const bag = new THREE.Mesh(geo, mat);
  bag.position.y = 2.6;
  // The bag is open: a ruffled leather lip folded back around the mouth, dark inside, coins showing.
  const lipPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    lipPts.push(new THREE.Vector2(1.9 + t * 1.3 + Math.sin(t * Math.PI) * 0.3, t * 1.7 - t * t * 0.5));
  }
  const lipGeo = new THREE.LatheGeometry(lipPts, 64);
  const lp = lipGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const z = lp.getZ(i);
    const yy = lp.getY(i);
    const a = Math.atan2(z, x);
    const rad = Math.hypot(x, z);
    // Gathered folds: the further out, the deeper the ruffle.
    const fold = Math.sin(a * 11) * 0.22 * (yy / 1.2) + N.noise(a * 3, yy) * 0.12;
    const k = (rad + fold) / rad;
    lp.setXYZ(i, x * k, yy + Math.sin(a * 11 + 1) * 0.15 * (yy / 1.2), z * k);
  }
  lipGeo.computeVertexNormals();
  const lipMat = mat.clone();
  lipMat.side = THREE.DoubleSide;
  const lip = new THREE.Mesh(lipGeo, lipMat);
  lip.position.y = 6.2;
  const inside = new THREE.Mesh(new THREE.CircleGeometry(2.05, 32), new THREE.MeshStandardMaterial({ color: 0x2a1609, roughness: 1 }));
  inside.rotation.x = -Math.PI / 2;
  inside.position.y = 6.25;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.2, 8, 40), new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.8 }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 6.25;
  g.add(bag, lip, inside, tie);
  // Coins heaped in the mouth of the bag.
  const heapGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.18, 24);
  const HR = rng(17);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(heapGeo, M.coin);
    const a = HR() * Math.PI * 2;
    const d = HR() * 1.1;
    c.position.set(Math.cos(a) * d, 6.35 + HR() * 0.6 + (1.1 - d) * 0.3, Math.sin(a) * d);
    c.rotation.set((HR() - 0.5) * 1.1, HR() * 6, (HR() - 0.5) * 1.1);
    g.add(c);
  }
  // Drawstrings hanging from the knot, with knotted ends.
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xb8925e, roughness: 0.85 });
  for (const [dx, dz, len] of [[1, 0.4, 1], [0.6, -0.9, 0.8]]) {
    const pts = [new THREE.Vector3(2.0 * dx, 6.3, 2.0 * dz), new THREE.Vector3(2.9 * dx, 6.0, 2.7 * dz), new THREE.Vector3(3.6 * dx, 4.6 * len + 1, 3.6 * dz), new THREE.Vector3(4.4 * dx, 2.2 * len + 1.2, 4.6 * dz)];
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.13, 6), cordMat));
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), cordMat);
    knot.position.copy(pts[3]);
    g.add(knot);
  }
  // Spilled coins, struck with a crown, and a short stack.
  const coinGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.18, 28);
  const R = rng(2);
  for (let i = 0; i < 11; i++) {
    const c = new THREE.Mesh(coinGeo, M.coin);
    const a = -0.6 + R() * 1.6;
    const r = 5 + R() * 3.5;
    c.position.set(Math.cos(a) * r, 0.1 + (i % 3) * 0.19, Math.sin(a) * r);
    c.rotation.set((R() - 0.5) * 0.25, R() * 3, (R() - 0.5) * 0.25);
    g.add(c);
  }
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(coinGeo, M.coin);
    c.position.set(-6 + (R() - 0.5) * 0.25, 0.1 + i * 0.19, 3.5 + (R() - 0.5) * 0.25);
    c.rotation.y = R() * 6;
    g.add(c);
  }
  return shadowed(g);
}

/** Hourglass: oak caps, turned posts, glass bulbs and sand. */
export function hourglass(M: Mats): THREE.Group {
  const g = new THREE.Group();
  const wood = plankMaterial(M, 6, true, 0.1, 0.1);
  for (const y of [0.6, 13.4]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 1.2, 6), wood);
    cap.position.y = y;
    g.add(cap);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const post = new THREE.Mesh(lathe([[0.4, 0], [0.55, 1], [0.35, 3], [0.6, 6], [0.35, 9], [0.55, 11.6], [0.4, 12.6]], 10), wood);
    post.position.set(Math.cos(a) * 3.2, 0.7, Math.sin(a) * 3.2);
    g.add(post);
  }
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xf6fbff, transmission: 1, roughness: 0.05, thickness: 0.3, ior: 1.5, transparent: true });
  const b = new THREE.Mesh(lathe([[0.2, 0], [2.4, 0.6], [2.8, 2.4], [2.2, 4.4], [0.45, 5.9], [0.45, 6.4], [2.2, 7.9], [2.8, 9.9], [2.4, 11.6], [0.2, 12.2]], 40), glass);
  b.position.y = 1.2;
  const sand = new THREE.MeshStandardMaterial({ color: 0xe0b866, roughness: 0.9 });
  const lower = new THREE.Mesh(lathe([[0, 0], [2.5, 0.2], [2.2, 1.2], [0.4, 2.8], [0, 3]], 30), sand);
  lower.position.y = 1.5;
  const upper = new THREE.Mesh(lathe([[0, 0], [0.35, 0.2], [2.1, 1.6], [2.5, 3.2], [0, 3.2]], 30), sand);
  upper.position.y = 7.6;
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), sand);
  stream.position.y = 5.9;
  g.add(b, lower, upper, stream);
  shadowed(g);
  b.castShadow = false;
  return g;
}

/** The Monarch's crown. */
export function crown(M: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[3.1, 0], [3.3, 0.2], [3.3, 1.6], [3.05, 1.8], [2.85, 1.6], [2.85, 0.2]], 48), M.gold));
  const gems = [0xd62a3a, 0x2a6ad6, 0x2ec4b6];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 4), M.gold);
    spike.position.set(Math.cos(a) * 3.05, 2.9, Math.sin(a) * 3.05);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), M.gold);
    ball.position.set(Math.cos(a) * 3.05, 4.3, Math.sin(a) * 3.05);
    g.add(spike, ball);
    if (i % 2 === 0) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshPhysicalMaterial({ color: gems[(i / 2) % 3], roughness: 0.05, clearcoat: 1, metalness: 0.1 }));
      gem.position.set(Math.cos(a) * 3.35, 0.9, Math.sin(a) * 3.35);
      gem.lookAt(Math.cos(a) * 10, 0.9, Math.sin(a) * 10);
      g.add(gem);
    }
  }
  g.rotation.z = 0.08;
  return shadowed(g);
}

/** Dice tray: oak frame with a felt bed. */
export function diceTray(M: Mats, feltColor: number[], w = 34, d = 12): THREE.Group {
  const g = new THREE.Group();
  const wood = plankMaterial(M, 1, false, 0.5, 0.18);
  const bed = new THREE.Mesh(new RoundedBoxGeometry(w - 2, 0.6, d - 2, 2, 0.2), new THREE.MeshStandardMaterial({ map: T.felt(feltColor), roughness: 1 }));
  bed.position.y = 0.3;
  g.add(bed);
  for (const [x, z, sw, sd] of [[0, -(d / 2) + 0.6, w, 1.2], [0, d / 2 - 0.6, w, 1.2], [-(w / 2) + 0.6, 0, 1.2, d], [w / 2 - 0.6, 0, 1.2, d]]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(sw, 1.8, sd, 2, 0.35), wood);
    rail.position.set(x, 0.9, z);
    g.add(rail);
  }
  return shadowed(g);
}

/** Rolled parchment. */
export function scroll(): THREE.Group {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshStandardMaterial({ map: T.parchment(), roughness: 0.85, side: THREE.DoubleSide }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.05;
  g.add(sheet);
  const rollMat = new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.8 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x5a3216, roughness: 0.6 });
  for (const x of [-7.2, 7.2]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7.4, 24), rollMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, 0.9, 0);
    g.add(r);
    for (const z of [-4.1, 4.1]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), knobMat);
      k.position.set(x, 0.9, z);
      g.add(k);
    }
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ dice
/** A glossy resin d20 whose top face shows a number (life total) that can be changed. */
export class D20 {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  private atlas: HTMLCanvasElement;
  private marble: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private rest = new THREE.Quaternion();
  private spin = 0;
  private baseY: number;
  value: number;

  constructor(color: number, value: number, size = 2.6, facing = new THREE.Vector3(0, 0.82, 0.57)) {
    this.value = value;
    const geo = new THREE.IcosahedronGeometry(size, 0);
    const cells = T.d20Cells(1280, 1024);
    const uv = new Float32Array(geo.attributes.position.count * 2);
    for (let f = 0; f < 20; f++) for (let v = 0; v < 3; v++) uv.set(cells[f][v], (f * 3 + v) * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    this.marble = T.resinCanvas(color, 640, 512, Math.round(color % 97));
    this.atlas = T.canvas(1280, 1024);
    T.paintD20(this.atlas, this.marble, value);
    this.texture = T.tex(this.atlas);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: this.texture, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.22 }));
    // Turn the die so face 0 points up toward the player, with the number upright.
    const pos = geo.attributes.position;
    const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
    const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const target = facing.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(n, target);
    const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const apex = a.clone().sub(centroid).applyQuaternion(q);
    const proj = (v: THREE.Vector3) => v.clone().sub(target.clone().multiplyScalar(v.dot(target))).normalize();
    const pa = proj(apex);
    const pw = proj(new THREE.Vector3(0, target.z, -target.y));
    let ang = Math.acos(THREE.MathUtils.clamp(pa.dot(pw), -1, 1));
    if (new THREE.Vector3().crossVectors(pa, pw).dot(target) < 0) ang = -ang;
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(target, ang));
    this.rest.copy(q);
    this.mesh.quaternion.copy(q);
    this.baseY = size * 0.8;
    this.mesh.position.y = this.baseY;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** Repaint the resin in a new color (your seat color). */
  recolor(color: number): void {
    this.marble = T.resinCanvas(color, 640, 512, Math.round(color % 97));
    T.paintD20(this.atlas, this.marble, this.value);
    this.texture.needsUpdate = true;
  }

  /** Show a new number; the die tumbles when it changes. */
  set(value: number, animate = true): void {
    if (value === this.value) return;
    this.value = value;
    T.paintD20(this.atlas, this.marble, value);
    this.texture.needsUpdate = true;
    if (animate) this.spin = 1;
  }

  /** Advance the tumble animation. Returns true while it is moving. */
  tick(dt: number): boolean {
    if (this.spin <= 0) return false;
    this.spin = Math.max(0, this.spin - dt * 1.6);
    const t = this.spin;
    const wobble = new THREE.Quaternion().setFromEuler(new THREE.Euler(t * t * 9, t * 6, t * t * 4));
    this.mesh.quaternion.copy(this.rest).multiply(wobble);
    this.mesh.position.y = this.baseY + Math.sin(t * Math.PI) * 3;
    if (t === 0) {
      this.mesh.quaternion.copy(this.rest);
      this.mesh.position.y = this.baseY;
    }
    return true;
  }
}

/** A d6 with a number on top (commander damage, counters). */
export class D6 {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private mats: THREE.MeshPhysicalMaterial[];
  private color: number;
  value: number;

  constructor(color: number, value: number, size = 1.9) {
    this.color = color;
    this.value = value;
    // BoxGeometry face order: +x, -x, +y (top), -y, +z (front), -z
    const nums = [3, 4, value, 0, 2, 5];
    this.mats = nums.map((v) => new THREE.MeshPhysicalMaterial({ map: T.d6Face(color, v || ''), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }));
    this.mesh = new THREE.Mesh(new RoundedBoxGeometry(size, size, size, 4, size * 0.16), this.mats);
    this.mesh.position.y = size / 2;
    this.mesh.rotation.y = 0.35;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
  }

  set(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.mats[2].map?.dispose();
    this.mats[2].map = T.d6Face(this.color, value);
    this.mats[2].needsUpdate = true;
  }
}

/** A commander portrait in a gold frame on a small stand. */
export function medallion(M: Mats, artUrl: string | null): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.55 });
  if (artUrl) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(artUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      // Crop the art to a square around its centre.
      const img = t.image as HTMLImageElement;
      const aspect = img.width / img.height;
      t.repeat.set(aspect > 1 ? 1 / aspect : 1, aspect > 1 ? 1 : aspect);
      t.offset.set((1 - t.repeat.x) / 2, (1 - t.repeat.y) / 2);
      face.map = t;
      face.color.set(0xffffff);
      face.needsUpdate = true;
    });
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4.1, 48), face);
  disc.position.set(0, 6.6, 0.42);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.7, 48), M.gold);
  back.rotation.x = Math.PI / 2;
  back.position.set(0, 6.6, 0);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.36, 12, 64), M.gold);
  rim.position.set(0, 6.6, 0.42);
  const foot = new THREE.Mesh(lathe([[0, 0], [3.2, 0], [3, 0.6], [1, 1.4], [0.7, 2.6], [0, 2.6]], 32), M.gold);
  g.add(disc, back, rim, foot);
  // Lean back a little, toward the light and the player.
  g.children.forEach((c) => {
    if (c !== foot) {
      c.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.25);
      c.rotation.x += -0.25;
    }
  });
  return shadowed(g);
}
