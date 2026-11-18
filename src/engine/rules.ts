import type { TriggeredAbility } from './cardtypes';
import {
  createToken, dealDamage, drawCards, isStillLegal, legalTargets, makeCtx, moveCard, pushEvent, queueDecision,
} from './ops';
import { emptyPool } from './mana';
import { getDef } from './registry';
import {
  alivePlayers, apnapOrder, battlefieldCards, cantAttackOrBlock, controllerHasStatic, defOf, getKeywords, getPlayer,
  getPT, hasKeyword, hasType, isLegendary, log, newId, nextPlayer, opponentsOf, snapshot,
} from './state';
import type {
  CardInstance, GameEvent, GameState, PendingTrigger, PlayerId, Snapshot, StackItem, Step, Target,
} from './types';
import { STEP_ORDER } from './types';

// ---------- Keyword triggers ----------

const KEYWORD_TRIGGERS: Record<number, TriggeredAbility> = {
  [-1]: {
    on: 'youCast',
    spellNotTypes: ['Creature'],
    text: 'Prowess (+1/+1 until end of turn)',
    effect: (ctx) => ctx.pump(ctx.self, 1, 1),
  },
  [-2]: {
    on: 'creatureYouControlAttacks',
    condition: (_s, e) => e.t === 'attacks' && e.alone,
    text: 'Exalted (attacking creature gets +1/+1)',
    effect: (ctx) => {
      if (ctx.event?.t === 'attacks') ctx.pump(ctx.event.card, 1, 1);
    },
  },
};

export function getTrigger(defName: string, index: number): TriggeredAbility {
  if (index < 0) return KEYWORD_TRIGGERS[index];
  return getDef(defName).triggers![index];
}

function triggersOf(state: GameState, card: CardInstance | Snapshot): { t: TriggeredAbility; index: number }[] {
  const def = defOf(card);
  const out = (def.triggers ?? []).map((t, index) => ({ t, index }));
  const kws = 'tapped' in card ? getKeywords(state, card) : def.keywords ?? [];
  if (kws.includes('Prowess')) out.push({ t: KEYWORD_TRIGGERS[-1], index: -1 });
  if (kws.includes('Exalted')) out.push({ t: KEYWORD_TRIGGERS[-2], index: -2 });
  return out;
}

