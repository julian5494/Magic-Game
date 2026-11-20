// What was left in the user's main decks: "choose one or more", phasing, damage doubling, linked exile, channel, and more.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { dealDamage, drawCards, moveCard } from '../src/engine/ops';
import { findDef, registerGenerated } from '../src/engine/registry';
import { battlefieldCards, getKeywords, getPT } from '../src/engine/state';
import { card as tgt, lands, P, player, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const FAREWELL = card({ name: 'Test Farewell', mana_cost: '{4}{W}{W}', type_line: 'Sorcery', oracle_text: 'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.' });
const CONCEAL = card({ name: 'Test Concealment', mana_cost: '{2}{W}{W}', type_line: 'Instant', oracle_text: 'Any number of target nonland permanents you control phase out. (Treat them and anything attached to them as though they don\'t exist until your next turn.)' });
const BLOODMONEY = card({ name: 'Test Blood Money', mana_cost: '{5}{B}{B}', type_line: 'Sorcery', oracle_text: 'Destroy all creatures. For each nontoken creature destroyed this way, you create a tapped Treasure token.' });
const PLATE = card({ name: 'Test Plate', mana_cost: '{3}', type_line: 'Legendary Artifact — Equipment', oracle_text: "Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity.\nEquip {3}" });
const AETTIR = card({ name: 'Test Aettir', mana_cost: '{6}', type_line: 'Legendary Artifact — Equipment', oracle_text: 'Equipped creature has base power and toughness X/X, where X is your life total.\nEquip {5}' });
const CID = card({ name: 'Test Cid', mana_cost: '{2}{W}', type_line: 'Legendary Creature — Human Pilot', power: '2', toughness: '2', oracle_text: 'During your turn, Test Cid has flying.' });
const TEFERI = card({ name: 'Test Teferi Insight', mana_cost: '{2}{U}{U}', type_line: 'Enchantment', oracle_text: "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead." });
const BOMB = card({ name: 'Test Bomb', mana_cost: '{1}', type_line: 'Enchantment', oracle_text: 'Remove five fuse counters from this enchantment and sacrifice it: It deals 20 damage to target player or planeswalker.' });
const OTAWARA = card({ name: 'Test Otawara', type_line: 'Legendary Land', oracle_text: "{T}: Add {U}.\nChannel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control." });
const SHELTER = card({ name: 'Test Shelter', mana_cost: '{1}{W}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature you control\nWhen this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.' });
const MARIONETTE = card({ name: 'Test Marionette', mana_cost: '{4}{B}{B}', type_line: 'Creature — Human Artificer', power: '4', toughness: '2', oracle_text: 'Fabricate 3 (When this creature enters, put three +1/+1 counters on it or create three 1/1 colorless Servo artifact creature tokens.)' });
const TALENT = card({ name: 'Test Talent', mana_cost: '{R}', type_line: 'Enchantment', oracle_text: "Whenever you cast a spell, if mana from a Treasure was spent to cast it, this enchantment deals damage equal to that spell's mana value to each opponent." });

describe('the rest of the main decks', () => {
  it('"choose one or more": every non-empty set of modes is castable', () => {
    const { s, A } = setup('boros');
    lands(s, A, 'Plains', 6);
    const f = put(s, A, FAREWELL, 'hand');
    const casts = legalActions(s, A).filter((a) => a.cardId === f.id);
    expect(casts.length).toBe(15);
  });

  it('phasing: phased-out permanents are gone until your next turn', () => {
    let { s, A } = setup('boros');
    lands(s, A, 'Plains', 4);
    const bear = put(s, A, 'Grizzly Bears');
    const c = put(s, A, CONCEAL, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: c.id }), (d) => (d.kind === 'chooseCards' ? { cards: [bear.id] } : undefined));
    expect(battlefieldCards(s).some((x) => x.id === bear.id)).toBe(false);
    for (let i = 0; i < 300 && !(s.activePlayer === A && s.turn > 2); i++) {
      const d = s.decisions[0];
      s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: { attackers: [], blocks: [], cards: [] } }) : act(s, s.priority!, { type: 'pass' });
    }
    expect(battlefieldCards(s).some((x) => x.id === bear.id)).toBe(true);
  });

  it('Blood Money: Treasures for nontoken creatures destroyed', () => {
    let { s, A, B } = setup('rakdos');
    put(s, A, 'Grizzly Bears');
    put(s, B, 'Grizzly Bears');
    put(s, B, 'Soldier Token').token = true;
    lands(s, A, 'Swamp', 7);
    const bm = put(s, A, BLOODMONEY, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: bm.id }));
    expect(battlefieldCards(s).filter((c) => c.def === 'Treasure Token' && c.tapped).length).toBe(2);
  });

  it('Desperate Gambit style damage doubling and prevention', () => {
    const { s, A, B } = setup('rakdos');
    const bear = put(s, A, 'Grizzly Bears');
    const life = P(s, B).life;
    bear.dmgMod = [{ mult: 2, turn: s.turn }];
    dealDamage(s, bear, B, 2);
    expect(P(s, B).life).toBe(life - 4);
    bear.dmgMod = [{ mult: 0, turn: s.turn }];
    dealDamage(s, bear, B, 2);
    expect(P(s, B).life).toBe(life - 4);
    dealDamage(s, bear, B, 2);
    expect(P(s, B).life).toBe(life - 6);
  });

  it("Commander's Plate and Aettir and Priwen", () => {
    const { s, A } = setup('boros');
    const bear = put(s, A, 'Grizzly Bears');
    put(s, A, PLATE).attachedTo = bear.id;
    const kws = getKeywords(s, bear);
    expect(kws).toContain('ProU');
    expect(kws).not.toContain('ProR');
    expect(getPT(s, bear).power).toBe(5);
    const t = setup('boros');
    const b2 = put(t.s, t.A, 'Grizzly Bears');
    put(t.s, t.A, AETTIR).attachedTo = b2.id;
    expect(getPT(t.s, b2).power).toBe(P(t.s, t.A).life);
  });

  it('Cid has flying only during your turn', () => {
    const { s, A, B } = setup('boros');
    const mine = put(s, A, CID);
    expect(getKeywords(s, mine)).toContain('Flying');
    const theirs = put(s, B, CID);
    expect(getKeywords(s, theirs)).not.toContain('Flying');
  });

  it("Teferi's Ageless Insight doubles draws outside the draw step", () => {
    const { s, A } = setup('izzet');
    put(s, A, TEFERI);
    const hand = P(s, A).hand.length;
    drawCards(s, A, 1);
    expect(P(s, A).hand.length).toBe(hand + 2);
  });

  it('Goblin Bomb: remove five fuse counters and sacrifice it', () => {
    let { s, A, B } = setup('izzet');
    const b = put(s, A, BOMB);
    expect(legalActions(s, A).some((a) => a.cardId === b.id && a.type === 'activate')).toBe(false);
    b.counters.fuse = 5;
    const ab = legalActions(s, A).find((a) => a.cardId === b.id && a.type === 'activate')!;
    const life = P(s, B).life;
    s = settle(act(s, A, { type: 'activate', cardId: b.id, ability: ab.ability!, targets: [player(B)] }));
    expect(P(s, B).life).toBe(life - 20);
    expect(s.cards[b.id].zone).toBe('graveyard');
  });

  it('channel: discard from hand, cheaper for each legendary creature', () => {
    let { s, A, B } = setup('izzet');
    lands(s, A, 'Island', 3);
    put(s, A, CID); // a legendary creature: costs {1} less
    const o = put(s, A, OTAWARA, 'hand');
    const target = put(s, B, 'Grizzly Bears');
    const ch = legalActions(s, A).find((a) => a.cardId === o.id && a.type === 'activate')!;
    expect(ch).toBeDefined();
    s = settle(act(s, A, { type: 'activate', cardId: o.id, ability: ch.ability!, targets: [tgt(target.id)] }));
    expect(s.cards[target.id].zone).toBe('hand');
    expect(s.cards[o.id].zone).toBe('graveyard');
  });

  it('linked exile returns when the Aura leaves', () => {
    let { s, A, B } = setup('boros');
    const bear = put(s, A, 'Grizzly Bears');
    const ring = put(s, B, 'Sol Ring');
    lands(s, A, 'Plains', 2);
    const sh = put(s, A, SHELTER, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: sh.id, targets: [tgt(bear.id)] }), (d) => (d.kind === 'chooseTargets' ? { targets: [tgt(ring.id)] } : undefined));
    expect(s.cards[ring.id].zone).toBe('exile');
    moveCard(s, sh.id, 'graveyard');
    expect(s.cards[ring.id].zone).toBe('battlefield');
  });

  it('fabricate: counters or Servos', () => {
    let { s, A } = setup('rakdos');
    lands(s, A, 'Swamp', 6);
    const m = put(s, A, MARIONETTE, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: m.id }), (d) => (d.kind === 'chooseOption' ? { option: 'servos' } : undefined));
    expect(battlefieldCards(s).filter((c) => c.def === 'Servo Token').length).toBe(3);
  });

  it("Alchemist's Talent: damage when Treasure mana paid for a spell", () => {
    let { s, A, B } = setup('rakdos');
    put(s, A, TALENT);
    const tr = put(s, A, 'Treasure Token');
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    const ab = legalActions(s, A).find((a) => a.cardId === tr.id)!;
    s = act(s, A, { type: 'manaTap', cardId: tr.id, ability: ab.ability!, color: 'R' });
    const life = P(s, B).life;
    s = settle(act(s, A, { type: 'cast', cardId: bolt.id, targets: [player(B)] }));
    expect(P(s, B).life).toBe(life - 3 - 1);
  });
});
