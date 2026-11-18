import type { CardFilter, Ctx, TargetSpec } from './cardtypes';
import { getDef } from './registry';
import {
  alivePlayers, battlefieldCards, commanderIdentity, controllerHasStatic, defOf, getKeywords, getPlayer, getPT, hasKeyword,
  hasType, log, matchesFilter, newId, opponentsOf, snapshot,
} from './state';
import type {
  CardId, CardInstance, Decision, DecisionAnswer, GameEvent, GameState, Keyword, ManaSym, PlayerId,
  Snapshot, Target, ZoneName,
} from './types';

// ---------- RNG ----------

export function random(state: GameState): number {
  // mulberry32
  let t = (state.seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(state: GameState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------- Cards & zones ----------

export function makeCard(state: GameState, defName: string, owner: PlayerId, zone: ZoneName, token = false): CardInstance {
  getDef(defName); // validate
  const card: CardInstance = {
    id: newId(state, 'c'),
    def: defName,
    owner,
    controller: owner,
    zone,
    inc: 0,
    tapped: false,
    sick: true,
    damage: 0,
    deathtouched: false,
    counters: {},
    temp: { power: 0, toughness: 0, keywords: [] },
    attachedTo: null,
    token,
    commander: false,
    skipUntap: 0,
    linked: [],
  };
  state.cards[card.id] = card;
  return card;
}

function zoneArray(state: GameState, card: CardInstance, zone: ZoneName): CardId[] | null {
  if (zone === 'battlefield') return state.battlefield;
  if (zone === 'stack') return null;
  const p = getPlayer(state, card.owner);
  return p[zone];
}

export function pushEvent(state: GameState, e: GameEvent): void {
  state.events.push(e);
}

export function queueDecision(state: GameState, d: Omit<Decision, 'id'>, front = false): Decision {
  const dec = { ...d, id: newId(state, 'd') } as Decision;
  if (front) state.decisions.unshift(dec);
  else state.decisions.push(dec);
  return dec;
}

export function moveCard(
  state: GameState,
  id: CardId,
  to: ZoneName,
  opts: { tapped?: boolean; controller?: PlayerId; bottom?: boolean; silent?: boolean } = {},
): void {
  const card = state.cards[id];
  if (!card) return;
  const from = card.zone;
  if (from === 'battlefield') {
    const snap = snapshot(state, card);
    state.battlefield = state.battlefield.filter((x) => x !== id);
    if (state.combat) {
      state.combat.attackers = state.combat.attackers.filter((a) => a.id !== id);
      for (const a of state.combat.attackers) a.blockedBy = a.blockedBy.filter((b) => b !== id);
    }
    state.recentlyLeft.push(snap);
    pushEvent(state, { t: 'leaves', card: id, snap, to });
  } else {
    const arr = zoneArray(state, card, from);
    if (arr) {
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  if (from === 'hand' && to === 'graveyard') pushEvent(state, { t: 'discard', player: card.owner, card: id });

  // Tokens cease to exist once they leave the battlefield.
  if (card.token && from === 'battlefield' && to !== 'battlefield') {
    delete state.cards[id];
    return;
  }

  const paidX = card.x;
  card.zone = to;
  card.inc++;
  card.tapped = false;
  card.damage = 0;
  card.deathtouched = false;
  card.counters = {};
  card.temp = { power: 0, toughness: 0, keywords: [] };
  card.attachedTo = null;
  card.sick = true;
  card.skipUntap = 0;
  card.eotControlOf = null;
  if (to !== 'stack') card.x = undefined;
  if (from === 'battlefield') card.linked = [];
  card.controller = to === 'battlefield' || to === 'stack' ? opts.controller ?? card.owner : card.owner;

  if (to === 'battlefield') {
    const def = defOf(card);
    card.tapped = !!opts.tapped || !!def.entersTapped || !!def.entersTappedIf?.(state, card.controller);
    if (def.etbCounters) {
      const n = def.etbCounters.n === 'X' ? paidX ?? 0 : def.etbCounters.n;
      if (n > 0) card.counters[def.etbCounters.kind] = (card.counters[def.etbCounters.kind] ?? 0) + n;
    }
    state.battlefield.push(id);
    if (def.shockLand && !card.tapped) {
      queueDecision(state, {
        player: card.controller,
        kind: 'chooseOption',
        prompt: `${def.name}: pay 2 life? If you don't, it enters tapped.`,
        options: [
          { id: 'pay', label: 'Pay 2 life (untapped)' },
          { id: 'tapped', label: 'Enters tapped' },
        ],
        handler: 'core:shock',
        data: { card: id, inc: card.inc },
      }, true);
    }
    pushEvent(state, { t: 'etb', card: id, controller: card.controller });
  } else if (to !== 'stack') {
    const arr = zoneArray(state, card, to)!;
    if (to === 'library') {
      if (opts.bottom) arr.push(id);
      else arr.unshift(id);
    } else arr.push(id);
  }

  if (card.commander && (to === 'graveyard' || to === 'exile' || to === 'library')) {
    queueDecision(state, {
      player: card.owner,
      kind: 'chooseOption',
      prompt: `Your commander ${card.def} was put into your ${to}. Move it to the command zone?`,
      options: [
        { id: 'yes', label: 'Command zone' },
        { id: 'no', label: `Leave in ${to}` },
      ],
      handler: 'core:commanderZone',
      data: { card: id, inc: card.inc },
    });
  }
}

export function drawCards(state: GameState, pid: PlayerId, n: number): void {
  const p = getPlayer(state, pid);
  for (let i = 0; i < n; i++) {
    if (p.library.length === 0) {
      p.drewFromEmpty = true;
      return;
    }
    moveCard(state, p.library[0], 'hand');
    pushEvent(state, { t: 'draw', player: pid });
  }
}

export function gainLife(state: GameState, pid: PlayerId, n: number): void {
  if (n <= 0) return;
  const p = getPlayer(state, pid);
  if (p.lost) return;
  p.life += n;
  p.lifeGainedThisTurn += n;
  pushEvent(state, { t: 'gainLife', player: pid, amount: n });
}

export function loseLife(state: GameState, pid: PlayerId, n: number): void {
  if (n <= 0) return;
  const p = getPlayer(state, pid);
  p.life -= n;
}

export function dealDamage(
  state: GameState,
  source: CardInstance | Snapshot,
  target: Target | CardId | PlayerId | null,
  amount: number,
  combat = false,
): void {
  if (amount <= 0 || target === null) return;
  const t = normalizeTarget(state, target);
  if (!t) return;
  const live = state.cards[source.id];
  const kws: Keyword[] = live && live.zone === 'battlefield' ? getKeywords(state, live) : defOf(source).keywords ?? [];
  const controller = live ? live.controller : source.controller;
  if (t.type === 'player') {
    const p = getPlayer(state, t.id);
    if (p.lost) return;
    p.life -= amount;
    if (combat) {
      pushEvent(state, { t: 'combatDamagePlayer', source: source.id, player: p.id, amount });
      if (state.monarch === p.id && controller !== p.id) {
        state.monarch = controller;
        log(state, `${getPlayer(state, controller).name} takes the monarchy.`);
      }
      if (source.commander) p.commanderDamage[source.id] = (p.commanderDamage[source.id] ?? 0) + amount;
    }
  } else if (t.type === 'card') {
    const c = state.cards[t.id];
    if (!c || c.zone !== 'battlefield' || !hasType(c, 'Creature')) return;
    if (!combat && c.id !== source.id && controllerHasStatic(state, c.controller, 'preventNoncombatDamageToOtherCreatures')) {
      const preventer = battlefieldCards(state).find(
        (x) => x.controller === c.controller && (defOf(x).statics ?? []).some((s) => s.kind === 'preventNoncombatDamageToOtherCreatures'),
      );
      if (preventer && preventer.id !== c.id) return;
    }
    c.damage += amount;
    if (kws.includes('Deathtouch')) c.deathtouched = true;
  } else return;
  if (kws.includes('Lifelink')) gainLife(state, controller, amount);
}

export function normalizeTarget(state: GameState, t: Target | CardId | PlayerId): Target | null {
  if (typeof t === 'object') return t;
  if (state.cards[t]) return { type: 'card', id: t };
  if (state.players.some((p) => p.id === t)) return { type: 'player', id: t };
  return null;
}

export function destroy(state: GameState, id: CardId): boolean {
  const c = state.cards[id];
  if (!c || c.zone !== 'battlefield') return false;
  if (hasKeyword(state, c, 'Indestructible')) return false;
  moveCard(state, id, 'graveyard');
  return true;
}

export function createToken(state: GameState, pid: PlayerId, defName: string, n = 1): CardInstance[] {
  const out: CardInstance[] = [];
  for (let i = 0; i < n; i++) {
    const card = makeCard(state, defName, pid, 'stack', true);
    card.zone = 'stack';
    moveCard(state, card.id, 'battlefield', { controller: pid });
    out.push(card);
  }
  return out;
}

export function tapPermanent(state: GameState, card: CardInstance): void {
  if (card.tapped) return;
  card.tapped = true;
  pushEvent(state, { t: 'tapped', card: card.id });
}

export function addMana(state: GameState, pid: PlayerId, sym: ManaSym, n: number): void {
  getPlayer(state, pid).manaPool[sym] += n;
}

// ---------- Targeting ----------

function targetableBy(state: GameState, card: CardInstance, controller: PlayerId): boolean {
  const kws = getKeywords(state, card);
  if (kws.includes('Shroud')) return false;
  if (kws.includes('Hexproof') && card.controller !== controller) return false;
  return true;
}

export function legalTargets(state: GameState, spec: TargetSpec, controller: PlayerId, source: CardId): Target[] {
  const out: Target[] = [];
  const perms = (types?: CardFilter['types']) =>
    battlefieldCards(state).filter(
      (c) =>
        (!types || types.some((t) => hasType(c, t))) &&
        matchesFilter(state, c, spec.filter, controller, source) &&
        targetableBy(state, c, controller),
    );
  switch (spec.kind) {
    case 'creature':
      for (const c of perms(['Creature'])) out.push({ type: 'card', id: c.id, inc: c.inc });
      break;
    case 'permanent':
      for (const c of perms()) out.push({ type: 'card', id: c.id, inc: c.inc });
      break;
    case 'player':
      for (const p of alivePlayers(state)) out.push({ type: 'player', id: p.id });
      break;
    case 'opponent':
      for (const p of opponentsOf(state, controller)) out.push({ type: 'player', id: p });
      break;
    case 'any':
      for (const c of perms(['Creature', 'Planeswalker'])) out.push({ type: 'card', id: c.id, inc: c.inc });
      for (const p of alivePlayers(state)) out.push({ type: 'player', id: p.id });
      break;
    case 'spell':
      for (const s of state.stack) {
        if (s.kind !== 'spell' || s.cardId === source) continue;
        const def = getDef(s.def);
        if (spec.spellTypes && !spec.spellTypes.some((t) => def.types.includes(t))) continue;
        if (spec.spellNotTypes && spec.spellNotTypes.some((t) => def.types.includes(t))) continue;
        out.push({ type: 'stack', id: s.id });
      }
      break;
    case 'graveyardCard': {
      const players = spec.graveyard === 'any' ? alivePlayers(state).map((p) => p.id) : [controller];
      for (const pid of players) {
        for (const id of getPlayer(state, pid).graveyard) {
          const c = state.cards[id];
          if (matchesFilter(state, c, { ...spec.filter, controller: undefined }, controller, source)) out.push({ type: 'card', id, inc: c.inc });
        }
      }
      break;
    }
  }
  return out;
}

export function sameTarget(a: Target, b: Target): boolean {
  return a.type === b.type && a.id === b.id;
}

export function isStillLegal(state: GameState, spec: TargetSpec, t: Target, controller: PlayerId, source: CardId): boolean {
  if (t.type === 'card') {
    const c = state.cards[t.id];
    if (!c || (t.inc !== undefined && c.inc !== t.inc)) return false;
  }
  return legalTargets(state, spec, controller, source).some((o) => sameTarget(o, t));
}

// ---------- Effect context ----------

export interface CtxInit {
  controller: PlayerId;
  source: CardId;
  sourceInc?: number;
  targets?: (Target | null)[];
  event?: GameEvent;
  x?: number;
  sacrificed?: Snapshot;
  snapshot?: Snapshot;
  def: string;
}

function resolveCard(state: GameState, c: CardInstance | CardId | null): CardInstance | null {
  if (!c) return null;
  const card = typeof c === 'string' ? state.cards[c] : state.cards[c.id];
  return card ?? null;
}

export function makeCtx(state: GameState, init: CtxInit): Ctx {
  const live = state.cards[init.source];
  const self =
    live && live.zone === 'battlefield' && (init.sourceInc === undefined || live.inc === init.sourceInc) ? live : null;
  const targets = init.targets ?? [];
  const sourceForDamage = (): CardInstance | Snapshot =>
    self ?? init.snapshot ?? (live ? live : ({ id: init.source, def: init.def, controller: init.controller } as Snapshot));
  const card = (c: CardInstance | CardId | null) => resolveCard(state, c);
  const cardData = { def: init.def, controller: init.controller, source: init.source, sourceInc: init.sourceInc, targets, event: init.event, x: init.x, sacrificed: init.sacrificed, snapshot: init.snapshot };

  const ctx: Ctx = {
    state,
    controller: init.controller,
    source: init.source,
    self,
    snapshot: init.snapshot,
    targets,
    event: init.event,
    x: init.x ?? 0,
    sacrificed: init.sacrificed,

    card(i) {
      const t = targets[i];
      if (!t || t.type !== 'card') return null;
      const c = state.cards[t.id];
      if (!c || (t.inc !== undefined && c.inc !== t.inc)) return null;
      return c;
    },
    player(i) {
      const t = targets[i];
      return t && t.type === 'player' ? t.id : null;
    },
    opponents: () => opponentsOf(state, init.controller),
    players: () => alivePlayers(state).map((p) => p.id),
    permanents: (filter) => battlefieldCards(state).filter((c) => matchesFilter(state, c, filter, init.controller, init.source)),
    creatures: (filter) =>
      battlefieldCards(state).filter((c) => hasType(c, 'Creature') && matchesFilter(state, c, filter, init.controller, init.source)),
    power: (c) => {
      const x = card(c);
      return x ? getPT(state, x).power : 0;
    },
    toughness: (c) => {
      const x = card(c);
      return x ? getPT(state, x).toughness : 0;
    },
    controllerOf(t) {
      if (!t) return null;
      if (t.type === 'player') return t.id;
      if (t.type === 'card') return state.cards[t.id]?.controller ?? null;
      return state.stack.find((s) => s.id === t.id)?.controller ?? null;
    },

    damage: (to, n) => dealDamage(state, sourceForDamage(), to, n, false),
    damageFrom: (src, to, n) => {
      const c = state.cards[src];
      if (c) dealDamage(state, c, to, n, false);
    },
    draw: (p, n) => drawCards(state, p, n),
    gainLife: (p, n) => gainLife(state, p, n),
    loseLife: (p, n) => loseLife(state, p, n),
    destroy: (c) => {
      const x = card(c);
      if (x) destroy(state, x.id);
    },
    exile: (c) => {
      const x = card(c);
      if (x) moveCard(state, x.id, 'exile');
    },
    bounce: (c) => {
      const x = card(c);
      if (x) moveCard(state, x.id, 'hand');
    },
    tap: (c) => {
      const x = card(c);
      if (x) tapPermanent(state, x);
    },
    untap: (c) => {
      const x = card(c);
      if (x) x.tapped = false;
    },
    counterSpell(stackId) {
      if (!stackId) return;
      const idx = state.stack.findIndex((s) => s.id === stackId);
      if (idx < 0) return;
      const item = state.stack[idx];
      if (item.kind === 'spell' && (getDef(item.def).statics ?? []).some((s) => s.kind === 'cantBeCountered')) {
        log(state, `${item.def} can't be countered.`);
        return;
      }
      state.stack.splice(idx, 1);
      if (item.kind === 'spell') moveCard(state, item.cardId, 'graveyard');
      log(state, `${item.def} was countered.`);
    },
    pump(c, p, t, kws) {
      const x = card(c);
      if (!x || x.zone !== 'battlefield') return;
      x.temp.power += p;
      x.temp.toughness += t;
      if (kws) x.temp.keywords.push(...kws);
    },
    addCounters(c, kind, n) {
      const x = card(c);
      if (!x || x.zone !== 'battlefield') return;
      x.counters[kind] = (x.counters[kind] ?? 0) + n;
    },
    createToken: (p, name, n = 1) => createToken(state, p, name, n),
    mill(p, n) {
      const pl = getPlayer(state, p);
      for (let i = 0; i < n && pl.library.length; i++) moveCard(state, pl.library[0], 'graveyard');
    },
    moveCard: (id, to, opts) => moveCard(state, id, to, opts),
    addMana: (p, sym, n) => addMana(state, p, sym, n),
    gainControlUntilEndOfTurn(c) {
      if (!c || c.zone !== 'battlefield') return;
      if (c.controller === init.controller) return;
      c.eotControlOf = c.eotControlOf ?? c.controller;
      c.controller = init.controller;
      c.sick = true;
    },
    fight(a, b) {
      if (!a || !b || a.zone !== 'battlefield' || b.zone !== 'battlefield') return;
      const pa = getPT(state, a).power;
      const pb = getPT(state, b).power;
      dealDamage(state, a, { type: 'card', id: b.id }, pa);
      dealDamage(state, b, { type: 'card', id: a.id }, pb);
    },
    log: (text) => log(state, text),

    eachSacrifices(players, filter, n) {
      for (const pid of players) {
        if (pid !== init.controller && controllerHasStatic(state, pid, 'oppsCantMakeYouSacrifice')) continue;
        const options = battlefieldCards(state).filter((c) => c.controller === pid && matchesFilter(state, c, filter, pid, init.source));
        if (options.length === 0) continue;
        if (options.length <= n) {
          for (const o of options) moveCard(state, o.id, 'graveyard');
          log(state, `${getPlayer(state, pid).name} sacrificed ${options.map((o) => o.def).join(', ')}.`);
          continue;
        }
        queueDecision(state, {
          player: pid,
          kind: 'chooseCards',
          prompt: `Choose ${n} to sacrifice`,
          cards: options.map((o) => o.id),
          min: n,
          max: n,
          handler: 'core:sacrifice',
        });
      }
    },
    chooseAndBounce(p, filter, n) {
      const options = battlefieldCards(state).filter((c) => c.controller === p && matchesFilter(state, c, filter, p, init.source));
      if (options.length === 0) return;
      if (options.length <= n) {
        for (const o of options) moveCard(state, o.id, 'hand');
        return;
      }
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt: `Return ${n} to your hand`,
        cards: options.map((o) => o.id),
        min: n,
        max: n,
        handler: 'core:bounceChosen',
      });
    },
    discard(p, n) {
      const hand = getPlayer(state, p).hand;
      if (hand.length === 0) return;
      if (hand.length <= n) {
        for (const id of [...hand]) moveCard(state, id, 'graveyard');
        return;
      }
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt: `Discard ${n} card${n > 1 ? 's' : ''}`,
        cards: [...hand],
        min: n,
        max: n,
        handler: 'core:discard',
        privateCards: true,
      });
    },
    discardRandom(p, n) {
      const hand = getPlayer(state, p).hand;
      for (let i = 0; i < n && hand.length; i++) {
        const id = hand[Math.floor(random(state) * hand.length)];
        log(state, `${getPlayer(state, p).name} discarded ${state.cards[id].def} at random.`);
        moveCard(state, id, 'graveyard');
      }
    },
    search(opts) {
      const pid = opts.player ?? init.controller;
      const pl = getPlayer(state, pid);
      const options = pl.library.filter((id) => matchesFilter(state, state.cards[id], opts.filter, pid, init.source));
      queueDecision(state, {
        player: pid,
        kind: 'chooseCards',
        prompt: opts.label,
        cards: options,
        min: 0,
        max: Math.min(opts.max, options.length),
        handler: 'core:search',
        data: { dest: opts.dest, tapped: !!opts.tapped, split: !!opts.split },
        privateCards: true,
      });
    },
    surveil(p, n, then) {
      const lib = getPlayer(state, p).library;
      if (lib.length === 0 || n <= 0) {
        if (then) runCardHandler(state, { ctx: cardData, key: then }, {});
        return;
      }
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt: `Surveil ${n}: choose cards to put into your graveyard (the rest stay on top)`,
        cards: lib.slice(0, n),
        min: 0,
        max: Math.min(n, lib.length),
        handler: 'core:surveil',
        data: then ? { then: { ctx: cardData, key: then } } : undefined,
        privateCards: true,
      });
    },
    proliferate() {
      // Auto-chosen: grow counters on your permanents and players' poison; -1/-1 on opponents' things.
      for (const c of battlefieldCards(state)) {
        for (const k of Object.keys(c.counters)) {
          if (!c.counters[k]) continue;
          const mine = c.controller === init.controller;
          if ((mine && k !== '-1/-1') || (!mine && k === '-1/-1')) c.counters[k]++;
        }
      }
      for (const p of state.players) if (p.id !== init.controller && p.poison > 0 && !p.lost) p.poison++;
    },
    unlessPays(p, cost, failKey, data) {
      queueDecision(state, {
        player: p,
        kind: 'chooseOption',
        prompt: `${init.def}: pay ${cost}? If you don't, the effect happens.`,
        options: [
          { id: 'pay', label: `Pay ${cost}` },
          { id: 'no', label: "Don't pay" },
        ],
        handler: 'core:unlessPay',
        data: { cost, fail: { ctx: cardData, key: failKey, extra: data } },
      });
    },
    copySpell(stackId, newController) {
      const item = state.stack.find((s) => s.id === stackId);
      if (!item || item.kind !== 'spell') return;
      state.stack.push({ ...item, id: newId(state, 's'), isCopy: true, controller: newController ?? init.controller });
      log(state, `${getPlayer(state, newController ?? init.controller).name} copies ${item.def}.`);
    },
    addManaChoice(p, n, colors) {
      const list: ManaSym[] = colors === 'any' ? ['W', 'U', 'B', 'R', 'G'] : colors === 'identity' ? (commanderIdentity(state, p) as ManaSym[]) : colors;
      if (list.length === 0) return addMana(state, p, 'C', n);
      if (list.length === 1) return addMana(state, p, list[0], n);
      queueDecision(state, {
        player: p,
        kind: 'chooseOption',
        prompt: `Choose a color of mana to add (${n})`,
        options: list.map((c) => ({ id: c, label: `{${c}}` })),
        handler: 'core:manaChoice',
        data: { n },
      }, true);
    },
    becomeMonarch(p) {
      if (state.monarch !== p) log(state, `${getPlayer(state, p).name} becomes the monarch.`);
      state.monarch = p;
    },
    scry(p, n, then) {
      const lib = getPlayer(state, p).library;
      if (lib.length === 0 || n <= 0) {
        if (then) runCardHandler(state, { ctx: cardData, key: then }, {});
        return;
      }
      const top = lib.slice(0, n);
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt: `Scry ${n}: choose cards to put on the bottom of your library (the rest stay on top)`,
        cards: top,
        min: 0,
        max: top.length,
        handler: 'core:scry',
        data: then ? { then: { ctx: cardData, key: then } } : undefined,
        privateCards: true,
      });
    },
    lookAndTake(p, n, max, filter, label) {
      const lib = getPlayer(state, p).library;
      const top = lib.slice(0, n);
      if (top.length === 0) return;
      const eligible = top.filter((id) => !filter || matchesFilter(state, state.cards[id], filter, p, init.source));
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt: label,
        cards: top,
        min: 0,
        max: Math.min(max, eligible.length),
        handler: 'core:lookAndTake',
        data: { top, eligible },
        privateCards: true,
      });
    },
    chooseOption(p, prompt, options, key, data) {
      queueDecision(state, { player: p, kind: 'chooseOption', prompt, options, handler: 'card', data: { ctx: cardData, key, extra: data } });
    },
    chooseCards(p, prompt, cards, min, max, key, data, privateCards) {
      queueDecision(state, {
        player: p,
        kind: 'chooseCards',
        prompt,
        cards,
        min,
        max,
        handler: 'card',
        data: { ctx: cardData, key, extra: data },
        privateCards,
      });
    },
  };
  return ctx;
}

export function runCardHandler(state: GameState, data: any, answer: DecisionAnswer): void {
  const def = getDef(data.ctx.def);
  const h = def.handlers?.[data.key];
  if (!h) throw new Error(`Missing handler ${data.key} on ${def.name}`);
  const ctx = makeCtx(state, data.ctx);
  h(ctx, answer, data.extra);
}
