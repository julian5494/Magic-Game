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
  return {
    oak: T.oakAtlas(),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b2724, metalness: 0.85, roughness: 0.55 }),
    pewter: new THREE.MeshStandardMaterial({ color: 0xa7adb5, metalness: 1, roughness: 0.32 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a948, metalness: 1, roughness: 0.28 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8893c, metalness: 1, roughness: 0.4 }),
  };
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
function foam(g: THREE.Group, y: number, r: number, seed: number) {
  const foamMat = new THREE.MeshPhysicalMaterial({ color: 0xfbf2de, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xffffff) });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), foamMat);
  cap.scale.y = 0.32;
  cap.position.y = y;
  g.add(cap);
  const R = rng(seed);
  const bub = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 32; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * (r - 0.3);
    const b = new THREE.Mesh(bub, foamMat);
    b.scale.setScalar(0.35 + R() * 0.45);
    b.scale.y *= 0.6;
    b.position.set(Math.cos(a) * d, y + 0.45 + (1 - d / r) * 0.9, Math.sin(a) * d);
    g.add(b);
  }
}

/** Pewter tankard with a foam head. */
export function tankard(M: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[0, 0], [4.3, 0], [4.55, 0.35], [4.3, 0.8], [4.0, 1.2], [3.85, 9.8], [4.15, 10.3], [4.2, 10.8], [3.95, 10.9], [3.7, 10.3], [3.7, 1.4], [0, 1.4]]), M.pewter));
  for (const y of [2.4, 8.6]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(3.93, 0.16, 8, 48), M.pewter);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(3.9, 9, 0), new THREE.Vector3(6.8, 9.2, 0), new THREE.Vector3(7.6, 6.2, 0), new THREE.Vector3(6.4, 3.2, 0), new THREE.Vector3(3.9, 2.6, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.62, 12), M.pewter));
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
/** Leather (or carved oak) deck box with a brass clasp. */
export function deckBox(M: Mats, kind: 'leather' | 'carved'): THREE.Group {
  const g = new THREE.Group();
  let mat: THREE.Material;
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
  } else {
    const emb = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.09, 8, 40), M.gold);
    emb.position.set(0, 4.6, 2.62);
    g.add(emb);
  }
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
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 1.6, 20), mat);
  neck.position.y = 7.2;
  const ruff = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.6, 20, 1, true), mat);
  ruff.position.y = 8.4;
  ruff.rotation.x = Math.PI;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.22, 8, 30), new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.8 }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 7.1;
  g.add(bag, neck, ruff, tie);
  const coinGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.18, 28);
  const R = rng(2);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(coinGeo, M.gold);
    const a = -0.6 + R() * 1.6;
    const r = 5 + R() * 3.5;
    c.position.set(Math.cos(a) * r, 0.1 + (i % 3) * 0.19, Math.sin(a) * r);
    c.rotation.set((R() - 0.5) * 0.25, R() * 3, (R() - 0.5) * 0.25);
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
