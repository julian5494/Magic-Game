// A simple heuristic bot. It isn't strong, but it plays lands, casts spells,
// attacks when it looks safe, blocks sensibly and answers every decision.
import type { TargetSpec } from './cardtypes';
import { canBlock, getTrigger } from './rules';
import { legalActions } from './game';
import { parseCost } from './mana';
import { abilityByIndex, getDef } from './registry';
import {
  battlefieldCards, cmc, defOf, getKeywords, getPlayer, getPT, hasType, isMainPhase, opponentsOf,
} from './state';
import type {
  Action, CardId, CardInstance, Decision, DecisionAnswer, GameState, PlayableAction, PlayerId, Target, TargetSpecView,
} from './types';

export function chooseBotAction(state: GameState, pid: PlayerId): Action | null {
  if (state.phase === 'over') return null;
  const d =
    state.phase === 'mulligan'
      ? state.decisions.find((x) => x.player === pid)
      : state.decisions[0]?.player === pid
        ? state.decisions[0]
        : undefined;
  if (d) return { type: 'decide', decisionId: d.id, answer: decide(state, pid, d) };
  if (state.phase !== 'playing' || state.priority !== pid || state.decisions.length) return null;
  return choosePlay(state, pid) ?? { type: 'pass' };
}

// ---------- Evaluation helpers ----------

function value(state: GameState, c: CardInstance): number {
  const def = defOf(c);
  let v = cmc(c);
  if (hasType(c, 'Creature')) {
    const pt = getPT(state, c);
    v += pt.power + pt.toughness / 2;
  }
  if (c.commander) v += 3;
  if (def.types.includes('Land')) v -= 1;
  return v;
}

function weakestOpponent(state: GameState, pid: PlayerId): PlayerId | null {
  const opps = opponentsOf(state, pid);
  if (!opps.length) return null;
  return opps.sort((a, b) => getPlayer(state, a).life - getPlayer(state, b).life)[0];
}

function pickTarget(state: GameState, pid: PlayerId, view: TargetSpecView, spec: TargetSpec | undefined, chosen: Target[]): Target | null {
  const bias = spec?.bias ?? 'opponent';
  const opts = view.options.filter((o) => !chosen.some((c) => c.type === o.type && c.id === o.id));
  const cardOpts = opts.filter((o) => o.type === 'card').map((o) => ({ o, c: state.cards[o.id] })).filter((x) => x.c);
  const playerOpts = opts.filter((o) => o.type === 'player');
  if (bias === 'self') {
    const mine = cardOpts.filter((x) => x.c.controller === pid || x.c.zone === 'graveyard').sort((a, b) => value(state, b.c) - value(state, a.c));
    if (mine.length) return mine[0].o;
    const me = playerOpts.find((o) => o.id === pid);
    if (me) return me;
    return null;
  }
  if (opts.some((o) => o.type === 'stack')) {
    const theirs = [...state.stack].reverse().find((s) => s.controller !== pid && opts.some((o) => o.id === s.id));
    return theirs ? opts.find((o) => o.id === theirs.id)! : null;
  }
  const theirs = cardOpts.filter((x) => x.c.controller !== pid).sort((a, b) => value(state, b.c) - value(state, a.c));
  if (spec?.kind === 'any' && playerOpts.length) {
    // Burn: kill a meaningful creature if we can, otherwise go face.
    const killable = theirs.find((x) => hasType(x.c, 'Creature') && getPT(state, x.c).toughness <= 3 && getPT(state, x.c).power >= 2);
    if (killable) return killable.o;
    const w = weakestOpponent(state, pid);
    return playerOpts.find((o) => o.id === w) ?? playerOpts.find((o) => o.id !== pid) ?? null;
  }
  if (theirs.length) return theirs[0].o;
  const oppPlayer = playerOpts.find((o) => o.id === weakestOpponent(state, pid));
  if (oppPlayer) return oppPlayer;
  return null;
}

function pickTargets(state: GameState, pid: PlayerId, views: TargetSpecView[], specs: TargetSpec[] | undefined): (Target | null)[] | null {
  const chosen: Target[] = [];
  const out: (Target | null)[] = [];
  for (let i = 0; i < views.length; i++) {
    const t = pickTarget(state, pid, views[i], specs?.[i], chosen);
    if (!t && !views[i].optional) return null;
    if (t) chosen.push(t);
    out.push(t);
  }
  return out;
}

