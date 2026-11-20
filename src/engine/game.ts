import type { ActivatedAbility, CardDef, CastVariant, StaticAbility } from './cardtypes';
import type { ManaCost, ManaSource } from './mana';
import { costVariants, emptyPool, parseCost, payFromPool, solvePayment } from './mana';
import {
  drawCards, gainLife, legalTargets, loseLife, makeCard, makeCtx, moveCard, pushEvent, queueDecision, runCardHandler,
  sameTarget, shuffle, tapPermanent,
} from './ops';
import { getDef } from './registry';
import {
  advanceStep, canAttack, canBlock, checkStateBased, collectTriggers, finishCleanup, getTrigger, playerLoses,
  processTriggers, putTriggerOnStack, resolveTop, startTurn,
} from './rules';
import {
  alivePlayers, battlefieldCards, commanderIdentity, defColors, defOf, getKeywords, getPlayer, hasKeyword, hasType, isMainPhase,
  log, matchesFilter, newId, nextPlayer, opponentsOf, snapshot, staticsOf,
} from './state';
import type {
  Action, CardId, CardInstance, CardLook, Decision, DecisionAnswer, GameState, ManaSym, PlayableAction, PlayerId, Snapshot, StackItem,
  Target, TargetSpecView,
} from './types';
import { COLORS, DEFAULT_STOPS, STOP_STEPS } from './types';

export class RulesError extends Error {}

// ---------- Mana ----------

function abilityColors(state: GameState, pid: PlayerId, ab: ActivatedAbility): ManaSym[] {
  const m = ab.mana!;
  if (m.fixed) return [...new Set(m.fixed)];
  if (m.colors === 'any') return [...COLORS];
  if (m.colors === 'identity') {
    const id = commanderIdentity(state, pid);
    return id.length ? id : ['C'];
  }
  return m.colors;
}

/** Activation restrictions: "only if ...", "only once each turn", "only during your turn". */
function restrictionsOk(state: GameState, c: CardInstance, ab: ActivatedAbility, index: number): boolean {
  if (ab.condition && !ab.condition(state, c)) return false;
  if (ab.onceEachTurn && c.usedOnTurn?.[`a${index}`] === state.turn) return false;
  if (ab.yourTurnOnly && state.activePlayer !== c.controller) return false;
  return true;
}

function markUsed(state: GameState, c: CardInstance, ab: ActivatedAbility, index: number): void {
  if (ab.onceEachTurn) c.usedOnTurn = { ...(c.usedOnTurn ?? {}), [`a${index}`]: state.turn };
}

function canUseTap(state: GameState, c: CardInstance): boolean {
  if (c.tapped) return false;
  if (hasType(c, 'Creature') && c.sick && !hasKeyword(state, c, 'Haste')) return false;
  return true;
}

export function manaSources(state: GameState, pid: PlayerId, exclude: CardId[] = []): ManaSource[] {
  const out: ManaSource[] = [];
  for (const c of battlefieldCards(state)) {
    if (c.controller !== pid || exclude.includes(c.id)) continue;
    defOf(c).abilities?.forEach((ab, i) => {
      if (!ab.mana || ab.cost.mana || ab.cost.sacrifice) return;
      if (ab.cost.life && getPlayer(state, pid).life < ab.cost.life) return;
      if (ab.cost.tap && !canUseTap(state, c)) return;
      if (!restrictionsOk(state, c, ab, i)) return;
      out.push({
        id: c.id,
        ability: i,
        produces: abilityColors(state, pid, ab),
        amount: ab.mana.count ? ab.mana.count(state, pid) : ab.mana.amount ?? 1,
        costly: !!ab.cost.sacrificeSelf || !!ab.mana.pain || !!ab.cost.life,
        fixed: ab.mana.fixed,
      });
    });
  }
  return out;
}

function activateManaAbility(state: GameState, pid: PlayerId, c: CardInstance, index: number, color?: ManaSym): void {
  const ab = defOf(c).abilities![index];
  const colors = abilityColors(state, pid, ab);
  const sym = color && colors.includes(color) ? color : colors[0];
  markUsed(state, c, ab, index);
  if (ab.cost.tap) tapPermanent(state, c);
  if (ab.cost.sacrificeSelf) moveCard(state, c.id, 'graveyard');
  const pool = getPlayer(state, pid).manaPool;
  if (ab.mana!.fixed) for (const s of ab.mana!.fixed) pool[s]++;
  else pool[sym] += ab.mana!.count ? ab.mana!.count(state, pid) : ab.mana!.amount ?? 1;
  if (ab.mana!.pain) loseLife(state, pid, ab.mana!.pain);
  if (ab.cost.life) loseLife(state, pid, ab.cost.life);
}

/** Convoke, improvise and delve act like extra mana sources while paying for that one spell. */
const CONVOKE = -1;
const IMPROVISE = -2;
const DELVE = -3;

/** How a spell may be helped to be paid for: its card, and whether to use those helpers before real mana. */
interface Help {
  card: CardInstance;
  first?: boolean;
}

function helperSources(state: GameState, pid: PlayerId, help: Help | undefined, exclude: CardId[]): ManaSource[] {
  const kinds = help ? defOf(help.card).costHelp ?? [] : [];
  if (!help || !kinds.length) return [];
  const out: ManaSource[] = [];
  const costly = !help.first;
  const used = new Set<CardId>([help.card.id, ...exclude]);
  for (const c of battlefieldCards(state)) {
    if (c.controller !== pid || c.tapped || used.has(c.id)) continue;
    if (kinds.includes('convoke') && hasType(c, 'Creature')) {
      // A creature pays for {1} or one mana of one of its colors.
      const colors = defColors(defOf(c)) as ManaSym[];
      out.push({ id: c.id, ability: CONVOKE, produces: [...colors, 'C'], amount: 1, costly });
      used.add(c.id);
    } else if (kinds.includes('improvise') && hasType(c, 'Artifact')) {
      out.push({ id: c.id, ability: IMPROVISE, produces: ['C'], amount: 1, costly });
      used.add(c.id);
    }
  }
  if (kinds.includes('delve'))
    for (const id of getPlayer(state, pid).graveyard) if (!used.has(id)) out.push({ id, ability: DELVE, produces: ['C'], amount: 1, costly });
  return out;
}

function findPayment(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[], help?: Help) {
  const pool = getPlayer(state, pid).manaPool;
  let sources = manaSources(state, pid, exclude);
  const extra = helperSources(state, pid, help, exclude);
  // "Use convoke/delve first": real mana becomes the fallback.
  if (help?.first && extra.length) sources = sources.map((s) => ({ ...s, costly: true }));
  sources = [...sources, ...extra];
  for (const v of costVariants(cost)) {
    const plan = solvePayment(v, pool, sources);
    if (plan) return { plan, cost: v };
  }
  return null;
}

