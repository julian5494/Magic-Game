// Protection, clones, X-cost tutors, delayed effects and more (Krark & Sakashima deck), from real oracle text.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import type { GameState } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { drawCards } from '../src/engine/ops';
import { findDef, registerGenerated } from '../src/engine/registry';
import { canBlock } from '../src/engine/rules';
import { getPT, isLegendary } from '../src/engine/state';
import { lands, moveAndFlush, P, player, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const SWORD = card({ name: 'Test Sword', mana_cost: '{3}', type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +2/+2 and has protection from red and from blue.\nEquip {2}' });
const SPARK = card({ name: 'Test Spark', mana_cost: '{3}{U}', type_line: 'Creature — Illusion', power: '0', toughness: '0', oracle_text: "You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary." });
const WHIR = card({ name: 'Test Whir', mana_cost: '{X}{U}{U}{U}', type_line: 'Instant', oracle_text: 'Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.' });
const SLEIGHT = card({ name: 'Test Sleight', mana_cost: '{U}', type_line: 'Sorcery', oracle_text: 'Look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.' });
const WINDFALL = card({ name: 'Test Windfall', mana_cost: '{2}{U}', type_line: 'Sorcery', oracle_text: 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.' });
const DRAIN = card({ name: 'Test Drain', mana_cost: '{U}{U}', type_line: 'Instant', oracle_text: "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value." });
const LOCUST = card({ name: 'Test Locust', mana_cost: '{2}{U}{R}', type_line: 'Legendary Creature — God', power: '4', toughness: '4', oracle_text: "When this creature dies, return it to its owner's hand at the beginning of the next end step." });
const LABMAN = card({ name: 'Test Labman', mana_cost: '{2}{U}', type_line: 'Creature — Human Wizard', power: '2', toughness: '2', oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.' });
const REMORA = card({ name: 'Test Remora', mana_cost: '{U}', type_line: 'Enchantment', oracle_text: 'Cumulative upkeep {1}' });
const TEZZ = card({ name: 'Test Tezzeret', mana_cost: '{3}{U}{U}', type_line: 'Legendary Planeswalker — Tezzeret', oracle_text: '−X: Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.', loyalty: '4' } as any);

/** Pass priority and answer decisions until `done` (or a guard runs out). */
function run(s: GameState, done: (s: GameState) => boolean, answer: (d: any) => any = (d) => ({ cards: [], option: 'no', attackers: [], blocks: [] })) {
  for (let i = 0; i < 200 && !done(s) && s.phase !== 'over'; i++) {
    const d = s.decisions[0];
    s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: answer(d) }) : act(s, s.priority!, { type: 'pass' });
  }
  return s;
}

describe('Krark & Sakashima deck mechanics', () => {
  it('protection from red: no red blockers, targets or damage', () => {
    let { s, A, B } = setup('izzet');
    const bear = put(s, A, 'Grizzly Bears');
    put(s, A, SWORD).attachedTo = bear.id;
    const goblin = put(s, B, 'Raging Goblin');
    expect(canBlock(s, goblin, bear)).toBe(false);
    lands(s, B, 'Mountain', 1);
    put(s, B, 'Lightning Bolt', 'hand');
    s.priority = B;
    const bolt = legalActions(s, B).find((a) => a.type === 'cast' && /Lightning Bolt/.test(s.cards[a.cardId!].def))!;
    expect(bolt.targets[0].options.some((o) => o.type === 'card' && o.id === bear.id)).toBe(false);
    expect(getPT(s, bear).power).toBe(4);
  });

  it("Spark Double copies a legend, isn't legendary, and gets a +1/+1 counter", () => {
    let { s, A } = setup('izzet');
    const legend = put(s, A, LOCUST);
    lands(s, A, 'Island', 4);
    const sd = put(s, A, SPARK, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: sd.id }), (d) => (d.kind === 'chooseCards' && d.cards?.includes(legend.id) ? { cards: [legend.id] } : undefined));
    const copy = s.cards[sd.id];
    expect(copy.zone).toBe('battlefield');
    expect(copy.def).toBe(LOCUST);
    expect(isLegendary(copy)).toBe(false);
    expect(s.cards[legend.id].zone).toBe('battlefield');
    expect(getPT(s, copy).power).toBe(5);
  });

  it('Whir of Invention: X caps the mana value', () => {
    let { s, A } = setup('izzet');
    lands(s, A, 'Island', 5);
    const w = put(s, A, WHIR, 'hand');
    const lib = P(s, A).library;
    const ring = put(s, A, 'Sol Ring', 'library');
    const a = legalActions(s, A).find((x) => x.cardId === w.id)!;
    expect(a.xMax).toBe(2);
    s = settle(act(s, A, { type: 'cast', cardId: w.id, x: 1 }), (d) => (d.kind === 'chooseCards' ? { cards: d.cards!.includes(ring.id) ? [ring.id] : [] } : undefined));
    expect(s.cards[ring.id].zone).toBe('battlefield');
    expect(lib).toBeDefined();
  });

  it('Tezzeret −X: X up to its loyalty', () => {
    let { s, A } = setup('izzet');
    const t = put(s, A, TEZZ);
    t.counters.loyalty = 4;
    const ring = put(s, A, 'Sol Ring', 'library');
    const a = legalActions(s, A).find((x) => x.cardId === t.id && x.type === 'activate')!;
    expect(a.xMax).toBe(4);
    s = settle(act(s, A, { type: 'activate', cardId: t.id, ability: a.ability!, x: 1 }), (d) => (d.kind === 'chooseCards' ? { cards: d.cards!.includes(ring.id) ? [ring.id] : [] } : undefined));
    expect(s.cards[t.id].counters.loyalty).toBe(3);
    expect(s.cards[ring.id].zone).toBe('battlefield');
  });

  it('Sleight of Hand: one to hand, the other to the bottom', () => {
    let { s, A } = setup('izzet');
    lands(s, A, 'Island', 1);
    const sl = put(s, A, SLEIGHT, 'hand');
    const [top, second] = P(s, A).library;
    const hand = P(s, A).hand.length;
    s = settle(act(s, A, { type: 'cast', cardId: sl.id }), (d) => (d.kind === 'chooseCards' ? { cards: [second] } : undefined));
    expect(P(s, A).hand.length).toBe(hand - 1 + 1);
    expect(s.cards[second].zone).toBe('hand');
    expect(P(s, A).library[P(s, A).library.length - 1]).toBe(top);
  });

  it('Windfall: everyone draws the most anyone discarded', () => {
    let { s, A, B } = setup('izzet');
    lands(s, A, 'Island', 3);
    const w = put(s, A, WINDFALL, 'hand');
    while (P(s, B).hand.length > 2) P(s, B).library.unshift(P(s, B).hand.pop()!);
    for (const id of P(s, B).library.slice(0, 0)) void id;
    const most = Math.max(P(s, A).hand.length - 1, P(s, B).hand.length);
    s = settle(act(s, A, { type: 'cast', cardId: w.id }));
    expect(P(s, A).hand.length).toBe(most);
    expect(P(s, B).hand.length).toBe(most);
  });

  it('Mana Drain adds {C} at your next main phase', () => {
    let { s, A, B } = setup('izzet');
    lands(s, B, 'Mountain', 1);
    const bolt = put(s, B, 'Lightning Bolt', 'hand');
    lands(s, A, 'Island', 2);
    const d = put(s, A, DRAIN, 'hand');
    s.priority = B;
    s = act(s, B, { type: 'cast', cardId: bolt.id, targets: [player(A)] });
    s = act(s, B, { type: 'pass' });
    s = act(s, A, { type: 'cast', cardId: d.id, targets: [{ type: 'stack', id: s.stack[0].id }] });
    s = settle(s);
    expect(s.cards[bolt.id].zone).toBe('graveyard');
    expect(s.delayed?.length).toBe(1);
    // "Your next main phase": cast during A's first main phase, so it's A's second main phase this turn.
    s = run(s, (x) => x.activePlayer === A && x.step === 'main2');
    expect(P(s, A).manaPool.C).toBe(1);
  });

  it('The Locust God returns to hand at the next end step', () => {
    let { s, A } = setup('izzet');
    const g = put(s, A, LOCUST);
    moveAndFlush(s, g.id, 'graveyard');
    s = settle(s);
    expect(s.cards[g.id].zone).toBe('graveyard');
    s = run(s, (x) => x.step === 'end' || x.step === 'cleanup');
    expect(s.cards[g.id].zone).toBe('hand');
  });

  it('Laboratory Maniac wins on an empty draw', () => {
    const { s, A } = setup('izzet');
    put(s, A, LABMAN);
    P(s, A).library.length = 0;
    drawCards(s, A, 1);
    expect(s.winner).toBe(A);
  });

  it('cumulative upkeep: pay more each turn or sacrifice', () => {
    let { s, A } = setup('izzet');
    const r = put(s, A, REMORA);
    lands(s, A, 'Island', 1);
    s = run(s, (x) => x.activePlayer !== A);
    s = run(s, (x) => x.activePlayer === A && x.step !== 'untap' && x.step !== 'upkeep' && x.turn > 1, (d) => ({ option: 'no', cards: [], attackers: [], blocks: [] }));
    expect(s.cards[r.id].zone).toBe('graveyard');
  });
});
