import type { ActivatedAbility, CardDef } from './cardtypes';
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
  alivePlayers, battlefieldCards, commanderIdentity, defOf, getKeywords, getPlayer, hasKeyword, hasType, isMainPhase,
  log, matchesFilter, newId, nextPlayer, opponentsOf, snapshot,
} from './state';
import type {
  Action, CardId, CardInstance, Decision, DecisionAnswer, GameState, ManaSym, PlayableAction, PlayerId, Snapshot,
  Target, TargetSpecView,
} from './types';
import { COLORS } from './types';

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
      out.push({
        id: c.id,
        ability: i,
        produces: abilityColors(state, pid, ab),
        amount: ab.mana.amount ?? 1,
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
  if (ab.cost.tap) tapPermanent(state, c);
  if (ab.cost.sacrificeSelf) moveCard(state, c.id, 'graveyard');
  const pool = getPlayer(state, pid).manaPool;
  if (ab.mana!.fixed) for (const s of ab.mana!.fixed) pool[s]++;
  else pool[sym] += ab.mana!.amount ?? 1;
  if (ab.mana!.pain) loseLife(state, pid, ab.mana!.pain);
  if (ab.cost.life) loseLife(state, pid, ab.cost.life);
}

function findPayment(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[]) {
  const pool = getPlayer(state, pid).manaPool;
  const sources = manaSources(state, pid, exclude);
  for (const v of costVariants(cost)) {
    const plan = solvePayment(v, pool, sources);
    if (plan) return { plan, cost: v };
  }
  return null;
}

function canPay(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[] = []): boolean {
  return findPayment(state, pid, cost, exclude) !== null;
}

function pay(state: GameState, pid: PlayerId, cost: ManaCost, exclude: CardId[] = []): void {
  const p = getPlayer(state, pid);
  const found = findPayment(state, pid, cost, exclude);
  if (!found) throw new RulesError('Not enough mana');
  for (const t of found.plan.taps) activateManaAbility(state, pid, state.cards[t.id], t.ability, t.color);
  if (!payFromPool(p.manaPool, found.cost)) throw new RulesError('Mana payment failed');
}

function spellCost(state: GameState, card: CardInstance, x: number): ManaCost {
  const def = defOf(card);
  const c = parseCost(def.cost);
  if (card.zone === 'command') c.generic += 2 * (getPlayer(state, card.owner).commanderCasts[card.id] ?? 0);
  c.generic += c.x * x;
  c.x = 0;
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

export function canAct(state: GameState, pid: PlayerId): boolean {
  return state.phase === 'playing' && state.decisions.length === 0 && state.priority === pid;
}

export function legalActions(state: GameState, pid: PlayerId): PlayableAction[] {
  if (!canAct(state, pid)) return [];
  const p = getPlayer(state, pid);
  const out: PlayableAction[] = [];
  const sorcery = sorceryTiming(state, pid);

  if (sorcery && p.landsPlayed < 1) {
    for (const id of p.hand) {
      if (hasType(state.cards[id], 'Land') && !defOf(state.cards[id]).cannotCast) out.push({ type: 'playLand', cardId: id, label: 'Play land', targets: [] });
    }
  }

  const castables = [...p.hand, ...p.command];
  for (const id of castables) {
    const card = state.cards[id];
    const def = defOf(card);
    if (def.types.includes('Land') || def.cannotCast) continue;
    const instantSpeed = def.types.includes('Instant') || (def.keywords ?? []).includes('Flash');
    if (!instantSpeed && !sorcery) continue;
    let sacrificeOptions: CardId[] | undefined;
    if (def.castSacrifice) {
      sacrificeOptions = battlefieldCards(state)
        .filter((c) => c.controller === pid && matchesFilter(state, c, def.castSacrifice, pid, id))
        .map((c) => c.id);
      if (!sacrificeOptions.length) continue;
    }
    const base = parseCost(def.cost);
    let xMax: number | undefined;
    if (base.x > 0) {
      xMax = -1;
      for (let x = 0; x <= 30; x++) {
        if (canPay(state, pid, spellCost(state, card, x))) xMax = x;
        else break;
      }
      if (xMax < 0) continue;
    } else if (!canPay(state, pid, spellCost(state, card, 0))) continue;
    const extra = { xMax, sacrificeOptions, sacrificeLabel: sacrificeOptions ? 'Sacrifice (additional cost)' : undefined };
    if (def.modes) {
      for (const combo of modeCombos(def.modes.length, def.modeCount ?? 1)) {
        const targets = specViews(state, combo.flatMap((m) => def.modes![m].targets), pid, id);
        if (!targets) continue;
        const label = `Cast ${def.name}: ${combo.map((m) => def.modes![m].text.replace(/^•\s*/, '')).join(' + ')}`;
        out.push({ type: 'cast', cardId: id, label, targets, modes: combo, ...extra });
      }
      continue;
    }
    const targets = specViews(state, def.targets, pid, id);
    if (!targets) continue;
    out.push({ type: 'cast', cardId: id, label: `Cast ${def.name}`, targets, ...extra });
  }

  for (const card of battlefieldCards(state)) {
    if (card.controller !== pid) continue;
    defOf(card).abilities?.forEach((ab, i) => {
      if (ab.mana) {
        if (!ab.cost.mana && !ab.cost.sacrifice) {
          if ((!ab.cost.tap || canUseTap(state, card)) && (!ab.cost.life || p.life >= ab.cost.life)) {
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
    if (!legal.some((a) => a.type === 'playLand' && a.cardId === action.cardId)) throw new RulesError("Can't play that land now");
    p.landsPlayed++;
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
    const a = legal.find((l) => l.type === 'cast' && l.cardId === action.cardId && modesKey(l.modes) === modesKey(action.modes));
    if (!a) throw new RulesError("Can't cast that now");
    const card = state.cards[action.cardId];
    const def = defOf(card);
    const targets = validateTargets(a.targets, action.targets);
    const x = a.xMax !== undefined ? Math.max(0, Math.min(action.x ?? 0, a.xMax)) : 0;
    if (a.sacrificeOptions && (!action.sacrifice || !a.sacrificeOptions.includes(action.sacrifice))) {
      throw new RulesError('Choose a permanent to sacrifice');
    }
    const fromCommand = card.zone === 'command';
    pay(state, pid, spellCost(state, card, x));
    let sacrificed: Snapshot | undefined;
    if (a.sacrificeOptions) {
      const sc = state.cards[action.sacrifice!];
      sacrificed = snapshot(state, sc);
      moveCard(state, sc.id, 'graveyard');
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
    });
    log(state, `${p.name} casts ${def.name}${a.modes ? ` (${a.label.replace(/^Cast [^:]+: /, '')})` : ''}${x ? ` (X=${x})` : ''}${describeTargets(state, targets)}.`);
    pushEvent(state, { t: 'cast', card: card.id, controller: pid, def: def.name });
    state.passes = [];
    p.holding = !!action.hold;
    return;
  }

  if (action.type === 'activate') {
    const a = legal.find((l) => l.type === 'activate' && l.cardId === action.cardId && l.ability === action.ability);
    if (!a) throw new RulesError("Can't activate that now");
    const card = state.cards[action.cardId];
    const def = defOf(card);
    const ab = def.abilities![action.ability];
    const targets = validateTargets(a.targets, action.targets);
    let sacrificed: Snapshot | undefined;
    if (ab.cost.sacrifice) {
      if (!action.sacrifice || !a.sacrificeOptions!.includes(action.sacrifice)) throw new RulesError('Choose a permanent to sacrifice');
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
      else p.manaPool[sym] += ab.mana.amount ?? 1;
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
    state.passes = [];
    p.holding = !!action.hold;
    return;
  }
  throw new RulesError('Unknown action');
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
    }
    combat.attackers = list.map((at) => ({ id: at.id, defender: at.defender, blockedBy: [], blocked: false }));
    for (const at of list) {
      const c = state.cards[at.id];
      if (!hasKeyword(state, c, 'Vigilance')) tapPermanent(state, c);
    }
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
    for (const id of d.data.top as string[]) if (!chosen.includes(id) && state.cards[id]?.zone === 'library') moveCard(state, id, 'library', { bottom: true });
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
  const stops = state.activePlayer === pid ? ['main1', 'main2', 'declareBlockers'] : ['declareBlockers', 'end'];
  return !stops.includes(state.step);
}

/** Advance the game until some player needs to make a choice. */
export function run(state: GameState): void {
  for (let guard = 0; guard < 5000; guard++) {
    if (state.phase === 'over') return;
    collectTriggers(state);
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
    for (const name of Array.isArray(cfg.commander) ? cfg.commander : [cfg.commander]) {
      const cmd = makeCard(state, name, p.id, 'command');
      cmd.commander = true;
      cmd.art = cfg.art?.[name];
      p.command.push(cmd.id);
      p.commanders.push(cmd.id);
    }
    for (const name of cfg.cards) {
      const c = makeCard(state, name, p.id, 'library');
      c.art = cfg.art?.[name];
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