function canPay(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[] = [], help?: Help): boolean {
  return findPayment(state, pid, cost, exclude, help) !== null;
}

function pay(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[] = [], help?: Help): void {
  const p = getPlayer(state, pid);
  const found = findPayment(state, pid, cost, exclude, help);
  if (!found) throw new RulesError('Not enough mana');
  const helped: string[] = [];
  for (const t of found.plan.taps) {
    const c = state.cards[t.id];
    if (t.ability === CONVOKE || t.ability === IMPROVISE) {
      tapPermanent(state, c);
      p.manaPool[t.color]++;
      helped.push(c.def);
    } else if (t.ability === DELVE) {
      moveCard(state, c.id, 'exile', { silent: true });
      p.manaPool[t.color]++;
      helped.push(c.def);
    } else activateManaAbility(state, pid, c, t.ability, t.color);
  }
  if (helped.length) {
    const how = (defOf(help!.card).costHelp ?? []).join('/');
    log(state, `${p.name} ${how === 'delve' ? 'exiles' : 'taps'} ${helped.join(', ')} to help pay (${how}).`);
  }
  if (!payFromPool(p.manaPool, found.cost)) throw new RulesError('Mana payment failed');
}

export const HAND_ABILITY = 1000;

function spellCost(state: GameState, card: CardInstance, x: number, variant?: CastVariant, pid: PlayerId = card.owner): ManaCost {
  const def = defOf(card);
  const c = parseCost(variant?.cost ?? def.cost);
  if (variant?.extraCost) {
    const e = parseCost(variant.extraCost);
    for (const k of ['generic', 'W', 'U', 'B', 'R', 'G', 'C'] as const) c[k] += e[k];
    if (e.hybrid) c.hybrid = [...(c.hybrid ?? []), ...e.hybrid];
  }
  if (card.zone === 'command') c.generic += 2 * (getPlayer(state, card.owner).commanderCasts[card.id] ?? 0);
  c.generic += c.x * x;
  c.x = 0;
  // Cost changes: taxes add generic mana, reductions take it away (never below zero).
  let delta = -(def.costReduction?.(state, pid) ?? 0);
  for (const src of battlefieldCards(state)) {
    for (const st of defOf(src).statics ?? []) {
      if (st.kind !== 'costMod') continue;
      const applies = st.whose === 'all' || (st.whose === 'you') === (src.controller === pid);
      if (applies && matchesFilter(state, card, st.filter, pid, src.id)) delta += st.delta;
    }
  }
  c.generic = Math.max(0, c.generic + delta);
  return c;
}

// ---------- Legal actions ----------

function sorceryTiming(state: GameState, pid: PlayerId): boolean {
  return state.activePlayer === pid && isMainPhase(state) && state.stack.length === 0;
}

function specViews(state: GameState, specs: CardDef['targets'], pid: PlayerId, source: CardId): TargetSpecView[] | null {
  const out: TargetSpecView[] = [];
  for (const spec of specs ?? []) {
    const options = legalTargets(state, spec, pid, source);
    if (!spec.optional && options.length === 0) return null;
    out.push({ label: spec.label ?? defaultLabel(spec.kind), optional: !!spec.optional, options });
  }
  return out;
}

function defaultLabel(kind: string): string {
  switch (kind) {
    case 'any':
      return 'any target';
    case 'graveyardCard':
      return 'card in a graveyard';
    default:
      return kind;
  }
}

/** Cards a player may play from somewhere other than their hand, thanks to static abilities they control. */
export function playableElsewhere(
  state: GameState,
  pid: PlayerId,
  statics: StaticAbility[] = staticsOf(state, pid),
): { topLands: CardId[]; topSpells: CardId[]; graveyardLands: CardId[] } {
  const p = getPlayer(state, pid);
  const top = p.library[0] ? state.cards[p.library[0]] : undefined;
  const fromTop = statics.filter((st): st is Extract<StaticAbility, { kind: 'playFromTop' }> => st.kind === 'playFromTop');
  const isLand = !!top && hasType(top, 'Land');
  const topLands = top && isLand && fromTop.some((st) => st.lands) ? [top.id] : [];
  const topSpells =
    top && !isLand && fromTop.some((st) => st.spells && (st.spells === 'any' || matchesFilter(state, top, st.spells, pid, top.id))) ? [top.id] : [];
  const graveyardLands = statics.some((st) => st.kind === 'landsFromGraveyard') ? p.graveyard.filter((id) => hasType(state.cards[id], 'Land')) : [];
  return { topLands, topSpells, graveyardLands };
}

export function canAct(state: GameState, pid: PlayerId): boolean {
  return state.phase === 'playing' && state.decisions.length === 0 && state.priority === pid;
}

export function legalActions(state: GameState, pid: PlayerId): PlayableAction[] {
  const all = allLegalActions(state, pid);
  // Split second: while it's on the stack, only mana abilities can be used.
  if (state.stack.some((it) => it.kind === 'spell' && state.cards[it.cardId] && hasKeyword(state, state.cards[it.cardId], 'Split second')))
    return all.filter((a) => a.type === 'manaTap' || a.isMana);
  return all;
}

