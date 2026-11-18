// Converts Scryfall card data into engine card definitions by parsing oracle text.
//
// Philosophy: anything we can't parse confidently is NOT given to the player. Unparsed
// abilities are recorded in `def.unsupported` and shown on the card, conditional mana
// abilities are dropped, and lands with conditions we can't read enter tapped.
// The parser can be incomplete, but it must never let a player do something illegal.
import type {
  ActivatedAbility, CardDef, CardFilter, Cost, Ctx, StaticAbility, TargetSpec, TriggerOn, TriggeredAbility,
} from './cardtypes';
import { parseCost } from './mana';
import { parseCount, parseExpr } from './oracle-amounts';
import { findDef, registerCards } from './registry';
import { battlefieldCards, getPlayer, getPT, hasType, matchesFilter, opponentsOf } from './state';
import type { CardType, Color, GameState, Keyword, ManaSym, PlayerId, Supertype } from './types';

export interface ScryFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  image_uris?: { normal?: string };
}

export interface ScryCard extends ScryFace {
  id?: string;
  color_identity?: string[];
  keywords?: string[];
  layout?: string;
  card_faces?: ScryFace[];
  legalities?: Record<string, string>;
  set?: string;
  collector_number?: string;
}

// ---------- Small helpers ----------

const NUMS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
type N = number | 'X';
function num(s: string | undefined): N | null {
  if (!s) return null;
  const l = s.toLowerCase();
  if (l in NUMS) return NUMS[l];
  if (/^\d+$/.test(l)) return parseInt(l, 10);
  if (l === 'x') return 'X';
  return null;
}
const val = (n: N, ctx: Ctx) => (n === 'X' ? ctx.x : n);

const KEYWORDS: Record<string, Keyword> = {
  flying: 'Flying', reach: 'Reach', trample: 'Trample', haste: 'Haste', vigilance: 'Vigilance', deathtouch: 'Deathtouch',
  lifelink: 'Lifelink', 'first strike': 'First strike', 'double strike': 'Double strike', menace: 'Menace',
  defender: 'Defender', hexproof: 'Hexproof', shroud: 'Shroud', indestructible: 'Indestructible', flash: 'Flash',
  prowess: 'Prowess', exalted: 'Exalted',
};

function parseKeywordList(s: string): Keyword[] | null {
  const parts = s.toLowerCase().replace(/\.$/, '').split(/,\s*(?:and\s+)?|\s+and\s+/).map((p) => p.trim()).filter(Boolean);
  const out: Keyword[] = [];
  for (const p of parts) {
    const k = KEYWORDS[p];
    if (!k) return null;
    out.push(k);
  }
  return out.length ? out : null;
}

