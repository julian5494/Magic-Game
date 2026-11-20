import type { ActivatedAbility, CardDef, CardFilter, StaticAbility } from './cardtypes';
import { costColors, manaValue } from './mana';
import { getDef, GRANTED, GRANTED_BASE } from './registry';
import type {
  CardId, CardInstance, CardType, Color, GameState, Keyword, Player, PlayerId, Snapshot,
} from './types';
import { COLORS } from './types';

export function getPlayer(state: GameState, id: PlayerId): Player {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.lost);
}

export function opponentsOf(state: GameState, pid: PlayerId): PlayerId[] {
  return alivePlayers(state).filter((p) => p.id !== pid).map((p) => p.id);
}

/** Next living player in turn order after `pid`. */
export function nextPlayer(state: GameState, pid: PlayerId): PlayerId {
  const idx = state.players.findIndex((p) => p.id === pid);
  for (let i = 1; i <= state.players.length; i++) {
    const p = state.players[(idx + i) % state.players.length];
    if (!p.lost) return p.id;
  }
  return pid;
}

/** Living players in APNAP order starting from the active player. */
export function apnapOrder(state: GameState): PlayerId[] {
  const out: PlayerId[] = [];
  const idx = state.players.findIndex((p) => p.id === state.activePlayer);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[(idx + i) % state.players.length];
    if (!p.lost) out.push(p.id);
  }
  return out;
}

export function newId(state: GameState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function log(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, text });
  if (state.log.length > 1000) state.log.splice(0, state.log.length - 1000);
}

export function defOf(card: CardInstance | Snapshot): CardDef {
  return getDef(card.def);
}

export function hasType(card: CardInstance | Snapshot, t: CardType): boolean {
  if ('temp' in card && card.temp.animate && (t === 'Creature' || t === 'Artifact')) return true;
  return defOf(card).types.includes(t);
}

/** A permanent's activated abilities with their indices: its own, then any granted by effects. */
export function abilitiesOf(state: GameState, card: CardInstance): { ab: ActivatedAbility; i: number }[] {
  const out = (defOf(card).abilities ?? []).map((ab, i) => ({ ab, i }));
  if (card.zone === 'battlefield' && hasType(card, 'Artifact') && !(defOf(card).subtypes ?? []).includes('Food') && controllerHasStatic(state, card.controller, 'artifactsAreFood')) {
    out.push({ ab: GRANTED[0], i: GRANTED_BASE });
  }
  return out;
}

/** Card types, including temporary ones ("becomes an artifact creature until end of turn"). */
export function typesOf(card: CardInstance): CardType[] {
  const types = defOf(card).types;
  return card.temp?.animate && !types.includes('Creature') ? [...types, 'Creature'] : types;
}

/** Subtypes, including ones granted by effects (Vihaan's Construct Assassins, Ragost's Foods). */
export function subtypesOf(state: GameState, card: CardInstance): string[] {
  const out = [...(defOf(card).subtypes ?? []), ...(card.temp?.animate?.subtypes ?? [])];
  if (card.zone === 'battlefield' && hasType(card, 'Artifact') && !out.includes('Food') && controllerHasStatic(state, card.controller, 'artifactsAreFood')) out.push('Food');
  return out;
}

export function isCreature(card: CardInstance): boolean {
  return hasType(card, 'Creature');
}

export function defColors(def: CardDef): Color[] {
  if (def.colors) return def.colors;
  return costColors(def.cost);
}

export function colorIdentity(def: CardDef): Color[] {
  const set = new Set<Color>([...defColors(def), ...(def.identity ?? [])]);
  return COLORS.filter((c) => set.has(c));
}

export function commanderIdentity(state: GameState, pid: PlayerId): Color[] {
  const p = getPlayer(state, pid);
  const set = new Set<Color>();
  for (const id of p.commanders) {
    const c = state.cards[id];
    if (c) for (const col of colorIdentity(defOf(c))) set.add(col);
  }
  return COLORS.filter((c) => set.has(c));
}