function eventMatches(
  state: GameState,
  t: TriggeredAbility,
  e: GameEvent,
  self: { id: string; controller: PlayerId; attachedTo?: string | null },
): boolean {
  const isCreatureSnap = (s: Snapshot) => s.types.includes('Creature');
  let ok = false;
  switch (t.on) {
    case 'etb':
      ok = e.t === 'etb' && e.card === self.id;
      break;
    case 'dies':
      ok = e.t === 'leaves' && e.card === self.id && e.to === 'graveyard' && isCreatureSnap(e.snap);
      break;
    case 'leaves':
      ok = e.t === 'leaves' && e.card === self.id;
      break;
    case 'toGraveyardFromBattlefield':
      ok = e.t === 'leaves' && e.card === self.id && e.to === 'graveyard';
      break;
    case 'attacks':
      ok = e.t === 'attacks' && e.card === self.id;
      break;
    case 'yourUpkeep':
      ok = e.t === 'step' && e.step === 'upkeep' && e.active === self.controller;
      break;
    case 'yourEndStep':
      ok = e.t === 'step' && e.step === 'end' && e.active === self.controller;
      break;
    case 'youCast': {
      if (e.t !== 'cast' || e.controller !== self.controller) break;
      const types = getDef(e.def).types;
      ok =
        (!t.spellTypes || t.spellTypes.some((x) => types.includes(x))) &&
        (!t.spellNotTypes || !t.spellNotTypes.some((x) => types.includes(x)));
      break;
    }
    case 'otherCreatureEtbYours': {
      if (e.t !== 'etb' || e.card === self.id || e.controller !== self.controller) break;
      const c = state.cards[e.card];
      ok = !!c && hasType(c, 'Creature');
      break;
    }
    case 'anyOtherCreatureEtb': {
      if (e.t !== 'etb' || e.card === self.id) break;
      const c = state.cards[e.card];
      ok = !!c && hasType(c, 'Creature');
      break;
    }
    case 'landfall': {
      if (e.t !== 'etb' || e.controller !== self.controller) break;
      const c = state.cards[e.card];
      ok = !!c && hasType(c, 'Land');
      break;
    }
    case 'youGainLife':
      ok = e.t === 'gainLife' && e.player === self.controller;
      break;
    case 'dealsCombatDamageToPlayer':
      ok = e.t === 'combatDamagePlayer' && e.source === self.id;
      break;
    case 'creatureYouControlDies':
      ok = e.t === 'leaves' && e.to === 'graveyard' && isCreatureSnap(e.snap) && e.snap.controller === self.controller;
      break;
    case 'otherCreatureYouControlDies':
      ok =
        e.t === 'leaves' && e.to === 'graveyard' && isCreatureSnap(e.snap) && e.snap.controller === self.controller && e.card !== self.id;
      break;
    case 'creatureYouControlAttacks': {
      if (e.t !== 'attacks') break;
      const c = state.cards[e.card];
      ok = !!c && c.controller === self.controller;
      break;
    }
    case 'becomesTapped':
      ok = e.t === 'tapped' && e.card === self.id;
      break;
    case 'equippedCreatureDies':
      ok = e.t === 'leaves' && e.to === 'graveyard' && isCreatureSnap(e.snap) && self.attachedTo === e.card;
      break;
    case 'equippedCreatureAttacks':
      ok = e.t === 'attacks' && self.attachedTo === e.card;
      break;
    case 'anyEtb':
      ok = e.t === 'etb';
      break;
    case 'eachUpkeep':
      ok = e.t === 'step' && e.step === 'upkeep';
      break;
    case 'eachEndStep':
      ok = e.t === 'step' && e.step === 'end';
      break;
    case 'opponentEndStep':
      ok = e.t === 'step' && e.step === 'end' && e.active !== self.controller;
      break;
    case 'eachDrawStep':
      ok = e.t === 'step' && e.step === 'draw';
      break;
    case 'yourDrawStep':
      ok = e.t === 'step' && e.step === 'draw' && e.active === self.controller;
      break;
    case 'yourBeginCombat':
      ok = e.t === 'step' && e.step === 'beginCombat' && e.active === self.controller;
      break;
    case 'eachBeginCombat':
      ok = e.t === 'step' && e.step === 'beginCombat';
      break;
    case 'youDraw':
      ok = e.t === 'draw' && e.player === self.controller;
      break;
    case 'opponentDraws':
      ok = e.t === 'draw' && e.player !== self.controller;
      break;
    case 'opponentCasts':
    case 'anyPlayerCasts': {
      if (e.t !== 'cast' || (t.on === 'opponentCasts' && e.controller === self.controller)) break;
      const types = getDef(e.def).types;
      ok =
        (!t.spellTypes || t.spellTypes.some((x) => types.includes(x))) &&
        (!t.spellNotTypes || !t.spellNotTypes.some((x) => types.includes(x)));
      break;
    }
    case 'youAttack':
      ok = e.t === 'attackDeclared' && e.player === self.controller && e.count > 0;
      break;
    case 'youDiscard':
      ok = e.t === 'discard' && e.player === self.controller;
      break;
    case 'creatureYouControlDealsCombatDamageToPlayer': {
      if (e.t !== 'combatDamagePlayer') break;
      const src = state.cards[e.source];
      ok = !!src && src.controller === self.controller;
      break;
    }
    case 'equippedCreatureDealsCombatDamageToPlayer':
      ok = e.t === 'combatDamagePlayer' && self.attachedTo === e.source;
      break;
    case 'enchantedCreatureAttacks':
      ok = e.t === 'attacks' && self.attachedTo === e.card;
      break;
    case 'anyDies':
      ok = e.t === 'leaves' && e.to === 'graveyard' && isCreatureSnap(e.snap);
      break;
  }
  if (!ok) return false;
  if (t.condition) {
    const live = state.cards[self.id];
    return t.condition(state, e, live ?? (self as any));
  }
  return true;
}

