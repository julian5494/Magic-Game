import { describe, expect, it } from 'vitest';
import {
  act, buildPrecon, buildView, createGame, deckToText, legalActions, PRECONS, validateDeck,
} from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { parseCost, solvePayment, emptyPool } from '../src/engine/mana';
import { makeCard, moveCard } from '../src/engine/ops';
import { getPT } from '../src/engine/state';
import { simulate } from './simulate';

const FILLER = Array.from({ length: 99 }, () => 'Forest');

/** Two humans, mulligans kept, sitting in the first player's main phase. */
function setup(): { s: GameState; A: PlayerId; B: PlayerId } {
  let s = createGame(
    [
      { id: 'a', name: 'Alice', commander: "Tajic, Legion's Edge", cards: FILLER.map(() => 'Mountain') },
      { id: 'b', name: 'Bob', commander: "Trostani, Selesnya's Voice", cards: FILLER },
    ],
    42,
  );
  for (const d of [...s.decisions]) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: { option: 'keep' } });
  // Clear random hands so tests control exactly what's available.
  for (const p of s.players) {
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return { s, A: s.activePlayer, B: s.players.find((p) => p.id !== s.activePlayer)!.id };
}

function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' | 'graveyard' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  if (zone === 'battlefield') c.sick = false;
  s.events = [];
  return c;
}

function passUntil(s: GameState, pred: (s: GameState) => boolean, max = 200): GameState {
  for (let i = 0; i < max && !pred(s); i++) {
    const d = s.decisions[0];
    if (d) {
      const answer = d.kind === 'declareAttackers' ? { attackers: [] } : d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes', cards: [] };
      s = act(s, d.player, { type: 'decide', decisionId: d.id, answer });
    } else if (s.priority) s = act(s, s.priority, { type: 'pass' });
  }
  return s;
}

describe('decks', () => {
  it('every precon is a legal 100-card Commander deck', () => {
    for (const p of PRECONS) {
      const v = validateDeck(deckToText(buildPrecon(p.id)));
      expect(v.errors).toEqual([]);
      expect(v.deck!.cards.length).toBe(99);
    }
  });

  it('rejects off-identity cards and duplicates', () => {
    const list = ['Commander', "1 Tajic, Legion's Edge", 'Deck', '2 Lightning Bolt', '1 Counterspell', '96 Mountain'].join('\n');
    const v = validateDeck(list);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/Singleton/);
    expect(v.errors.join(' ')).toMatch(/color identity/);
  });
});

describe('mana', () => {
  it('auto-pays with basics before flexible sources', () => {
    const plan = solvePayment(parseCost('{1}{R}'), emptyPool(), [
      { id: 'tower', ability: 0, produces: ['R', 'W'], amount: 1, costly: false },
      { id: 'mtn', ability: 0, produces: ['R'], amount: 1, costly: false },
      { id: 'plains', ability: 0, produces: ['W'], amount: 1, costly: false },
    ]);
    expect(plan!.taps.map((t) => t.id).sort()).toEqual(['mtn', 'plains']);
  });

  it('returns null when colors cannot be made', () => {
    expect(solvePayment(parseCost('{U}'), emptyPool(), [{ id: 'm', ability: 0, produces: ['R'], amount: 1, costly: false }])).toBeNull();
  });
});