function allLegalActions(state: GameState, pid: PlayerId): PlayableAction[] {
  if (!canAct(state, pid)) return [];
  const p = getPlayer(state, pid);
  const out: PlayableAction[] = [];
  const sorcery = sorceryTiming(state, pid);

  // Cards exiled with "you may play it this turn".
  const impulse = Object.values(state.cards)
    .filter((c) => c.zone === 'exile' && c.playableBy?.player === pid && c.playableBy.untilTurn >= state.turn)
    .map((c) => c.id);
  const statics = staticsOf(state, pid);
  const landDrops = 1 + (p.extraLandsThisTurn ?? 0) + statics.reduce((n, st) => n + (st.kind === 'extraLand' ? st.n : 0), 0);
  // Playing from other places: the top of the library (Courser of Kruphix, Future Sight...) and lands from the graveyard.
  const { topLands, topSpells, graveyardLands } = playableElsewhere(state, pid, statics);
  if (sorcery && p.landsPlayed < landDrops) {
    for (const id of [...p.hand, ...impulse, ...topLands, ...graveyardLands]) {
      const def = defOf(state.cards[id]);
      if (hasType(state.cards[id], 'Land') && !def.cannotCast) out.push({ type: 'playLand', cardId: id, label: 'Play land', targets: [] });
      const back = def.backFace ? getDef(def.backFace) : null;
      if (back && back.types.includes('Land') && !back.cannotCast) out.push({ type: 'playLand', cardId: id, label: `Play ${back.name} (back face)`, targets: [], back: true });
    }
  }

  const flash = statics.filter((st): st is Extract<StaticAbility, { kind: 'flash' }> => st.kind === 'flash');
  for (const id of [...p.hand, ...p.command, ...p.graveyard, ...impulse, ...topSpells]) {
    const card = state.cards[id];
    const def = defOf(card);
    if (def.types.includes('Land') || def.cannotCast) continue;
    const fromGraveyard = card.zone === 'graveyard';
    if (fromGraveyard && !def.castVariants?.some((v) => v.zone === 'graveyard')) continue;
    const instantSpeed =
      def.types.includes('Instant') ||
      (def.keywords ?? []).includes('Flash') ||
      flash.some((st) => !st.filter || matchesFilter(state, card, st.filter, pid, id));
    if (!instantSpeed && !sorcery) continue;
    let costCards: CardId[] | undefined;
    let costLabel: string | undefined;
    if (def.castSacrifice) {
      costCards = battlefieldCards(state)
        .filter((c) => c.controller === pid && matchesFilter(state, c, def.castSacrifice, pid, id))
        .map((c) => c.id);
      costLabel = 'Sacrifice (additional cost)';
      if (!costCards.length) continue;
    } else if (def.castDiscard) {
      costCards = p.hand.filter((h) => h !== id);
      costLabel = 'Discard a card (additional cost)';
      if (costCards.length < def.castDiscard) continue;
    }
    const variants: { index?: number; v?: CastVariant }[] = fromGraveyard ? [] : [{}];
    def.castVariants?.forEach((v, index) => {
      if (v.zone !== (fromGraveyard ? 'graveyard' : 'hand')) return;
      if (v.condition && !v.condition(state, pid)) return;
      variants.push({ index, v });
    });
    const help: Help = { card };
    const helps = !!def.costHelp?.length;
    for (const { index, v } of variants) {
      // Extra costs of this way of casting it: life, and a card exiled from hand (Force of Will).
      const lifeCost = (v?.life ?? 0) + (typeof def.castLife === 'number' ? def.castLife : 0);
      if (lifeCost > p.life) continue;
      let vCards = costCards;
      let vLabel = costLabel;
      if (v?.exileFromHand) {
        vCards = p.hand.filter((h) => h !== id && matchesFilter(state, state.cards[h], v.exileFromHand, pid, id));
        vLabel = 'Exile a card from your hand (cost)';
        if (!vCards.length) continue;
      }
      const base = parseCost(v?.cost ?? def.cost);
      let xMax: number | undefined;
      if (base.x > 0) {
        xMax = -1;
        // "Pay X life" can't pay more life than you have.
        const lifeCap = def.castLife === 'X' ? p.life - lifeCost : 30;
        for (let x = 0; x <= Math.min(30, lifeCap); x++) {
          if (canPay(state, pid, spellCost(state, card, x, v, pid), [], help)) xMax = x;
          else break;
        }
        if (xMax < 0) continue;
      } else if (!canPay(state, pid, spellCost(state, card, 0, v, pid), [], help)) continue;
      // "As an additional cost, pay X life" picks an X even when the mana cost has none.
      else if (def.castLife === 'X') xMax = Math.max(0, p.life - lifeCost);
      const extra = { xMax, sacrificeOptions: vCards, sacrificeLabel: vLabel, variant: index };
      const name = v ? `${def.name} — ${v.label}` : def.name;
      const push = (a: PlayableAction) => {
        out.push(a);
        // Convoke/improvise/delve: also offer paying with those first.
        if (helps) out.push({ ...a, label: `${a.label} (${def.costHelp!.join('/')} first)`, helpFirst: true });
      };
      if (def.modes && !v?.effect) {
        const counts = [def.modeCount ?? 1];
        if (def.modeCountWithCommander && battlefieldCards(state).some((c) => c.controller === pid && c.commander)) counts.push(def.modeCountWithCommander);
        for (const combo of counts.flatMap((k) => modeCombos(def.modes!.length, k))) {
          const targets = specViews(state, combo.flatMap((m) => def.modes![m].targets), pid, id);
          if (!targets) continue;
          const label = `Cast ${name}: ${combo.map((m) => def.modes![m].text.replace(/^•\s*/, '')).join(' + ')}`;
          push({ type: 'cast', cardId: id, label, targets, modes: combo, ...extra });
        }
        continue;
      }
      const targets = specViews(state, v?.targets ?? def.targets, pid, id);
      if (!targets) continue;
      push({ type: 'cast', cardId: id, label: `Cast ${name}`, targets, ...extra });
    }
  }

  // Abilities usable from hand (cycling).
  for (const id of p.hand) {
    const def = defOf(state.cards[id]);
    def.handAbilities?.forEach((ab, i) => {
      if (ab.sorcerySpeed && !sorcery) return;
      if (ab.cost.mana && !canPay(state, pid, parseCost(ab.cost.mana), [])) return;
      const targets = specViews(state, ab.targets, pid, id);
      if (!targets) return;
      out.push({ type: 'activate', cardId: id, ability: HAND_ABILITY + i, label: ab.text, targets });
    });
  }

  for (const card of battlefieldCards(state)) {
    if (card.controller !== pid) continue;
    defOf(card).abilities?.forEach((ab, i) => {
      if (ab.mana) {
        if (!ab.cost.mana && !ab.cost.sacrifice) {
          if ((!ab.cost.tap || canUseTap(state, card)) && (!ab.cost.life || p.life >= ab.cost.life) && restrictionsOk(state, card, ab, i)) {
            out.push({ type: 'manaTap', cardId: card.id, ability: i, label: ab.text, targets: [], manaColors: ab.mana.fixed ? undefined : abilityColors(state, pid, ab) });
          }
        } else {
          // Mana abilities with extra costs (Signets, sacrifice outlets) are activated by hand and resolve immediately.
          const a = abilityAction(state, pid, card, i, ab, true);
          if (a) out.push({ ...a, isMana: true, manaColors: ab.mana.fixed ? undefined : abilityColors(state, pid, ab) });
        }
        return;
      }
      const a = abilityAction(state, pid, card, i, ab, sorcery);
      if (a) out.push(a);
    });
  }
  return out;
}

function modeCombos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}

