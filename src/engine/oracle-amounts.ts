// Parses amount expressions in rules text: "the number of creatures you control",
// "cards in your hand", "its power", "the greatest power among creatures you control", ...
import type { CardFilter } from './cardtypes';
import { findDef } from './registry';
import { battlefieldCards, devotion, getPlayer, getPT, hasType, matchesFilter, opponentsOf } from './state';
import type { CardId, CardType, Color, GameState, PlayerId } from './types';

export type Expr = (state: GameState, controller: PlayerId, source: CardId, lastId?: string) => number;

const TYPES: Record<string, CardType> = {
  creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', land: 'Land', planeswalker: 'Planeswalker',
  instant: 'Instant', sorcery: 'Sorcery',
};
const COLORS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function sing(w: string): string {
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** "creature", "nontoken creature", "artifact and/or enchantment", "Elf" → filter (types + adjectives). */
function nounFilter(phrase: string): CardFilter | null {
  const f: CardFilter = {};
  const words = phrase.trim().replace(/ and\/or /g, ' or ').split(/\s+(?:or|and)\s+|,\s*(?:or\s+)?|\s+/).filter(Boolean);
  const types: CardType[] = [];
  for (const raw of words) {
    const w = sing(raw.toLowerCase());
    if (TYPES[w]) types.push(TYPES[w]);
    else if (w === 'permanent') continue;
    else if (w === 'nontoken') f.nontoken = true;
    else if (w === 'token') f.token = true;
    else if (w === 'other' || w === 'another') f.other = true;
    else if (w === 'equipped') f.custom = (s, c) => battlefieldCards(s).some((x) => x.attachedTo === c.id && (findDef(x.def)?.subtypes ?? []).includes('Equipment'));
    else if (w === 'attacking') f.attacking = true;
    else if (w === 'tapped') f.custom = (_s, c) => c.tapped;
    else if (w === 'untapped') f.custom = (_s, c) => !c.tapped;
    else if (w === 'basic') f.basicLand = true;
    else if (w === 'legendary') f.supertypes = ['Legendary'];
    else if (w.startsWith('non') && TYPES[w.slice(3)]) f.notTypes = [...(f.notTypes ?? []), TYPES[w.slice(3)]];
    else if (COLORS[w]) f.colors = [...(f.colors ?? []), COLORS[w]];
    else if (/^[A-Z]/.test(raw)) f.subtypes = [...(f.subtypes ?? []), raw === 'Elves' ? 'Elf' : sing(raw)];
    else return null;
  }
  if (types.length) f.types = types;
  return f;
}

function cardsIn(zone: 'graveyard' | 'hand' | 'exile', filterText: string, whose: 'your' | 'all'): Expr | null {
  const f = filterText ? nounFilter(filterText) : {};
  if (!f) return null;
  return (state, controller, source) => {
    const ids = whose === 'your' ? getPlayer(state, controller)[zone] : state.players.filter((p) => !p.lost).flatMap((p) => p[zone]);
    return ids.filter((id) => state.cards[id] && matchesFilter(state, state.cards[id], { ...f, other: undefined }, controller, source)).length;
  };
}

/** Count expression for a "for each X" / "number of X" phrase. */
export function parseCount(raw: string): Expr | null {
  const p = raw.trim().replace(/^the number of /i, '').replace(/^(?:a|an) /i, '');
  const l = p.toLowerCase();
  let m: RegExpMatchArray | null;
  if (/^cards? in your hand$/.test(l)) return (s, c) => getPlayer(s, c).hand.length;
  if (/^opponents? you have$|^opponents?$/.test(l)) return (s, c) => opponentsOf(s, c).length;
  if (/^players?$/.test(l)) return (s) => s.players.filter((x) => !x.lost).length;
  if (/^creatures? that died this turn$/.test(l)) return (s) => s.diedThisTurn ?? 0;
  if (/^spells? you've cast this turn$/.test(l)) return (s, c) => getPlayer(s, c).spellsCast ?? 0;
  if ((m = p.match(/^(.*?)\s*cards? in your graveyard$/i))) return cardsIn('graveyard', m[1], 'your');
  if ((m = p.match(/^(.*?)\s*cards? in all graveyards$/i))) return cardsIn('graveyard', m[1], 'all');
  if ((m = p.match(/^(.*?)\s*cards? in your hand$/i))) return cardsIn('hand', m[1], 'your');
  if ((m = l.match(/^([+\-\w/]+) counters? on (?:cardname|it)$/))) {
    const kind = m[1];
    return (s, _c, src) => s.cards[src]?.counters[kind] ?? 0;
  }
  if (/^basic land types? among lands you control$/.test(l)) {
    return (s, c) => {
      const set = new Set<string>();
      for (const card of battlefieldCards(s)) {
        if (card.controller !== c || !hasType(card, 'Land')) continue;
        for (const st of findDef(card.def)?.subtypes ?? []) if (['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(st)) set.add(st);
      }
      return set.size;
    };
  }
  if (/^colors? among permanents you control$/.test(l)) {
    return (s, c) => {
      const set = new Set<string>();
      for (const card of battlefieldCards(s)) if (card.controller === c) for (const col of findDef(card.def)?.colors ?? []) set.add(col);
      return set.size;
    };
  }
  // Permanents: "<noun phrase> (you control|your opponents control|an opponent controls|on the battlefield)"
  m = p.match(/^(.*?) (you control|your opponents control|an opponent controls|you don't control|on the battlefield)$/i);
  if (m) {
    const f = nounFilter(m[1]);
    if (!f) return null;
    const who = m[2].toLowerCase();
    if (who === 'you control') f.controller = 'you';
    else if (who !== 'on the battlefield') f.controller = 'opponent';
    return (s, c, src) => battlefieldCards(s).filter((card) => matchesFilter(s, card, f, c, src)).length;
  }
  return null;
}

/** Value expression: "its power", "X", "the greatest power among creatures you control", or a count. */
export function parseExpr(raw: string): Expr | null {
  const p = raw.trim().replace(/\.$/, '');
  const l = p.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = l.match(/^(?:its|cardname's|that creature's|the sacrificed creature's|this creature's) (power|toughness|mana value)$/))) {
    const stat = m[1];
    return (s, _c, src, last) => {
      const card = s.cards[last ?? src] ?? s.cards[src];
      if (!card) return 0;
      if (stat === 'mana value') return manaValueOf(card.def);
      const pt = card.zone === 'battlefield' ? getPT(s, card) : { power: findDef(card.def)?.power ?? 0, toughness: findDef(card.def)?.toughness ?? 0 };
      return stat === 'power' ? pt.power : pt.toughness;
    };
  }
  if ((m = l.match(/^the greatest (power|toughness|mana value) among (.+?) you control$/))) {
    const stat = m[1];
    const f = nounFilter(m[2]);
    if (!f) return null;
    return (s, c, src) =>
      Math.max(
        0,
        ...battlefieldCards(s)
          .filter((card) => card.controller === c && matchesFilter(s, card, f, c, src))
          .map((card) => (stat === 'mana value' ? manaValueOf(card.def) : stat === 'power' ? getPT(s, card).power : getPT(s, card).toughness)),
      );
  }
  if ((m = l.match(/^your devotion to (white|blue|black|red|green)$/))) {
    const col = COLORS[m[1]];
    return (s, c) => devotion(s, c, col);
  }
  if (/^the amount of life you(?:'ve)? gained this turn$/.test(l)) return (s, c) => getPlayer(s, c).lifeGainedThisTurn;
  if (/^your life total$/.test(l)) return (s, c) => Math.max(0, getPlayer(s, c).life);
  if (/^the number of cards in your hand$/.test(l)) return (s, c) => getPlayer(s, c).hand.length;
  if (/^the number of /.test(l)) return parseCount(p);
  return null;
}

function manaValueOf(defName: string): number {
  const cost = findDef(defName)?.cost ?? '';
  let n = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(m[1])) n += +m[1];
    else if (m[1] !== 'X') n += m[1].startsWith('2/') ? 2 : 1;
  }
  return n;
}
