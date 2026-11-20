// Treasure, sacrifice and artifact-graveyard engines (Vihaan and Ragost decks), from real oracle text.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import type { GameState } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { createToken } from '../src/engine/ops';
import { findDef, registerGenerated } from '../src/engine/registry';
import { card as tgt, lands, moveAndFlush, onField, P, player, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const DEVIL = card({ name: 'Test Devil', mana_cost: '{1}{B}{R}', type_line: 'Creature — Devil', power: '3', toughness: '3', oracle_text: 'Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.' });
const XORN = card({ name: 'Test Xorn', mana_cost: '{2}{R}', type_line: 'Creature — Elemental', power: '3', toughness: '2', oracle_text: 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.' });
const MANUFACTOR = card({ name: 'Test Manufactor', mana_cost: '{3}', type_line: 'Artifact Creature — Assembly-Worker', power: '1', toughness: '3', oracle_text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.' });
const GOLDSPAN = card({ name: 'Test Goldspan', mana_cost: '{3}{R}{R}', type_line: 'Creature — Dragon', power: '4', toughness: '4', oracle_text: 'Flying, haste\nWhenever this creature attacks or becomes the target of a spell, create a Treasure token.\nTreasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."' });
const BREAKER = card({ name: 'Test Breaker', mana_cost: '{2}{R}', type_line: 'Creature — Human Warrior', power: '2', toughness: '3', oracle_text: 'Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.' });
const CLOCK = card({ name: 'Test Clock', mana_cost: '{4}', type_line: 'Artifact', oracle_text: "Untap all artifacts you control during each other player's untap step." });
const KCI = card({ name: 'Test Ironworks', mana_cost: '{4}', type_line: 'Artifact', oracle_text: 'Sacrifice an artifact: Add {C}{C}.' });
const OPPORTUNIST = card({ name: 'Test Opportunist', mana_cost: '{2}{B}', type_line: 'Creature — Human Rogue', power: '2', toughness: '1', oracle_text: 'Whenever one or more other creatures die, draw a card. This ability triggers only once each turn.' });
const TAX = card({ name: 'Test Monologue', mana_cost: '{2}{W}', type_line: 'Enchantment', oracle_text: 'Whenever an opponent casts their second spell each turn, you create a Treasure token.' });
const STATUE = card({ name: 'Test Statue', mana_cost: '{3}', type_line: 'Artifact', oracle_text: 'When this artifact enters or is put into a graveyard from the battlefield, create a Treasure token.' });
const BOUNTY = card({ name: 'Test Bounty', mana_cost: '{4}{R}', type_line: 'Sorcery', oracle_text: 'For each land you control, create a Treasure token.' });
const SCRAPHEAP = card({ name: 'Test Scrapheap', mana_cost: '{3}', type_line: 'Artifact', oracle_text: 'Whenever an artifact or enchantment is put into your graveyard from the battlefield, you gain 1 life.' });

const treasures = (s: GameState, pid: string) => onField(s, pid, 'Treasure Token');

/** Pass priority until the active player is asked to declare attackers. */
function toAttack(s: GameState): GameState {
  for (let i = 0; i < 40 && !s.decisions.some((d) => d.kind === 'declareAttackers'); i++) s = act(s, s.priority!, { type: 'pass' });
  return s;
}

describe('treasure and sacrifice engines', () => {
  it('Xorn adds one Treasure; Academy Manufactor makes one of each', () => {
    const { s, A } = setup('rakdos');
    put(s, A, XORN);
    createToken(s, A, 'Treasure Token', 2);
    expect(treasures(s, A).length).toBe(3);
    const t = setup('rakdos');
    put(t.s, t.A, MANUFACTOR);
    createToken(t.s, t.A, 'Treasure Token', 1);
    expect(onField(t.s, t.A, 'Clue Token').length + onField(t.s, t.A, 'Food Token').length + onField(t.s, t.A, 'Treasure Token').length).toBe(3);
  });

  it('Mayhem Devil: sacrificing a Treasure deals 1 damage', () => {
    let { s, A, B } = setup('rakdos');
    put(s, A, DEVIL);
    const tr = put(s, A, 'Treasure Token');
    const life = P(s, B).life;
    const ab = legalActions(s, A).find((a) => a.cardId === tr.id)!;
    s = act(s, A, { type: 'manaTap', cardId: tr.id, ability: ab.ability!, color: 'R' });
    s = settle(s, (d) => (d.kind === 'chooseTargets' ? { targets: [player(B)] } : undefined));
    expect(P(s, B).life).toBe(life - 1);
  });

  it('Goldspan Dragon: attacking makes a Treasure, and Treasures add two mana', () => {
    let { s, A, B } = setup('rakdos');
    const g = put(s, A, GOLDSPAN);
    s = toAttack(s);
    const d = s.decisions[0];
    s = settle(act(s, A, { type: 'decide', decisionId: d.id, answer: { attackers: [{ id: g.id, defender: B }] } }));
    expect(treasures(s, A).length).toBe(1);
    const tr = treasures(s, A)[0];
    const ab = legalActions(s, A).find((a) => a.cardId === tr.id)!;
    s = act(s, A, { type: 'manaTap', cardId: tr.id, ability: ab.ability!, color: 'R' });
    expect(P(s, A).manaPool.R).toBe(2);
  });

  it('"one or more creatures deal combat damage" triggers once for several attackers', () => {
    let { s, A, B } = setup('boros');
    const br = put(s, A, BREAKER);
    const bears = put(s, A, 'Grizzly Bears');
    br.sick = false;
    bears.sick = false;
    s = toAttack(s);
    const d = s.decisions[0];
    s = settle(act(s, A, { type: 'decide', decisionId: d.id, answer: { attackers: [{ id: br.id, defender: B }, { id: bears.id, defender: B }] } }), (x) => (x.kind === 'declareBlockers' ? { blocks: [] } : undefined));
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = settle(act(s, s.priority!, { type: 'pass' }), (x) => (x.kind === 'declareBlockers' ? { blocks: [] } : undefined));
    expect(treasures(s, A).length).toBe(1);
  });

  it("Unwinding Clock untaps your artifacts on other players' turns", () => {
    let { s, A } = setup('boros');
    put(s, A, CLOCK);
    const ring = put(s, A, 'Sol Ring');
    ring.tapped = true;
    for (let i = 0; i < 60 && s.activePlayer === A; i++) {
      const d = s.decisions[0];
      s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : { cards: [] } }) : act(s, s.priority!, { type: 'pass' });
    }
    expect(s.activePlayer).not.toBe(A);
    expect(s.cards[ring.id].tapped).toBe(false);
  });

  it('Krark-Clan Ironworks: sacrifice an artifact for {C}{C}', () => {
    let { s, A } = setup('boros');
    const kci = put(s, A, KCI);
    const ring = put(s, A, 'Sol Ring');
    const ab = legalActions(s, A).find((a) => a.cardId === kci.id && a.type === 'activate')!;
    expect(ab.sacrificeOptions).toContain(ring.id);
    s = act(s, A, { type: 'activate', cardId: kci.id, ability: ab.ability!, sacrifice: ring.id });
    expect(P(s, A).manaPool.C).toBe(2);
    expect(s.cards[ring.id].zone).toBe('graveyard');
  });

  it('Morbid Opportunist draws only once a turn', () => {
    let { s, A } = setup('rakdos');
    put(s, A, OPPORTUNIST);
    const a = put(s, A, 'Grizzly Bears');
    const b = put(s, A, 'Grizzly Bears');
    const hand = P(s, A).hand.length;
    moveAndFlush(s, a.id, 'graveyard');
    s = settle(s);
    moveAndFlush(s, b.id, 'graveyard');
    s = settle(s);
    expect(P(s, A).hand.length).toBe(hand + 1);
  });

  it("Monologue Tax: an opponent's second spell each turn", () => {
    let { s, A, B } = setup('boros');
    put(s, B, TAX);
    lands(s, A, 'Mountain', 2);
    for (let i = 0; i < 2; i++) {
      const bolt = put(s, A, 'Lightning Bolt', 'hand');
      s = settle(act(s, A, { type: 'cast', cardId: bolt.id, targets: [player(B)] }));
    }
    expect(treasures(s, B).length).toBe(1);
  });

  it('enters or is put into a graveyard: Prized Statue; Scrapheap gains life', () => {
    let { s, A } = setup('boros');
    put(s, A, SCRAPHEAP);
    lands(s, A, 'Plains', 3);
    const st = put(s, A, STATUE, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: st.id }));
    expect(treasures(s, A).length).toBe(1);
    const life = P(s, A).life;
    moveAndFlush(s, st.id, 'graveyard');
    s = settle(s);
    expect(treasures(s, A).length).toBe(2);
    expect(P(s, A).life).toBe(life + 1);
  });

  it("Brass's Bounty: a Treasure for each land", () => {
    let { s, A } = setup('boros');
    lands(s, A, 'Mountain', 5);
    const b = put(s, A, BOUNTY, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: b.id }));
    expect(treasures(s, A).length).toBe(5);
  });

  it('Goldspan Dragon: becoming the target of a spell makes a Treasure', () => {
    let { s, A } = setup('rakdos');
    const g = put(s, A, GOLDSPAN);
    lands(s, A, 'Mountain', 1);
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: bolt.id, targets: [tgt(g.id)] }));
    expect(treasures(s, A).length).toBe(1);
  });
});