function abilityAction(
  state: GameState,
  pid: PlayerId,
  card: CardInstance,
  i: number,
  ab: ActivatedAbility,
  sorcery: boolean,
): PlayableAction | null {
  if (ab.sorcerySpeed && !sorcery) return null;
  if (ab.cost.tap && !canUseTap(state, card)) return null;
  if (!restrictionsOk(state, card, ab, i)) return null;
  if (ab.cost.loyalty !== undefined) {
    if (!sorcery) return null;
    if (card.usedOnTurn?.loyalty === state.turn) return null;
    if (ab.cost.loyalty < 0 && (card.counters.loyalty ?? 0) < -ab.cost.loyalty) return null;
  }
  if (ab.cost.life && getPlayer(state, pid).life < ab.cost.life) return null;
  let sacrificeOptions: CardId[] | undefined;
  if (ab.cost.sacrifice) {
    sacrificeOptions = battlefieldCards(state)
      .filter((c) => c.controller === pid && matchesFilter(state, c, ab.cost.sacrifice, pid, card.id))
      .map((c) => c.id);
    if (sacrificeOptions.length === 0) return null;
  }
  const exclude = ab.cost.tap || ab.cost.sacrificeSelf ? [card.id] : [];
  if (ab.cost.mana && !canPay(state, pid, parseCost(ab.cost.mana), exclude)) return null;
  let targets = specViews(state, ab.targets, pid, card.id);
  if (!targets) return null;
  if (ab.equip) {
    targets = targets.map((t) => ({ ...t, options: t.options.filter((o) => o.id !== card.attachedTo) }));
    if (targets[0].options.length === 0) return null;
  }
  return {
    type: 'activate',
    cardId: card.id,
    ability: i,
    label: ab.text,
    targets,
    sacrificeOptions,
    sacrificeLabel: sacrificeOptions ? 'Choose a permanent to sacrifice' : undefined,
  };
}

function validateTargets(views: TargetSpecView[], given: (Target | null)[] | undefined): (Target | null)[] {
  const chosen = given ?? [];
  if (views.length === 0) return [];
  if (chosen.length !== views.length) throw new RulesError('Wrong number of targets');
  return views.map((v, i) => {
    const t = chosen[i];
    if (!t) {
      if (!v.optional) throw new RulesError(`Missing target: ${v.label}`);
      return null;
    }
    const match = v.options.find((o) => sameTarget(o, t));
    if (!match) throw new RulesError(`Illegal target for ${v.label}`);
    return match;
  });
}

// ---------- Applying actions ----------

export function applyAction(state: GameState, pid: PlayerId, action: Action): void {
  const p = getPlayer(state, pid);
  if (p.lost && action.type !== 'setAutoPass') throw new RulesError('You have left the game');
  switch (action.type) {
    case 'setAutoPass':
      p.autoPass = action.mode;
      return;
    case 'setStops': {
      const clean = (steps: unknown) => (Array.isArray(steps) ? STOP_STEPS.filter((st) => steps.includes(st)) : []);
      p.stops = { mine: clean(action.mine), theirs: clean(action.theirs) };
      return;
    }
    case 'passUntilEndOfTurn':
      p.passUntilTurn = state.turn;
      if (state.priority === pid && state.decisions.length === 0) doPass(state, pid);
      return;
    case 'concede':
      playerLoses(state, pid, 'conceded');
      return;
    case 'decide':
      return applyDecision(state, pid, action.decisionId, action.answer);
  }
  if (!canAct(state, pid)) throw new RulesError("You don't have priority");

  if (action.type === 'pass') {
    doPass(state, pid);
    return;
  }

  const legal = legalActions(state, pid);
  if (action.type === 'playLand') {
    if (!legal.some((a) => a.type === 'playLand' && a.cardId === action.cardId && !!a.back === !!action.back)) throw new RulesError("Can't play that land now");
    p.landsPlayed++;
    if (action.back) {
      const c = state.cards[action.cardId];
      c.frontDef = c.def;
      c.def = defOf(c).backFace!;
    }
    log(state, `${p.name} plays ${state.cards[action.cardId].def}.`);
    moveCard(state, action.cardId, 'battlefield', { controller: pid });
    return;
  }

  if (action.type === 'manaTap') {
    const a = legal.find((l) => l.type === 'manaTap' && l.cardId === action.cardId && l.ability === action.ability);
    if (!a) throw new RulesError("Can't activate that mana ability");
    activateManaAbility(state, pid, state.cards[action.cardId], action.ability, action.color);
    return;
  }

  if (action.type === 'cast') {
    const modesKey = (m?: number[]) => (m ?? []).join(',');
    const a = legal.find(
      (l) =>
        l.type === 'cast' && l.cardId === action.cardId && modesKey(l.modes) === modesKey(action.modes) && l.variant === action.variant && !!l.helpFirst === !!action.helpFirst,
    );
    if (!a) throw new RulesError("Can't cast that now");
    const card = state.cards[action.cardId];
    const def = defOf(card);
    const targets = validateTargets(a.targets, action.targets);
    const x = a.xMax !== undefined ? Math.max(0, Math.min(action.x ?? 0, a.xMax)) : 0;
    if (a.sacrificeOptions && (!action.sacrifice || !a.sacrificeOptions.includes(action.sacrifice))) {
      throw new RulesError('Choose a permanent to sacrifice');
    }
    const fromCommand = card.zone === 'command';
    const variant = a.variant !== undefined ? def.castVariants![a.variant] : undefined;
    pay(state, pid, spellCost(state, card, x, variant, pid), [], { card, first: !!action.helpFirst });
    const lifeCost = (variant?.life ?? 0) + (def.castLife === 'X' ? x : def.castLife ?? 0);
    if (lifeCost > 0) {
      log(state, `${p.name} pays ${lifeCost} life.`);
      loseLife(state, pid, lifeCost);
    }
    let sacrificed: Snapshot | undefined;
    if (a.sacrificeOptions) {
      const sc = state.cards[action.sacrifice!];
      if (variant?.exileFromHand) {
        log(state, `${p.name} exiles ${sc.def} from their hand.`);
        moveCard(state, sc.id, 'exile', { silent: true });
      } else if (def.castDiscard) {
        log(state, `${p.name} discards ${sc.def}.`);
        moveCard(state, sc.id, 'graveyard');
      } else {
        sacrificed = snapshot(state, sc);
        moveCard(state, sc.id, 'graveyard');
      }
    }
    if (fromCommand) p.commanderCasts[card.id] = (p.commanderCasts[card.id] ?? 0) + 1;
    moveCard(state, card.id, 'stack', { controller: pid });
    card.x = x;
    state.stack.push({
      id: newId(state, 's'),
      kind: 'spell',
      controller: pid,
      cardId: card.id,
      def: def.name,
      targets,
      text: a.modes ? a.label.replace(/^Cast [^:]+: /, '') : def.text ?? '',
      x,
      sacrificed,
      modes: a.modes,
      variant: a.variant,
    });
    log(state, `${p.name} casts ${def.name}${a.modes ? ` (${a.label.replace(/^Cast [^:]+: /, '')})` : ''}${x ? ` (X=${x})` : ''}${describeTargets(state, targets)}.`);
    pushEvent(state, { t: 'cast', card: card.id, controller: pid, def: def.name });
    const before = state.spellsThisTurn ?? 0;
    state.spellsThisTurn = before + 1;
    const top = state.stack[state.stack.length - 1];
    if (def.storm && before > 0) {
      for (let i = 0; i < before; i++) state.stack.push({ ...top, id: newId(state, 's'), isCopy: true });
      log(state, `Storm: ${before} cop${before === 1 ? 'y' : 'ies'} of ${def.name}.`);
    }
    checkWard(state, pid, top);
    state.passes = [];
    p.holding = !!action.hold;
    return;
  }

  if (action.type === 'activate') {
    const a = legal.find((l) => l.type === 'activate' && l.cardId === action.cardId && l.ability === action.ability);
    if (!a) throw new RulesError("Can't activate that now");
    const card = state.cards[action.cardId];
    const def = defOf(card);
    if (action.ability >= HAND_ABILITY) {
      const hab = def.handAbilities![action.ability - HAND_ABILITY];
      const targets = validateTargets(a.targets, action.targets);
      if (hab.cost.mana) pay(state, pid, parseCost(hab.cost.mana), []);
      log(state, `${p.name} discards ${def.name}: ${hab.text}.`);
      const snap = snapshot(state, card);
      moveCard(state, card.id, 'graveyard');
      state.stack.push({ id: newId(state, 's'), kind: 'ability', controller: pid, cardId: card.id, def: def.name, index: action.ability, targets, text: hab.text, sourceSnapshot: snap });
      state.passes = [];
      return;
    }
    const ab = def.abilities![action.ability];
    const targets = validateTargets(a.targets, action.targets);
    let sacrificed: Snapshot | undefined;
    if (ab.cost.sacrifice) {
      if (!action.sacrifice || !a.sacrificeOptions!.includes(action.sacrifice)) throw new RulesError('Choose a permanent to sacrifice');
    }
    markUsed(state, card, ab, action.ability);
    if (ab.cost.loyalty !== undefined) {
      card.counters.loyalty = (card.counters.loyalty ?? 0) + ab.cost.loyalty;
      card.usedOnTurn = { ...(card.usedOnTurn ?? {}), loyalty: state.turn };
    }
    const inc = card.inc;
    const sourceSnap = snapshot(state, card);
    if (ab.cost.mana) pay(state, pid, parseCost(ab.cost.mana), ab.cost.tap || ab.cost.sacrificeSelf ? [card.id] : []);
    if (ab.cost.tap) tapPermanent(state, card);
    if (ab.cost.life) loseLife(state, pid, ab.cost.life);
    if (ab.cost.sacrifice) {
      const sc = state.cards[action.sacrifice!];
      sacrificed = snapshot(state, sc);
      moveCard(state, sc.id, 'graveyard');
    }
    if (ab.cost.sacrificeSelf) {
      sacrificed = sacrificed ?? sourceSnap;
      moveCard(state, card.id, 'graveyard');
    }
    if (ab.mana) {
      // Mana abilities don't use the stack.
      const colors = abilityColors(state, pid, ab);
      const sym = action.color && colors.includes(action.color) ? action.color : colors[0];
      if (ab.mana.fixed) for (const s of ab.mana.fixed) p.manaPool[s]++;
      else p.manaPool[sym] += ab.mana.count ? ab.mana.count(state, pid) : ab.mana.amount ?? 1;
      if (ab.mana.pain) loseLife(state, pid, ab.mana.pain);
      return;
    }
    state.stack.push({
      id: newId(state, 's'),
      kind: 'ability',
      controller: pid,
      cardId: card.id,
      sourceInc: inc,
      def: def.name,
      index: action.ability,
      targets,
      text: ab.text,
      sacrificed,
      sourceSnapshot: sourceSnap,
    });
    log(state, `${p.name} activates ${def.name}: ${ab.text}${describeTargets(state, targets)}.`);
    checkWard(state, pid, state.stack[state.stack.length - 1]);
    state.passes = [];
    p.holding = !!action.hold;
    return;
  }
  throw new RulesError('Unknown action');
}