/** Turn queued events into pending triggers. */
export function collectTriggers(state: GameState): void {
  if (state.events.length === 0) {
    state.recentlyLeft = [];
    return;
  }
  const events = state.events;
  const left = state.recentlyLeft;
  state.events = [];
  state.recentlyLeft = [];
  for (const e of events) {
    const seen = new Set<string>();
    for (const card of battlefieldCards(state)) {
      seen.add(card.id);
      for (const { t, index } of triggersOf(state, card)) {
        if (eventMatches(state, t, e, card)) {
          if (t.onceEachTurn) {
            if (card.usedOnTurn?.[`t${index}`] === state.turn) continue;
            card.usedOnTurn = { ...(card.usedOnTurn ?? {}), [`t${index}`]: state.turn };
          }
          state.pendingTriggers.push({ source: card.id, def: card.def, index, controller: card.controller, event: e });
        }
      }
    }
    // "When you cast this spell" triggers come from the spell on the stack.
    if (e.t === 'cast' && state.cards[e.card]) {
      const spell = state.cards[e.card];
      (getDef(spell.def).triggers ?? []).forEach((t, index) => {
        if (t.on === 'castSelf') state.pendingTriggers.push({ source: spell.id, def: spell.def, index, controller: e.controller, event: e });
      });
    }
    // Leaves-the-battlefield abilities "look back in time".
    if (e.t === 'leaves') {
      for (const snap of left) {
        if (seen.has(snap.id)) continue;
        for (const { t, index } of triggersOf(state, snap)) {
          const lookBack = ['dies', 'leaves', 'toGraveyardFromBattlefield', 'creatureYouControlDies', 'otherCreatureYouControlDies', 'equippedCreatureDies', 'anyDies'];
          if (!lookBack.includes(t.on)) continue;
          if (eventMatches(state, t, e, snap)) {
            state.pendingTriggers.push({ source: snap.id, def: snap.def, index, controller: snap.controller, event: e, snapshot: snap });
          }
        }
      }
    }
  }
}

export function putTriggerOnStack(state: GameState, trig: PendingTrigger, targets: (Target | null)[]): void {
  const t = getTrigger(trig.def, trig.index);
  const src = state.cards[trig.source];
  const item: StackItem = {
    id: newId(state, 's'),
    kind: 'trigger',
    controller: trig.controller,
    cardId: trig.source,
    sourceInc: src?.inc,
    def: trig.def,
    index: trig.index,
    targets,
    text: t.text,
    event: trig.event,
    sourceSnapshot: trig.snapshot ?? (src ? snapshot(state, src) : undefined),
  };
  state.stack.push(item);
  state.passes = [];
}