// ---------- Main-phase play ----------

function choosePlay(state: GameState, pid: PlayerId): Action | null {
  const legal = legalActions(state, pid);
  const myTurn = state.activePlayer === pid;
  const sorcerySpeed = myTurn && isMainPhase(state) && state.stack.length === 0;

  // Respond to opponents' big spells with counters.
  const top = state.stack[state.stack.length - 1];
  if (top && top.controller !== pid && top.kind === 'spell') {
    for (const a of legal.filter((l) => l.type === 'cast')) {
      const def = defOf(state.cards[a.cardId]);
      if (!def.targets?.some((t) => t.kind === 'spell')) continue;
      if (cmc(state.cards[top.cardId]) < 3) continue;
      const targets = pickTargets(state, pid, a.targets, def.targets);
      if (targets) return { type: 'cast', cardId: a.cardId, targets };
    }
    return null;
  }
  if (!sorcerySpeed) {
    // At an opponent's end step, use instant-speed removal or card draw.
    if (!myTurn && state.step === 'end' && state.stack.length === 0) return castBest(state, pid, legal, true);
    return null;
  }

  const land = chooseLand(state, pid, legal);
  if (land) return land;
  const cast = castBest(state, pid, legal, false);
  if (cast) return cast;
  for (const a of legal.filter((l) => l.type === 'activate')) {
    if ((a.ability! >= 1000 && a.ability! < 2000) || a.isMana) continue; // cycling / mana abilities with costs: bots skip them
    const card = state.cards[a.cardId];
    const ab = abilityByIndex(defOf(card), a.ability!);
    if (!ab || !ab.aiValue || ab.cost.sacrifice) continue;
    if (ab.equip && card.attachedTo) continue;
    const targets = pickTargets(state, pid, a.targets, ab.targets);
    if (!targets) continue;
    return { type: 'activate', cardId: a.cardId, ability: a.ability!, targets };
  }
  return null;
}