/** Ward: targeting an opponent's warded permanent means paying the ward cost or being countered. */
export function checkWard(state: GameState, pid: PlayerId, item: StackItem | undefined): void {
  if (!item) return;
  for (const t of item.targets) {
    if (!t || t.type !== 'card') continue;
    const c = state.cards[t.id];
    const ward = c && c.zone === 'battlefield' && c.controller !== pid ? defOf(c).ward : undefined;
    if (!ward) continue;
    queueDecision(state, {
      player: pid,
      kind: 'chooseOption',
      prompt: `${c.def} has ward ${ward}. Pay it, or your ${item.def} is countered.`,
      options: [
        { id: 'pay', label: `Pay ${ward}` },
        { id: 'no', label: "Don't pay" },
      ],
      handler: 'core:unlessPay',
      data: { cost: ward, counterStack: item.id },
    });
  }
}

function describeTargets(state: GameState, targets: (Target | null)[]): string {
  const names = targets.filter(Boolean).map((t) => {
    if (t!.type === 'player') return getPlayer(state, t!.id).name;
    if (t!.type === 'card') return state.cards[t!.id]?.def ?? '?';
    return state.stack.find((s) => s.id === t!.id)?.def ?? 'a spell';
  });
  return names.length ? ` targeting ${names.join(', ')}` : '';
}

function doPass(state: GameState, pid: PlayerId): void {
  getPlayer(state, pid).holding = false;
  state.passes.push(pid);
  const alive = alivePlayers(state);
  if (alive.every((pl) => state.passes.includes(pl.id))) {
    state.passes = [];
    if (state.stack.length > 0) {
      resolveTop(state);
      state.priority = state.activePlayer;
    } else {
      advanceStep(state);
    }
  } else {
    state.priority = nextPlayer(state, pid);
  }
}

// ---------- Decisions ----------

function validateAnswer(state: GameState, d: Decision, a: DecisionAnswer): void {
  if (d.kind === 'chooseCards' || d.kind === 'mulligan') {
    if (d.kind === 'mulligan') {
      if (!d.options!.some((o) => o.id === a.option)) throw new RulesError('Invalid choice');
      return;
    }
    const cards = a.cards ?? [];
    if (new Set(cards).size !== cards.length) throw new RulesError('Duplicate cards');
    if (cards.some((c) => !d.cards!.includes(c))) throw new RulesError('Invalid card choice');
    if (cards.length < (d.min ?? 0) || cards.length > (d.max ?? cards.length)) {
      throw new RulesError(`Choose between ${d.min} and ${d.max} cards`);
    }
  } else if (d.kind === 'chooseOption') {
    if (!d.options!.some((o) => o.id === a.option)) throw new RulesError('Invalid choice');
  } else if (d.kind === 'chooseTargets') {
    validateTargets(d.targetSpecs!, a.targets);
  }
}