function processPendingTrigger(state: GameState): void {
  const order = apnapOrder(state);
  // Stable sort keeps a chosen trigger at the front of its controller's group.
  state.pendingTriggers.sort((a, b) => order.indexOf(a.controller) - order.indexOf(b.controller) || Number(!!b.chosen) - Number(!!a.chosen));
  const first = state.pendingTriggers[0];
  const mine = state.pendingTriggers.filter((t) => t.controller === first.controller);
  const label = (t: PendingTrigger) => `${t.def}: ${getTrigger(t.def, t.index).text}`;
  if (!first.chosen && mine.length > 1 && new Set(mine.map(label)).size > 1 && !getPlayer(state, first.controller).isBot) {
    // The controller chooses the order of their simultaneous triggers (rule 603.3b).
    queueDecision(state, {
      player: first.controller,
      kind: 'chooseOption',
      prompt: 'Several of your abilities triggered. Choose the one to put on the stack next (abilities put on the stack later resolve first).',
      options: mine.map((t, i) => ({ id: String(i), label: label(t) })),
      handler: 'core:orderTrigger',
      data: { controller: first.controller },
    });
    return;
  }
  const trig = state.pendingTriggers.shift()!;
  if (getPlayer(state, trig.controller).lost) return;
  const t = getTrigger(trig.def, trig.index);
  if (!t.targets?.length) {
    putTriggerOnStack(state, trig, []);
    return;
  }
  const specs = t.targets.map((spec) => ({
    label: spec.label ?? spec.kind,
    optional: !!spec.optional,
    options: legalTargets(state, spec, trig.controller, trig.source),
  }));
  if (specs.some((s) => !s.optional && s.options.length === 0) || specs.every((s) => s.options.length === 0)) {
    log(state, `${trig.def}'s ability has no legal targets and is removed.`);
    return;
  }
  if (specs.every((s) => !s.optional && s.options.length === 1)) {
    putTriggerOnStack(state, trig, specs.map((s) => s.options[0]));
    return;
  }
  queueDecision(state, {
    player: trig.controller,
    kind: 'chooseTargets',
    prompt: `Choose targets for ${trig.def}: ${t.text}`,
    targetSpecs: specs,
    handler: 'core:triggerTargets',
    data: { trig },
  });
}

// ---------- Stack resolution ----------

export function resolveTop(state: GameState): void {
  const item = state.stack.pop();
  if (!item) return;
  const def = getDef(item.def);
  if (item.kind === 'spell') {
    const card = state.cards[item.cardId];
    const variant = item.variant !== undefined ? def.castVariants?.[item.variant] : undefined;
    const specs = variant?.targets ?? (item.modes && def.modes ? item.modes.flatMap((m) => def.modes![m].targets) : def.targets ?? []);
    const finish = () => {
      if (item.isCopy) return;
      if (state.cards[item.cardId]?.zone === 'stack') moveCard(state, item.cardId, variant?.exileAfter ? 'exile' : 'graveyard');
    };
    const targets = item.targets.map((t, i) =>
      t && specs[i] && isStillLegal(state, specs[i], t, item.controller, item.cardId) ? t : null,
    );
    const chosen = item.targets.filter(Boolean).length;
    const legal = targets.filter(Boolean).length;
    if (specs.length > 0 && chosen > 0 && legal === 0) {
      log(state, `${def.name} fizzles (no legal targets).`);
      finish();
      return;
    }
    log(state, `${def.name} resolves.`);
    const isPermanent = !def.types.includes('Instant') && !def.types.includes('Sorcery');
    if (isPermanent && item.isCopy) return; // copies of permanent spells aren't supported; they do nothing
    if (isPermanent) {
      const isAura = (def.subtypes ?? []).includes('Aura');
      moveCard(state, card.id, 'battlefield', { controller: item.controller });
      if (isAura) {
        const t = targets[0];
        if (t && t.type === 'card') card.attachedTo = t.id;
      }
      return;
    }
    if (variant?.effect) {
      variant.effect(makeCtx(state, { controller: item.controller, source: item.cardId, targets, x: item.x, sacrificed: item.sacrificed, def: def.name }));
    } else if (item.modes && def.modes) {
      // Each mode sees only its own targets.
      let base = 0;
      for (const m of item.modes) {
        const mode = def.modes[m];
        const slice = targets.slice(base, base + mode.targets.length);
        base += mode.targets.length;
        mode.effect(makeCtx(state, { controller: item.controller, source: item.cardId, targets: slice, x: item.x, sacrificed: item.sacrificed, def: def.name }));
      }
    } else if (def.effect) {
      def.effect(makeCtx(state, { controller: item.controller, source: item.cardId, targets, x: item.x, sacrificed: item.sacrificed, def: def.name }));
    }
    finish();
    return;
  }

  // Activated or triggered ability.
  const ability =
    item.kind === 'ability'
      ? item.index! >= 1000
        ? def.handAbilities![item.index! - 1000]
        : def.abilities![item.index!]
      : getTrigger(item.def, item.index!);
  const specs = ability.targets ?? [];
  const targets = item.targets.map((t, i) =>
    t && specs[i] && isStillLegal(state, specs[i], t, item.controller, item.cardId) ? t : null,
  );
  if (specs.length > 0 && item.targets.some(Boolean) && !targets.some(Boolean)) {
    log(state, `${def.name}'s ability fizzles.`);
    return;
  }
  const init = {
    controller: item.controller,
    source: item.cardId,
    sourceInc: item.sourceInc,
    targets,
    event: item.event,
    x: item.x,
    sacrificed: item.sacrificed,
    snapshot: item.sourceSnapshot,
    def: def.name,
  };
  if (item.kind === 'trigger' && (ability as TriggeredAbility).optional) {
    queueDecision(state, {
      player: item.controller,
      kind: 'chooseOption',
      prompt: `${def.name}: ${ability.text}`,
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      handler: 'core:optional',
      data: { init, kind: item.kind, index: item.index },
    });
    return;
  }
  ability.effect?.(makeCtx(state, init));
}