function chooseLand(state: GameState, pid: PlayerId, legal: PlayableAction[]): Action | null {
  const lands = legal.filter((l) => l.type === 'playLand');
  if (!lands.length) return null;
  // Prefer lands that enter tapped early, untapped ones when we can use the mana now.
  const scored = lands.map((l) => {
    const def = defOf(state.cards[l.cardId]);
    let s = 0;
    if (def.entersTapped) s += 1;
    if (def.name === 'Command Tower') s += 2;
    return { l, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return { type: 'playLand', cardId: scored[0].l.cardId, back: scored[0].l.back };
}

function castBest(state: GameState, pid: PlayerId, legal: PlayableAction[], instantOnly: boolean): Action | null {
  const myCreatures = battlefieldCards(state).filter((c) => c.controller === pid && hasType(c, 'Creature')).length;
  const theirCreatures = battlefieldCards(state).filter((c) => c.controller !== pid && hasType(c, 'Creature')).length;
  const casts = legal
    .filter((l) => l.type === 'cast')
    .map((a) => ({ a, card: state.cards[a.cardId], def: defOf(state.cards[a.cardId]) }))
    .filter(({ def }) => !instantOnly || def.types.includes('Instant') || (def.keywords ?? []).includes('Flash'))
    .sort((x, y) => {
      // Commanders and permanents first, then by cost.
      const px = (x.card.zone === 'command' ? 2 : 0) + (x.def.types.some((t) => t !== 'Instant' && t !== 'Sorcery') ? 1 : 0);
      const py = (y.card.zone === 'command' ? 2 : 0) + (y.def.types.some((t) => t !== 'Instant' && t !== 'Sorcery') ? 1 : 0);
      return py - px || cmc(y.card) - cmc(x.card);
    });
  for (const { a, def } of casts) {
    if (def.ai?.holdForInstant) continue;
    if (def.ai?.value === -1 && theirCreatures < myCreatures + 2) continue;
    if (def.targets?.some((t) => t.kind === 'spell')) continue;
    if (def.unsupported?.length && !def.effect && !def.modes && (def.types.includes('Instant') || def.types.includes('Sorcery'))) continue;
    if (def.name === 'Dark Ritual') continue;
    const variant = a.variant !== undefined ? def.castVariants?.[a.variant] : undefined;
    const specs = variant?.targets ?? (a.modes && def.modes ? a.modes.flatMap((m) => def.modes![m].targets) : def.targets);
    const targets = pickTargets(state, pid, a.targets, specs);
    if (!targets) continue;
    const action: Action = { type: 'cast', cardId: a.cardId, targets, modes: a.modes, variant: a.variant };
    if (a.sacrificeOptions) {
      const cheap = lowestValue(state, a.sacrificeOptions, 1)[0];
      if (!cheap || state.cards[cheap].commander) continue;
      action.sacrifice = cheap;
    }
    if (a.xMax !== undefined) {
      if (a.xMax < 2) continue;
      action.x = a.xMax;
    }
    return action;
  }
  return null;
}

// ---------- Decisions ----------

function lowestValue(state: GameState, ids: CardId[], n: number): CardId[] {
  return [...ids].sort((a, b) => value(state, state.cards[a]) - value(state, state.cards[b])).slice(0, n);
}

function discardChoice(state: GameState, pid: PlayerId, ids: CardId[], n: number): CardId[] {
  const landsInPlay = battlefieldCards(state).filter((c) => c.controller === pid && hasType(c, 'Land')).length;
  return [...ids]
    .sort((a, b) => {
      const ca = state.cards[a];
      const cb = state.cards[b];
      const la = hasType(ca, 'Land') ? (landsInPlay >= 5 ? -10 : 5) : 0;
      const lb = hasType(cb, 'Land') ? (landsInPlay >= 5 ? -10 : 5) : 0;
      return la - lb || cmc(cb) - cmc(ca);
    })
    .slice(0, n);
}

function decide(state: GameState, pid: PlayerId, d: Decision): DecisionAnswer {
  switch (d.kind) {
    case 'mulligan': {
      const p = getPlayer(state, pid);
      const lands = p.hand.filter((id) => hasType(state.cards[id], 'Land')).length;
      const keep = p.mulligans >= 2 || (lands >= 2 && lands <= 5);
      return { option: keep ? 'keep' : 'mulligan' };
    }
    case 'declareAttackers':
      return { attackers: chooseAttackers(state, pid, d) };
    case 'declareBlockers':
      return { blocks: chooseBlocks(state, pid, d) };
    case 'chooseTargets': {
      const trig = d.data?.trig;
      const specs = trig ? getTrigger(trig.def, trig.index).targets : undefined;
      const t = pickTargets(state, pid, d.targetSpecs!, specs);
      return { targets: t ?? d.targetSpecs!.map((s) => (s.optional ? null : s.options[0])) };
    }
    case 'chooseOption':
      if (d.options!.some((o) => o.id === 'yes')) return { option: 'yes' };
      return { option: d.options![0].id };
    case 'chooseNumber':
      return { number: d.max ?? 0 };
    case 'chooseCards':
      return { cards: chooseCards(state, pid, d) };
  }
  return {};
}

function chooseCards(state: GameState, pid: PlayerId, d: Decision): CardId[] {
  const cards = d.cards ?? [];
  const min = d.min ?? 0;
  const max = d.max ?? cards.length;
  switch (d.handler) {
    case 'core:bottom':
    case 'core:cleanupDiscard':
    case 'core:discard':
      return discardChoice(state, pid, cards, min);
    case 'core:sacrifice':
      return lowestValue(state, cards, min);
    case 'core:search': {
      // Prefer basics of colors we have the fewest sources of; for tutors take the most expensive card.
      const sorted = [...cards].sort((a, b) => {
        const ca = state.cards[a];
        const cb = state.cards[b];
        return Number(hasType(ca, 'Land')) - Number(hasType(cb, 'Land')) || cmc(cb) - cmc(ca);
      });
      const out: CardId[] = [];
      const seen = new Set<string>();
      for (const id of sorted) {
        if (out.length >= max) break;
        const name = state.cards[id].def;
        if (seen.has(name) && sorted.some((x) => !seen.has(state.cards[x].def) && !out.includes(x))) continue;
        seen.add(name);
        out.push(id);
      }
      for (const id of sorted) if (out.length < max && !out.includes(id)) out.push(id);
      return out;
    }
    case 'core:searchSplit':
      return [cards[0]];
    case 'core:scry': {
      const landsInPlay = battlefieldCards(state).filter((c) => c.controller === pid && hasType(c, 'Land')).length;
      return cards.filter((id) => {
        const c = state.cards[id];
        if (hasType(c, 'Land')) return landsInPlay >= 6;
        return cmc(c) > landsInPlay + 3;
      });
    }
    case 'core:lookAndTake': {
      const eligible: CardId[] = d.data?.eligible ?? cards;
      return [...eligible].sort((a, b) => cmc(state.cards[b]) - cmc(state.cards[a])).slice(0, max);
    }
    case 'card': {
      if (d.data?.key === 'putBack') return discardChoice(state, pid, cards, min);
      if (d.data?.key === 'bounce') return lowestValue(state, cards, Math.max(min, 1)).slice(0, Math.max(min, 1));
      break;
    }
  }
  return cards.slice(0, Math.max(min, Math.min(max, min)));
}

function chooseAttackers(state: GameState, pid: PlayerId, d: Decision): { id: CardId; defender: PlayerId }[] {
  const out: { id: CardId; defender: PlayerId }[] = [];
  const defenders = d.defenders ?? [];
  if (!defenders.length) return out;
  // Focus the opponent with the lowest life.
  const target = [...defenders].sort((a, b) => getPlayer(state, a).life - getPlayer(state, b).life)[0];
  const blockers = battlefieldCards(state).filter((c) => c.controller === target && hasType(c, 'Creature') && !c.tapped);
  for (const id of d.attackers ?? []) {
    const a = state.cards[id];
    const pt = getPT(state, a);
    if (pt.power <= 0) continue;
    const able = blockers.filter((b) => canBlock(state, b, a));
    const dangerous = able.filter((b) => {
      const bpt = getPT(state, b);
      const kills = bpt.power >= pt.toughness || getKeywords(state, b).includes('Deathtouch');
      const dies = pt.power >= bpt.toughness || getKeywords(state, a).includes('Deathtouch');
      return kills && !dies;
    });
    if (able.length === 0 || dangerous.length === 0) out.push({ id, defender: target });
  }
  return out;
}

function chooseBlocks(state: GameState, pid: PlayerId, d: Decision): { blocker: CardId; attacker: CardId }[] {
  const out: { blocker: CardId; attacker: CardId }[] = [];
  const used = new Set<CardId>();
  const attackers = (d.attacking ?? [])
    .map((id) => state.cards[id])
    .filter(Boolean)
    .sort((a, b) => getPT(state, b).power - getPT(state, a).power);
  const me = getPlayer(state, pid);
  let incoming = attackers.reduce((n, a) => n + Math.max(0, getPT(state, a).power), 0);
  for (const a of attackers) {
    if (getKeywords(state, a).includes('Menace')) continue;
    const apt = getPT(state, a);
    const candidates = (d.blockers ?? [])
      .filter((id) => !used.has(id))
      .map((id) => state.cards[id])
      .filter((b) => canBlock(state, b, a));
    const good = candidates.find((b) => {
      const bpt = getPT(state, b);
      const kills = bpt.power >= apt.toughness || getKeywords(state, b).includes('Deathtouch');
      const survives = apt.power < bpt.toughness && !getKeywords(state, a).includes('Deathtouch');
      return kills && survives;
    });
    const trade = candidates.find((b) => {
      const bpt = getPT(state, b);
      return (bpt.power >= apt.toughness || getKeywords(state, b).includes('Deathtouch')) && value(state, b) <= value(state, a);
    });
    const chump = incoming >= me.life ? lowestValue(state, candidates.map((c) => c.id), 1)[0] : undefined;
    const pick = good?.id ?? trade?.id ?? chump;
    if (pick) {
      used.add(pick);
      out.push({ blocker: pick, attacker: a.id });
      incoming -= apt.power;
    }
  }
  return out;
}

export { parseCost, getDef };
