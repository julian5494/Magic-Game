// The top of the library: looking at it, playing from it, reordering it; lands from the graveyard; granted flash.
import { describe, expect, it } from 'vitest';
import { act, buildView, legalActions } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { lands, P, put, settle, setup } from './helpers';

/** Register a card from Scryfall-style oracle text (as an imported deck would). */
function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  expect(findDef(c.name)!.unsupported ?? []).toEqual([]);
  return c.name;
}

const VIZIER = card({ name: 'Test Vizier', mana_cost: '{3}{G}', type_line: 'Creature — Naga', power: '3', toughness: '4', oracle_text: 'You may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.' });
const COURSER = card({ name: 'Test Courser', mana_cost: '{1}{G}{G}', type_line: 'Enchantment Creature — Centaur', power: '2', toughness: '4', oracle_text: 'Play with the top card of your library revealed.\nYou may play lands from the top of your library.' });
const EXCAVATOR = card({ name: 'Test Excavator', mana_cost: '{2}{G}', type_line: 'Creature — Naga', power: '3', toughness: '3', oracle_text: 'You may play lands from your graveyard.' });
const LEYLINE = card({ name: 'Test Leyline', mana_cost: '{2}{U}{U}', type_line: 'Enchantment', oracle_text: 'You may cast spells as though they had flash.' });
const PONDER = card({ name: 'Test Ponder', mana_cost: '{U}', type_line: 'Sorcery', oracle_text: 'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.' });
const WAYFINDER = card({ name: 'Test Wayfinder', mana_cost: '{3}{G}', type_line: 'Creature — Satyr', power: '1', toughness: '1', oracle_text: 'When this creature enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.' });
const DIG = card({ name: 'Test Dig', mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Look at the top seven cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.' });
const BOB = card({ name: 'Test Confidant', mana_cost: '{1}{B}', type_line: 'Creature — Human', power: '2', toughness: '1', oracle_text: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.' });
const EXPLORER = card({ name: 'Test Explorer', mana_cost: '{1}{G}', type_line: 'Creature — Merfolk', power: '2', toughness: '2', oracle_text: 'When this creature enters, it explores.' });

/** Put a card on top of a player's library. */
function onTop(s: GameState, pid: PlayerId, name: string) {
  const c = put(s, pid, name, 'library');
  const lib = P(s, pid).library;
  lib.splice(lib.indexOf(c.id), 1);
  lib.unshift(c.id);
  return c;
}

describe('the top of the library', () => {
  it('"look at the top card any time": only you see it, and you can cast creatures from it', () => {
    let { s, A, B } = setup('simic');
    put(s, A, VIZIER);
    lands(s, A, 'Forest', 2);
    const bears = onTop(s, A, 'Grizzly Bears');
    expect(buildView(s, A).players.find((p) => p.id === A)!.top).toBe(bears.id);
    expect(buildView(s, B).players.find((p) => p.id === A)!.top).toBeUndefined();
    expect(buildView(s, B).cards[bears.id]).toBeUndefined();
    s = settle(act(s, A, { type: 'cast', cardId: bears.id }));
    expect(s.cards[bears.id].zone).toBe('battlefield');
    // Noncreature spells on top can't be cast this way.
    const spell = onTop(s, A, 'Divination');
    lands(s, A, 'Island', 3);
    expect(legalActions(s, A).some((a) => a.cardId === spell.id)).toBe(false);
  });

  it('"play with the top card revealed" shows it to everyone; lands can be played from the top', () => {
    let { s, A, B } = setup('simic');
    put(s, A, COURSER);
    const forest = onTop(s, A, 'Forest');
    const v = buildView(s, B).players.find((p) => p.id === A)!;
    expect(v.top).toBe(forest.id);
    expect(v.topRevealed).toBe(true);
    s = act(s, A, { type: 'playLand', cardId: forest.id });
    expect(s.cards[forest.id].zone).toBe('battlefield');
    // That was the land drop for the turn.
    const next = onTop(s, A, 'Island');
    expect(legalActions(s, A).some((a) => a.type === 'playLand' && a.cardId === next.id)).toBe(false);
  });

  it('lands can be played from the graveyard', () => {
    let { s, A } = setup('simic');
    put(s, A, EXCAVATOR);
    const forest = put(s, A, 'Forest', 'graveyard');
    s = act(s, A, { type: 'playLand', cardId: forest.id });
    expect(s.cards[forest.id].zone).toBe('battlefield');
  });

  it('"cast spells as though they had flash" lets sorceries and creatures be cast on the stack', () => {
    let { s, A } = setup('simic');
    put(s, A, LEYLINE);
    lands(s, A, 'Forest', 4);
    const bears = put(s, A, 'Grizzly Bears', 'hand');
    const growth = put(s, A, 'Rampant Growth', 'hand');
    s = act(s, A, { type: 'cast', cardId: bears.id, hold: true });
    expect(s.stack.length).toBe(1);
    expect(legalActions(s, A).some((a) => a.type === 'cast' && a.cardId === growth.id)).toBe(true);
  });

  it('Ponder: put three back in the order you choose, then maybe shuffle, then draw', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Island', 1);
    const [x, y, z] = [onTop(s, A, 'Forest'), onTop(s, A, 'Island'), onTop(s, A, 'Grizzly Bears')];
    const ponder = put(s, A, PONDER, 'hand');
    s = act(s, A, { type: 'cast', cardId: ponder.id });
    s = settle(s, (d) => (d.kind === 'chooseCards' ? { cards: [x.id, z.id, y.id] } : d.kind === 'chooseOption' ? { option: 'no' } : undefined));
    // x went on top and was drawn; z is now on top, then y.
    expect(s.cards[x.id].zone).toBe('hand');
    expect(P(s, A).library.slice(0, 2)).toEqual([z.id, y.id]);
  });

  it('reveal four, take a land, the rest go to the graveyard', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Forest', 4);
    const cards = [onTop(s, A, 'Grizzly Bears'), onTop(s, A, 'Forest'), onTop(s, A, 'Divination'), onTop(s, A, 'Opt')];
    const forest = cards[1];
    const way = put(s, A, WAYFINDER, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: way.id }), (d) => (d.kind === 'chooseCards' ? { cards: [forest.id] } : undefined));
    expect(s.cards[forest.id].zone).toBe('hand');
    expect(cards.filter((c) => c !== forest).every((c) => s.cards[c.id].zone === 'graveyard')).toBe(true);
  });

  it('"put two of them into your hand" takes exactly two', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Island', 1);
    for (let i = 0; i < 7; i++) onTop(s, A, i % 2 ? 'Forest' : 'Opt');
    const dig = put(s, A, DIG, 'hand');
    s = act(s, A, { type: 'cast', cardId: dig.id });
    s = act(s, A, { type: 'pass' });
    s = act(s, s.priority!, { type: 'pass' });
    const d = s.decisions[0];
    expect(d.min).toBe(2);
    expect(d.max).toBe(2);
  });

  it('Dark Confidant-style upkeep: reveal the top card, put it in hand, lose life equal to its mana value', () => {
    let { s, A, B } = setup('simic');
    put(s, B, BOB);
    const top = onTop(s, B, 'Thragtusk');
    const life = P(s, B).life;
    // Pass through to B's upkeep.
    for (let i = 0; i < 80 && !(s.activePlayer === B && s.step === 'draw'); i++) {
      const d = s.decisions[0];
      if (d) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes', cards: (d.cards ?? []).slice(0, d.min ?? 0) } });
      else s = act(s, s.priority!, { type: 'pass' });
    }
    expect(s.cards[top.id].zone).toBe('hand');
    expect(P(s, B).life).toBe(life - 5);
  });

  it('explore: a land goes to hand; otherwise a +1/+1 counter', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Forest', 4);
    const land = onTop(s, A, 'Forest');
    const e1 = put(s, A, EXPLORER, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: e1.id }));
    expect(s.cards[land.id].zone).toBe('hand');
    const spell = onTop(s, A, 'Divination');
    const e2 = put(s, A, EXPLORER, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: e2.id }), (d) => (d.kind === 'chooseOption' ? { option: 'yes' } : undefined));
    expect(s.cards[e2.id].counters['+1/+1']).toBe(1);
    expect(s.cards[spell.id].zone).toBe('graveyard');
  });

  it('flashback cards can be cast from the graveyard', () => {
    const { s, A } = setup('orzhov');
    lands(s, A, 'Swamp', 2);
    const souls = put(s, A, 'Lingering Souls', 'graveyard');
    expect(legalActions(s, A).some((a) => a.type === 'cast' && a.cardId === souls.id)).toBe(true);
  });
});