// ---------- State-based actions ----------

export function playerLoses(state: GameState, pid: PlayerId, reason: string): void {
  const p = getPlayer(state, pid);
  if (p.lost) return;
  p.lost = true;
  p.lossReason = reason;
  log(state, `${p.name} loses the game (${reason}).`);
  // Everything they own leaves the game; control effects they had end.
  state.stack = state.stack.filter((s) => s.controller !== pid);
  for (const id of Object.keys(state.cards)) {
    const c = state.cards[id];
    if (c.owner === pid) {
      if (c.zone === 'battlefield') state.battlefield = state.battlefield.filter((x) => x !== id);
      delete state.cards[id];
    } else if (c.controller === pid && c.zone === 'battlefield') {
      c.controller = c.owner;
    }
  }
  for (const k of ['library', 'hand', 'graveyard', 'exile', 'command'] as const) p[k] = [];
  if (state.combat) {
    state.combat.attackers = state.combat.attackers.filter((a) => state.cards[a.id] && a.defender !== pid);
    for (const a of state.combat.attackers) a.blockedBy = a.blockedBy.filter((b) => state.cards[b]);
  }
  state.decisions = state.decisions.filter((d) => d.player !== pid);
  if (state.monarch === pid) state.monarch = state.activePlayer !== pid ? state.activePlayer : nextPlayer(state, pid);
  state.pendingTriggers = state.pendingTriggers.filter((t) => t.controller !== pid);
  state.passes = state.passes.filter((x) => x !== pid);
  if (state.priority === pid) state.priority = nextPlayer(state, pid);
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.phase = 'over';
    state.winner = alive[0]?.id ?? null;
    state.priority = null;
    if (alive[0]) log(state, `${alive[0].name} wins the game!`);
  }
}