function applyDecision(state: GameState, pid: PlayerId, decisionId: string, answer: DecisionAnswer): void {
  // During mulligans everyone decides simultaneously; otherwise decisions are answered in order.
  const idx = state.phase === 'mulligan' ? state.decisions.findIndex((x) => x.id === decisionId) : 0;
  const d = state.decisions[idx];
  if (!d || d.id !== decisionId) throw new RulesError('That decision is not active');
  if (d.player !== pid) throw new RulesError('Not your decision');
  validateAnswer(state, d, answer);
  state.decisions.splice(idx, 1);
  const h = HANDLERS[d.handler];
  if (!h) throw new Error(`No handler ${d.handler}`);
  h(state, d, answer);
  // Effects that were waiting on these choices carry on.
  while (state.decisions.length === 0 && state.continuations?.length) runCardHandler(state, state.continuations.shift()!, {});
}

type Handler = (state: GameState, d: Decision, a: DecisionAnswer) => void;

const HANDLERS: Record<string, Handler> = {
  'core:mulligan': (state, d, a) => {
    const p = getPlayer(state, d.player);
    if (a.option === 'keep') {
      const n = Math.max(0, p.mulligans - 1); // first mulligan is free in Commander
      log(state, `${p.name} keeps ${7 - n} cards.`);
      if (n > 0) {
        queueDecision(
          state,
          {
            player: p.id,
            kind: 'chooseCards',
            prompt: `Choose ${n} card${n > 1 ? 's' : ''} to put on the bottom of your library`,
            cards: [...p.hand],
            min: n,
            max: n,
            handler: 'core:bottom',
            privateCards: true,
          },
          true,
        );
      } else p.kept = true;
      return;
    }
    p.mulligans++;
    log(state, `${p.name} mulligans.`);
    for (const id of [...p.hand]) moveCard(state, id, 'library');
    shuffle(state, p.library);
    drawCards(state, p.id, 7);
    queueDecision(state, mulliganDecision(state, p.id), true);
  },
  'core:bottom': (state, d, a) => {
    const p = getPlayer(state, d.player);
    for (const id of a.cards!) moveCard(state, id, 'library', { bottom: true });
    p.kept = true;
  },
  'core:attackers': (state, d, a) => {
    const combat = state.combat!;
    const list = a.attackers ?? [];
    const ids = new Set<string>();
    for (const at of list) {
      if (ids.has(at.id)) throw new RulesError('Creature declared twice');
      ids.add(at.id);
      const c = state.cards[at.id];
      if (!d.attackers!.includes(at.id) || !c || !canAttack(state, c)) throw new RulesError('That creature cannot attack');
      if (!d.defenders!.includes(at.defender)) throw new RulesError('Invalid defending player');
      if (at.planeswalker) {
        const pw = state.cards[at.planeswalker];
        if (!d.planeswalkers?.includes(at.planeswalker) || !pw || pw.controller !== at.defender) throw new RulesError('Invalid planeswalker to attack');
      }
    }
    combat.attackers = list.map((at) => ({ id: at.id, defender: at.defender, planeswalker: at.planeswalker, blockedBy: [], blocked: false }));
    for (const at of list) {
      const c = state.cards[at.id];
      if (!hasKeyword(state, c, 'Vigilance')) tapPermanent(state, c);
    }
    if (list.length) pushEvent(state, { t: 'attackDeclared', player: d.player, count: list.length });
    for (const at of list) pushEvent(state, { t: 'attacks', card: at.id, defender: at.defender, alone: list.length === 1 });
    if (list.length) {
      const byDef = new Map<string, string[]>();
      for (const at of list) byDef.set(at.defender, [...(byDef.get(at.defender) ?? []), state.cards[at.id].def]);
      for (const [def, names] of byDef) log(state, `${getPlayer(state, d.player).name} attacks ${getPlayer(state, def).name} with ${names.join(', ')}.`);
    }
    state.priority = state.activePlayer;
  },
  'core:blockers': (state, d, a) => {
    const combat = state.combat!;
    const blocks = a.blocks ?? [];
    const used = new Set<string>();
    for (const b of blocks) {
      if (used.has(b.blocker)) throw new RulesError('A creature can block only one attacker');
      used.add(b.blocker);
      const B = state.cards[b.blocker];
      const A = state.cards[b.attacker];
      if (!d.blockers!.includes(b.blocker) || !d.attacking!.includes(b.attacker) || !B || !A || !canBlock(state, B, A)) {
        throw new RulesError(`${B?.def ?? 'That creature'} can't block ${A?.def ?? 'that'}`);
      }
    }
    // Menace check
    for (const atk of d.attacking!) {
      const n = blocks.filter((b) => b.attacker === atk).length;
      if (n === 1 && hasKeyword(state, state.cards[atk], 'Menace')) {
        throw new RulesError(`${state.cards[atk].def} has menace and must be blocked by two or more creatures`);
      }
    }
    for (const b of blocks) {
      const info = combat.attackers.find((x) => x.id === b.attacker)!;
      info.blockedBy.push(b.blocker);
      info.blocked = true;
    }
    if (blocks.length) {
      log(state, `${getPlayer(state, d.player).name} blocks: ${blocks.map((b) => `${state.cards[b.blocker].def} → ${state.cards[b.attacker].def}`).join(', ')}.`);
    }
    if (!state.decisions.some((x) => x.handler === 'core:blockers')) state.priority = state.activePlayer;
  },
  'core:triggerTargets': (state, d, a) => {
    const targets = validateTargets(d.targetSpecs!, a.targets);
    putTriggerOnStack(state, d.data.trig, targets);
  },
  'core:optional': (state, d, a) => {
    if (a.option !== 'yes') return;
    const { init, kind, index } = d.data;
    const def = getDef(init.def);
    const ability = kind === 'ability' ? def.abilities![index] : getTrigger(init.def, index);
    ability.effect?.(makeCtx(state, init));
  },
  'core:shock': (state, d, a) => {
    const c = state.cards[d.data.card];
    if (!c || c.inc !== d.data.inc || c.zone !== 'battlefield') return;
    if (a.option === 'pay') {
      loseLife(state, d.player, 2);
      log(state, `${getPlayer(state, d.player).name} pays 2 life for ${c.def}.`);
    } else c.tapped = true;
  },
  'core:commanderZone': (state, d, a) => {
    const c = state.cards[d.data.card];
    if (a.option !== 'yes' || !c || c.inc !== d.data.inc) return;
    moveCard(state, c.id, 'command');
    log(state, `${c.def} returns to the command zone.`);
  },
  'core:cleanupDiscard': (state, _d, a) => {
    for (const id of a.cards!) moveCard(state, id, 'graveyard');
    finishCleanup(state);
  },
  'core:sacrifice': (state, d, a) => {
    for (const id of a.cards!) if (state.cards[id]?.zone === 'battlefield') moveCard(state, id, 'graveyard');
    log(state, `${getPlayer(state, d.player).name} sacrifices ${a.cards!.map((id) => state.cards[id]?.def ?? 'a token').join(', ')}.`);
  },
  'core:orderTrigger': (state, d, a) => {
    const mine = state.pendingTriggers.filter((t) => t.controller === d.data.controller);
    const pick = mine[Number(a.option)];
    if (!pick) return;
    state.pendingTriggers = [pick, ...state.pendingTriggers.filter((t) => t !== pick)];
    pick.chosen = true;
  },
  'core:surveil': (state, d, a) => {
    for (const id of a.cards!) moveCard(state, id, 'graveyard');
    log(state, `${getPlayer(state, d.player).name} surveils, putting ${a.cards!.length} into their graveyard.`);
    if (d.data?.then) runCardHandler(state, d.data.then, {});
  },
  'core:unlessPay': (state, d, a) => {
    if (a.option === 'pay' && canPay(state, d.player, parseCost(d.data.cost))) {
      pay(state, d.player, parseCost(d.data.cost));
      log(state, `${getPlayer(state, d.player).name} pays ${d.data.cost}.`);
      return;
    }
    if (d.data.counterStack) {
      const idx = state.stack.findIndex((s) => s.id === d.data.counterStack);
      if (idx >= 0) {
        const item = state.stack.splice(idx, 1)[0];
        if (item.kind === 'spell' && !item.isCopy) moveCard(state, item.cardId, 'graveyard');
        log(state, `${item.def} is countered by ward.`);
      }
      return;
    }
    runCardHandler(state, d.data.fail, {});
  },
  'core:manaChoice': (state, d, a) => {
    const sym = a.option as ManaSym;
    getPlayer(state, d.player).manaPool[sym] += d.data.n;
  },
  'core:clone': (state, d, a) => {
    const c = state.cards[d.data.card];
    if (!c || c.inc !== d.data.inc || c.zone !== 'battlefield') return;
    const pick = a.cards?.[0] ? state.cards[a.cards[0]] : null;
    if (pick) {
      c.frontDef = c.frontDef ?? c.def;
      c.def = pick.def;
      log(state, `${c.frontDef} enters as a copy of ${pick.def}.`);
    }
    pushEvent(state, { t: 'etb', card: c.id, controller: c.controller });
  },
  'core:bounceChosen': (state, _d, a) => {
    for (const id of a.cards!) if (state.cards[id]?.zone === 'battlefield') moveCard(state, id, 'hand');
  },
  'core:discard': (state, d, a) => {
    log(state, `${getPlayer(state, d.player).name} discards ${a.cards!.map((id) => state.cards[id].def).join(', ')}.`);
    for (const id of a.cards!) moveCard(state, id, 'graveyard');
  },
  'core:search': (state, d, a) => {
    const p = getPlayer(state, d.player);
    const chosen = a.cards ?? [];
    const { dest, tapped, split } = d.data;
    if (split && chosen.length === 2) {
      queueDecision(
        state,
        {
          player: p.id,
          kind: 'chooseCards',
          prompt: 'Choose the land to put onto the battlefield tapped (the other goes to your hand)',
          cards: chosen,
          min: 1,
          max: 1,
          handler: 'core:searchSplit',
          data: { chosen },
        },
        true,
      );
      return;
    }
    if (split) {
      for (const id of chosen) moveCard(state, id, 'battlefield', { tapped: true, controller: p.id });
      shuffle(state, p.library);
      return;
    }
    if (dest === 'top') {
      for (const id of chosen) moveCard(state, id, 'hand');
      shuffle(state, p.library);
      for (const id of chosen) moveCard(state, id, 'library');
    } else {
      for (const id of chosen) moveCard(state, id, dest, { tapped, controller: p.id });
      shuffle(state, p.library);
    }
    if (chosen.length) {
      const visible = dest === 'battlefield';
      log(state, `${p.name} searches their library${visible ? ` and puts ${chosen.map((id) => state.cards[id].def).join(', ')} onto the battlefield` : ''}.`);
    }
  },
  'core:searchSplit': (state, d, a) => {
    const p = getPlayer(state, d.player);
    const bf = a.cards![0];
    for (const id of d.data.chosen as string[]) {
      if (id === bf) moveCard(state, id, 'battlefield', { tapped: true, controller: p.id });
      else moveCard(state, id, 'hand');
    }
    shuffle(state, p.library);
  },
  'core:scry': (state, d, a) => {
    for (const id of a.cards!) moveCard(state, id, 'library', { bottom: true });
    log(state, `${getPlayer(state, d.player).name} scries, putting ${a.cards!.length} on the bottom.`);
    if (d.data?.then) runCardHandler(state, d.data.then, {});
  },
  'core:lookAndTake': (state, d, a) => {
    const chosen = a.cards ?? [];
    if (chosen.some((c) => !d.data.eligible.includes(c))) throw new RulesError("You can't take that card");
    for (const id of chosen) moveCard(state, id, 'hand');
    const toGraveyard = d.data.rest === 'graveyard';
    for (const id of d.data.top as string[]) {
      if (chosen.includes(id) || state.cards[id]?.zone !== 'library') continue;
      if (toGraveyard) moveCard(state, id, 'graveyard');
      else moveCard(state, id, 'library', { bottom: true });
    }
  },
  'core:arrangeTop': (state, d, a) => {
    const top: string[] = d.data.top;
    const order = a.cards ?? [];
    if (order.length !== top.length || order.some((c) => !top.includes(c)) || new Set(order).size !== order.length) throw new RulesError('Put every card back, each once');
    const lib = getPlayer(state, d.player).library;
    // Only cards still in the library are put back (in case something moved one meanwhile).
    const still = order.filter((id) => lib.includes(id));
    const rest = lib.filter((id) => !still.includes(id));
    lib.splice(0, lib.length, ...still, ...rest);
    log(state, `${getPlayer(state, d.player).name} puts ${order.length} card${order.length === 1 ? '' : 's'} back on top in a chosen order.`);
    if (d.data.mayShuffle)
      queueDecision(state, {
        player: d.player,
        kind: 'chooseOption',
        prompt: 'Shuffle your library?',
        options: [
          { id: 'no', label: 'Keep them on top' },
          { id: 'yes', label: 'Shuffle' },
        ],
        handler: 'core:mayShuffle',
      });
  },
  'core:mayShuffle': (state, d, a) => {
    if (a.option !== 'yes') return;
    shuffle(state, getPlayer(state, d.player).library);
    log(state, `${getPlayer(state, d.player).name} shuffles their library.`);
  },
  'core:putOnTop': (state, d, a) => {
    const cards = a.cards ?? [];
    const hand = getPlayer(state, d.player).hand;
    if (cards.length !== d.min || cards.some((c) => !hand.includes(c))) throw new RulesError('Choose cards from your hand');
    for (let i = cards.length - 1; i >= 0; i--) moveCard(state, cards[i], 'library');
  },
  'core:explore': (state, d, a) => {
    const c = state.cards[d.data.card];
    if (a.option === 'yes' && c?.zone === 'library') moveCard(state, c.id, 'graveyard');
  },
  card: (state, d, a) => runCardHandler(state, d.data, a),
};