describe('spells and state-based actions', () => {
  it('Lightning Bolt kills a creature and goes to the graveyard', () => {
    let { s, A, B } = setup();
    put(s, A, 'Mountain');
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    const bear = put(s, B, 'Grizzly Bears');
    s = act(s, A, { type: 'cast', cardId: bolt.id, targets: [{ type: 'card', id: bear.id }] });
    s = passUntil(s, (x) => x.stack.length === 0);
    expect(s.cards[bear.id].zone).toBe('graveyard');
    expect(s.cards[bolt.id].zone).toBe('graveyard');
  });

  it('Counterspell counters a spell', () => {
    let { s, A, B } = setup();
    put(s, A, 'Mountain');
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    put(s, B, 'Island');
    put(s, B, 'Island');
    const cs = put(s, B, 'Counterspell', 'hand');
    s.players.find((p) => p.id === B)!.autoPass = 'none';
    s = act(s, A, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: B }] });
    s = passUntil(s, (x) => x.priority === B);
    const stackId = s.stack[0].id;
    s = act(s, B, { type: 'cast', cardId: cs.id, targets: [{ type: 'stack', id: stackId }] });
    s = passUntil(s, (x) => x.stack.length === 0);
    expect(s.players.find((p) => p.id === B)!.life).toBe(40);
    expect(s.cards[bolt.id].zone).toBe('graveyard');
  });

  it('auras and anthems change power and toughness', () => {
    const { s, A } = setup();
    const bear = put(s, A, 'Grizzly Bears');
    put(s, A, 'Glorious Anthem');
    const ban = put(s, A, 'Bonesplitter');
    ban.attachedTo = bear.id;
    expect(getPT(s, bear)).toEqual({ power: 5, toughness: 3 });
  });

  it('Oblivion Ring exiles and returns a permanent', () => {
    let { s, A, B } = setup();
    for (let i = 0; i < 3; i++) put(s, A, 'Plains');
    const ring = put(s, A, 'Oblivion Ring', 'hand');
    const bear = put(s, B, 'Grizzly Bears');
    s = act(s, A, { type: 'cast', cardId: ring.id });
    s = passUntil(s, (x) => x.cards[bear.id].zone === 'exile');
    expect(s.cards[bear.id].zone).toBe('exile');
    moveCard(s, ring.id, 'graveyard');
    s = act(s, A, { type: 'setAutoPass', mode: 'smart' });
    s = passUntil(s, (x) => x.cards[bear.id].zone === 'battlefield');
    expect(s.cards[bear.id].zone).toBe('battlefield');
  });
});

describe('commander rules', () => {
  it('applies commander tax after the commander returns to the command zone', () => {
    let { s, A } = setup();
    for (let i = 0; i < 3; i++) put(s, A, 'Mountain');
    put(s, A, 'Plains');
    const cmd = s.players.find((p) => p.id === A)!.command[0];
    expect(legalActions(s, A).some((a) => a.type === 'cast' && a.cardId === cmd)).toBe(true);
    s = act(s, A, { type: 'cast', cardId: cmd });
    s = passUntil(s, (x) => x.cards[cmd].zone === 'battlefield');
    moveCard(s, cmd, 'graveyard');
    s.decisions = s.decisions.filter((d) => d.handler === 'core:commanderZone');
    s = act(s, A, { type: 'decide', decisionId: s.decisions[0].id, answer: { option: 'yes' } });
    expect(s.cards[cmd].zone).toBe('command');
    // Untap and try again: {1}{R}{W} + {2} tax = 5 mana, we have 4.
    for (const id of s.battlefield) s.cards[id].tapped = false;
    Object.assign(s, { step: 'main1', priority: A, decisions: [], stack: [], activePlayer: A, combat: null });
    expect(legalActions(s, A).some((a) => a.type === 'cast' && a.cardId === cmd)).toBe(false);
    put(s, A, 'Mountain');
    expect(legalActions(s, A).some((a) => a.type === 'cast' && a.cardId === cmd)).toBe(true);
  });

  it('a player who takes 21 commander damage loses', () => {
    let { s, A, B } = setup();
    const cmd = s.players.find((p) => p.id === A)!.command[0];
    moveCard(s, cmd, 'battlefield', { controller: A });
    s.cards[cmd].sick = false;
    s.cards[cmd].counters['+1/+1'] = 18; // 21 power
    s.events = [];
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareAttackers');
    s = act(s, A, { type: 'decide', decisionId: s.decisions[0].id, answer: { attackers: [{ id: cmd, defender: B }] } });
    s = passUntil(s, (x) => x.phase === 'over');
    expect(s.winner).toBe(A);
    expect(s.players.find((p) => p.id === B)!.lossReason).toMatch(/commander damage/);
  });
});