/** Perform state-based actions once. Returns true if anything happened. */
export function checkStateBased(state: GameState): boolean {
  let changed = false;
  for (const p of alivePlayers(state)) {
    if (p.life <= 0) playerLoses(state, p.id, 'life total reached 0');
    else if (p.drewFromEmpty) playerLoses(state, p.id, 'drew from an empty library');
    else if (p.poison >= 10) playerLoses(state, p.id, '10 poison counters');
    else {
      const cmd = Object.entries(p.commanderDamage).find(([, n]) => n >= 21);
      if (cmd) playerLoses(state, p.id, '21 commander damage');
      else continue;
    }
    changed = true;
  }
  if (state.phase === 'over') return true;

  const toGraveyard: string[] = [];
  const toDestroy: string[] = [];
  for (const c of battlefieldCards(state)) {
    if (c.counters['+1/+1'] && c.counters['-1/-1']) {
      const n = Math.min(c.counters['+1/+1'], c.counters['-1/-1']);
      c.counters['+1/+1'] -= n;
      c.counters['-1/-1'] -= n;
      changed = true;
    }
    if (hasType(c, 'Planeswalker') && (c.counters.loyalty ?? 0) <= 0) toGraveyard.push(c.id);
    if (hasType(c, 'Creature')) {
      const { toughness } = getPT(state, c);
      if (toughness <= 0) toGraveyard.push(c.id);
      else if ((c.damage >= toughness || (c.deathtouched && c.damage > 0)) && !hasKeyword(state, c, 'Indestructible')) toDestroy.push(c.id);
    }
    const def = defOf(c);
    if ((def.subtypes ?? []).includes('Aura')) {
      const host = c.attachedTo ? state.cards[c.attachedTo] : null;
      if (!host || host.zone !== 'battlefield') toGraveyard.push(c.id);
    }
    if ((def.subtypes ?? []).includes('Equipment') && c.attachedTo) {
      const host = state.cards[c.attachedTo];
      if (!host || host.zone !== 'battlefield' || !hasType(host, 'Creature')) {
        c.attachedTo = null;
        changed = true;
      }
    }
  }
  // Legend rule: keep the newest.
  const legends = new Map<string, CardInstance[]>();
  for (const c of battlefieldCards(state)) {
    if (!isLegendary(c)) continue;
    const key = `${c.controller}|${c.def}`;
    legends.set(key, [...(legends.get(key) ?? []), c]);
  }
  for (const list of legends.values()) {
    if (list.length > 1) for (const c of list.slice(0, -1)) toGraveyard.push(c.id);
  }
  const all = [...new Set([...toGraveyard, ...toDestroy])];
  for (const id of all) {
    if (state.cards[id]?.zone === 'battlefield') {
      moveCard(state, id, 'graveyard');
      changed = true;
    }
  }
  return changed;
}

// ---------- Turn structure ----------

export function startTurn(state: GameState, pid: PlayerId): void {
  state.turn++;
  state.activePlayer = pid;
  for (const p of state.players) {
    p.landsPlayed = 0;
    p.extraLandsThisTurn = 0;
    state.spellsThisTurn = 0;
    p.lifeGainedThisTurn = 0;
    if (p.passUntilTurn !== null && p.passUntilTurn < state.turn) p.passUntilTurn = null;
  }
  log(state, `— Turn ${state.turn}: ${getPlayer(state, pid).name} —`);
  enterStep(state, 'untap');
}

export function canAttack(state: GameState, c: CardInstance): boolean {
  return (
    c.zone === 'battlefield' &&
    hasType(c, 'Creature') &&
    c.controller === state.activePlayer &&
    !c.tapped &&
    (!c.sick || hasKeyword(state, c, 'Haste')) &&
    !hasKeyword(state, c, 'Defender') &&
    !hasKeyword(state, c, 'CantAttack') &&
    !cantAttackOrBlock(state, c)
  );
}

export function canBlock(state: GameState, blocker: CardInstance, attacker: CardInstance): boolean {
  if (blocker.zone !== 'battlefield' || !hasType(blocker, 'Creature') || blocker.tapped) return false;
  if (cantAttackOrBlock(state, blocker) || blocker.temp.cantBlock || hasKeyword(state, blocker, 'CantBlock')) return false;
  const akw = getKeywords(state, attacker);
  if (akw.includes('Unblockable')) return false;
  const bkw = getKeywords(state, blocker);
  if (akw.includes('Flying') && !bkw.includes('Flying') && !bkw.includes('Reach')) return false;
  return true;
}

