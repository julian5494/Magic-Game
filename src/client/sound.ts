// Sound effects, synthesized in the browser (no audio files): soft whooshes, wooden thuds, bells and
// shimmers, all sent through one warm reverb so they sit in the same room. Plus an optional
// crackling-hearth ambience for the tavern.

type Color = 'W' | 'U' | 'B' | 'R' | 'G';

export type SoundName =
  | 'draw' | 'land' | 'cast' | 'ability' | 'resolve' | 'creature' | 'permanent' | 'token' | 'dies' | 'destroy' | 'exile'
  | 'bounce' | 'countered' | 'attack' | 'block' | 'damage' | 'lifeGain' | 'lifeLoss' | 'counter' | 'tap' | 'yourTurn'
  | 'theirTurn' | 'prompt' | 'click' | 'pickup' | 'cancel' | 'shuffle' | 'win' | 'lose' | 'monarch' | 'commander'
  // Touching things on the table.
  | 'coins' | 'shing' | 'clink' | 'whoosh' | 'knock' | 'flip' | 'rustle' | 'creak';

/** Every sound, in the order the sound board lists them. */
export const SOUND_NAMES: SoundName[] = [
  'draw', 'shuffle', 'land', 'cast', 'commander', 'ability', 'resolve', 'creature', 'permanent', 'token', 'tap', 'counter',
  'attack', 'block', 'damage', 'dies', 'destroy', 'exile', 'bounce', 'countered', 'lifeGain', 'lifeLoss', 'monarch',
  'yourTurn', 'theirTurn', 'prompt', 'pickup', 'cancel', 'click', 'win', 'lose',
  'coins', 'shing', 'clink', 'whoosh', 'knock', 'flip', 'rustle', 'creak',
];

export interface SoundOpts {
  /** Delay in seconds (to stagger several of the same sound). */
  delay?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Multiplies the loudness. */
  gain?: number;
  /** Colors of the spell or permanent, to flavor the sound. */
  colors?: string[];
  /** 0..1, how big the thing is (a creature's power, say). */
  size?: number;
}

const VOL_KEY = 'commander-arena-volume';
const MUTE_KEY = 'commander-arena-muted';
const AMB_KEY = 'commander-arena-ambience';

