// The tavern around the table: a fire in the hearth, a murmuring crowd with the odd clink of a mug, and a lute
// playing an endless folk tune. All of it is generated live, but any of it can be replaced by a recording:
// put fire, tavern or music (.ogg/.mp3/.wav) in src/client/public/audio/ and it loops instead.

type Stop = () => void;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A recording the player added (src/client/public/audio/<name>.ogg/.mp3/.wav), if there is one. */
async function recording(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
  for (const ext of ['ogg', 'mp3', 'wav']) {
    try {
      const res = await fetch(`/audio/${name}.${ext}`);
      // The server answers unknown paths with the page itself; only real audio counts.
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) continue;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function loopBuffer(ctx: AudioContext, buf: AudioBuffer, out: AudioNode, gain = 1): Stop {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out);
  src.start();
  return () => {
    try {
      src.stop();
    } catch {
      /* stopped */
    }
    g.disconnect();
  };
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return b;
}

export class TavernAudio {
  private white: AudioBuffer;
  private brown: AudioBuffer;
  private stopAmb: Stop[] = [];
  private stopMus: Stop[] = [];
  private lute = new Map<number, AudioBuffer>();

  constructor(
    private ctx: AudioContext,
    private ambOut: AudioNode,
    private musicOut: AudioNode,
    private send: AudioNode,
  ) {
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 4, true);
  }

  // ---------------------------------------------------------------- ambience
  async startAmbience(): Promise<void> {
    if (this.stopAmb.length) return;
    const token: Stop[] = [];
    this.stopAmb = token;
    const [fire, crowd] = await Promise.all([recording(this.ctx, 'fire'), recording(this.ctx, 'tavern')]);
    if (this.stopAmb !== token) return; // stopped meanwhile
    token.push(fire ? loopBuffer(this.ctx, fire, this.ambOut, 0.6) : this.fire());
    token.push(crowd ? loopBuffer(this.ctx, crowd, this.ambOut, 0.5) : this.crowd());
  }

  stopAmbience(): void {
    this.stopAmb.forEach((s) => s());
    this.stopAmb = [];
  }

  /**
   * A fire, in three layers: a low roar that swells and settles, a soft hiss of burning gas, and crackles — mostly
   * tiny, now and then a cluster of them, rarely a sharp snap — softened as if heard across the room.
   */
  private fire(): Stop {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.35; // the hearth is off to the right
    out.connect(pan).connect(this.ambOut);
    const loops: AudioBufferSourceNode[] = [];
    const layer = (buf: AudioBuffer, filters: BiquadFilterNode[], level: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = Math.random();
      const g = ctx.createGain();
      g.gain.value = level;
      let node: AudioNode = src;
      for (const f of filters) node = node.connect(f);
      node.connect(g).connect(out);
      src.start(0, Math.random() * 2);
      loops.push(src);
      return g;
    };
    const bq = (type: BiquadFilterType, f: number, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    const roar = layer(this.brown, [bq('lowpass', 420)], 0.16);
    const hiss = layer(this.white, [bq('highpass', 2600), bq('lowpass', 7500)], 0.008);
    const crackleBus = ctx.createGain();
    crackleBus.gain.value = 1;
    crackleBus.connect(bq('lowpass', 5500)).connect(out);

    const crackle = (t: number, big: boolean) => {
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const f = bq('bandpass', rand(900, big ? 2500 : 4800), rand(0.6, 1.6));
      const g = ctx.createGain();
      // Mostly very quiet; loudness falls off like a log-normal.
      const peak = big ? rand(0.08, 0.16) : 0.004 * Math.exp(rand(0, 2.4));
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.0008);
      g.gain.setTargetAtTime(0, t + 0.0008, big ? 0.012 : rand(0.0015, 0.006));
      const p = ctx.createStereoPanner();
      p.pan.value = rand(-0.25, 0.25);
      src.connect(f).connect(g).connect(p).connect(crackleBus);
      src.start(t, Math.random() * 1.9);
      src.stop(t + 0.15);
      if (big) {
        // A snap has a little body to it.
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(rand(110, 170), t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.05, t);
        og.gain.setTargetAtTime(0, t, 0.02);
        o.connect(og).connect(crackleBus);
        o.start(t);
        o.stop(t + 0.2);
      }
    };
    const tick = () => {
      const t0 = ctx.currentTime + 0.05;
      // The roar and hiss drift.
      roar.gain.setTargetAtTime(rand(0.09, 0.2), t0, 0.5);
      hiss.gain.setTargetAtTime(rand(0.003, 0.012), t0, 0.08);
      // ~6 crackles a second on average, sometimes in a burst.
      const n = Math.random() < 0.55 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const t = t0 + Math.random() * 0.1;
        if (Math.random() < 0.12) {
          const k = Math.floor(rand(3, 9));
          let tt = t;
          for (let j = 0; j < k; j++) {
            crackle(tt, false);
            tt += rand(0.006, 0.045);
          }
        } else crackle(t, Math.random() < 0.025);
      }
    };
    const timer = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(timer);
      loops.forEach((l) => {
        try {
          l.stop();
        } catch {
          /* stopped */
        }
      });
      pan.disconnect();
    };
  }

  /**
   * A crowd across the room: several voices talking in bursts (vowel-like formants on a breathy buzz, too far away
   * and muffled to make out), a low room tone, and now and then a mug set down.
   */
  private crowd(): Stop {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;
    bus.connect(lp).connect(hp);
    hp.connect(this.ambOut);
    const wet = ctx.createGain();
    wet.gain.value = 1.2;
    hp.connect(wet).connect(this.send);
    const stops: Stop[] = [];
    // Room tone.
    {
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(g).connect(bus);
      src.start(0, Math.random() * 3);
      stops.push(() => src.stop());
    }
    const VOWELS: [number, number][] = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [440, 1020], [300, 870], [660, 1720], [490, 1350]];
    for (let v = 0; v < 7; v++) {
      const f0 = v % 3 === 0 ? rand(180, 240) : rand(95, 150);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f0;
      const breath = ctx.createBufferSource();
      breath.buffer = this.white;
      breath.loop = true;
      const bg = ctx.createGain();
      bg.gain.value = 0.25;
      const src = ctx.createGain();
      osc.connect(src);
      breath.connect(bg).connect(src);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.Q.value = 8;
      const voice = ctx.createGain();
      voice.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.8, 0.8);
      src.connect(f1).connect(voice);
      src.connect(f2).connect(voice);
      voice.connect(pan).connect(bus);
      osc.start();
      breath.start(0, Math.random() * 1.9);
      // Talk in phrases of syllables, with pauses.
      let talking = Math.random() < 0.5;
      let until = ctx.currentTime + rand(0.5, 3);
      const level = rand(0.05, 0.11);
      const syllable = () => {
        const t = ctx.currentTime + 0.02;
        if (t > until) {
          talking = !talking;
          until = t + (talking ? rand(1.2, 4.5) : rand(0.6, 3.5));
        }
        if (talking) {
          const [a, b] = pick(VOWELS);
          f1.frequency.setTargetAtTime(a * rand(0.9, 1.1), t, 0.03);
          f2.frequency.setTargetAtTime(b * rand(0.9, 1.1), t, 0.03);
          osc.frequency.setTargetAtTime(f0 * rand(0.88, 1.15), t, 0.05);
          voice.gain.setTargetAtTime(level * rand(0.5, 1), t, 0.025);
          voice.gain.setTargetAtTime(level * 0.15, t + rand(0.09, 0.18), 0.03);
        } else voice.gain.setTargetAtTime(0, t, 0.1);
      };
      const timer = window.setInterval(syllable, rand(150, 240));
      stops.push(() => {
        window.clearInterval(timer);
        osc.stop();
        breath.stop();
      });
    }
    // Mugs set down, somewhere in the room.
    const clink = () => {
      const t = ctx.currentTime + 0.05;
      const p = ctx.createStereoPanner();
      p.pan.value = rand(-0.9, 0.9);
      p.connect(this.ambOut);
      const w = ctx.createGain();
      w.gain.value = 1.5;
      p.connect(w).connect(this.send);
      const base = rand(900, 1500);
      for (const [r, g] of [[1, 0.012], [1.52, 0.007], [2.37, 0.004]]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = base * r;
        const og = ctx.createGain();
        og.gain.setValueAtTime(g, t);
        og.gain.setTargetAtTime(0, t, 0.08);
        o.connect(og).connect(p);
        o.start(t);
        o.stop(t + 0.6);
      }
      clinkTimer = window.setTimeout(clink, rand(4000, 13000));
    };
    let clinkTimer = window.setTimeout(clink, rand(2000, 6000));
    stops.push(() => window.clearTimeout(clinkTimer));
    return () => {
      stops.forEach((s) => {
        try {
          s();
        } catch {
          /* stopped */
        }
      });
      bus.disconnect();
      hp.disconnect();
    };
  }

  // ---------------------------------------------------------------- music
  async startMusic(): Promise<void> {
    if (this.stopMus.length) return;
    const token: Stop[] = [];
    this.stopMus = token;
    const rec = await recording(this.ctx, 'music');
    if (this.stopMus !== token) return;
    token.push(rec ? loopBuffer(this.ctx, rec, this.musicOut, 0.8) : this.folkTune());
  }

  stopMusic(): void {
    this.stopMus.forEach((s) => s());
    this.stopMus = [];
  }

  /** A plucked string (Karplus-Strong), rendered once per note. */
  private luteNote(midi: number): AudioBuffer {
    const hit = this.lute.get(midi);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sr * 2.2);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const n = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(n);
    // A soft pluck: smoothed noise.
    let s = 0;
    for (let i = 0; i < n; i++) {
      s = s * 0.55 + (Math.random() * 2 - 1) * 0.45;
      ring[i] = s;
    }
    const decay = 0.9965 - (midi - 45) * 0.00004;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx];
      const b = ring[(idx + 1) % n];
      const y = decay * 0.5 * (a + b);
      ring[idx] = y;
      d[i] = a;
      idx = (idx + 1) % n;
    }
    // Fade the tail to silence.
    for (let i = len - 2000; i < len; i++) d[i] *= (len - i) / 2000;
    this.lute.set(midi, buf);
    return buf;
  }

  /**
   * An endless, gently varied folk tune in A dorian, 6/8: a lute melody over plucked arpeggios, a soft drone and
   * a frame drum. Each pass composes a new verse on the same chords, so it doesn't loop audibly.
   */
  private folkTune(): Stop {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    bus.connect(lp).connect(this.musicOut);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    lp.connect(wet).connect(this.send);

    const eighth = 0.3; // dotted quarter = 66 bpm
    // A dorian: A B C D E F# G
    const SCALE = [57, 59, 60, 62, 64, 66, 67];
    const CHORDS: Record<string, number[]> = { Am: [57, 60, 64], G: [55, 59, 62], C: [48, 52, 55], Em: [52, 55, 59], D: [50, 54, 57] };
    const A_PART = ['Am', 'Am', 'G', 'G', 'Am', 'Am', 'Em', 'Am'];
    const B_PART = ['C', 'C', 'G', 'G', 'Am', 'D', 'Em', 'Am'];
    const RHYTHMS = [[3, 3], [2, 1, 2, 1], [1, 1, 1, 3], [2, 1, 3], [3, 2, 1], [1, 1, 1, 1, 1, 1]];
    const scaleNotes: number[] = [];
    for (let o = 0; o < 3; o++) for (const n of SCALE) scaleNotes.push(n + o * 12);
    const inRange = scaleNotes.filter((n) => n >= 64 && n <= 81);

    const pluck = (t: number, midi: number, gain: number, panv = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.luteNote(midi);
      const g = ctx.createGain();
      g.gain.value = gain;
      const p = ctx.createStereoPanner();
      p.pan.value = panv;
      src.connect(g).connect(p).connect(bus);
      src.start(t);
    };
    const drum = (t: number, strong: boolean) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(strong ? 95 : 140, t);
      o.frequency.exponentialRampToValueAtTime(strong ? 55 : 90, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(strong ? 0.22 : 0.06, t);
      g.gain.setTargetAtTime(0, t, strong ? 0.09 : 0.03);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.5);
    };
    // A soft drone on A and E that breathes with the parts.
    const drone = [45, 52].map((m) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(bus);
      o.start();
      return { o, g };
    });

    // Compose one verse (A A B A), returning [time offset in eighths, midi, kind] events.
    const compose = () => {
      const ev: { at: number; midi: number; kind: 'mel' | 'acc' | 'drum' | 'drumS' | 'droneOn' | 'droneOff' }[] = [];
      let prev = 69;
      let bar = 0;
      for (const part of [A_PART, A_PART, B_PART, A_PART]) {
        ev.push({ at: bar * 6, midi: 0, kind: part === B_PART ? 'droneOff' : 'droneOn' });
        part.forEach((ch, i) => {
          const at = bar * 6;
          const chord = CHORDS[ch];
          // Arpeggio: root low, then fifth and third above.
          const low = chord[0] - 12 < 40 ? chord[0] : chord[0] - 12;
          [low, chord[2], chord[1] + 12, chord[0] + 12, chord[2], chord[1] + 12].forEach((m, k) => ev.push({ at: at + k, midi: m, kind: 'acc' }));
          ev.push({ at, midi: 0, kind: 'drumS' }, { at: at + 3, midi: 0, kind: 'drum' });
          const end = i === part.length - 1;
          const rhythm = end ? [6] : pick(RHYTHMS);
          let pos = 0;
          rhythm.forEach((len, k) => {
            const strong = pos === 0 || pos === 3;
            let next: number;
            if (end) next = 69;
            else if (strong) {
              // A chord tone near the last note.
              const tones = inRange.filter((n) => chord.some((c) => (n - c) % 12 === 0));
              next = tones.reduce((best, n) => (Math.abs(n - prev) < Math.abs(best - prev) && n !== prev ? n : best), tones[0]);
              if (Math.random() < 0.3) next = pick(tones);
            } else {
              // A step up or down the scale.
              const idx = inRange.indexOf(prev);
              const step = Math.random() < 0.5 ? -1 : 1;
              next = inRange[Math.max(0, Math.min(inRange.length - 1, (idx < 0 ? 4 : idx) + step))];
            }
            if (!(k > 0 && Math.random() < 0.08)) ev.push({ at: at + pos, midi: next, kind: 'mel' });
            prev = next;
            pos += len;
          });
          bar++;
        });
      }
      return { ev, length: bar * 6 };
    };

    let verse = compose();
    let start = ctx.currentTime + 0.4;
    let cursor = 0;
    const tick = () => {
      const horizon = ctx.currentTime + 0.4;
      while (true) {
        const e = verse.ev[cursor];
        if (!e) {
          // Next verse, sometimes after a short breath.
          start += verse.length * eighth + (Math.random() < 0.4 ? 6 * eighth : 0);
          verse = compose();
          cursor = 0;
          continue;
        }
        const t = start + e.at * eighth;
        if (t > horizon) break;
        if (t >= ctx.currentTime - 0.05) {
          if (e.kind === 'mel') pluck(t + rand(0, 0.012), e.midi, 0.5, 0.1);
          else if (e.kind === 'acc') pluck(t, e.midi, 0.2, -0.15);
          else if (e.kind === 'drumS' || e.kind === 'drum') drum(t, e.kind === 'drumS');
          else for (const d of drone) d.g.gain.setTargetAtTime(e.kind === 'droneOn' ? 0.025 : 0, t, 1.2);
        }
        cursor++;
      }
    };
    const timer = window.setInterval(tick, 100);
    tick();
    return () => {
      window.clearInterval(timer);
      for (const d of drone) d.o.stop();
      bus.disconnect();
    };
  }
}