function mulliganDecision(state: GameState, pid: PlayerId): Omit<Decision, 'id'> {
  const p = getPlayer(state, pid);
  const n = Math.max(0, p.mulligans); // after this mulligan you'd bottom `mulligans` cards
  return {
    player: pid,
    kind: 'mulligan',
    prompt: p.mulligans === 0 ? 'Keep your opening hand? (Your first mulligan is free.)' : `Keep this hand? You'll put ${p.mulligans - 1} card(s) on the bottom.`,
    cards: [...p.hand],
    options: [
      { id: 'keep', label: 'Keep' },
      { id: 'mulligan', label: n === 0 ? 'Mulligan (free)' : 'Mulligan' },
    ],
    handler: 'core:mulligan',
    privateCards: true,
  };
}

// ---------- Auto pass & main loop ----------

function shouldAutoPass(state: GameState, pid: PlayerId): boolean {
  const p = getPlayer(state, pid);
  const top = state.stack[state.stack.length - 1];
  if (p.holding) return false;
  if (!p.isBot && p.autoPass === 'none') return false;
  if (!p.isBot && p.autoPass === 'stack' && top && top.controller !== pid) return false;
  const meaningful = legalActions(state, pid).filter((a) => a.type !== 'manaTap' && !a.isMana);
  if (meaningful.length === 0) return true;
  if (p.passUntilTurn === state.turn) {
    // Only stop if an opponent puts something on the stack.
    if (!top || top.controller === pid) return true;
  }
  if (p.autoPass === 'none') return false;
  if (top) return top.controller === pid;
  const st = p.stops ?? DEFAULT_STOPS;
  const stops = state.activePlayer === pid ? st.mine : st.theirs;
  // First-strike damage and the end of combat count as the combat damage stop.
  const step = state.step === 'firstStrikeDamage' || state.step === 'endCombat' ? 'combatDamage' : state.step;
  return !stops.includes(step);
}