const load = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Chords that flavor casting by color (Hz). */
const CHORDS: Record<Color | 'C', number[]> = {
  W: [523.25, 659.25, 783.99, 1046.5], // C major, bright
  U: [440, 554.37, 659.25, 830.61], // A major 7, airy
  B: [196, 233.08, 293.66, 349.23], // G minor 7, dark
  R: [293.66, 369.99, 440, 587.33], // D major, hot
  G: [174.61, 220, 261.63, 349.23], // F major, earthy
  C: [329.63, 493.88, 659.25, 987.77], // open fifths, metallic
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private send!: GainNode;
  private noise!: AudioBuffer;
  private ambTimer = 0;
  private ambNodes: AudioNode[] = [];
  private wantAmbience = false;
  private last: Record<string, number> = {};
  volume = Number(load(VOL_KEY, '0.6'));
  muted = load(MUTE_KEY, 'off') === 'on';
  ambience = load(AMB_KEY, 'on') === 'on';
  private listeners = new Set<() => void>();

  constructor(offline = false) {
    if (typeof window === 'undefined' || offline) return;
    // Browsers only allow audio after the player interacts with the page.
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private changed() {
    this.listeners.forEach((f) => f());
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    save(VOL_KEY, String(this.volume));
    this.applyLevels();
    this.changed();
  }
  setMuted(m: boolean) {
    this.muted = m;
    save(MUTE_KEY, m ? 'on' : 'off');
    this.applyLevels();
    this.changed();
  }
  setAmbience(on: boolean) {
    this.ambience = on;
    save(AMB_KEY, on ? 'on' : 'off');
    if (on && this.wantAmbience) this.startAmbience();
    else this.stopAmbienceNodes();
    this.changed();
  }

  private applyLevels() {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.volume * this.volume; // perceptual curve
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.build(new AC());
    return this.ctx;
  }

  /** Render one sound into a buffer (for the sound board and level checks), without touching the live mix. */
  async render(name: SoundName, o: SoundOpts = {}, seconds = 3): Promise<AudioBuffer> {
    const Off = window.OfflineAudioContext;
    const off = new Off(2, Math.floor(44100 * seconds), 44100);
    const eng = new SoundEngine(true);
    eng.volume = 1;
    eng.muted = false;
    eng.build(off as unknown as AudioContext);
    eng.play(name, o, true);
    return off.startRendering();
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    // A gentle limiter so stacked sounds never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    // Shared room reverb.
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.4);
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.send.connect(verb).connect(wet).connect(this.master);
    // Two seconds of white noise to filter into whooshes, knocks and crackles.
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.applyLevels();
    if (this.wantAmbience && this.ambience) this.startAmbience();
  }

  /** A warm, slightly dark room: stereo noise with an exponential tail, softened over time. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.15 + t * 0.6; // more filtering later in the tail
        lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------ building blocks
  private out(pan = 0, reverb = 0.3): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.send);
    }
    return p;
  }

  /** An oscillator with a pitch glide and an attack/decay envelope. */
  private tone(t: number, o: { type?: OscillatorType; f: number; f2?: number; dur: number; a?: number; gain: number; pan?: number; rev?: number; lp?: number; detune?: number }) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.dur);
    let node: AudioNode = osc.connect(g);
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      node = node.connect(f);
    }
    node.connect(this.out(o.pan, o.rev ?? 0.25));
    osc.start(t);
    osc.stop(t + a + o.dur + 0.05);
  }

  /** Filtered noise: whooshes (with a sweep), knocks and crackles. */
  private hiss(t: number, o: { type?: BiquadFilterType; f: number; f2?: number; q?: number; dur: number; a?: number; gain: number; pan?: number; rev?: number; rate?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ctx.createGain();
    const a = o.a ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, o.dur));
    src.connect(f).connect(g).connect(this.out(o.pan, o.rev ?? 0.2));
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur + 0.05);
  }

  /** A struck bell: a few inharmonic partials with a long, soft decay. */
  private bell(t: number, f: number, gain: number, dur = 1.6, pan = 0) {
    for (const [ratio, g, d] of [[1, 1, 1], [2.01, 0.5, 0.7], [2.76, 0.35, 0.55], [4.07, 0.2, 0.35], [5.43, 0.12, 0.25]] as const)
      this.tone(t, { f: f * ratio, dur: dur * d, a: 0.003, gain: gain * g, pan, rev: 0.5 });
  }

  /** A quick sparkle of high pings (magic dust). */
  private sparkle(t: number, n: number, gain: number, pan = 0) {
    for (let i = 0; i < n; i++) this.tone(t + i * 0.035 + Math.random() * 0.02, { f: 1800 + Math.random() * 2600, dur: 0.25 + Math.random() * 0.2, gain: gain * (1 - i / (n + 1)), pan: pan + (Math.random() - 0.5) * 0.6, rev: 0.7 });
  }

  private chord(colors?: string[]): number[] {
    const cs = (colors ?? []).filter((c): c is Color => 'WUBRG'.includes(c));
    if (cs.length === 0) return CHORDS.C;
    if (cs.length === 1) return CHORDS[cs[0]];
    // Several colors: the root of each, stacked.
    return cs.slice(0, 4).map((c) => CHORDS[c][0] * (c === 'B' || c === 'G' ? 2 : 1));
  }

  // ------------------------------------------------------------------ the sounds
  play(name: SoundName, o: SoundOpts = {}, offline = false): void {
    if (this.muted || this.volume <= 0) return;
    const ctx = offline ? this.ctx : this.ensure();
    if (!ctx || (!offline && ctx.state !== 'running')) return;
    // Don't machine-gun the same sound: a few per 60 ms at most.
    const now = performance.now();
    if (!o.delay && now - (this.last[name] ?? 0) < 45) return;
    this.last[name] = now;
    const t = ctx.currentTime + 0.01 + (o.delay ?? 0);
    const k = o.gain ?? 1;
    const pan = o.pan ?? 0;
    const size = Math.max(0, Math.min(1, o.size ?? 0.4));
    switch (name) {
      case 'draw':
        this.hiss(t, { f: 2400, f2: 5200, q: 0.9, dur: 0.17, a: 0.02, gain: 0.36 * k, pan });
        this.hiss(t + 0.05, { type: 'highpass', f: 6000, dur: 0.05, gain: 0.05 * k, pan });
        break;
      case 'pickup':
        this.hiss(t, { f: 700, f2: 2200, q: 1.2, dur: 0.2, a: 0.05, gain: 0.2 * k, pan });
        break;
      case 'cancel':
        this.hiss(t, { f: 2000, f2: 600, q: 1.2, dur: 0.18, a: 0.02, gain: 0.16 * k, pan });
        break;
      case 'click':
        this.tone(t, { f: 1400, f2: 1100, dur: 0.035, gain: 0.07 * k, rev: 0.1 });
        this.hiss(t, { type: 'highpass', f: 4000, dur: 0.012, gain: 0.04 * k, rev: 0 });
        break;
      case 'tap':
        this.hiss(t, { f: 1600, q: 2, dur: 0.035, gain: 0.16 * k, pan, rev: 0.05 });
        this.tone(t, { type: 'triangle', f: 420, f2: 380, dur: 0.05, gain: 0.05 * k, pan, rev: 0.05 });
        break;
      case 'land':
        // A card set down firmly on the wooden table.
        this.tone(t, { f: 150, f2: 52, dur: 0.28, gain: 0.55 * k, pan, rev: 0.15 });
        this.hiss(t, { type: 'lowpass', f: 900, dur: 0.07, gain: 0.32 * k, pan, rev: 0.15 });
        this.tone(t, { type: 'triangle', f: 230, f2: 205, dur: 0.14, gain: 0.06 * k, pan, rev: 0.2 });
        this.sparkle(t + 0.06, 2, 0.012 * k, pan);
        break;
      case 'cast': {
        // A swell of air and a shimmering chord in the spell's colors.
        this.hiss(t, { f: 380, f2: 2600, q: 0.8, dur: 0.42, a: 0.18, gain: 0.2 * k, pan, rev: 0.4 });
        this.chord(o.colors).forEach((f, i) => {
          this.tone(t + 0.08 + i * 0.045, { f, dur: 0.9, a: 0.06, gain: 0.045 * k, pan, rev: 0.6, lp: 4000 });
          this.tone(t + 0.08 + i * 0.045, { f: f * 2, dur: 0.6, a: 0.06, gain: 0.015 * k, pan, rev: 0.7, detune: 6 });
        });
        if (o.colors?.includes('R')) for (let i = 0; i < 5; i++) this.hiss(t + 0.05 + Math.random() * 0.4, { type: 'highpass', f: 3000, dur: 0.02, gain: 0.07 * k, pan });
        break;
      }
      case 'commander':
        this.tone(t, { f: 65, f2: 40, dur: 0.9, gain: 0.6 * k, rev: 0.4 });
        this.hiss(t, { f: 300, f2: 3500, q: 0.7, dur: 0.6, a: 0.2, gain: 0.22 * k, rev: 0.5 });
        this.chord(o.colors).forEach((f, i) => this.tone(t + 0.15 + i * 0.07, { type: 'triangle', f, dur: 1.6, a: 0.12, gain: 0.04 * k, rev: 0.7, lp: 2600 }));
        this.bell(t + 0.2, 196, 0.06 * k, 2.2);
        break;
      case 'ability':
        this.tone(t, { f: 1320, dur: 0.18, gain: 0.05 * k, pan, rev: 0.5 });
        this.tone(t + 0.06, { f: 1760, dur: 0.22, gain: 0.04 * k, pan, rev: 0.5 });
        break;
      case 'resolve': {
        const base = this.chord(o.colors)[0];
        this.bell(t, base * 2, 0.05 * k, 1.4, pan);
        this.sparkle(t + 0.04, 4, 0.02 * k, pan);
        break;
      }
      case 'creature': {
        // Weight: bigger creatures land lower and longer.
        const f = 110 - size * 50;
        this.tone(t, { f, f2: f * 0.4, dur: 0.35 + size * 0.4, gain: (0.5 + size * 0.35) * k, pan, rev: 0.25 });
        this.hiss(t, { type: 'lowpass', f: 500 + size * 300, dur: 0.22 + size * 0.2, gain: (0.22 + size * 0.15) * k, pan, rev: 0.25 });
        this.chord(o.colors).slice(0, 3).forEach((cf, i) => this.tone(t + 0.05 + i * 0.03, { f: cf, dur: 0.7, a: 0.03, gain: 0.025 * k, pan, rev: 0.6, lp: 3000 }));
        this.sparkle(t + 0.08, 3, 0.015 * k, pan);
        break;
      }
      case 'permanent':
        this.tone(t, { f: 120, f2: 60, dur: 0.2, gain: 0.35 * k, pan, rev: 0.2 });
        for (const [f, g] of [[660, 0.05], [990, 0.035], [1485, 0.02]]) this.tone(t + 0.02, { type: 'triangle', f, dur: 0.5, gain: g * k, pan, rev: 0.5 });
        break;
      case 'token':
        this.tone(t, { f: 520, f2: 880, dur: 0.09, gain: 0.2 * k, pan, rev: 0.3 });
        this.sparkle(t + 0.03, 3, 0.03 * k, pan);
        break;
      case 'dies':
        this.hiss(t, { type: 'lowpass', f: 1400, f2: 250, dur: 0.38, gain: 0.32 * k, pan, rev: 0.3 });
        this.tone(t, { f: 240, f2: 70, dur: 0.55, gain: 0.18 * k, pan, rev: 0.4 });
        this.tone(t + 0.05, { type: 'triangle', f: 196, f2: 174.6, dur: 0.6, gain: 0.03 * k, pan, rev: 0.6 });
        break;
      case 'destroy':
        this.hiss(t, { type: 'highpass', f: 2000, dur: 0.14, gain: 0.22 * k, pan, rev: 0.3 });
        for (const f of [820, 1150, 1730]) this.tone(t, { type: 'triangle', f, f2: f * 0.92, dur: 0.3, gain: 0.04 * k, pan, rev: 0.4 });
        this.tone(t, { f: 160, f2: 60, dur: 0.25, gain: 0.25 * k, pan, rev: 0.2 });
        break;
      case 'exile':
        // Pulled out of the world: a rising, airy rush that cuts off.
        this.hiss(t, { f: 500, f2: 6000, q: 1.4, dur: 0.55, a: 0.45, gain: 0.2 * k, pan, rev: 0.6 });
        this.tone(t + 0.1, { f: 700, f2: 2600, dur: 0.45, a: 0.3, gain: 0.03 * k, pan, rev: 0.7 });
        break;
      case 'bounce':
        this.hiss(t, { f: 2600, f2: 500, q: 1, dur: 0.32, a: 0.03, gain: 0.28 * k, pan, rev: 0.3 });
        break;
      case 'countered':
        this.hiss(t, { type: 'highpass', f: 1500, f2: 7000, dur: 0.25, a: 0.02, gain: 0.15 * k, pan, rev: 0.5 });
        [1318.5, 987.8, 659.3].forEach((f, i) => this.tone(t + 0.05 + i * 0.09, { type: 'triangle', f, dur: 0.35, gain: 0.05 * k, pan, rev: 0.6 }));
        break;
      case 'attack':
        // A blade drawn and a war drum.
        this.hiss(t, { f: 900, f2: 4200, q: 2.2, dur: 0.22, a: 0.03, gain: 0.28 * k, pan, rev: 0.25 });
        this.tone(t + 0.04, { f: 72, f2: 44, dur: 0.6, gain: 0.6 * k, rev: 0.35 });
        this.hiss(t + 0.04, { type: 'lowpass', f: 220, dur: 0.32, gain: 0.28 * k, rev: 0.3 });
        break;
      case 'block':
        // A shield takes the hit.
        this.hiss(t, { f: 3000, q: 1.5, dur: 0.05, gain: 0.25 * k, pan, rev: 0.2 });
        for (const [f, g] of [[523, 0.06], [741, 0.05], [1187, 0.035], [1683, 0.02]]) this.tone(t, { type: 'triangle', f, dur: 0.35, gain: g * k, pan, rev: 0.4 });
        this.tone(t, { f: 130, f2: 70, dur: 0.18, gain: 0.3 * k, pan });
        break;
      case 'damage':
        this.tone(t, { f: 120, f2: 48, dur: 0.26, gain: 0.6 * k, pan, rev: 0.2 });
        this.hiss(t, { type: 'lowpass', f: 800, dur: 0.08, gain: 0.3 * k, pan, rev: 0.2 });
        break;
      case 'lifeGain':
        [784, 987.8, 1174.7, 1568].forEach((f, i) => this.tone(t + i * 0.055, { f, dur: 0.6, a: 0.01, gain: 0.04 * k, pan, rev: 0.6 }));
        this.sparkle(t + 0.15, 3, 0.012 * k, pan);
        break;
      case 'lifeLoss':
        this.tone(t, { f: 98, dur: 0.4, a: 0.01, gain: 0.25 * k, pan, rev: 0.3 });
        this.tone(t, { type: 'triangle', f: 196, f2: 185, dur: 0.32, gain: 0.04 * k, pan, rev: 0.4 });
        break;
      case 'counter':
        // A die clattering onto the table.
        [0, 0.055, 0.1, 0.13].forEach((d, i) => this.hiss(t + d, { f: 2600 + Math.random() * 1400, q: 4, dur: 0.03, gain: (0.55 / (i + 1)) * k, pan, rev: 0.15 }));
        this.tone(t, { type: 'triangle', f: 1800, dur: 0.025, gain: 0.05 * k, pan });
        break;
      case 'yourTurn':
        this.bell(t, 392, 0.09 * k, 2.4);
        this.tone(t, { f: 196, dur: 1.6, a: 0.02, gain: 0.07 * k, rev: 0.5 });
        break;
      case 'theirTurn':
        this.bell(t, 261.6, 0.03 * k, 1.2);
        break;
      case 'prompt':
        this.tone(t, { f: 880, dur: 0.25, gain: 0.04 * k, rev: 0.5 });
        this.tone(t + 0.1, { f: 1318.5, dur: 0.35, gain: 0.04 * k, rev: 0.5 });
        break;
      case 'shuffle':
        // A riffle: dozens of tiny card flicks.
        for (let i = 0; i < 34; i++) {
          const env = Math.sin((i / 34) * Math.PI);
          this.hiss(t + i * 0.016 + Math.random() * 0.004, { f: 2800 + Math.random() * 1500, q: 1.6, dur: 0.012, gain: (0.04 + env * 0.12) * k, pan: -0.2 + (i / 34) * 0.4, rev: 0.1 });
        }
        break;
      case 'monarch':
        this.chord(['W']).forEach((f, i) => this.tone(t + i * 0.08, { type: 'triangle', f, dur: 1.2, a: 0.05, gain: 0.045 * k, rev: 0.6, lp: 3000 }));
        this.bell(t + 0.3, 523.25, 0.05 * k, 2);
        break;
      case 'coins':
        // A handful of coins jingling in a leather bag.
        for (let i = 0; i < 9; i++) {
          const d = Math.random() * 0.35;
          const f = 2600 + Math.random() * 2400;
          for (const [r, g] of [[1, 0.05], [1.51, 0.03], [2.32, 0.018]]) this.tone(t + d, { type: 'triangle', f: f * r, dur: 0.12 + Math.random() * 0.1, gain: g * k * (0.5 + Math.random() * 0.5), pan: pan + (Math.random() - 0.5) * 0.3, rev: 0.25 });
        }
        this.hiss(t, { type: 'lowpass', f: 600, dur: 0.3, gain: 0.08 * k, pan, rev: 0.1 });
        break;
      case 'shing':
        // Steel ringing: a bright scrape and a long, thin tone.
        this.hiss(t, { f: 5000, f2: 9000, q: 3, dur: 0.25, a: 0.01, gain: 0.08 * k, pan, rev: 0.4 });
        for (const [f, g] of [[3150, 0.05], [4720, 0.03], [6890, 0.015]]) this.tone(t, { f, dur: 1.2, a: 0.004, gain: g * k, pan, rev: 0.5 });
        break;
      case 'clink':
        for (const [f, g] of [[1240, 0.07], [1863, 0.04], [2905, 0.025]]) this.tone(t, { type: 'triangle', f, dur: 0.5, a: 0.002, gain: g * k, pan, rev: 0.35 });
        this.hiss(t + 0.08, { type: 'lowpass', f: 900, dur: 0.25, a: 0.05, gain: 0.05 * k, pan, rev: 0.2 });
        break;
      case 'whoosh':
        this.hiss(t, { type: 'lowpass', f: 300, f2: 1400, dur: 0.45, a: 0.12, gain: 0.25 * k, pan, rev: 0.3 });
        break;
      case 'knock':
        this.tone(t, { f: 180, f2: 70, dur: 0.22, gain: 0.45 * k, pan, rev: 0.25 });
        this.hiss(t, { type: 'lowpass', f: 1000, dur: 0.05, gain: 0.25 * k, pan, rev: 0.2 });
        this.tone(t + 0.16, { f: 170, f2: 70, dur: 0.18, gain: 0.3 * k, pan, rev: 0.25 });
        break;
      case 'flip':
        this.hiss(t, { f: 2500, q: 2, dur: 0.03, gain: 0.15 * k, pan });
        this.tone(t + 0.85, { f: 260, f2: 180, dur: 0.12, gain: 0.25 * k, pan, rev: 0.2 });
        this.hiss(t + 0.85, { type: 'lowpass', f: 1200, dur: 0.04, gain: 0.15 * k, pan });
        break;
      case 'rustle':
        for (let i = 0; i < 6; i++) this.hiss(t + i * 0.04 + Math.random() * 0.03, { f: 3000 + Math.random() * 2000, q: 0.8, dur: 0.06, gain: 0.06 * k, pan });
        break;
      case 'creak':
        this.tone(t, { type: 'sawtooth', f: 140, f2: 110, dur: 0.5, a: 0.05, gain: 0.03 * k, pan, rev: 0.3, lp: 900 });
        break;
      case 'win':
        [261.6, 329.6, 392, 523.25, 659.25].forEach((f, i) => {
          this.tone(t + i * 0.12, { type: 'sawtooth', f, dur: 1.8 - i * 0.15, a: 0.04, gain: 0.04 * k, rev: 0.6, lp: 1800 });
          this.tone(t + i * 0.12, { f: f / 2, dur: 1.6, a: 0.04, gain: 0.05 * k, rev: 0.5 });
        });
        this.bell(t + 0.6, 523.25, 0.08 * k, 3);
        break;
      case 'lose':
        [440, 349.2, 293.7, 220].forEach((f, i) => this.tone(t + i * 0.22, { type: 'triangle', f, dur: 1.2, a: 0.05, gain: 0.05 * k, rev: 0.6, lp: 1600 }));
        this.tone(t + 0.7, { f: 110, dur: 2, a: 0.1, gain: 0.08 * k, rev: 0.6 });
        break;
    }
  }

  // ------------------------------------------------------------------ hearth ambience
  /** Ask for the crackling-fire ambience (it starts once audio is allowed and the setting is on). */
  wantHearth(on: boolean): void {
    this.wantAmbience = on;
    if (on && this.ambience) this.startAmbience();
    else this.stopAmbienceNodes();
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambNodes.length) return;
    // A low roar of the fire and a quiet room.
    const roar = ctx.createBufferSource();
    roar.buffer = this.noise;
    roar.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // The roar breathes slowly.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(g.gain);
    roar.connect(lp).connect(g).connect(this.amb);
    roar.start();
    lfo.start();
    this.ambNodes = [roar, lfo];
    // Pops and crackles at random.
    const tick = () => {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime;
      const n = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 4) : Math.random() < 0.6 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const t = t0 + Math.random() * 0.25;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900 + Math.random() * 3500;
        f.Q.value = 0.8 + Math.random() * 2;
        const gg = this.ctx.createGain();
        const peak = 0.015 + Math.random() * Math.random() * 0.09;
        gg.gain.setValueAtTime(0.0001, t);
        gg.gain.exponentialRampToValueAtTime(peak, t + 0.002);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015 + Math.random() * 0.05);
        const p = this.ctx.createStereoPanner();
        p.pan.value = 0.25 + Math.random() * 0.3; // the hearth is off to the right
        src.connect(f).connect(gg).connect(p).connect(this.amb);
        src.start(t, Math.random() * 1.8);
        src.stop(t + 0.1);
      }
    };
    this.ambTimer = window.setInterval(tick, 260);
  }

  private stopAmbienceNodes(): void {
    window.clearInterval(this.ambTimer);
    this.ambTimer = 0;
    for (const n of this.ambNodes) {
      try {
        (n as AudioScheduledSourceNode).stop();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
    this.ambNodes = [];
  }
}

export const sound = new SoundEngine();
