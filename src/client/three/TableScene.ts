// The 3D tavern behind the board. The board itself stays real HTML (so clicks, drag & drop and arrows keep
// working); it is placed on the 3D table with CSS3DRenderer, which shares the WebGL camera.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import * as Mo from './models';
import { leatherGrainDataUrl } from './textures';

export type Quality = 'high' | 'low';
export type PropSet = 'candle' | 'lantern';

/** Size of the HTML board in CSS pixels; 10 px = 1 cm on the table. */
export const BOARD_W = 1800;
export const BOARD_H = 1040;
const PX = 0.1;
const TABLE_W = 212;
const TABLE_D = 132;
const TRAY_Z = 60;
const OPP_Z = -59;
const PITCH = (54 * Math.PI) / 180;
const FOV = 30;

export interface Anchor {
  x: number;
  y: number;
  r: number;
}
export interface Anchors {
  me?: Anchor;
  /** Where your die sits with the camera at rest (the hand is centred on this, so it doesn't sway). */
  home?: Anchor;
  opp?: Anchor;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class TableScene {
  private container: HTMLElement;
  private board: CSS3DObject;
  private renderer: THREE.WebGLRenderer;
  private css: CSS3DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1500);
  private composer: EffectComposer | null = null;
  private quality: Quality;
  private calm = false;
  private M!: Mo.Mats;
  private props: Record<string, THREE.Group> = {};
  private flickers: Mo.Flicker[] = [];
  private propFlicker: Record<string, Mo.Flicker> = {};
  private propSet: PropSet = 'candle';
  private myDie: Mo.D20 | null = null;
  private cmdGroup = new THREE.Group();
  private wear: THREE.Group | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private dirty = true;
  private disposed = false;
  private insets: Insets = { top: 70, bottom: 94, left: 40, right: 80 };
  private frameNo = 0;
  /** Called with the screen positions of the dice (for click/drop areas) whenever they move on screen. */
  onLayout: ((anchors: Anchors) => void) | null = null;
  private oppDie: Mo.D20 | null = null;
  private oppGroup = new THREE.Group();
  private oppArt = '';
  private oppDieColor = 0;
  private lastAnchors = '';
  private home: Anchor | null = null;
  // Camera: the framed pose, plus a gentle drift that follows the mouse.
  private basePos = new THREE.Vector3();
  private baseTarget = new THREE.Vector3();
  private mouse = new THREE.Vector2();
  private sway = new THREE.Vector2();

  constructor(container: HTMLElement, boardEl: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.className = 'table3d-canvas';
    this.css = new CSS3DRenderer();
    this.css.domElement.className = 'table3d-css';
    boardEl.style.width = `${BOARD_W}px`;
    boardEl.style.height = `${BOARD_H}px`;
    this.board = new CSS3DObject(boardEl);
    this.board.rotation.x = -Math.PI / 2;
    this.board.scale.setScalar(PX);
    this.board.position.set(0, 0.7, 0);
  }

  /** Build everything. Heavy texture work is spread over frames so the page stays responsive. */
  async build(): Promise<void> {
    const s = this.scene;
    s.background = new THREE.Color(0x070402);
    s.fog = new THREE.Fog(0x0d0805, 260, 620);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.22;
    pmrem.dispose();

    s.add(new THREE.HemisphereLight(0x6a5240, 0x0c0704, 0.32));
    const key = new THREE.SpotLight(0xffd6a6, 52000, 0, 0.68, 1, 2);
    key.position.set(-14, 175, 52);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.camera.near = 60;
    key.shadow.camera.far = 320;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x8a9cff, 0.35);
    rim.position.set(30, 60, -140);
    s.add(rim);
    await nextFrame();

    this.M = Mo.materials();
    await nextFrame();
    const room = Mo.room(this.M);
    s.add(room.group);
    this.flickers.push(...room.fires);
    await nextFrame();
    s.add(Mo.tavernTable(this.M, { W: TABLE_W, D: TABLE_D, rows: 8 }));
    await nextFrame();

    const candle = Mo.candle(this.M);
    const lantern = Mo.lantern(this.M);
    this.propFlicker = { candle: candle.flicker, lantern: lantern.flicker };
    this.props = {
      candle: candle.group,
      lantern: lantern.group,
      tankard: Mo.tankard(this.M),
      stein: Mo.stein(this.M),
      boxLeather: Mo.deckBox(this.M, 'leather'),
      boxCarved: Mo.deckBox(this.M, 'carved'),
      pouch: Mo.coinPouch(this.M),
      hourglass: Mo.hourglass(this.M),
      crown: Mo.crown(this.M),
      scroll: Mo.scroll(),
      trayRed: Mo.diceTray(this.M, [96, 24, 30], 46, 15),
      trayGreen: Mo.diceTray(this.M, [26, 70, 44], 46, 15),
    };
    const P = this.props;
    const hw = TABLE_W / 2;
    const hd = TABLE_D / 2;
    P.tankard.rotation.y = -0.5;
    P.stein.rotation.y = -0.6;
    for (const k of ['boxLeather', 'boxCarved']) P[k].rotation.y = 0.35;
    P.pouch.rotation.y = -0.4;
    P.scroll.rotation.y = 0.12;
    P.scroll.scale.setScalar(0.8);
    P.crown.visible = false;
    for (const k of ['trayRed', 'trayGreen']) P[k].position.set(0, 0.1, TRAY_Z);
    for (const p of Object.values(P)) s.add(p);
    await nextFrame();

