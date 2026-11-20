// More keywords and rules text, parsed from real oracle wording.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { card as tgt, lands, moveAndFlush, onField, P, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}

const CHANNELER = card({ name: 'Test Channeler', mana_cost: '{2}{U}', type_line: 'Creature — Human', power: '2', toughness: '2', oracle_text: "When this creature enters, choose one —\n• Create a 1/1 white Bird creature token with flying.\n• Return another target nonland permanent to its owner's hand.\n• Draw a card." });
const LIVES = card({ name: 'Test Lives', mana_cost: '{3}{G}', type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' });
const FOG = card({ name: 'Test Fog', mana_cost: '{G}', type_line: 'Instant', oracle_text: 'Prevent all combat damage that would be dealt this turn.' });
const PERSIST = card({ name: 'Test Persister', mana_cost: '{2}{B}', type_line: 'Creature — Spirit', power: '2', toughness: '2', oracle_text: 'Persist' });
const ANNIHILATOR = card({ name: 'Test Annihilator', mana_cost: '{4}', type_line: 'Creature — Eldrazi', power: '5', toughness: '5', oracle_text: 'Annihilator 2' });
const GROVE = card({ name: 'Test Grove', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}.' });
const GRIP = card({ name: 'Test Grip', mana_cost: '{2}{G}', type_line: 'Instant', oracle_text: 'Split second\nDestroy target artifact or enchantment.' });
const CRADLE = card({ name: 'Test Cradle', type_line: 'Legendary Land', oracle_text: '{T}: Add {G} for each creature you control.' });
const WILL = card({ name: 'Test Will', mana_cost: '{2}{R}', type_line: 'Sorcery', oracle_text: 'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• You gain 3 life.\n• Draw a card.' });

describe('keywords and rules text', () => {
  it('modal enter trigger: you pick the mode as it resolves', () => {
    let { s, A } = setup('izzet');
    lands(s, A, 'Island', 3);
    const c = put(s, A, CHANNELER, 'hand');
    const hand0 = P(s, A).hand.length;
    s = settle(act(s, A, { type: 'cast', cardId: c.id }), (d) => (d.kind === 'chooseOption' && d.options?.some((o) => /Draw a card/.test(o.label)) ? { option: d.options.find((o) => /Draw/.test(o.label))!.id } : undefined));
    expect(P(s, A).hand.length).toBe(hand0 - 1 + 1);
  });

  it('token doubling', () => {
    let { s, A } = setup('boros');
    put(s, A, LIVES);
    lands(s, A, 'Plains', 2);
    const c = put(s, A, 'Raise the Alarm', 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: c.id }));
    expect(onField(s, A, 'Soldier Token').length).toBe(4);
  });

  it('Fog prevents combat damage this turn', () => {
    let { s, A } = setup('golgari');
    lands(s, A, 'Forest', 1);
    const f = put(s, A, FOG, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: f.id }));
    expect(s.fogTurn).toBe(s.turn);
  });

  it('persist brings it back once with a -1/-1 counter', () => {
    let { s, A } = setup('golgari');
    const c = put(s, A, PERSIST);
    moveAndFlush(s, c.id, 'graveyard');
    s = settle(s);
    expect(s.cards[c.id].zone).toBe('battlefield');
    expect(s.cards[c.id].counters['-1/-1']).toBe(1);
    moveAndFlush(s, c.id, 'graveyard');
    s = settle(s);
    expect(s.cards[c.id].zone).toBe('graveyard');
  });

  it('annihilator makes the defender sacrifice', () => {
    let { s, A, B } = setup('golgari');
    const e = put(s, A, ANNIHILATOR);
    put(s, B, 'Forest');
    put(s, B, 'Forest');
    put(s, B, 'Forest');
    for (let i = 0; i < 40 && !s.decisions.some((d) => d.kind === 'declareAttackers'); i++) s = act(s, s.priority!, { type: 'pass' });
    const d = s.decisions[0];
    s = act(s, A, { type: 'decide', decisionId: d.id, answer: { attackers: [{ id: e.id, defender: B }] } });
    s = settle(s, (x) => (x.kind === 'chooseCards' ? { cards: (x.cards ?? []).slice(0, x.min ?? 0) } : undefined));
    expect(onField(s, B, 'Forest').length).toBe(1);
  });

  it('filter lands pay {G/U} for two mana', () => {
    const { s, A } = setup('simic');
    put(s, A, GROVE);
    put(s, A, 'Forest');
    const acts = legalActions(s, A).filter((a) => a.cardId === onField(s, A, GROVE)[0].id);
    expect(acts.length).toBeGreaterThanOrEqual(3);
  });

  it('split second: nothing can respond but mana abilities', () => {
    let { s, A, B } = setup('golgari');
    lands(s, A, 'Forest', 3);
    put(s, B, 'Sol Ring');
    put(s, B, 'Island');
    put(s, B, 'Island');
    put(s, B, 'Counterspell', 'hand');
    const g = put(s, A, GRIP, 'hand');
    s = act(s, A, { type: 'cast', cardId: g.id, targets: [tgt(onField(s, B, 'Sol Ring')[0].id)] });
    s = act(s, A, { type: 'pass' });
    expect(legalActions(s, B).some((a) => a.type === 'cast')).toBe(false);
  });

  it('"choose both if you control a commander"', () => {
    const { s, A } = setup('boros');
    lands(s, A, 'Mountain', 3);
    const w = put(s, A, WILL, 'hand');
    const both = () => legalActions(s, A).filter((a) => a.cardId === w.id).some((a) => a.modes?.length === 2);
    expect(both()).toBe(false);
    put(s, A, 'Grizzly Bears').commander = true;
    expect(both()).toBe(true);
  });

  it("Gaea's Cradle makes one mana per creature", () => {
    let { s, A } = setup('simic');
    const cradle = put(s, A, CRADLE);
    for (let i = 0; i < 3; i++) put(s, A, 'Grizzly Bears');
    const tap = legalActions(s, A).find((a) => a.cardId === cradle.id)!;
    s = act(s, A, { type: 'manaTap', cardId: cradle.id, ability: tap.ability! });
    expect(P(s, A).manaPool.G).toBe(3);
  });
});