function enterStep(state: GameState, step: Step): void {
  state.step = step;
  state.priority = null;
  state.passes = [];
  for (const p of state.players) p.manaPool = emptyPool();
  const ap = state.activePlayer;
  switch (step) {
    case 'untap':
      for (const c of battlefieldCards(state)) {
        if (c.controller !== ap) continue;
        c.sick = false;
        if (c.skipUntap > 0) c.skipUntap--;
        else c.tapped = false;
      }
      return;
    case 'upkeep':
    case 'end':
      pushEvent(state, { t: 'step', step, active: ap });
      if (step === 'end' && state.monarch === ap) drawCards(state, ap, 1);
      state.priority = ap;
      return;
    case 'draw':
      pushEvent(state, { t: 'step', step, active: ap });
      if (!(state.turn === 1 && state.players.length === 2)) drawCards(state, ap, 1);
      state.priority = ap;
      return;
    case 'main1':
    case 'main2':
    case 'endCombat':
      state.priority = ap;
      return;
    case 'beginCombat':
      state.combat = { attackers: [], blockersDeclared: false, firstStrikeDone: false, dealtFirstStrike: [] };
      pushEvent(state, { t: 'step', step, active: ap });
      state.priority = ap;
      return;
    case 'declareAttackers': {
      const attackers = battlefieldCards(state).filter((c) => canAttack(state, c));
      const defenders = opponentsOf(state, ap);
      if (!state.combat || attackers.length === 0 || defenders.length === 0) return;
      queueDecision(state, {
        player: ap,
        kind: 'declareAttackers',
        prompt: 'Declare attackers',
        attackers: attackers.map((c) => c.id),
        defenders,
        planeswalkers: battlefieldCards(state)
          .filter((c) => defenders.includes(c.controller) && hasType(c, 'Planeswalker'))
          .map((c) => c.id),
        handler: 'core:attackers',
      });
      return;
    }
    case 'declareBlockers': {
      const combat = state.combat!;
      const defenders = [...new Set(combat.attackers.map((a) => a.defender))];
      let any = false;
      for (const d of apnapOrder(state)) {
        if (!defenders.includes(d)) continue;
        const attacking = combat.attackers.filter((a) => a.defender === d).map((a) => a.id);
        const blockers = battlefieldCards(state).filter(
          (b) => b.controller === d && attacking.some((a) => canBlock(state, b, state.cards[a])),
        );
        if (blockers.length === 0) continue;
        any = true;
        queueDecision(state, {
          player: d,
          kind: 'declareBlockers',
          prompt: 'Declare blockers',
          blockers: blockers.map((b) => b.id),
          attacking,
          handler: 'core:blockers',
        });
      }
      combat.blockersDeclared = true;
      if (!any) state.priority = ap;
      return;
    }
    case 'firstStrikeDamage': {
      const combat = state.combat!;
      const participants = [
        ...combat.attackers.map((a) => a.id),
        ...combat.attackers.flatMap((a) => a.blockedBy),
      ].map((id) => state.cards[id]).filter(Boolean);
      if (!participants.some((c) => hasKeyword(state, c, 'First strike') || hasKeyword(state, c, 'Double strike'))) return;
      dealCombatDamage(state, true);
      combat.firstStrikeDone = true;
      state.priority = ap;
      return;
    }
    case 'combatDamage':
      dealCombatDamage(state, false);
      state.priority = ap;
      return;
    case 'cleanup': {
      const p = getPlayer(state, ap);
      const max = controllerHasStatic(state, ap, 'noMaxHandSize') ? Infinity : 7;
      if (p.hand.length > max) {
        const n = p.hand.length - max;
        queueDecision(state, {
          player: ap,
          kind: 'chooseCards',
          prompt: `Discard ${n} card${n > 1 ? 's' : ''} to hand size`,
          cards: [...p.hand],
          min: n,
          max: n,
          handler: 'core:cleanupDiscard',
          privateCards: true,
        });
        return;
      }
      finishCleanup(state);
      return;
    }
  }
}

export function finishCleanup(state: GameState): void {
  for (const c of battlefieldCards(state)) {
    c.damage = 0;
    c.deathtouched = false;
    c.temp = { power: 0, toughness: 0, keywords: [] };
    if (c.eotControlOf) {
      c.controller = c.eotControlOf;
      c.eotControlOf = null;
    }
  }
}