/** Advance the game until some player needs to make a choice. */
export function run(state: GameState): void {
  for (let guard = 0; guard < 5000; guard++) {
    if (state.phase === 'over') return;
    collectTriggers(state);
    // Evoke: once its enter triggers are waiting, the creature is sacrificed.
    for (const c of battlefieldCards(state).filter((x) => x.evoked)) {
      c.evoked = false;
      log(state, `${c.def} is sacrificed (evoke).`);
      moveCard(state, c.id, 'graveyard');
    }
    if (state.decisions.length) return;
    if (state.phase === 'mulligan') {
      if (state.players.every((p) => p.kept || p.lost)) {
        state.phase = 'playing';
        startTurn(state, state.startingPlayer);
        continue;
      }
      return;
    }
    if (checkStateBased(state)) continue;
    if (state.phase !== 'playing') return;
    if (getPlayer(state, state.activePlayer).lost) {
      state.stack = [];
      state.combat = null;
      state.pendingTriggers = [];
      state.step = 'cleanup';
      advanceStep(state);
      continue;
    }
    if (state.pendingTriggers.length) {
      processTriggers(state);
      continue;
    }
    if (state.priority === null) {
      advanceStep(state);
      continue;
    }
    if (shouldAutoPass(state, state.priority)) {
      doPass(state, state.priority);
      continue;
    }
    return;
  }
  throw new Error('Game loop did not settle');
}

// ---------- Game creation ----------

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  /** One commander, or two partners. */
  commander: string | string[];
  cards: string[];
  isBot?: boolean;
  /** Preferred image per card name (chosen printing). */
  art?: Record<string, string>;
  /** Each copy's look per card name (art, foil, treatments), handed out in list order. */
  printings?: Record<string, CardLook[]>;
}

export function createGame(players: PlayerConfig[], seed = Date.now() % 2147483647): GameState {
  const state: GameState = {
    id: `g${seed}`,
    phase: 'mulligan',
    players: [],
    cards: {},
    battlefield: [],
    stack: [],
    turn: 0,
    activePlayer: players[0].id,
    step: 'untap',
    priority: null,
    passes: [],
    combat: null,
    pendingTriggers: [],
    events: [],
    decisions: [],
    log: [],
    seed,
    nextId: 1,
    winner: null,
    startingPlayer: players[0].id,
    recentlyLeft: [],
    startingLife: 40,
  };
  const order = [...players];
  shuffle(state, order);
  for (const cfg of order) {
    state.players.push({
      id: cfg.id,
      name: cfg.name,
      life: 40,
      poison: 0,
      library: [],
      hand: [],
      graveyard: [],
      exile: [],
      command: [],
      manaPool: emptyPool(),
      landsPlayed: 0,
      commanderDamage: {},
      commanderCasts: {},
      commanders: [],
      lost: false,
      drewFromEmpty: false,
      mulligans: 0,
      kept: false,
      isBot: !!cfg.isBot,
      autoPass: 'smart',
      passUntilTurn: null,
      lifeGainedThisTurn: 0,
    });
  }
  for (const cfg of order) {
    const p = getPlayer(state, cfg.id);
    const used: Record<string, number> = {};
    const dress = (c: CardInstance, name: string) => {
      const list = cfg.printings?.[name];
      if (list?.length) {
        const look = list[(used[name] = (used[name] ?? -1) + 1) % list.length];
        c.look = look;
        c.art = look.image ?? cfg.art?.[name];
      } else c.art = cfg.art?.[name];
    };
    for (const name of Array.isArray(cfg.commander) ? cfg.commander : [cfg.commander]) {
      const cmd = makeCard(state, name, p.id, 'command');
      cmd.commander = true;
      dress(cmd, name);
      p.command.push(cmd.id);
      p.commanders.push(cmd.id);
    }
    for (const name of cfg.cards) {
      const c = makeCard(state, name, p.id, 'library');
      dress(c, name);
      p.library.push(c.id);
    }
    shuffle(state, p.library);
  }
  state.activePlayer = state.players[0].id;
  state.startingPlayer = state.players[0].id;
  log(state, `${state.players[0].name} will go first.`);
  for (const p of state.players) {
    drawCards(state, p.id, 7);
    queueDecision(state, mulliganDecision(state, p.id));
  }
  state.events = [];
  run(state);
  return state;
}

/** Apply an action to a copy of the state and return the new state. Throws RulesError on illegal actions. */
export function act(state: GameState, pid: PlayerId, action: Action): GameState {
  const next = structuredClone(state);
  applyAction(next, pid, action);
  run(next);
  return next;
}

export { opponentsOf, getKeywords, gainLife };