export function cmc(card: CardInstance | Snapshot): number {
  return manaValue(defOf(card).cost);
}

export function isLegendary(card: CardInstance): boolean {
  return !card.copyNotLegendary && (defOf(card).supertypes ?? []).includes('Legendary');
}

/** Static abilities of the permanents a player controls. */
export function staticsOf(state: GameState, pid: PlayerId): StaticAbility[] {
  const out: StaticAbility[] = [];
  for (const c of battlefieldCards(state)) if (c.controller === pid) for (const st of defOf(c).statics ?? []) out.push(st);
  return out;
}

export function battlefieldCards(state: GameState): CardInstance[] {
  return state.battlefield.map((id) => state.cards[id]).filter(Boolean);
}

/** Permanents attached to `card` (auras and equipment). */
export function attachmentsOf(state: GameState, cardId: CardId): CardInstance[] {
  return battlefieldCards(state).filter((c) => c.attachedTo === cardId);
}

function staticMods(state: GameState, card: CardInstance) {
  let power = 0;
  let toughness = 0;
  const keywords: Keyword[] = [];
  const lost: Keyword[] = [];
  let cantAttackOrBlock = false;
  if (card.zone !== 'battlefield') return { power, toughness, keywords, lost, cantAttackOrBlock };
  for (const src of battlefieldCards(state)) {
    const def = defOf(src);
    if (!def.statics) continue;
    for (const st of def.statics) {
      if (st.kind === 'anthem') {
        if (matchesFilter(state, card, st.filter, src.controller, src.id)) {
          const k = st.scale ? st.scale(state, src, card) : 1;
          power += st.power * k;
          toughness += st.toughness * k;
          if (st.keywords) keywords.push(...st.keywords);
        }
      } else if (st.kind === 'attached' && src.attachedTo === card.id && (!st.condition || st.condition(state, card))) {
        const k = st.scale ? st.scale(state, src, card) : 1;
        power += (st.power ?? 0) * k;
        toughness += (st.toughness ?? 0) * k;
        if (st.keywords) keywords.push(...st.keywords);
        if (st.loseKeywords) lost.push(...st.loseKeywords);
        if (st.cantAttackOrBlock) cantAttackOrBlock = true;
      }
    }
  }
  return { power, toughness, keywords, lost, cantAttackOrBlock };
}

export function getPT(state: GameState, card: CardInstance): { power: number; toughness: number } {
  const def = defOf(card);
  let power = card.temp.animate?.power ?? def.power ?? 0;
  let toughness = card.temp.animate?.toughness ?? def.toughness ?? 0;
  if (def.dynamicPT) {
    const d = def.dynamicPT(state, card);
    power += d.power;
    toughness += d.toughness;
  }
  const plus = card.counters['+1/+1'] ?? 0;
  const minus = card.counters['-1/-1'] ?? 0;
  power += plus - minus + card.temp.power;
  toughness += plus - minus + card.temp.toughness;
  const s = staticMods(state, card);
  return { power: power + s.power, toughness: toughness + s.toughness };
}

export function getKeywords(state: GameState, card: CardInstance): Keyword[] {
  const def = defOf(card);
  const mods = staticMods(state, card);
  const set = new Set<Keyword>([...(def.keywords ?? []), ...card.temp.keywords, ...mods.keywords]);
  for (const k of mods.lost) set.delete(k);
  if (card.dashed) set.add('Haste');
  return [...set];
}

/** Does this permanent have protection from any of these colors? */
export function protectedFrom(state: GameState, card: CardInstance, colors: readonly string[]): boolean {
  if (!colors.length) return false;
  const kws = getKeywords(state, card);
  return colors.some((c) => kws.includes(`Pro${c}` as Keyword));
}