describe('combat', () => {
  it('ground creatures cannot block fliers', () => {
    let { s, A, B } = setup();
    const angel = put(s, A, 'Serra Angel');
    const bear = put(s, B, 'Grizzly Bears');
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareAttackers');
    s = act(s, A, { type: 'decide', decisionId: s.decisions[0].id, answer: { attackers: [{ id: angel.id, defender: B }] } });
    // Bob has no legal blockers, so no blocking decision is offered and damage happens.
    s = passUntil(s, (x) => x.step === 'main2' || x.step === 'end');
    expect(s.players.find((p) => p.id === B)!.life).toBe(36);
    expect(s.cards[bear.id].zone).toBe('battlefield');
  });

  it('deathtouch + trample assigns 1 to the blocker and the rest to the player', () => {
    let { s, A, B } = setup();
    const atk = put(s, A, 'Craw Wurm');
    atk.temp.keywords.push('Deathtouch', 'Trample');
    const blocker = put(s, B, 'Leatherback Baloth');
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareAttackers');
    s = act(s, A, { type: 'decide', decisionId: s.decisions[0].id, answer: { attackers: [{ id: atk.id, defender: B }] } });
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareBlockers');
    s = act(s, B, { type: 'decide', decisionId: s.decisions[0].id, answer: { blocks: [{ blocker: blocker.id, attacker: atk.id }] } });
    s = passUntil(s, (x) => x.step === 'endCombat' || x.step === 'main2');
    expect(s.cards[blocker.id].zone).toBe('graveyard');
    expect(s.players.find((p) => p.id === B)!.life).toBe(35);
  });

  it('first strike kills before regular damage', () => {
    let { s, A, B } = setup();
    const knight = put(s, A, 'Attended Knight');
    const lions = put(s, B, 'Savannah Lions');
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareAttackers');
    s = act(s, A, { type: 'decide', decisionId: s.decisions[0].id, answer: { attackers: [{ id: knight.id, defender: B }] } });
    s = passUntil(s, (x) => x.decisions[0]?.kind === 'declareBlockers');
    s = act(s, B, { type: 'decide', decisionId: s.decisions[0].id, answer: { blocks: [{ blocker: lions.id, attacker: knight.id }] } });
    s = passUntil(s, (x) => x.step === 'main2');
    expect(s.cards[lions.id].zone).toBe('graveyard');
    expect(s.cards[knight.id].zone).toBe('battlefield');
  });
});

describe('hidden information', () => {
  it("does not reveal opponents' hands or libraries", () => {
    const { s, A, B } = setup();
    const secret = put(s, B, 'Counterspell', 'hand');
    const view = buildView(s, A);
    expect(view.cards[secret.id]).toBeUndefined();
    expect(view.players.find((p) => p.id === B)!.handCount).toBe(1);
  });
});

describe('full games', () => {
  it('bots finish 4-player games without rules errors', () => {
    const ids = PRECONS.map((p) => p.id);
    for (const seed of [3, 11]) {
      const { state } = simulate(seed, ids);
      expect(state.phase).toBe('over');
    }
  }, 60_000);
});

describe('mana available (view)', () => {
  it('counts each untapped source once, grouped by color', () => {
    const { s, A } = setup();
    put(s, A, 'Forest');
    put(s, A, 'Forest');
    put(s, A, 'Sol Ring');
    put(s, A, 'Command Tower');
    const tapped = put(s, A, 'Mountain');
    tapped.tapped = true;
    const v = buildView(s, A);
    const me = v.players.find((p) => p.id === A)!;
    expect(me.mana.total).toBe(5);
    expect(me.mana.groups.find((g) => g.produces.join('') === 'G')?.amount).toBe(2);
    expect(me.mana.groups.find((g) => g.produces.join('') === 'C')?.amount).toBe(2);
    const opp = v.players.find((p) => p.id !== A)!;
    expect(opp.mana.total).toBe(0);
  });
});