    this.myDie = new Mo.D20(0x2ec4b6, 40, 3.9, new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH)));
    // The opponent across the table: their commander on a medallion and their own d20.
    this.oppDie = new Mo.D20(0x9b6cff, 40, 4.2, new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH)));
    this.oppDie.group.position.set(9, 0.1, OPP_Z);
    this.oppGroup.add(this.oppDie.group);
    this.oppGroup.visible = false;
    s.add(this.oppGroup);
    this.myDie.group.position.set(0, 0.7, TRAY_Z);
    this.cmdGroup.position.set(0, 0.7, TRAY_Z);
    s.add(this.myDie.group, this.cmdGroup);
    s.add(this.board);

    // The HTML playmats get the same pebbled leather grain.
    this.container.style.setProperty('--leather-grain', `url("${leatherGrainDataUrl(256, 4)}")`);
    this.applyProps();
    this.setupPost();
    this.container.appendChild(this.renderer.domElement);
    this.container.appendChild(this.css.domElement);
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.shadowMap.needsUpdate = true;
    this.loop();
  }

  private setupPost(): void {
    this.composer = null;
    if (this.quality !== 'high') return;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.6, 0.97));
    composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader:
          'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - .5; float v = smoothstep(.85, .25, length(d * vec2(1.15, 1.)) * .9); c.rgb *= mix(.5, 1., v); gl_FragColor = c; }',
      }),
    );
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  /** Space reserved by the HUD around the board (CSS px). */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.resize();
  }

  setCalm(calm: boolean): void {
    this.calm = calm;
    this.dirty = true;
  }

  setPropSet(set: PropSet): void {
    this.propSet = set;
    this.applyProps();
  }

  private applyProps(): void {
    const P = this.props;
    if (!P.candle) return;
    const a = this.propSet === 'candle';
    P.candle.visible = a;
    P.tankard.visible = a;
    P.boxLeather.visible = a;
    P.pouch.visible = a;
    P.trayRed.visible = a;
    P.lantern.visible = !a;
    P.stein.visible = !a;
    P.boxCarved.visible = !a;
    P.hourglass.visible = !a;
    P.scroll.visible = !a;
    P.trayGreen.visible = !a;
    for (const p of Object.values(P)) if (p.userData.offscreen) p.visible = false;
    this.propFlicker.candle.light.visible = a;
    this.propFlicker.lantern.light.visible = !a;
    if (this.wear) this.scene.remove(this.wear);
    const c = P.candle.position;
    const d = P.tankard.position;
    this.wear = Mo.tableWear({
      rings: [[d.x + 1, d.z + 3, 4.6], [d.x - 5, d.z + 5, 4.4]],
      burn: [c.x + 5, c.z + 3],
      wax: a ? [[c.x + 8, c.z + 5, 0.6], [c.x + 9.5, c.z + 2, 0.45], [c.x + 6, c.z + 8, 0.5]] : [],
    });
    this.scene.add(this.wear);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** Your life total on the d20 in the dice tray. */
  setLife(life: number): void {
    if (!this.myDie) return;
    this.myDie.set(life, this.lifeShown);
    this.lifeShown = true;
    this.dirty = true;
  }

  private dieColor = 0x2ec4b6;
  private lifeShown = false;
  private oppShown = '';
  setDieColor(color: number): void {
    if (!this.myDie || color === this.dieColor) return;
    this.dieColor = color;
    this.myDie.recolor(color);
    this.dirty = true;
  }

  /** The opponent across the table (life on their d20, commander art on the medallion), or nobody. */
  setOpponent(o: { id: string; life: number; color: number; art: string | null } | null): void {
    if (!this.oppDie || !this.M) return;
    this.oppGroup.visible = !!o;
    if (!o) this.oppShown = '';
    if (o) {
      if (o.color !== this.oppDieColor) {
        this.oppDieColor = o.color;
        this.oppDie.recolor(o.color);
      }
      // Tumble only when the same opponent's life changes, not when someone new sits across.
      this.oppDie.set(o.life, this.oppShown === o.id);
      this.oppShown = o.id;
      const art = o.art ?? '';
      if (art !== this.oppArt) {
        this.oppArt = art;
        const old = this.oppGroup.getObjectByName('medallion');
        if (old) this.oppGroup.remove(old);
        const med = Mo.medallion(this.M, art || null);
        med.name = 'medallion';
        med.position.set(-8, 0.1, OPP_Z - 1);
        med.scale.setScalar(1.35);
        this.oppGroup.add(med);
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** Pointer position over the window, -0.5..0.5 each way (drives the camera drift). */
  setPointer(x: number, y: number): void {
    this.mouse.set(x, y);
  }

  /** Commander damage you've taken, as d6s in the tray beside your d20 (up to four). */
  setCommanderDamage(list: { amount: number; color: number }[]): void {
    const shown = list.filter((d) => d.amount > 0).slice(0, 4);
    const key = shown.map((d) => `${d.color}:${d.amount}`).join('|');
    if (this.cmdGroup.userData.key === key) return;
    this.cmdGroup.userData.key = key;
    this.cmdGroup.clear();
    shown.forEach((d, i) => {
      const die = new Mo.D6(d.color, d.amount, 2.8);
      const side = i % 2 === 0 ? -1 : 1;
      die.group.position.set(side * (10 + Math.floor(i / 2) * 6), 0, (i % 3) * 0.6 - 0.6);
      die.group.rotation.y = side * 0.25;
      this.cmdGroup.add(die.group);
    });
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** Put the Monarch's crown by your tray ('me'), across the table ('across'), or away. */
  setMonarch(where: 'me' | 'across' | null): void {
    const c = this.props.crown;
    if (!c) return;
    c.visible = where !== null;
    if (where === 'me') c.position.set(33, 0.1, TRAY_Z - 1);
    if (where === 'across') c.position.set(34, 0.1, -TABLE_D / 2 + 7);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  private onVisibility = () => {
    if (!document.hidden) this.dirty = true;
  };

  /** Frame the camera so the board fits between the HUD insets at the current window size. */
  resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
    this.composer?.setSize(w, h);
    const cam = this.camera;
    cam.aspect = w / h;
    cam.fov = FOV;
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const bw = (BOARD_W * PX) / 2;
    const bd = (BOARD_H * PX) / 2;
    const corners = [
      new THREE.Vector3(-bw, 0, -bd),
      new THREE.Vector3(bw, 0, -bd),
      new THREE.Vector3(-bw, 0, bd),
      new THREE.Vector3(bw, 0, bd),
    ];
    const { top, bottom, left, right } = this.insets;
    const toNdcY = (px: number) => 1 - (2 * px) / h;
    const yTop = toNdcY(top);
    const yBottom = toNdcY(h - bottom);
    const xLeft = -1 + (2 * left) / w;
    const xRight = 1 - (2 * right) / w;
    const place = (d: number, tz: number) => {
      const target = new THREE.Vector3(0, 0, tz);
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      const p = corners.map((c) => c.clone().project(cam));
      const med = new THREE.Vector3(0, 14, OPP_Z).project(cam);
      return {
        top: Math.max(p[0].y, p[1].y, med.y),
        bottom: Math.min(p[2].y, p[3].y),
        xmin: Math.min(...p.map((q) => q.x)),
        xmax: Math.max(...p.map((q) => q.x)),
      };
    };
    // For a distance, slide the look-at point so the board's near edge sits on the bottom inset.
    const centred = (d: number) => {
      let lo = -120;
      let hi = 120;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const r = place(d, mid);
        // Moving the look-at point toward you raises the board on screen.
        if (r.bottom > yBottom) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    };
    cam.clearViewOffset();
    const halfBand = (xRight - xLeft) / 2;
    let lo = 60;
    let hi = 900;
    let best = hi;
    for (let i = 0; i < 26; i++) {
      const d = (lo + hi) / 2;
      const tz = centred(d);
      const r = place(d, tz);
      const fits = r.top <= yTop && r.xmax <= halfBand && r.xmin >= -halfBand;
      if (fits) {
        best = d;
        hi = d;
      } else lo = d;
    }
    place(best, centred(best));
    this.basePos.copy(cam.position);
    this.baseTarget.set(0, 0, centred(best));
    // Shift sideways so the board sits centred between the left and right insets.
    cam.setViewOffset(w, h, (right - left) / 2, 0, w, h);
    cam.updateProjectionMatrix();
    this.placeProps(w, h);
    const hp = new THREE.Vector3(0, 3.9, TRAY_Z).project(cam);
    this.home = { x: Math.round(((hp.x + 1) / 2) * w), y: Math.round(((1 - hp.y) / 2) * h), r: 0 };
    this.css.render(this.scene, cam);
    this.dirty = true;
    this.reportLayout();
  };

  /**
   * The HTML board is drawn over the 3D table, so props must stand where the board isn't:
   * the far corners beside the opponent's mat, and the near edge beside your dice tray.
   * Spots are chosen on screen and projected onto the table, so they stay visible at any window size.
   */
  private placeProps(w: number, h: number): void {
    const P = this.props;
    if (!P.candle) return;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hw = TABLE_W / 2 - 7;
    const hd = TABLE_D / 2 - 5;
    const spot = (fx: number, fy: number): THREE.Vector3 | null => {
      const ndc = new THREE.Vector2(fx * 2 - 1, 1 - fy * 2);
      ray.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.x = THREE.MathUtils.clamp(hit.x, -hw, hw);
      hit.z = THREE.MathUtils.clamp(hit.z, -hd, hd);
      hit.y = 0.1;
      return hit;
    };
    const put = (keys: string[], fx: number, fy: number) => {
      const at = spot(fx, fy);
      for (const k of keys) {
        if (!P[k]) continue;
        if (at) P[k].position.copy(at);
        P[k].userData.offscreen = !at;
      }
    };
    const l = (this.insets.left + 20) / w;
    const r = 1 - (this.insets.right + 30) / w;
    put(['candle', 'lantern'], l + 0.04, 0.24);
    put(['tankard', 'stein'], r - 0.04, 0.22);
    put(['scroll'], l + 0.17, 0.15);
    put(['boxLeather', 'boxCarved'], l + 0.12, 0.935);
    put(['pouch', 'hourglass'], 0.745, 0.935);
    this.applyProps();
  }

  private reportLayout(): void {
    if (!this.myDie || !this.onLayout) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const at = (x: number, y: number, z: number, size: number): Anchor => {
      const p = new THREE.Vector3(x, y, z).project(this.camera);
      const q = new THREE.Vector3(x + size, y, z).project(this.camera);
      return { x: Math.round(((p.x + 1) / 2) * w), y: Math.round(((1 - p.y) / 2) * h), r: Math.round(Math.abs(q.x - p.x) * (w / 2) * 1.3) };
    };
    const anchors: Anchors = { me: at(0, 3.9, TRAY_Z, 3.9), home: this.home ?? undefined };
    if (this.oppGroup.visible) anchors.opp = at(9, 4.2, OPP_Z, 4.2);
    const key = JSON.stringify(anchors);
    if (key === this.lastAnchors) return;
    this.lastAnchors = key;
    this.onLayout(anchors);
  }

  /** Ease the camera toward the mouse (and a slow idle drift). Returns true if it moved. */
  private moveCamera(t: number, dt: number): boolean {
    const cam = this.camera;
    const want = this.calm ? new THREE.Vector2(0, 0) : new THREE.Vector2(this.mouse.x + Math.sin(t * 0.15) * 0.06, this.mouse.y + Math.sin(t * 0.12 + 1) * 0.05);
    const before = this.sway.clone();
    // Time-based easing, so the drift feels the same at any frame rate.
    this.sway.lerp(want, 1 - Math.exp(-dt * 1.4));
    if (this.sway.distanceTo(before) < 0.0004 && !this.dirty) return false;
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
    cam.position.copy(this.basePos).addScaledVector(right, this.sway.x * 11).addScaledVector(up, -this.sway.y * 5);
    // Orbit around the middle of the table: near and far things shift against each other (parallax).
    cam.lookAt(this.baseTarget);
    cam.updateMatrixWorld();
    this.css.render(this.scene, cam);
    this.reportLayout();
    return true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.frameNo++;
    const dieMoving = (this.myDie?.tick(dt) ?? false) || (this.oppDie?.tick(dt) ?? false);
    const camMoved = this.moveCamera(t, dt);
    if (this.calm && !this.dirty && !dieMoving && !camMoved) return;
    // Lights flicker; the low setting redraws at half rate.
    if (this.quality === 'low' && !this.dirty && !dieMoving && !camMoved && this.frameNo % 2) return;
    if (!this.calm) {
      for (const f of [...this.flickers, this.propFlicker[this.propSet]]) {
        const n = Math.sin(t * 17 + f.base) * 0.5 + Math.sin(t * 29 + 1.3) * 0.3 + Math.sin(t * 7.3) * 0.2;
        const k = f.steady ? 1 + n * 0.05 : 1 + n * 0.14;
        f.light.intensity = f.base * k;
        if (f.flame) f.flame.scale.y = (f.steady ? 3.6 : 3) * k;
        if (f.halo) f.halo.material.opacity = 0.75 + n * 0.12;
      }
    }
    this.dirty = false;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.scene.remove(this.board);
    this.renderer.domElement.remove();
    this.css.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.dispose();
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