export function advanceStep(state: GameState): void {
  if (state.step === 'cleanup') {
    startTurn(state, nextPlayer(state, state.activePlayer));
    return;
  }
  let next = STEP_ORDER[STEP_ORDER.indexOf(state.step) + 1];
  if (state.step === 'declareAttackers' && (!state.combat || state.combat.attackers.length === 0)) next = 'endCombat';
  if (state.step === 'endCombat') state.combat = null;
  enterStep(state, next);
}

function dealCombatDamage(state: GameState, first: boolean): void {
  const combat = state.combat;
  if (!combat) return;
  const fs = (c: CardInstance) => hasKeyword(state, c, 'First strike') || hasKeyword(state, c, 'Double strike');
  const strikes = (c: CardInstance) => {
    if (first) return fs(c);
    if (!combat.firstStrikeDone) return true;
    return !combat.dealtFirstStrike.includes(c.id) || hasKeyword(state, c, 'Double strike');
  };
  const assignments: { source: CardInstance; target: Target; amount: number }[] = [];
  for (const a of combat.attackers) {
    const A = state.cards[a.id];
    if (!A || A.zone !== 'battlefield') continue;
    if (!strikes(A)) continue;
    if (first) combat.dealtFirstStrike.push(A.id);
    const power = getPT(state, A).power;
    if (power <= 0) continue;
    const trample = hasKeyword(state, A, 'Trample');
    // Attacking a planeswalker that has left the battlefield deals no damage.
    const pw = a.planeswalker ? state.cards[a.planeswalker] : null;
    const hit: Target | null = a.planeswalker ? (pw && pw.zone === 'battlefield' ? { type: 'card', id: pw.id } : null) : { type: 'player', id: a.defender };
    if (!a.blocked) {
      if (hit) assignments.push({ source: A, target: hit, amount: power });
      continue;
    }
    const blockers = a.blockedBy.map((id) => state.cards[id]).filter((b) => b && b.zone === 'battlefield');
    if (blockers.length === 0) {
      if (trample && hit) assignments.push({ source: A, target: hit, amount: power });
      continue;
    }
    const dt = hasKeyword(state, A, 'Deathtouch');
    let remaining = power;
    blockers.forEach((b, i) => {
      const lethal = dt ? 1 : Math.max(0, getPT(state, b).toughness - b.damage);
      const isLast = i === blockers.length - 1;
      const amt = isLast && !trample ? remaining : Math.min(remaining, lethal);
      if (amt > 0) assignments.push({ source: A, target: { type: 'card', id: b.id }, amount: amt });
      remaining -= amt;
    });
    if (trample && remaining > 0 && hit) assignments.push({ source: A, target: hit, amount: remaining });
  }
  for (const a of combat.attackers) {
    const A = state.cards[a.id];
    for (const bid of a.blockedBy) {
      const B = state.cards[bid];
      if (!B || B.zone !== 'battlefield' || !strikes(B)) continue;
      if (first) combat.dealtFirstStrike.push(B.id);
      const power = getPT(state, B).power;
      if (power > 0 && A && A.zone === 'battlefield') assignments.push({ source: B, target: { type: 'card', id: A.id }, amount: power });
    }
  }
  for (const as of assignments) dealDamage(state, as.source, as.target, as.amount, true);
  const total = assignments.filter((a) => a.target.type === 'player');
  for (const t of assignments) {
    if (t.target.type === 'player') log(state, `${t.source.def} deals ${t.amount} combat damage to ${getPlayer(state, t.target.id).name}.`);
    else if (state.cards[t.target.id] && hasType(state.cards[t.target.id], 'Planeswalker') && !state.combat?.attackers.some((x) => x.blockedBy.includes(t.target.id))) {
      log(state, `${t.source.def} deals ${t.amount} combat damage to ${state.cards[t.target.id].def}.`);
    }
  }
}

export function processTriggers(state: GameState): void {
  processPendingTrigger(state);
}

export { createToken };