const TYPE_WORDS: Record<string, CardType> = {
  creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', land: 'Land', planeswalker: 'Planeswalker',
  instant: 'Instant', sorcery: 'Sorcery',
};
const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function singular(w: string): string {
  if (w === 'sorceries') return 'sorcery';
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && /(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// ---------- Object phrases ("target nonland permanent an opponent controls") ----------

interface ObjSpec {
  kind: TargetSpec['kind'];
  filter: CardFilter;
  spellTypes?: CardType[];
  spellNotTypes?: CardType[];
  graveyard?: 'yours' | 'any';
}

function parseObject(phraseIn: string): ObjSpec | null {
  let p = phraseIn.trim().replace(/^target\s+/i, '');
  const lower = p.toLowerCase();
  if (lower === 'any target') return { kind: 'any', filter: {} };
  if (lower === 'player' || lower === 'player or planeswalker') return { kind: 'player', filter: {} };
  if (lower === 'opponent' || lower === 'opponent or planeswalker') return { kind: 'opponent', filter: {} };

  // Graveyard cards.
  let m = p.match(/^(?:(.*?)\s+)?cards? (?:from|in) (your|a) graveyard$/i);
  if (m) {
    const inner = m[1] ? parseNouns(m[1]) : { types: undefined, filter: {} as CardFilter };
    if (!inner) return null;
    return { kind: 'graveyardCard', filter: { ...inner.filter, types: inner.types }, graveyard: m[2].toLowerCase() === 'your' ? 'yours' : 'any' };
  }
  // Spells.
  m = p.match(/^(?:(.*?)\s+)?spell$/i);
  if (m) {
    const w = (m[1] ?? '').toLowerCase();
    if (!w) return { kind: 'spell', filter: {} };
    const words = w.split(/,\s*or\s+|,\s+|\s+or\s+/);
    if (words.every((x) => x.startsWith('non') && TYPE_WORDS[x.slice(3)])) {
      return { kind: 'spell', filter: {}, spellNotTypes: words.map((x) => TYPE_WORDS[x.slice(3)]) };
    }
    if (words.every((x) => TYPE_WORDS[x])) return { kind: 'spell', filter: {}, spellTypes: words.map((x) => TYPE_WORDS[x]) };
    return null;
  }
  const filter: CardFilter = {};
  const suffixes: [RegExp, (mm: RegExpMatchArray) => void][] = [
    [/\s+you control$/i, () => (filter.controller = 'you')],
    [/\s+(?:an opponent controls|your opponents control|you don't control)$/i, () => (filter.controller = 'opponent')],
    [/\s+with mana value (\d+) or less$/i, (mm) => (filter.maxCmc = +mm[1])],
    [/\s+with mana value (\d+) or greater$/i, (mm) => addCustom(filter, (s, c) => cmcOf(c.def) >= +mm[1])],
    [/\s+with power (\d+) or greater$/i, (mm) => (filter.minPower = +mm[1])],
    [/\s+with power (\d+) or less$/i, (mm) => addCustom(filter, (s, c) => getPT(s, c).power <= +mm[1])],
    [/\s+with flying$/i, () => addCustom(filter, (s, c) => hasKw(s, c, 'Flying'))],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [re, fn] of suffixes) {
      const mm = p.match(re);
      if (mm) {
        fn(mm);
        p = p.slice(0, mm.index);
        changed = true;
      }
    }
  }
  const nouns = parseNouns(p);
  if (!nouns) return null;
  Object.assign(filter, nouns.filter);
  const types = nouns.types;
  if (types && types.length === 1 && types[0] === 'Creature') return { kind: 'creature', filter };
  return { kind: 'permanent', filter: { ...filter, types } };
}

function cmcOf(defName: string): number {
  const d = findDef(defName);
  const c = parseCost(d?.cost);
  return c.generic + c.W + c.U + c.B + c.R + c.G + c.C;
}

function hasKw(s: GameState, c: any, k: Keyword): boolean {
  return (findDef(c.def)?.keywords ?? []).includes(k) || c.temp?.keywords?.includes(k);
}

function addCustom(f: CardFilter, fn: NonNullable<CardFilter['custom']>) {
  const prev = f.custom;
  f.custom = prev ? (s, c, ctl, src) => prev(s, c, ctl, src) && fn(s, c, ctl, src) : fn;
}

/** "nonland permanent", "artifact or enchantment", "attacking or blocking creature", "Goblins". */
function parseNouns(phrase: string): { types?: CardType[]; filter: CardFilter } | null {
  let p = phrase.trim().replace(/ and\/or /g, ' or ');
  const filter: CardFilter = {};
  if (/^attacking or blocking /i.test(p)) {
    filter.attackingOrBlocking = true;
    p = p.replace(/^attacking or blocking /i, '');
  }
  const alts = p.split(/,\s*or\s+|,\s+|\s+or\s+/);
  const types: CardType[] = [];
  let anyPermanent = false;
  for (let i = 0; i < alts.length; i++) {
    const words = alts[i].trim().split(/\s+/);
    const noun = singular(words[words.length - 1].toLowerCase());
    const original = words[words.length - 1];
    const adjs = words.slice(0, -1);
    if (TYPE_WORDS[noun]) types.push(TYPE_WORDS[noun]);
    else if (noun === 'permanent') anyPermanent = true;
    else if (noun === 'card') anyPermanent = true;
    else if (/^[A-Z]/.test(original)) {
      filter.subtypes = [...(filter.subtypes ?? []), singularSubtype(original)];
      if (!types.includes('Creature')) types.push('Creature');
    } else return null;
    for (const a of adjs) {
      const w = a.toLowerCase();
      if (w === 'nonland') filter.nonland = true;
      else if (w === 'another' || w === 'other') filter.other = true;
      else if (w === 'nontoken') filter.nontoken = true;
      else if (w === 'token') filter.token = true;
      else if (w === 'nonlegendary') filter.nonlegendary = true;
      else if (w === 'legendary') filter.supertypes = ['Legendary'];
      else if (w === 'basic') filter.basicLand = true;
      else if (w === 'nonbasic') addCustom(filter, (_s, c) => !(findDef(c.def)?.supertypes ?? []).includes('Basic'));
      else if (w === 'attacking') filter.attacking = true;
      else if (w === 'tapped') addCustom(filter, (_s, c) => c.tapped);
      else if (w === 'untapped') addCustom(filter, (_s, c) => !c.tapped);
      else if (w.startsWith('non') && TYPE_WORDS[w.slice(3)]) filter.notTypes = [...(filter.notTypes ?? []), TYPE_WORDS[w.slice(3)]];
      else if (w.startsWith('non') && COLOR_WORDS[w.slice(3)]) filter.notColors = [...(filter.notColors ?? []), COLOR_WORDS[w.slice(3)]];
      else if (COLOR_WORDS[w]) filter.colors = [...(filter.colors ?? []), COLOR_WORDS[w]];
      else if (TYPE_WORDS[w] && i === alts.length - 1) types.push(TYPE_WORDS[w]); // "artifact creature"
      else if (/^[A-Z]/.test(a)) filter.subtypes = [...(filter.subtypes ?? []), a];
      else return null;
    }
  }
  return { types: anyPermanent ? (types.length ? types : undefined) : types.length ? types : undefined, filter };
}

function singularSubtype(w: string): string {
  if (w === 'Elves') return 'Elf';
  if (w === 'Dwarves') return 'Dwarf';
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function spec(o: ObjSpec, label: string, bias: 'opponent' | 'self', optional = false): TargetSpec {
  return { kind: o.kind, filter: o.filter, spellTypes: o.spellTypes, spellNotTypes: o.spellNotTypes, graveyard: o.graveyard, label, bias, optional };
}

/** Parse "target X", "up to two target Xs", "two target Xs" into target specs. */
function parseTargets(phrase: string, bias: 'opponent' | 'self'): TargetSpec[] | null {
  let m = phrase.match(/^up to (\w+) (?:other )?target (.+)$/i);
  if (m) {
    const n = num(m[1]);
    const o = parseObject(singularPhrase(m[2]));
    if (n === null || n === 'X' || !o) return null;
    return Array.from({ length: n }, (_, i) => spec(o, `${i ? 'another ' : ''}target ${singularPhrase(m![2])}`, bias, true));
  }
  m = phrase.match(/^(two|three) target (.+)$/i);
  if (m) {
    const n = num(m[1]) as number;
    const o = parseObject(singularPhrase(m[2]));
    if (!o) return null;
    return Array.from({ length: n }, (_, i) => spec(o, `${i ? 'another ' : ''}target ${singularPhrase(m![2])}`, bias));
  }
  if (/^(?:another )?target /i.test(phrase) || /^any target$/i.test(phrase)) {
    const o = parseObject(phrase.replace(/^another /i, ''));
    if (!o) return null;
    if (/^another /i.test(phrase)) o.filter.other = true;
    return [spec(o, phrase, bias)];
  }
  return null;
}

function singularPhrase(p: string): string {
  return p.replace(/\b(creatures|permanents|artifacts|enchantments|lands|players|opponents|spells|cards)\b/gi, (w) => singular(w.toLowerCase()));
}

// ---------- Effects ----------

interface Scratch {
  lastId?: string;
  lastController?: PlayerId;
  lastPower?: number;
  lastToughness?: number;
  lastCmc?: number;
  lost?: number;
}

interface Piece {
  targets: TargetSpec[];
  run: (ctx: Ctx, base: number, scratch: Scratch) => void;
  /** Pieces that open a decision (scry/search) must be last, or continue via a handler. */
  async?: 'scry' | 'surveil';
  scryN?: N;
  /** Decision continuations this piece needs, registered on the card under unique keys. */
  handlers?: Record<string, NonNullable<CardDef['handlers']>[string]>;
}

let handlerSeq = 0;
const hkey = () => `h${++handlerSeq}`;

function remember(ctx: Ctx, idx: number, scratch: Scratch) {
  const c = ctx.card(idx);
  if (c) {
    scratch.lastId = c.id;
    scratch.lastController = c.controller;
    scratch.lastCmc = cmcOf(c.def);
    if (c.zone === 'battlefield') {
      const pt = getPT(ctx.state, c);
      scratch.lastPower = pt.power;
      scratch.lastToughness = pt.toughness;
    }
  } else {
    const p = ctx.player(idx);
    if (p) scratch.lastController = p;
  }
}

/** Players referenced by a subject phrase. */
function players(subject: string): ((ctx: Ctx, base: number, s: Scratch) => PlayerId[]) | { target: TargetSpec } | null {
  const l = subject.toLowerCase();
  if (l === 'you') return (ctx) => [ctx.controller];
  if (l === 'each opponent') return (ctx) => ctx.opponents();
  if (l === 'each player') return (ctx) => ctx.players();
  if (l === 'its controller' || l === 'its owner' || l === 'thatplayer' || l === "that creature's controller" || l === "that permanent's controller") {
    return (_c, _b, s) => (s.lastController ? [s.lastController] : []);
  }
  if (l === 'that player') {
    return (ctx, _b, s) => {
      const e = ctx.event;
      if (e?.t === 'combatDamagePlayer') return [e.player];
      if (e?.t === 'attacks') return [e.defender];
      if (e?.t === 'draw' || e?.t === 'discard') return [e.player];
      if (e?.t === 'cast') return [e.controller];
      return s.lastController ? [s.lastController] : [];
    };
  }
  if (l === 'target player') return { target: { kind: 'player', label: 'target player', bias: 'opponent' } };
  if (l === 'target opponent') return { target: { kind: 'opponent', label: 'target opponent', bias: 'opponent' } };
  return null;
}

function forPlayers(subject: string, bias: 'opponent' | 'self', fn: (ctx: Ctx, p: PlayerId, s: Scratch) => void): Piece | null {
  const who = players(subject);
  if (!who) return null;
  if (typeof who === 'function') return { targets: [], run: (ctx, b, s) => who(ctx, b, s).forEach((p) => fn(ctx, p, s)) };
  return {
    targets: [{ ...who.target, bias }],
    run: (ctx, base, s) => {
      const p = ctx.player(base);
      if (p) {
        s.lastController = p;
        fn(ctx, p, s);
      }
    },
  };
}

/** Permanents referenced by a subject: "target creature", "CARDNAME", "creatures you control", "it". */
function permanentsSubject(subject: string, bias: 'opponent' | 'self'): Piece & { each?: (ctx: Ctx, base: number, s: Scratch) => string[] } | null {
  const l = subject.toLowerCase();
  if (l === 'cardname') return { targets: [], run: () => {}, each: (ctx) => (ctx.self ? [ctx.self.id] : []) };
  if (l === 'it' || l === 'that creature' || l === 'that permanent' || l === 'that token') {
    return {
      targets: [],
      run: () => {},
      each: (ctx, _b, s) => {
        if (s.lastId) return [s.lastId];
        const e = ctx.event;
        if (e && (e.t === 'etb' || e.t === 'attacks') && ctx.state.cards[e.card]?.zone === 'battlefield') return [e.card];
        return [];
      },
    };
  }
  if (l === 'equipped creature' || l === 'enchanted creature') return { targets: [], run: () => {}, each: (ctx) => (ctx.self?.attachedTo ? [ctx.self.attachedTo] : []) };
  const t = parseTargets(subject, bias);
  if (t) {
    return {
      targets: t,
      run: () => {},
      each: (ctx, base, s) => {
        const out: string[] = [];
        t.forEach((_x, i) => {
          remember(ctx, base + i, s);
          const c = ctx.card(base + i);
          if (c) out.push(c.id);
        });
        return out;
      },
    };
  }
  const all = l.match(/^(?:all|each) (.+)$/) ?? (/(creatures|permanents|artifacts|lands) (you control|your opponents control|you don't control)$/.test(l) ? [l, l] : null);
  if (all) {
    const o = parseObject(singularPhrase(all[1]));
    if (!o || o.kind === 'spell' || o.kind === 'graveyardCard' || o.kind === 'player' || o.kind === 'opponent' || o.kind === 'any') return null;
    const types = o.kind === 'creature' ? ['Creature' as CardType] : o.filter.types;
    return { targets: [], run: () => {}, each: (ctx) => ctx.permanents({ ...o.filter, types }).map((c) => c.id) };
  }
  if (l === 'other creatures you control' || l === 'each other creature you control') {
    return { targets: [], run: () => {}, each: (ctx) => ctx.creatures({ controller: 'you', other: true }).map((c) => c.id) };
  }
  return null;
}

function action(subject: string, bias: 'opponent' | 'self', fn: (ctx: Ctx, id: string, s: Scratch) => void): Piece | null {
  const subj = permanentsSubject(subject, bias);
  if (!subj || !subj.each) return null;
  return {
    targets: subj.targets,
    run: (ctx, base, s) => {
      for (const id of subj.each!(ctx, base, s)) fn(ctx, id, s);
    },
  };
}

const TOKEN_ARTIFACTS: Record<string, string> = { treasure: 'Treasure Token', clue: 'Clue Token', food: 'Food Token' };

function tokenDef(desc: string, withKw: string | undefined): string | null {
  const l = desc.trim();
  const named = TOKEN_ARTIFACTS[l.toLowerCase()];
  if (named && !withKw) return named;
  const m = l.match(/^(\d+)\/(\d+) ((?:(?:white|blue|black|red|green|colorless)(?:,? and |, | ))+)(.+?) (artifact )?creature$/i);
  if (!m) return null;
  const colors = m[3].toLowerCase().split(/,? and |, | /).filter((c) => c && c !== 'colorless').map((c) => COLOR_WORDS[c]).filter(Boolean);
  const subtypes = m[4].split(/\s+/).filter(Boolean);
  if (!subtypes.every((s) => /^[A-Z]/.test(s))) return null;
  const kws = withKw ? parseKeywordList(withKw) : [];
  if (!kws) return null;
  const name = `${subtypes.join(' ')} ${m[1]}/${m[2]}${kws.length ? ' ' + kws.join(' ') : ''} Token`;
  if (!findDef(name)) {
    registerCards([
      {
        name,
        types: m[5] ? ['Artifact', 'Creature'] : ['Creature'],
        subtypes,
        power: +m[1],
        toughness: +m[2],
        colors: colors as Color[],
        keywords: kws,
        text: kws.join(', '),
        token: true,
      },
    ]);
  }
  return name;
}

function ensureFood() {
  if (findDef('Food Token')) return;
  registerCards([
    {
      name: 'Food Token',
      types: ['Artifact'],
      subtypes: ['Food'],
      colors: [],
      token: true,
      text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
      abilities: [{ text: '{2}, {T}, Sacrifice: You gain 3 life.', cost: { mana: '{2}', tap: true, sacrificeSelf: true }, effect: (ctx) => ctx.gainLife(ctx.controller, 3), aiValue: 0 }],
    },
  ]);
}

type SentenceParser = (s: string) => Piece | null;

const SENTENCES: SentenceParser[] = [
  // Damage
  (s) => {
    const m = s.match(/^CARDNAME deals (\w+) damage to (.+)$/i);
    if (!m) return null;
    const n = num(m[1]);
    if (n === null) return null;
    const to = m[2].toLowerCase();
    if (to === 'each opponent' || to === 'each player' || to === 'you' || to === 'target player' || to === 'target opponent' || to === 'that player') {
      return forPlayers(m[2], 'opponent', (ctx, p) => ctx.damage(p, val(n, ctx)));
    }
    if (to === 'target player or planeswalker' || to === 'target opponent or planeswalker') {
      return forPlayers(to.replace(' or planeswalker', ''), 'opponent', (ctx, p) => ctx.damage(p, val(n, ctx)));
    }
    if (to === 'each creature and each player' || to === 'each creature and each opponent') {
      return {
        targets: [],
        run: (ctx) => {
          ctx.creatures().forEach((c) => ctx.damage(c.id, val(n, ctx)));
          (to.endsWith('player') ? ctx.players() : ctx.opponents()).forEach((p) => ctx.damage(p, val(n, ctx)));
        },
      };
    }
    if (/^any target$|^target /.test(to)) {
      const t = parseTargets(m[2], 'opponent');
      if (!t) return null;
      return {
        targets: t,
        run: (ctx, base, sc) =>
          t.forEach((_x, i) => {
            remember(ctx, base + i, sc);
            ctx.damage(ctx.targets[base + i], val(n, ctx));
          }),
      };
    }
    return action(m[2], 'opponent', (ctx, id) => ctx.damage(id, val(n, ctx)));
  },
  // Draw
  (s) => {
    const m = s.match(/^(?:(you|target player|target opponent|each player|each opponent|that player|its controller|THATPLAYER) )?draws? (\w+) cards?$/i);
    if (!m) return null;
    const n = num(m[2]);
    if (n === null) return null;
    return forPlayers(m[1] ?? 'you', 'self', (ctx, p) => ctx.draw(p, val(n, ctx)));
  },
  // Life
  (s) => {
    const m = s.match(/^(you|target player|target opponent|each player|each opponent|its controller|that player|THATPLAYER) (gains?|loses?) (\w+) life$/i);
    if (!m) return null;
    const n = num(m[3]);
    if (n === null) return null;
    const gain = m[2].toLowerCase().startsWith('gain');
    return forPlayers(m[1], gain ? 'self' : 'opponent', (ctx, p, sc) => {
      if (gain) ctx.gainLife(p, val(n, ctx));
      else {
        ctx.loseLife(p, val(n, ctx));
        sc.lost = (sc.lost ?? 0) + val(n, ctx);
      }
    });
  },
  (s) => {
    const m = s.match(/^(you|its controller|THATPLAYER) (?:gains?|loses?) life equal to (?:its (power|toughness|mana value)|that (?:card|permanent|creature)'s (power|toughness|mana value)|the life lost this way)$/i);
    if (!m) return null;
    const lose = /loses? life/i.test(s);
    const stat = (m[2] ?? m[3])?.toLowerCase();
    return forPlayers(m[1], lose ? 'opponent' : 'self', (ctx, p, sc) => {
      const n = stat ? (stat === 'power' ? sc.lastPower : stat === 'toughness' ? sc.lastToughness : sc.lastCmc) : sc.lost;
      if (lose) ctx.loseLife(p, Math.max(0, n ?? 0));
      else ctx.gainLife(p, Math.max(0, n ?? 0));
    });
  },
  // Destroy / exile / bounce / tap / untap
  (s) => {
    const m = s.match(/^(destroy|exile|tap|untap) (.+)$/i);
    if (!m) return null;
    const verb = m[1].toLowerCase();
    const bias = verb === 'untap' ? 'self' : 'opponent';
    return action(m[2], bias, (ctx, id) => {
      if (verb === 'destroy') ctx.destroy(id);
      else if (verb === 'exile') ctx.exile(id);
      else if (verb === 'tap') ctx.tap(id);
      else ctx.untap(id);
    });
  },
  (s) => {
    const m = s.match(/^return (.+?) to (?:its|their) owners?'s? hands?$/i);
    if (!m || /graveyard/i.test(m[1])) return null;
    return action(m[1], 'opponent', (ctx, id) => ctx.bounce(id));
  },
  (s) => {
    const m = s.match(/^put (.+?) on the (bottom|top) of its owner's library$/i);
    if (!m) return null;
    const bottom = m[2].toLowerCase() === 'bottom';
    return action(m[1], 'opponent', (ctx, id) => ctx.moveCard(id, 'library', { bottom }));
  },
  // Graveyard recursion
  (s) => {
    const m = s.match(/^return (.+? from (?:your|a) graveyard) to (your hand|the battlefield(?: under your control)?)$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'self');
    if (!t || t.some((x) => x.kind !== 'graveyardCard')) return null;
    const toBf = m[2].toLowerCase().startsWith('the battlefield');
    return {
      targets: t,
      run: (ctx, base) =>
        t.forEach((_x, i) => {
          const c = ctx.card(base + i);
          if (!c) return;
          if (toBf) ctx.moveCard(c.id, 'battlefield', { controller: ctx.controller });
          else ctx.moveCard(c.id, 'hand');
        }),
    };
  },
  (s) => {
    const m = s.match(/^put (.+? (?:from|in) (?:your|a) graveyard) onto the battlefield(?: under your control)?( tapped)?$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'self');
    if (!t || t.some((x) => x.kind !== 'graveyardCard')) return null;
    return {
      targets: t,
      run: (ctx, base, sc) =>
        t.forEach((_x, i) => {
          const c = ctx.card(base + i);
          if (!c) return;
          sc.lastCmc = cmcOf(c.def);
          sc.lastId = c.id;
          ctx.moveCard(c.id, 'battlefield', { controller: ctx.controller, tapped: !!m[2] });
        }),
    };
  },
  (s) => {
    const m = s.match(/^(.+?) can't (be blocked|block) this turn$/i);
    if (!m) return null;
    const blocked = m[2].toLowerCase() === 'be blocked';
    return action(m[1], blocked ? 'self' : 'opponent', (ctx, id) => {
      if (blocked) ctx.pump(id, 0, 0, ['Unblockable']);
      else {
        const c = ctx.state.cards[id];
        if (c) c.temp.cantBlock = true;
      }
    });
  },
  (s) => {
    const m = s.match(/^exile (target player's|each opponent's|all|each player's) graveyards?$/i);
    if (!m) return null;
    const w = m[1].toLowerCase();
    const subject = w === "target player's" ? 'target player' : w === "each opponent's" ? 'each opponent' : 'each player';
    return forPlayers(subject, 'opponent', (ctx, p) => {
      for (const id of [...getPlayer(ctx.state, p).graveyard]) ctx.moveCard(id, 'exile');
    });
  },
  // "Return a land you control to its owner's hand" (a choice, not a target)
  (s) => {
    const m = s.match(/^return (a|an|two) (.+?) you control to (?:its|their) owner'?s'? hands?$/i);
    if (!m) return null;
    const o = parseNouns(singularPhrase(m[2]));
    if (!o) return null;
    const n = num(m[1]) as number;
    return { targets: [], run: (ctx) => ctx.chooseAndBounce(ctx.controller, { ...o.filter, types: o.types }, n) };
  },
  // "Sacrifice a land." (you)
  (s) => {
    const m = s.match(/^sacrifice (a|an|two) (.+)$/i);
    if (!m || /cardname/i.test(m[2])) return null;
    const o = parseNouns(singularPhrase(m[2]));
    if (!o) return null;
    const n = num(m[1]) as number;
    return { targets: [], run: (ctx) => ctx.eachSacrifices([ctx.controller], { ...o.filter, types: o.types }, n) };
  },
  // Bite: "Target creature you control deals damage equal to its power to target creature you don't control"
  (s) => {
    const m = s.match(/^(target creature you control|CARDNAME) deals damage equal to its power to (.+)$/i);
    if (!m) return null;
    const self = /cardname/i.test(m[1]);
    const first = self ? [] : parseTargets(m[1], 'self');
    const second = parseTargets(m[2].replace(/(?:, planeswalker,? or battle| or planeswalker| or battle)(?= you don't control| an opponent controls|$)/i, ''), 'opponent');
    if (!first || !second) return null;
    return {
      targets: [...first, ...second],
      run: (ctx, base) => {
        const src = self ? ctx.self : ctx.card(base);
        const t = ctx.targets[base + first.length];
        if (!src || src.zone !== 'battlefield' || !t) return;
        dealDamageFrom(ctx, src.id, t, getPT(ctx.state, src).power);
      },
    };
  },
  // Counter
  (s) => {
    const m = s.match(/^counter (target .*spell)$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'opponent');
    if (!t) return null;
    return {
      targets: t,
      run: (ctx, base) => {
        const x = ctx.targets[base];
        ctx.counterSpell(x && x.type === 'stack' ? x.id : null);
      },
    };
  },
  // Tokens
  (s) => {
    const m = s.match(/^(?:(its controller|that creature's controller|that permanent's controller|that player|THATPLAYER|each player|each opponent|target opponent|target player) )?creates? (\w+) (tapped )?(.+?) tokens?(?: with (.+))?$/i);
    if (!m) return null;
    const subject = m[1];
    m.splice(1, 1);
    const n = num(m[1]);
    if (n === null) return null;
    if (m[3].toLowerCase() === 'food') ensureFood();
    const name = tokenDef(m[3], m[4]);
    if (!name) return null;
    const tapped = !!m[2];
    return forPlayers(subject ?? 'you', 'self', (ctx, p) => {
      const made = ctx.createToken(p, name, val(n, ctx));
      if (tapped) made.forEach((t) => ctx.tap(t));
    });
  },
  // Pump: "X gets +N/+M [and gains K] until end of turn", "X gains K until end of turn"
  (s) => {
    const m = s.match(/^(.+?) (?:gets?|get) ([+-]\w+)\/([+-]\w+)(?: and gains? (.+?))? until end of turn$/i);
    if (!m) return null;
    const p = pm(m[2]);
    const t = pm(m[3]);
    if (p === null || t === null) return null;
    const kws = m[4] ? parseKeywordList(m[4]) : [];
    if (!kws) return null;
    const bias = (typeof p === 'number' && p < 0) || (typeof t === 'number' && t < 0) ? 'opponent' : 'self';
    return action(m[1], bias, (ctx, id) => ctx.pump(id, pmVal(p, ctx), pmVal(t, ctx), kws));
  },
  (s) => {
    const m = s.match(/^(.+?) gains? (.+?) until end of turn$/i);
    if (!m) return null;
    const kws = parseKeywordList(m[2]);
    if (!kws) return null;
    return action(m[1], 'self', (ctx, id) => ctx.pump(id, 0, 0, kws));
  },
  // Counters
  (s) => {
    const m = s.match(/^put (\w+) ([+-]1\/[+-]1) counters? on (.+)$/i);
    if (!m) return null;
    const n = num(m[1]);
    if (n === null) return null;
    const kind = m[2] === '+1/+1' ? '+1/+1' : m[2] === '-1/-1' ? '-1/-1' : null;
    if (!kind) return null;
    return action(m[3], kind === '+1/+1' ? 'self' : 'opponent', (ctx, id) => ctx.addCounters(id, kind, val(n, ctx)));
  },
  // Search library
  (s) => {
    const mm = s.match(/^(?:(its controller|that player|THATPLAYER|target player) (?:may )?searches? their|(?:you may )?search your) library for (.+? cards?)(?: with different names)?, (.+)$/i);
    if (!mm) return null;
    const who = mm[1];
    const m = [mm[0], mm[2], mm[3]];
    const what = m[1].match(/^(?:a|an|up to (\w+)) (?:(.+?) )?cards?$/i);
    if (!what) return null;
    const max = what[1] ? num(what[1]) : 1;
    if (max === null || max === 'X') return null;
    let filter: CardFilter;
    const kind = what[2] ?? '';
    if (/^card$/i.test(kind) || kind === '') filter = {};
    else if (/^basic land$/i.test(kind)) filter = { basicLand: true };
    else {
      const basicPrefix = /^basic /i.test(kind);
      const parts = kind.replace(/^basic /i, '').split(/,\s*or\s+|\s+or\s+|,\s+/);
      if (parts.every((x) => /^(Plains|Island|Swamp|Mountain|Forest)$/.test(x))) {
        filter = { types: ['Land'], subtypes: parts, ...(basicPrefix ? { basicLand: true } : {}) };
      } else {
        const o = parseNouns(kind);
        if (!o) return null;
        filter = { ...o.filter, types: o.types };
      }
    }
    const rest = m[2].toLowerCase();
    const split = /put one onto the battlefield tapped and the other into your hand/.test(rest);
    let dest: 'battlefield' | 'hand' | 'top';
    if (split || /onto the battlefield/.test(rest)) dest = 'battlefield';
    else if (/into your hand/.test(rest)) dest = 'hand';
    else if (/on top/.test(rest)) dest = 'top';
    else return null;
    const tapped = /onto the battlefield tapped/.test(rest);
    return forPlayers(who ?? 'you', 'self', (ctx, p) =>
      ctx.search({ player: p, filter, max, dest, tapped, split, label: `Search your library for ${m[1]}` }),
    );
  },
  (s) => {
    const m = s.match(/^surveil (\w+)$/i);
    const n = m && num(m[1]);
    return n === null || n === undefined ? null : { targets: [], run: () => {}, async: 'surveil', scryN: n };
  },
  (s) => (/^proliferate$/i.test(s) ? { targets: [], run: (ctx) => ctx.proliferate() } : null),
  (s) => (/^you become the monarch$/i.test(s) ? { targets: [], run: (ctx) => ctx.becomeMonarch(ctx.controller) } : null),
  (s) => {
    const m = s.match(/^LOOKTAKE (\d+) (\d+) ?(.*)$/);
    if (!m) return null;
    let filter: CardFilter | null = null;
    if (m[3]) {
      const o = parseNouns(m[3]);
      if (!o) return null;
      filter = { ...o.filter, types: o.types };
    }
    const n = +m[1];
    const max = +m[2];
    return {
      targets: [],
      run: (ctx) => ctx.lookAndTake(ctx.controller, n, max, filter, `Look at the top ${n}: choose up to ${max}${m[3] ? ` ${m[3]}` : ''} to put into your hand`),
    };
  },
  // "Counter target spell unless its controller pays {N}"
  (s) => {
    const m = s.match(/^counter (target .*spell) unless its controller pays (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*)$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'opponent');
    if (!t) return null;
    const k = hkey();
    return {
      targets: t,
      run: (ctx, base) => {
        const x = ctx.targets[base];
        if (!x || x.type !== 'stack') return;
        const owner = ctx.controllerOf(x);
        if (owner) ctx.unlessPays(owner, m[2].toUpperCase(), k, { stackId: x.id });
      },
      handlers: { [k]: (ctx, _a, data) => ctx.counterSpell(data.stackId) },
    };
  },
  (s) => {
    const m = s.match(/^copy (target .*spell)$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'self');
    if (!t) return null;
    return {
      targets: t,
      run: (ctx, base) => {
        const x = ctx.targets[base];
        if (x && x.type === 'stack') ctx.copySpell(x.id);
      },
    };
  },
  (s) => {
    const m = s.match(/^add (\w+) mana of any (?:one )?color( in your commander's color identity)?$/i);
    if (!m) return null;
    const n = num(m[1]);
    if (typeof n !== 'number') return null;
    return { targets: [], run: (ctx) => ctx.addManaChoice(ctx.controller, n, m[2] ? 'identity' : 'any') };
  },
  (s) => {
    const m = s.match(/^create (a|two|three) tokens? that's a copy of (.+)$/i);
    if (!m) return null;
    const n = num(m[1]) as number;
    const subj = permanentsSubject(m[2], 'self');
    if (!subj?.each) return null;
    return {
      targets: subj.targets,
      run: (ctx, base, sc) => {
        for (const id of subj.each!(ctx, base, sc)) {
          const c = ctx.state.cards[id];
          if (c) ctx.createToken(ctx.controller, c.def, n);
        }
      },
    };
  },
  (s) => {
    const m = s.match(/^IMPULSE (\d+) (thisturn|nextturn)$/);
    if (!m) return null;
    const n = +m[1];
    return {
      targets: [],
      run: (ctx) => {
        const st = ctx.state;
        const order = st.players.filter((p) => !p.lost).map((p) => p.id);
        const ai = order.indexOf(st.activePlayer);
        const me = order.indexOf(ctx.controller);
        const dist = (me - ai + order.length) % order.length || order.length;
        const untilTurn = m[2] === 'thisturn' ? st.turn : st.turn + dist;
        const lib = getPlayer(st, ctx.controller).library;
        for (const id of lib.slice(0, n)) {
          ctx.moveCard(id, 'exile');
          st.cards[id].playableBy = { player: ctx.controller, untilTurn };
        }
      },
    };
  },
  (s) => (/^investigate$/i.test(s) ? { targets: [], run: (ctx) => void ctx.createToken(ctx.controller, 'Clue Token') } : null),
  (s) => {
    const m = s.match(/^gain (\w+) life$/i);
    const n = m && num(m[1]);
    return n === null || n === undefined ? null : { targets: [], run: (ctx) => ctx.gainLife(ctx.controller, val(n, ctx)) };
  },
  (s) => {
    if (!/^sacrifice (it|cardname|that creature|that permanent)$/i.test(s)) return null;
    return {
      targets: [],
      run: (ctx, _b, sc) => {
        const id = /cardname/i.test(s) ? ctx.self?.id : sc.lastId ?? ctx.self?.id;
        const c = id ? ctx.state.cards[id] : null;
        if (c && c.zone === 'battlefield') ctx.moveCard(c.id, 'graveyard');
      },
    };
  },
  (s) => {
    const m = s.match(/^untap up to (\w+) lands$/i);
    const n = m && num(m[1]);
    if (typeof n !== 'number') return null;
    return {
      targets: [],
      run: (ctx) => ctx.permanents({ controller: 'you', types: ['Land'] }).filter((c) => c.tapped).slice(0, n).forEach((c) => ctx.untap(c)),
    };
  },
  (s) => {
    if (!/^each player discards their hand$/i.test(s)) return null;
    return { targets: [], run: (ctx) => ctx.players().forEach((p) => [...getPlayer(ctx.state, p).hand].forEach((id) => ctx.moveCard(id, 'graveyard'))) };
  },
  (s) => {
    const m = s.match(/^return (?:it|that card|the exiled card|those cards) to the battlefield( tapped)? under (your|its owner's|their owners') control$/i);
    if (!m) return null;
    return {
      targets: [],
      run: (ctx, _b, sc) => {
        const c = sc.lastId ? ctx.state.cards[sc.lastId] : null;
        if (c && (c.zone === 'exile' || c.zone === 'graveyard')) {
          ctx.moveCard(c.id, 'battlefield', { tapped: !!m[1], controller: m[2].toLowerCase() === 'your' ? ctx.controller : c.owner });
        }
      },
    };
  },
  // Scry
  (s) => {
    const m = s.match(/^scry (\w+)$/i);
    if (!m) return null;
    const n = num(m[1]);
    if (n === null) return null;
    return { targets: [], run: () => {}, async: 'scry', scryN: n };
  },
  // Mill
  (s) => {
    const m = s.match(/^(?:(you|target player|each opponent|each player|target opponent) )?mills? (\w+) cards?$/i);
    if (!m) return null;
    const n = num(m[2]);
    if (n === null) return null;
    return forPlayers(m[1] ?? 'you', 'opponent', (ctx, p) => ctx.mill(p, val(n, ctx)));
  },
  // Sacrifice
  (s) => {
    const m = s.match(/^(each player|each opponent|target player|target opponent) sacrifices (a|an|one|two|three) (.+)$/i);
    if (!m) return null;
    const n = num(m[2]) as number;
    const o = parseNouns(singularPhrase(m[3].replace(/ of their choice$/i, '')));
    if (!o) return null;
    const filter: CardFilter = { ...o.filter, types: o.types };
    const who = players(m[1]);
    if (!who) return null;
    if (typeof who === 'function') return { targets: [], run: (ctx, b, sc) => ctx.eachSacrifices(who(ctx, b, sc), filter, n) };
    return {
      targets: [{ ...who.target, bias: 'opponent' }],
      run: (ctx, base) => {
        const p = ctx.player(base);
        if (p) ctx.eachSacrifices([p], filter, n);
      },
    };
  },
  // Discard
  (s) => {
    const m = s.match(/^(?:(target player|target opponent|each opponent|each player|that player) )?discards? (\w+) cards?( at random)?$/i);
    if (!m) return null;
    const n = num(m[2]);
    if (n === null) return null;
    const random = !!m[3];
    return forPlayers(m[1] ?? 'you', m[1] ? 'opponent' : 'self', (ctx, p) => (random ? ctx.discardRandom(p, val(n, ctx)) : ctx.discard(p, val(n, ctx))));
  },
  // Mana from spells (rituals)
  (s) => {
    const m = s.match(/^add ((?:\{[WUBRGC]\})+)$/i);
    if (!m) return null;
    const syms = (m[1].match(/\{([WUBRGC])\}/gi) ?? []).map((x) => x[1].toUpperCase() as ManaSym);
    return { targets: [], run: (ctx) => syms.forEach((sym) => ctx.addMana(ctx.controller, sym, 1)) };
  },
  // Fight
  (s) => {
    const m = s.match(/^(target creature you control|CARDNAME) fights (target creature (?:you don't control|an opponent controls)|another target creature|up to one target creature (?:you don't control|an opponent controls))$/i);
    if (!m) return null;
    const self = m[1].toLowerCase() === 'cardname';
    const first = self ? [] : parseTargets(m[1], 'self');
    const second = parseTargets(m[2], 'opponent');
    if (!first || !second) return null;
    return {
      targets: [...first, ...second],
      run: (ctx, base) => {
        const a = self ? ctx.self : ctx.card(base);
        const b = ctx.card(base + first.length);
        ctx.fight(a, b);
      },
    };
  },
  // Control change
  (s) => {
    const m = s.match(/^gain control of (target .+) until end of turn$/i);
    if (!m) return null;
    const t = parseTargets(m[1], 'opponent');
    if (!t) return null;
    return {
      targets: t,
      run: (ctx, base, sc) => {
        remember(ctx, base, sc);
        ctx.gainControlUntilEndOfTurn(ctx.card(base));
      },
    };
  },
];

function dealDamageFrom(ctx: Ctx, sourceId: string, t: import('./types').Target, amount: number) {
  ctx.damageFrom(sourceId, t, amount);
}

function pm(s: string): number | 'X' | '-X' | null {
  if (/^[+-]\d+$/.test(s)) return parseInt(s, 10);
  if (s === '+X') return 'X';
  if (s === '-X') return '-X';
  return null;
}
const pmVal = (v: number | 'X' | '-X', ctx: Ctx) => (v === 'X' ? ctx.x : v === '-X' ? -ctx.x : v);

const IGNORABLE = [/^(?:it|they) can't be regenerated$/i, /^then shuffle$/i, /^shuffle$/i, /^you may choose new targets for the cop(?:y|ies)$/i];

function withX(pieces: Piece[], x: (ctx: Ctx, sc: Scratch) => number): Piece[] {
  return pieces.map((p) => ({ ...p, run: (ctx, base, sc) => p.run({ ...ctx, x: x(ctx, sc) }, base, sc) }));
}

/** "... for each X", "..., where X is Y", "... equal to Y": rewrite to an X amount and parse the rest. */
function amountSentence(s: string): Piece[] | null {
  let m = s.match(/^(.*), where X is (.+)$/i);
  if (m) {
    const e = parseExpr(m[2]);
    const inner = e && parseSentence(m[1]);
    if (e && inner) return withX(inner, (ctx, sc) => e(ctx.state, ctx.controller, ctx.source, sc.lastId));
  }
  m = s.match(/^(.*?) for each (.+)$/i);
  if (m) {
    const e = parseCount(m[2]);
    if (!e) return null;
    let body = m[1];
    let base = 1;
    if (/[+-]1\/[+-][01]\b/.test(body)) body = body.replace(/([+-])1\//, '$1X/').replace(/\/([+-])1\b/, '/$1X');
    else {
      const nm = body.match(/\b(a|an|one|two|three|four|five|six|\d+)\b(?!\/)/i);
      if (!nm) return null;
      base = num(nm[1]) as number;
      body = body.slice(0, nm.index) + 'X' + body.slice(nm.index! + nm[0].length);
    }
    const inner = parseSentence(body);
    if (inner) return withX(inner, (ctx) => base * e(ctx.state, ctx.controller, ctx.source));
    return null;
  }
  m = s.match(/^create a number of (.+?) tokens? equal to (.+)$/i);
  if (m) {
    const e = parseExpr(m[2]) ?? parseCount(m[2]);
    const inner = e && parseSentence(`Create X ${m[1]} tokens`);
    if (e && inner) return withX(inner, (ctx, sc) => e(ctx.state, ctx.controller, ctx.source, sc.lastId));
  }
  m = s.match(/^put a number of (.+?) counters on (.+?) equal to (.+)$/i);
  if (m) {
    const e = parseExpr(m[3]) ?? parseCount(m[3]);
    const inner = e && parseSentence(`Put X ${m[1]} counters on ${m[2]}`);
    if (e && inner) return withX(inner, (ctx, sc) => e(ctx.state, ctx.controller, ctx.source, sc.lastId));
  }
  m = s.match(/^(.*?)\b(damage|life|cards) equal to (.+?)(?: to (.+))?$/i);
  if (m) {
    const e = parseExpr(m[3]) ?? parseCount(m[3]);
    if (!e) return null;
    const rewritten = `${m[1]}X ${m[2]}${m[4] ? ` to ${m[4]}` : ''}`;
    const inner = parseSentence(rewritten);
    if (inner) return withX(inner, (ctx, sc) => e(ctx.state, ctx.controller, ctx.source, sc.lastId));
  }
  return null;
}

function parseSentence(raw: string): Piece[] | null {
  const s = raw.trim().replace(/\.$/, '');
  if (!s) return [];
  if (IGNORABLE.some((r) => r.test(s))) return [];
  for (const p of SENTENCES) {
    const r = p(s);
    if (r) return [r];
  }
  if (/for each|where X is|equal to/i.test(s)) {
    const r = amountSentence(s);
    if (r) return r;
  }
  // Compound sentences, inheriting the subject when the second half omits it
  // ("Target player draws two cards and loses 2 life").
  for (const sep of [/, then /i, / and then /i, / and /i]) {
    const parts = s.split(sep);
    if (parts.length < 2) continue;
    const subj = parts[0].match(/^(you|target player|target opponent|each player|each opponent|its controller|that player)\b/i)?.[1];
    const out: Piece[] = [];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let r = parseSentence(part.charAt(0).toUpperCase() + part.slice(1));
      if (!r && i > 0 && subj) {
        const inherited = /^target /i.test(subj) ? 'THATPLAYER' : subj;
        r = parseSentence(`${inherited} ${part}`);
      }
      if (!r) {
        ok = false;
        break;
      }
      out.push(...r);
    }
    if (ok && out.length) return out;
  }
  return null;
}

/** Parse an effect paragraph into targets + effect. Registers continuations on `def.handlers`. */
function normalizeMulti(text: string): string {
  text = text.replace(
    /Exile the top (card|\w+ cards) of your library\. (?:You may play (?:it|that card|them|those cards) this turn|Until (?:the )?end of your next turn, you may play (?:it|that card|them|those cards))\.?/gi,
    (all, what) => {
      const n = what === 'card' ? 1 : num(what.split(' ')[0]);
      if (typeof n !== 'number') return all;
      return `IMPULSE ${n} ${/next turn/i.test(all) ? 'nextturn' : 'thisturn'}. `;
    },
  );
  // "Look at the top N cards of your library. (You may reveal) a/up to N <type> card(s) from among them and put it into your hand.
  //  Put the rest on the bottom of your library in any/a random order."
  return text.replace(
    /Look at the top (\w+) cards of your library\. (?:You may reveal |Reveal |Put )?(an?|one|up to (\w+)) (?:(.+?) cards? )?(?:from among them|of them)(?:,? and put (?:it|them|that card|those cards))? into your hand(?: and the rest on the bottom of your library(?: in (?:any|a random) order)?)?\.?(?:\s*Put the rest (?:on the bottom of your library|into your graveyard)(?: in (?:any|a random) order)?\.?)?/gi,
    (all, n, a, upTo, kind) => {
      const nn = num(n);
      const max = upTo ? num(upTo) : 1;
      if (typeof nn !== 'number' || typeof max !== 'number' || /graveyard/i.test(all)) return all;
      return `LOOKTAKE ${nn} ${max}${kind ? ` ${kind}` : ''}. `;
    },
  );
}

/** Diagnostics for tooling (tests/signatures.ts): failed sentences and trigger conditions. */
export const parseDiagnostics = { sentences: new Map<string, number>(), triggers: new Map<string, number>(), enabled: false };
function note(map: Map<string, number>, s: string) {
  if (parseDiagnostics.enabled) map.set(s, (map.get(s) ?? 0) + 1);
}

function parseEffect(text: string, def: CardDef, key: string, offset = 0): { targets: TargetSpec[]; effect: (ctx: Ctx) => void } | null {
  const sentences = normalizeMulti(text).trim().replace(/\.$/, '').split(/\.\s+/);
  const pieces: Piece[] = [];
  for (const s of sentences) {
    const r = parseSentence(s);
    if (!r) {
      note(parseDiagnostics.sentences, s);
      return null;
    }
    pieces.push(...r);
  }
  if (!pieces.length) return null;
  const targets = pieces.flatMap((p) => p.targets);
  const bases: number[] = [];
  let b = offset;
  for (const p of pieces) {
    bases.push(b);
    b += p.targets.length;
  }
  const runFrom = (ctx: Ctx, start: number, scratch: Scratch) => {
    for (let i = start; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.async) {
        const then = i + 1 < pieces.length ? `${key}:after${i}` : undefined;
        if (p.async === 'scry') ctx.scry(ctx.controller, val(p.scryN!, ctx), then);
        else ctx.surveil(ctx.controller, val(p.scryN!, ctx), then);
        return;
      }
      p.run(ctx, bases[i], scratch);
    }
  };
  pieces.forEach((p, i) => {
    if (p.async && i + 1 < pieces.length) def.handlers![`${key}:after${i}`] = (c2) => runFrom(c2, i + 1, {});
    if (p.handlers) Object.assign(def.handlers!, p.handlers);
  });
  return { targets, effect: (ctx) => runFrom(ctx, 0, {}) };
}

// ---------- Mana abilities ----------

function parseManaProduction(s: string): ActivatedAbility['mana'] | null {
  const t = s.replace(/\.$/, '');
  let m = t.match(/^add ((?:\{[WUBRGC]\})+)$/i);
  if (m) {
    const syms = (m[1].match(/\{([WUBRGC])\}/gi) ?? []).map((x) => x[1].toUpperCase() as ManaSym);
    if (syms.every((x) => x === syms[0])) return { colors: [syms[0]], amount: syms.length };
    return { colors: [...new Set(syms)], fixed: syms };
  }
  m = t.match(/^add ((?:\{[WUBRGC]\}(?:, | or |, or ))+\{[WUBRGC]\})$/i);
  if (m) return { colors: (m[1].match(/\{([WUBRGC])\}/gi) ?? []).map((x) => x[1].toUpperCase() as ManaSym) };
  if (/^add one mana of any color$/i.test(t)) return { colors: 'any' };
  if (/^add one mana of any color in your commander's color identity$/i.test(t)) return { colors: 'identity' };
  if (/^add one mana of any (?:color|type) that a land (?:you control|an opponent controls) could produce$/i.test(t)) return { colors: 'identity' };
  if (/^add two mana of any one color$/i.test(t)) return { colors: 'any', amount: 2 };
  return null;
}

// ---------- Costs ----------

function parseActivationCost(raw: string): Cost | null {
  const cost: Cost = {};
  for (const part of raw.split(/,\s*/)) {
    const p = part.trim();
    if (/^(\{[0-9WUBRGCX]+\})+$/i.test(p)) {
      if (/X/i.test(p)) return null;
      cost.mana = p.toUpperCase();
    } else if (p === '{T}') cost.tap = true;
    else if (/^sacrifice (cardname)$/i.test(p)) cost.sacrificeSelf = true;
    else if (/^sacrifice (a|another) (.+)$/i.test(p)) {
      const m = p.match(/^sacrifice (a|another) (.+)$/i)!;
      const o = parseNouns(m[2]);
      if (!o) return null;
      cost.sacrifice = { ...o.filter, types: o.types, other: m[1].toLowerCase() === 'another' || undefined };
    } else if (/^pay (\d+) life$/i.test(p)) cost.life = +p.match(/(\d+)/)![1];
    else return null;
  }
  return cost;
}

// ---------- Triggers ----------

type TrigSpec = { on: TriggerOn; spellTypes?: CardType[]; spellNotTypes?: CardType[]; condition?: TriggeredAbility['condition'] };
function parseTrigger(cond: string): TrigSpec[] | null {
  const c = cond.toLowerCase().replace(/ the battlefield/g, '');
  const map: [RegExp, TriggerOn][] = [
    [/^when(ever)? cardname enters$/, 'etb'],
    [/^when(ever)? cardname dies$/, 'dies'],
    [/^when(ever)? cardname is put into a graveyard from$/, 'toGraveyardFromBattlefield'],
    [/^when(ever)? cardname leaves$/, 'leaves'],
    [/^whenever cardname attacks$/, 'attacks'],
    [/^whenever cardname deals combat damage to a player$/, 'dealsCombatDamageToPlayer'],
    [/^whenever cardname becomes tapped$/, 'becomesTapped'],
    [/^at the beginning of your upkeep$/, 'yourUpkeep'],
    [/^at the beginning of your end step$/, 'yourEndStep'],
    [/^whenever another creature (?:you control enters|enters under your control)$/, 'otherCreatureEtbYours'],
    [/^whenever (?:a|another) creature enters$/, 'anyOtherCreatureEtb'],
    [/^whenever a land (?:you control enters|enters under your control)$/, 'landfall'],
    [/^whenever you gain life$/, 'youGainLife'],
    [/^whenever (?:cardname or )?(?:a|another) creature you control dies$/, 'creatureYouControlDies'],
    [/^whenever another creature you control dies$/, 'otherCreatureYouControlDies'],
    [/^whenever a creature you control attacks$/, 'creatureYouControlAttacks'],
    [/^whenever equipped creature dies$/, 'equippedCreatureDies'],
    [/^whenever equipped creature attacks$/, 'equippedCreatureAttacks'],
  ];
  if (/^whenever cardname enters or attacks$/.test(c)) return [{ on: 'etb' }, { on: 'attacks' }];
  if (/^whenever cardname or another creature dies$/.test(c)) return [{ on: 'anyDies' }];
  if (/^whenever cardname or another creature you control dies$/.test(c)) return [{ on: 'creatureYouControlDies' }];
  for (const [re, on] of map) if (re.test(c)) return [{ on }];
  // Generic "whenever a/another <thing> [you control] enters/dies".
  const g = cond.replace(/ the battlefield/g, '').match(/^whenever (a|an|another|one or more) (.+?)( you control| an opponent controls)? (enters(?: under your control)?|dies)$/i);
  if (g) {
    const o = parseObject(singularPhrase(g[2]));
    if (!o || (o.kind !== 'creature' && o.kind !== 'permanent')) return null;
    const types: CardType[] | undefined = o.kind === 'creature' ? ['Creature'] : o.filter.types;
    const yours = /you control/i.test(g[3] ?? '') || /under your control/i.test(g[4]);
    const theirs = /opponent/i.test(g[3] ?? '');
    const other = g[1].toLowerCase() === 'another';
    if (/^dies$/i.test(g[4])) {
      return [{
        on: 'anyDies',
        condition: (_s, e, self) => {
          if (e.t !== 'leaves') return false;
          if (other && e.card === self.id) return false;
          if (yours && e.snap.controller !== self.controller) return false;
          if (theirs && e.snap.controller === self.controller) return false;
          if (o.filter.token && !e.snap.token) return false;
          if (o.filter.nontoken && e.snap.token) return false;
          if (types && !types.some((t) => e.snap.types.includes(t))) return false;
          return true;
        },
      }];
    }
    return [{
      on: 'anyEtb',
      condition: (s, e, self) => {
        if (e.t !== 'etb') return false;
        const c = s.cards[e.card];
        if (!c) return false;
        if (other && e.card === self.id) return false;
        if (yours && c.controller !== self.controller) return false;
        if (theirs && c.controller === self.controller) return false;
        if (types && !types.some((t) => hasType(c, t))) return false;
        return matchesFilter(s, c, { ...o.filter, controller: undefined, other: undefined }, self.controller, self.id);
      },
    }];
  }
  const cast = c.match(/^whenever you cast (?:an?|your first) (.+?) spell(?: each turn)?$/);
  if (cast && !/first|each turn/.test(c)) {
    const w = cast[1];
    if (w === 'instant or sorcery') return [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'] }];
    if (w === 'creature') return [{ on: 'youCast', spellTypes: ['Creature'] }];
    if (w === 'noncreature') return [{ on: 'youCast', spellNotTypes: ['Creature'] }];
    if (w === 'artifact') return [{ on: 'youCast', spellTypes: ['Artifact'] }];
    if (w === 'enchantment') return [{ on: 'youCast', spellTypes: ['Enchantment'] }];
  }
  if (/^whenever you cast a spell$/.test(c)) return [{ on: 'youCast' }];
  const simple: [RegExp, TriggerOn][] = [
    [/^at the beginning of each (?:player's )?upkeep$/, 'eachUpkeep'],
    [/^at the beginning of (?:each|the) end step$/, 'eachEndStep'],
    [/^at the beginning of each opponent's end step$/, 'opponentEndStep'],
    [/^at the beginning of your draw step$/, 'yourDrawStep'],
    [/^at the beginning of combat on your turn$/, 'yourBeginCombat'],
    [/^at the beginning of each combat$/, 'eachBeginCombat'],
    [/^whenever you draw a card$/, 'youDraw'],
    [/^whenever an opponent draws a card$/, 'opponentDraws'],
    [/^whenever you attack$/, 'youAttack'],
    [/^when you cast this spell$/, 'castSelf'],
    [/^whenever you discard a card$/, 'youDiscard'],
    [/^whenever a creature you control deals combat damage to a player$/, 'creatureYouControlDealsCombatDamageToPlayer'],
    [/^whenever equipped creature deals combat damage to a player$/, 'equippedCreatureDealsCombatDamageToPlayer'],
    [/^whenever enchanted creature attacks$/, 'enchantedCreatureAttacks'],
  ];
  for (const [re, on] of simple) if (re.test(c)) return [{ on }];
  const oc = c.match(/^whenever (an opponent|a player) casts (?:a|an) (?:(.+?) )?spell$/);
  if (oc) {
    const on: TriggerOn = oc[1] === 'a player' ? 'anyPlayerCasts' : 'opponentCasts';
    const w = oc[2];
    if (!w) return [{ on }];
    if (w === 'instant or sorcery') return [{ on, spellTypes: ['Instant', 'Sorcery'] }];
    if (w === 'creature') return [{ on, spellTypes: ['Creature'] }];
    if (w === 'noncreature') return [{ on, spellNotTypes: ['Creature'] }];
    return null;
  }
  // Copies never trigger here, so "cast or copy" triggers at most as often as it should.
  const cc = c.match(/^whenever you cast or copy an instant or sorcery spell$/);
  if (cc) return [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'] }];
  return null;
}

// ---------- Statics ----------

function parseStatic(line: string): { statics?: StaticAbility[]; keywords?: Keyword[]; dynamicPT?: CardDef['dynamicPT'] } | null {
  const l = line.replace(/\.$/, '');
  // Variable power/toughness.
  let dm = l.match(/^cardname's (power|toughness|power and toughness) (?:is|are each) equal to (.+)$/i);
  if (dm) {
    const e = parseExpr(dm[2]);
    if (!e) return null;
    const which = dm[1].toLowerCase();
    return {
      dynamicPT: (state, self) => {
        const v = e(state, self.controller, self.id);
        return { power: which.includes('power') ? v : 0, toughness: which.includes('toughness') ? v : 0 };
      },
    };
  }
  dm = l.match(/^cardname gets \+(\d+)\/\+(\d+) for each (.+)$/i);
  if (dm) {
    const e = parseCount(dm[3]);
    if (!e) return null;
    const [p, t] = [+dm[1], +dm[2]];
    return {
      dynamicPT: (state, self) => {
        const n = e(state, self.controller, self.id);
        return { power: p * n, toughness: t * n };
      },
    };
  }
  let m = l.match(/^(other )?(.+?) you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?$/i);
  if (m) {
    const o = parseObject(singularPhrase(m[2]));
    if (!o || (o.kind !== 'creature' && o.kind !== 'permanent')) return null;
    const kws = m[5] ? parseKeywordList(m[5]) : [];
    if (!kws) return null;
    const types: CardType[] = o.kind === 'creature' ? ['Creature'] : o.filter.types ?? ['Creature'];
    return { statics: [{ kind: 'anthem', filter: { ...o.filter, types, controller: 'you', other: m[1] ? true : undefined }, power: +m[3], toughness: +m[4], keywords: kws }] };
  }
  m = l.match(/^(other )?(.+?) you control have (.+)$/i);
  if (m) {
    const o = parseObject(singularPhrase(m[2]));
    const kws = parseKeywordList(m[3]);
    if (!o || !kws || (o.kind !== 'creature' && o.kind !== 'permanent')) return null;
    const types: CardType[] = o.kind === 'creature' ? ['Creature'] : o.filter.types ?? ['Creature'];
    return { statics: [{ kind: 'anthem', filter: { ...o.filter, types, controller: 'you', other: m[1] ? true : undefined }, power: 0, toughness: 0, keywords: kws }] };
  }
  m = l.match(/^(?:equipped|enchanted) creature gets ([+-]\d+)\/([+-]\d+)(?: and has (.+))?$/i);
  if (m) {
    const kws = m[3] ? parseKeywordList(m[3]) : [];
    if (!kws) return null;
    return { statics: [{ kind: 'attached', power: +m[1], toughness: +m[2], keywords: kws }] };
  }
  m = l.match(/^(?:equipped|enchanted) creature has (.+)$/i);
  if (m) {
    const kws = parseKeywordList(m[1]);
    if (!kws) return null;
    return { statics: [{ kind: 'attached', keywords: kws }] };
  }
  if (/^enchanted creature can't attack or block$/i.test(l)) return { statics: [{ kind: 'attached', cantAttackOrBlock: true }] };
  if (/^you have no maximum hand size$/i.test(l)) return { statics: [{ kind: 'noMaxHandSize' }] };
  if (/^(?:this spell|cardname) can't be countered$/i.test(l)) return { statics: [{ kind: 'cantBeCountered' }] };
  if (/^cardname can't be blocked$/i.test(l)) return { keywords: ['Unblockable'] };
  return null;
}

/** "you control a Swamp or a Mountain", "you control three or more artifacts", "it's your turn". */
function parseControlCondition(text: string): ((state: GameState, pid: PlayerId) => boolean) | null {
  const t = text.trim().replace(/\.$/, '');
  let m = t.match(/^you control (?:a|an) (\w+)(?: or (?:a|an) (\w+))?$/i);
  if (m && /^[A-Z]/.test(m[1])) {
    const subs = [m[1], m[2]].filter(Boolean) as string[];
    return (state, pid) => battlefieldCards(state).some((c) => c.controller === pid && subs.some((s) => (findDef(c.def)?.subtypes ?? []).includes(s)));
  }
  m = t.match(/^you control (\w+) or more (.+)$/i);
  if (m) {
    const n = num(m[1]);
    const o = parseNouns(singularPhrase(m[2]));
    if (typeof n !== 'number' || !o) return null;
    const f = { ...o.filter, types: o.types, controller: 'you' as const };
    return (state, pid) => battlefieldCards(state).filter((c) => matchesFilter(state, c, f, pid, '')).length >= n;
  }
  m = t.match(/^you control (?:a|an) (.+)$/i);
  if (m) {
    const o = parseNouns(m[1]);
    if (!o) return null;
    const f = { ...o.filter, types: o.types, controller: 'you' as const };
    return (state, pid) => battlefieldCards(state).some((c) => matchesFilter(state, c, f, pid, ''));
  }
  return null;
}

// ---------- ETB-tapped conditions ----------

function parseEntersTapped(line: string, def: CardDef): boolean {
  const l = line.replace(/\.$/, '');
  if (/^cardname enters tapped$/i.test(l)) {
    def.entersTapped = true;
    return true;
  }
  if (/^as cardname enters, you may pay 2 life\. if you don't, it enters tapped$/i.test(l)) {
    def.shockLand = true;
    return true;
  }
  let m = l.match(/^cardname enters tapped unless you have two or more opponents$/i);
  if (m) {
    def.entersTappedIf = (state: GameState, pid: PlayerId) => opponentsOf(state, pid).length < 2;
    return true;
  }
  m = l.match(/^cardname enters tapped unless you control (?:a|an) (\w+)(?: or (?:a|an) (\w+))?$/i);
  if (m) {
    const subs = [m[1], m[2]].filter(Boolean) as string[];
    def.entersTappedIf = (state, pid) =>
      !battlefieldCards(state).some((c) => c.controller === pid && subs.some((s) => (findDef(c.def)?.subtypes ?? []).includes(s)));
    return true;
  }
  m = l.match(/^cardname enters tapped unless you control two or more basic lands$/i);
  if (m) {
    def.entersTappedIf = (state, pid) =>
      battlefieldCards(state).filter((c) => c.controller === pid && (findDef(c.def)?.supertypes ?? []).includes('Basic') && hasType(c, 'Land')).length < 2;
    return true;
  }
  m = l.match(/^cardname enters tapped unless you control two or (fewer|more) other lands$/i);
  if (m) {
    const fewer = m[1].toLowerCase() === 'fewer';
    def.entersTappedIf = (state, pid) => {
      const n = battlefieldCards(state).filter((c) => c.controller === pid && hasType(c, 'Land')).length - 1; // excluding itself
      return fewer ? n > 2 : n < 2;
    };
    return true;
  }
  if (/^cardname enters tapped unless/i.test(l)) {
    // Unknown condition: be conservative.
    def.entersTapped = true;
    def.unsupported!.push(`${line} (always enters tapped here)`);
    return true;
  }
  return false;
}

/** Unparsed text that would be a drawback if ignored: such cards can't be cast at all. */
const DRAWBACKS = [
  /additional cost/i,
  /doesn't untap/i,
  /^skip your/i,
  /cumulative upkeep|^echo\b/i,
  /at the beginning of (?:your|each) (?:upkeep|end step|draw step).*(?:sacrifice|lose|unless|pay|damage to you)/i,
  /sacrifice (?:it|cardname) unless/i,
  /you lose \d+ life|deals? \d+ damage to you/i,

  /^as cardname enters, (?:you may )?(?:pay|sacrifice|discard|exile|return)/i,
  /^when cardname enters, (?:sacrifice|return a|discard|exile a card from your hand)/i,
  /^you can't /i,
  /your opponents? may/i,
];

// ---------- Main conversion ----------

function parseTypeLine(typeLine: string): { supertypes: Supertype[]; types: CardType[]; subtypes: string[] } {
  const [left, right] = typeLine.split(/\s+—\s+/);
  const supertypes: Supertype[] = [];
  const types: CardType[] = [];
  for (const w of left.split(/\s+/)) {
    if (w === 'Legendary' || w === 'Basic') supertypes.push(w);
    else if (TYPE_WORDS[w.toLowerCase()]) types.push(TYPE_WORDS[w.toLowerCase()]);
  }
  return { supertypes, types, subtypes: right ? right.split(/\s+/) : [] };
}

function normalizeOracle(text: string, name: string): string {
  let t = text.replace(/\s*\([^)]*\)/g, '');
  const short = name.includes(',') ? name.split(',')[0] : null;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(escape(name), 'g'), 'CARDNAME');
  if (short && short.length > 3) t = t.replace(new RegExp(`\\b${escape(short)}\\b`, 'g'), 'CARDNAME');
  t = t.replace(/\bthis (creature|artifact|enchantment|land|permanent|equipment|aura|vehicle)\b/gi, 'CARDNAME');
  t = t.replace(/\bthis spell\b/gi, 'this spell');
  return t;
}

function stripAbilityWord(line: string): string {
  return line.replace(/^[A-Z][A-Za-z' -]+ — /, '');
}

export function convertScryfall(card: ScryCard): CardDef {
  const face: ScryFace = card.card_faces && card.card_faces.length && !card.mana_cost && !card.oracle_text ? card.card_faces[0] : card;
  const name = face.name;
  const tl = parseTypeLine(face.type_line ?? card.type_line ?? '');
  const def: CardDef = {
    name,
    cost: face.mana_cost || undefined,
    types: tl.types,
    supertypes: tl.supertypes.length ? tl.supertypes : undefined,
    subtypes: tl.subtypes.length ? tl.subtypes : undefined,
    colors: (face.colors ?? card.colors ?? []).filter((c) => 'WUBRG'.includes(c)) as Color[],
    identity: (card.color_identity ?? []).filter((c) => 'WUBRG'.includes(c)) as Color[],
    text: face.oracle_text ?? '',
    keywords: [],
    abilities: [],
    triggers: [],
    statics: [],
    unsupported: [],
    handlers: {},
    image: face.image_uris?.normal ?? card.image_uris?.normal,
    banned: card.legalities ? card.legalities.commander === 'banned' : undefined,
  };
  if (card.card_faces && card.card_faces.length > 1 && card.layout === 'modal_dfc') {
    // Modal double-faced cards: the back face is its own card. Back-face lands can be played.
    const b = card.card_faces[1];
    const backDef = findDef(b.name) ?? convertScryfall({ ...b, color_identity: card.color_identity, legalities: card.legalities, layout: 'normal' });
    if (!findDef(b.name)) registerCards([backDef]);
    def.backFace = b.name;
    if (!backDef.types.includes('Land')) def.unsupported!.push(`Back face (${b.name}) can't be cast yet`);
  } else if (card.card_faces && card.card_faces.length > 1 && card.layout !== 'split') {
    def.unsupported!.push(`Other face (${card.card_faces.slice(1).map((f) => f.name).join(', ')}) isn't playable yet`);
  }
  if (card.layout === 'split') def.unsupported!.push('Split card: only the first half is playable');
  if (def.types.includes('Creature')) {
    const p = face.power ?? '0';
    const t = face.toughness ?? '0';
    def.power = parseInt(p, 10) || 0;
    def.toughness = parseInt(t, 10) || 0;
    if (/\*/.test(p) || /\*/.test(t)) def.unsupported!.push(`Variable power/toughness (${p}/${t}) is treated as ${def.power}/${def.toughness}`);
  }
  if (def.types.includes('Planeswalker')) def.loyalty = parseInt(face.loyalty ?? (card as ScryFace).loyalty ?? '0', 10) || 0;
  // Basic lands' mana ability comes from their type.
  const basicMana: Record<string, ManaSym> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
  const typeMana = (def.subtypes ?? []).map((s) => basicMana[s]).filter(Boolean);
  if (def.types.includes('Land') && typeMana.length) {
    def.abilities!.push({ text: `{T}: Add ${typeMana.map((c) => `{${c}}`).join(' or ')}.`, cost: { tap: true }, mana: { colors: typeMana } });
  }

  const isSpell = def.types.includes('Instant') || def.types.includes('Sorcery');
  const text = normalizeOracle(face.oracle_text ?? '', name);
  const spellTargets: TargetSpec[] = [];
  const spellEffects: ((ctx: Ctx) => void)[] = [];
  let lineNo = 0;
  let modal: { count: number } | null = null;
  let kickedText: string | null = null;
  const spellLines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = stripAbilityWord(rawLine.trim());
    lineNo++;
    if (!line) continue;
    // Modal spells: "Choose one —" followed by "• mode" lines.
    const cm = line.match(/^choose (one|two) —$/i);
    if (cm && isSpell) {
      modal = { count: cm[1].toLowerCase() === 'one' ? 1 : 2 };
      def.modes = [];
      def.modeCount = modal.count;
      continue;
    }
    if (modal && /^•/.test(line)) {
      const body = line.replace(/^•\s*/, '').replace(/^[A-Z][A-Za-z' -]+ — /, '');
      const eff = parseEffect(body, def, `m${lineNo}`);
      if (eff) def.modes!.push({ text: body, targets: eff.targets, effect: eff.effect });
      else def.unsupported!.push(`${rawLine.trim()} (this mode isn't available)`);
      continue;
    }
    modal = null;
    const add = line.match(/^as an additional cost to cast this spell, sacrifice (a|an) (.+?)\.?$/i);
    if (add) {
      const o = parseNouns(add[2]);
      if (o) {
        def.castSacrifice = { ...o.filter, types: o.types };
        continue;
      }
    }
    const km = isSpell ? line.match(/^if this spell was kicked, (.+)$/i) : null;
    if (km && !/instead/i.test(km[1])) {
      kickedText = km[1];
      continue;
    }
    const before = spellEffects.length;
    if (handleLine(line, rawLine.trim(), def, isSpell, spellTargets, spellEffects, `l${lineNo}`)) {
      if (spellEffects.length > before) spellLines.push(line);
      continue;
    }
    def.unsupported!.push(rawLine.trim());
    if (DRAWBACKS.some((r) => r.test(line))) def.cannotCast = true;
  }
  const kicker: string | undefined = (def as any)._kicker;
  const overload: string | undefined = (def as any)._overload;
  delete (def as any)._kicker;
  delete (def as any)._overload;
  if (kicker) {
    const kicked = kickedText ? parseEffect(kickedText, def, 'kick', spellTargets.length) : null;
    if (kicked && spellEffects.length) {
      const normal = [...spellEffects];
      def.castVariants = [
        ...(def.castVariants ?? []),
        {
          label: `Kicked (${kicker})`,
          extraCost: kicker,
          zone: 'hand',
          targets: [...spellTargets, ...kicked.targets],
          effect: (ctx) => {
            normal.forEach((e) => e(ctx));
            kicked.effect(ctx);
          },
        },
      ];
    } else def.unsupported!.push(`Kicker ${kicker}${kickedText ? ` (if kicked: ${kickedText})` : ''}`);
  }
  if (overload) {
    const parts = spellLines.map((l, i) => parseEffect(l.replace(/\btarget\b/gi, 'each'), def, `ov${i}`));
    if (parts.length && parts.every((p) => p && p.targets.length === 0)) {
      def.castVariants = [
        ...(def.castVariants ?? []),
        { label: `Overload (${overload})`, cost: overload, zone: 'hand', targets: [], effect: (ctx) => parts.forEach((p) => p!.effect(ctx)) },
      ];
    } else def.unsupported!.push(`Overload ${overload}`);
  }
  if (def.modes) {
    if (def.modes.length < (def.modeCount ?? 1)) {
      def.modes = undefined;
      def.cannotCast = true;
    }
  }
  if (/\{[^}]*\/P\}|\{S\}/i.test(def.cost ?? '')) {
    def.cannotCast = true;
    def.unsupported!.push('Phyrexian or snow mana costs');
  }
  if (isSpell && !def.effect && !def.modes && !spellEffects.length) def.cannotCast = true;
  if (isSpell) {
    if (spellEffects.length) {
      def.targets = spellTargets;
      def.effect = (ctx) => spellEffects.forEach((e) => e(ctx));
    }
  }
  // Commander eligibility & partners.
  const lowerText = (face.oracle_text ?? '').toLowerCase();
  if (/can be your commander/.test(lowerText)) def.canBeCommander = true;
  if (/^partner$/m.test(face.oracle_text ?? '')) def.partner = 'partner';
  const pw = (face.oracle_text ?? '').match(/^Partner with ([^\n(]+)/m);
  if (pw) def.partner = { with: pw[1].trim() };
  if (/^friends forever$/im.test(face.oracle_text ?? '')) def.partner = 'friends';
  if (/^choose a background$/im.test(face.oracle_text ?? '')) def.partner = 'chooseBackground';
  if ((def.subtypes ?? []).includes('Background')) def.partner = 'background';
  // Clean empty arrays.
  if (!def.keywords!.length) delete def.keywords;
  if (!def.triggers!.length) delete def.triggers;
  if (!def.statics!.length) delete def.statics;
  return def;
}

function handleLine(
  line: string,
  original: string,
  def: CardDef,
  isSpell: boolean,
  spellTargets: TargetSpec[],
  spellEffects: ((ctx: Ctx) => void)[],
  key: string,
): boolean {
  const l = line.replace(/\.$/, '');
  // Keyword lines ("Flying, vigilance").
  const kws = parseKeywordList(l);
  if (kws) {
    def.keywords!.push(...kws);
    return true;
  }
  if (/^partner(?: with .+)?$|^friends forever$|^choose a background$/i.test(l)) return true;
  const cl = l.match(/^you may have cardname enter(?: the battlefield)? as a copy of (?:any|a) (creature|artifact|permanent)(?: on the battlefield)?$/i);
  if (cl) {
    def.cloneOf = cl[1].toLowerCase() as CardDef['cloneOf'];
    return true;
  }
  if (/^storm$/i.test(l)) {
    def.storm = true;
    return true;
  }
  let km = l.match(/^ward (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*)$/i);
  if (km) {
    def.ward = km[1].toUpperCase();
    return true;
  }
  km = l.match(/^flashback (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*)$/i);
  if (km && isSpell) {
    def.castVariants = [...(def.castVariants ?? []), { label: 'Flashback', cost: km[1].toUpperCase(), zone: 'graveyard', exileAfter: true }];
    return true;
  }
  km = l.match(/^(kicker|overload) (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*)$/i);
  if (km && isSpell) {
    (def as any)[`_${km[1].toLowerCase()}`] = km[2].toUpperCase(); // resolved after all lines are read
    return true;
  }
  km = l.match(/^(basic land|plains|island|swamp|mountain|forest)?cycling (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*)$/i);
  if (km) {
    const kind = km[1]?.toLowerCase();
    const filter: CardFilter | null = !kind ? null : kind === 'basic land' ? { basicLand: true } : { types: ['Land'], subtypes: [kind[0].toUpperCase() + kind.slice(1)] };
    def.handAbilities = [
      ...(def.handAbilities ?? []),
      {
        text: `${km[1] ? km[1][0].toUpperCase() + km[1].slice(1) : 'C'}${km[1] ? 'cycling' : 'ycling'} ${km[2].toUpperCase()}`,
        cost: { mana: km[2].toUpperCase() },
        effect: filter ? (ctx) => ctx.search({ filter, max: 1, dest: 'hand', label: 'Search for a land card' }) : (ctx) => ctx.draw(ctx.controller, 1),
      },
    ];
    return true;
  }
  if (/^if you control a commander, you may cast this spell without paying its mana cost$/i.test(l)) {
    def.castVariants = [
      ...(def.castVariants ?? []),
      {
        label: 'Free (you control a commander)',
        cost: '{0}',
        zone: 'hand',
        condition: (state, pid) => battlefieldCards(state).some((c) => c.controller === pid && c.commander),
      },
    ];
    return true;
  }
  km = l.match(/^you may pay (\{[0-9WUBRGC]+\}(?:\{[0-9WUBRGC]+\})*) rather than pay this spell's mana cost$/i);
  if (km) {
    def.castVariants = [...(def.castVariants ?? []), { label: `Alternative cost ${km[1].toUpperCase()}`, cost: km[1].toUpperCase(), zone: 'hand' }];
    return true;
  }
  if (/^as an additional cost to cast this spell, discard a card$/i.test(l)) {
    def.castDiscard = 1;
    return true;
  }
  let em = l.match(/^cardname enters(?: the battlefield)? with (\w+) ([+-]1\/[+-]1|\w+) counters? on it$/i);
  if (em) {
    const n = num(em[1]);
    if (n === null) return false;
    def.etbCounters = { kind: em[2].toLowerCase(), n };
    return true;
  }
  if (/^this ability triggers only once each turn$/i.test(l) && def.triggers!.length) {
    def.triggers![def.triggers!.length - 1].onceEachTurn = true;
    return true;
  }
  em = l.match(/^cardname can't (block|attack|attack or block)$/i);
  if (em) {
    const w = em[1].toLowerCase();
    if (w.includes('attack')) def.keywords!.push('CantAttack');
    if (w.includes('block')) def.keywords!.push('CantBlock');
    return true;
  }
  em = l.match(/^you may play (an|two) additional lands? on each of your turns$/i);
  if (em) {
    def.statics!.push({ kind: 'extraLand', n: em[1] === 'two' ? 2 : 1 });
    return true;
  }
  if (/can be your commander/i.test(l)) return true;
  let m = l.match(/^equip (\{[0-9WUBRGC]+\})$/i);
  if (m) {
    def.equip = m[1].toUpperCase();
    return true;
  }
  m = l.match(/^enchant (creature|permanent|artifact|land|enchantment|creature you control|creature an opponent controls)$/i);
  if (m) {
    const o = parseObject(m[1]);
    if (!o) return false;
    def.targets = [spec(o, `${m[1]} to enchant`, /you control/.test(m[1]) ? 'self' : 'opponent')];
    return true;
  }
  if (parseEntersTapped(line, def)) return true;

  // Painlands: "{T}: Add {G} or {U}. CARDNAME deals 1 damage to you."
  m = l.match(/^\{T\}: (Add .+?)\. CARDNAME deals (\d+) damage to you$/i);
  if (m) {
    const mana = parseManaProduction(m[1]);
    if (!mana) return false;
    def.abilities!.push({ text: original, cost: { tap: true }, mana: { ...mana, pain: +m[2] } });
    return true;
  }

  // Activated abilities "cost: effect".
  m = line.match(/^([^:"]+?): (.+)$/);
  if (m && !/^(when|whenever|at) /i.test(line)) {
    const lm = m[1].trim().match(/^\[?([+−-]?)(\d+)\]?$/);
    if (lm) {
      // Planeswalker loyalty ability: sorcery speed, once per turn per planeswalker.
      const n = (lm[1] === '+' ? 1 : lm[1] ? -1 : 1) * +lm[2];
      const eff = parseEffect(m[2].replace(/\.$/, ''), def, key);
      if (!eff) return false;
      def.abilities!.push({ text: original, cost: { loyalty: lm[1] || lm[2] !== '0' ? n : 0 }, targets: eff.targets, effect: eff.effect, sorcerySpeed: true, aiValue: n >= 0 && !eff.targets.length ? 1 : 0 });
      return true;
    }
    const cost = parseActivationCost(m[1]);
    if (!cost) return false;
    let effectText = m[2].replace(/\.$/, '');
    let sorcerySpeed = false;
    if (/\. Activate only as a sorcery$/i.test(effectText)) {
      sorcerySpeed = true;
      effectText = effectText.replace(/\. Activate only as a sorcery$/i, '');
    }
    const restriction: Partial<ActivatedAbility> = {};
    let rm: RegExpMatchArray | null;
    while ((rm = effectText.match(/\. Activate (?:this ability )?only (.+?)$/i))) {
      const rOrig = rm[1].replace(/\.$/, '');
      const r = rOrig.toLowerCase();
      effectText = effectText.slice(0, rm.index);
      if (r === 'as a sorcery') sorcerySpeed = true;
      else if (r === 'once each turn') restriction.onceEachTurn = true;
      else if (r === 'during your turn') restriction.yourTurnOnly = true;
      else if (r === 'as a sorcery and only once each turn') {
        sorcerySpeed = true;
        restriction.onceEachTurn = true;
      } else {
        const cond = parseControlCondition(rOrig.replace(/^if /i, ''));
        if (!cond) return false; // unknown restriction: don't hand the ability out
        restriction.condition = (state, self) => cond(state, self.controller);
      }
    }
    if (/Activate only/i.test(effectText)) return false;
    const mana = parseManaProduction(effectText);
    if (mana) {
      def.abilities!.push({ text: original, cost, mana, ...restriction });
      return true;
    }
    const eff = parseEffect(effectText, def, key);
    if (!eff) return false;
    const harmlessSelf = eff.targets.length === 0 && !cost.sacrifice && !cost.life && !cost.sacrificeSelf;
    def.abilities!.push({ text: original, cost, targets: eff.targets, effect: eff.effect, sorcerySpeed, aiValue: harmlessSelf ? 1 : 0, ...restriction });
    return true;
  }

  // Triggered abilities.
  m = line.match(/^((?:when|whenever|at) [^,]+), (.+)$/i);
  if (m) {
    const trig = parseTrigger(m[1]);
    if (!trig) {
      note(parseDiagnostics.triggers, m[1]);
      return false;
    }
    let body = m[2].replace(/\.$/, '');
    let optional = false;
    if (/^you may /i.test(body)) {
      optional = true;
      body = body.replace(/^you may /i, '');
      body = body.charAt(0).toUpperCase() + body.slice(1);
    }
    const eff = parseEffect(body, def, key);
    if (!eff) return false;
    for (const t of trig) {
      const ta: TriggeredAbility = { on: t.on, spellTypes: t.spellTypes, spellNotTypes: t.spellNotTypes, condition: t.condition, text: original, targets: eff.targets.length ? eff.targets : undefined, optional, effect: eff.effect };
      def.triggers!.push(ta);
    }
    return true;
  }

  const st = parseStatic(line);
  if (st) {
    if (st.statics) def.statics!.push(...st.statics);
    if (st.keywords) def.keywords!.push(...st.keywords);
    if (st.dynamicPT) {
      const prev = def.dynamicPT;
      def.dynamicPT = prev
        ? (s, c) => {
            const a = prev(s, c);
            const b = st.dynamicPT!(s, c);
            return { power: a.power + b.power, toughness: a.toughness + b.toughness };
          }
        : st.dynamicPT;
      def.unsupported = def.unsupported!.filter((u) => !u.startsWith('Variable power/toughness'));
    }
    return true;
  }

  if (isSpell) {
    const eff = parseEffect(line, def, key, spellTargets.length);
    if (!eff) return false;
    spellTargets.push(...eff.targets);
    spellEffects.push(eff.effect);
    return true;
  }
  return false;
}

export { getPlayer };