export function hasKeyword(state: GameState, card: CardInstance, kw: Keyword): boolean {
  return getKeywords(state, card).includes(kw);
}

export function cantAttackOrBlock(state: GameState, card: CardInstance): boolean {
  return staticMods(state, card).cantAttackOrBlock;
}

export function controllerHasStatic(state: GameState, pid: PlayerId, kind: string): boolean {
  return battlefieldCards(state).some((c) => c.controller === pid && (defOf(c).statics ?? []).some((s) => s.kind === kind));
}

export function snapshot(state: GameState, card: CardInstance): Snapshot {
  const pt = card.zone === 'battlefield' ? getPT(state, card) : { power: defOf(card).power ?? 0, toughness: defOf(card).toughness ?? 0 };
  return {
    id: card.id,
    def: card.def,
    owner: card.owner,
    controller: card.controller,
    power: pt.power,
    toughness: pt.toughness,
    types: [...typesOf(card)],
    subtypes: subtypesOf(state, card),
    token: card.token,
    commander: card.commander,
    zone: card.zone,
    attachedTo: card.attachedTo,
    linked: [...card.linked],
    counters: { ...card.counters },
  };
}

export function matchesFilter(
  state: GameState,
  card: CardInstance,
  f: CardFilter | undefined,
  controller: PlayerId,
  source: CardId,
): boolean {
  if (!f) return true;
  const def = defOf(card);
  const types = typesOf(card);
  if (f.types && !f.types.some((t) => types.includes(t))) return false;
  if (f.notTypes && f.notTypes.some((t) => types.includes(t))) return false;
  if (f.subtypes && !f.subtypes.some((t) => subtypesOf(state, card).includes(t)) && !(def.keywords ?? []).includes('Changeling')) return false;
  if (f.supertypes && !f.supertypes.some((t) => (def.supertypes ?? []).includes(t))) return false;
  if (f.controller === 'you' && card.controller !== controller) return false;
  if (f.controller === 'opponent' && card.controller === controller) return false;
  if (f.nonland && def.types.includes('Land')) return false;
  const colors = defColors(def);
  if (f.colors && !f.colors.some((c) => colors.includes(c))) return false;
  if (f.notColors && f.notColors.some((c) => colors.includes(c))) return false;
  if (f.maxCmc !== undefined && manaValue(def.cost) > f.maxCmc) return false;
  if (f.minPower !== undefined && getPT(state, card).power < f.minPower) return false;
  if (f.nonlegendary && (def.supertypes ?? []).includes('Legendary')) return false;
  if (f.nontoken && card.token) return false;
  if (f.token && !card.token) return false;
  if (f.other && card.id === source) return false;
  if (f.basicLand && !((def.supertypes ?? []).includes('Basic') && def.types.includes('Land'))) return false;
  if (f.attacking && !state.combat?.attackers.some((a) => a.id === card.id)) return false;
  if (f.attackingOrBlocking) {
    const c = state.combat;
    const inCombat = !!c && (c.attackers.some((a) => a.id === card.id) || c.attackers.some((a) => a.blockedBy.includes(card.id)));
    if (!inCombat) return false;
  }
  if (f.custom && !f.custom(state, card, controller, source)) return false;
  return true;
}

export function devotion(state: GameState, pid: PlayerId, color: Color): number {
  let n = 0;
  for (const c of battlefieldCards(state)) {
    if (c.controller !== pid) continue;
    const cost = defOf(c).cost ?? '';
    n += (cost.match(new RegExp(`\\{${color}\\}`, 'g')) ?? []).length;
  }
  return n;
}

export function isMainPhase(state: GameState): boolean {
  return state.step === 'main1' || state.step === 'main2';
}

export function typeLine(def: CardDef): string {
  const left = [...(def.supertypes ?? []), ...def.types].join(' ');
  const right = (def.subtypes ?? []).join(' ');
  return right ? `${left} — ${right}` : left;
}
