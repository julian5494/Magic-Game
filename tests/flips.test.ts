// Coin flips: the mechanic behind Krark, Okaun, Zndrsplt and friends.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import type { GameState } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { flipCoin } from '../src/engine/ops';
import { findDef, registerGenerated } from '../src/engine/registry';
import { lands, onField, P, player, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const THUMB = card({ name: 'Test Thumb', mana_cost: '{2}', type_line: 'Legendary Artifact', oracle_text: 'If you would flip a coin, instead flip two coins and ignore one.' });
const EDGAR = card({ name: 'Test Edgar', mana_cost: '{2}{U}{R}', type_line: 'Legendary Creature — Human', power: '4', toughness: '4', oracle_text: 'Two-Headed Coin — The first time you flip one or more coins each turn, those coins come up heads and you win those flips.' });
const STRONGBOX = card({ name: 'Test Strongbox', mana_cost: '{4}', type_line: 'Artifact', oracle_text: '{2}, {T}: Flip a coin. If you win the flip, sacrifice this artifact and draw three cards.' });
const ZNDRSPLT = card({ name: 'Test Zndrsplt', mana_cost: '{2}{U}', type_line: 'Legendary Creature — Homunculus', power: '1', toughness: '4', oracle_text: 'At the beginning of combat on your turn, flip a coin until you lose a flip.\nWhenever a player wins a coin flip, draw a card.' });
const OKAUN = card({ name: 'Test Okaun', mana_cost: '{2}{R}', type_line: 'Legendary Creature — Cyclops', power: '3', toughness: '3', oracle_text: 'Whenever a player wins a coin flip, double this creature\'s power and toughness until end of turn.' });
const STITCH = card({ name: 'Test Stitch', mana_cost: '{1}{U}{R}', type_line: 'Sorcery', oracle_text: 'Flip a coin. If you win the flip, take an extra turn after this one.' });
const KRARK = card({ name: 'Test Krark', mana_cost: '{1}{R}', type_line: 'Legendary Creature — Goblin', power: '2', toughness: '2', oracle_text: 'Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, return that spell to its owner\'s hand. If you win the flip, copy that spell, and you may choose new targets for the copy.' });
const CHANCE = card({ name: 'Test Chance', mana_cost: '{2}{R}{R}', type_line: 'Enchantment', oracle_text: 'Whenever you win a coin flip, put a luck counter on this enchantment.\nAt the beginning of your upkeep, if this enchantment has ten or more luck counters on it, you win the game.' });

/** Fix the coin: run with a seed that makes the next flip come out the way we want. */
function rig(s: GameState, A: string, win: boolean) {
  for (let seed = 1; seed < 500; seed++) {
    const probe = structuredClone(s);
    probe.seed = seed;
    probe.players.find((p) => p.id === A)!.flipTurn = -1;
    if (flipCoin(probe, A) === win) {
      s.seed = seed;
      s.log.length = s.log.length; // unchanged
      return;
    }
  }
}

describe('coin flips', () => {
  it("Edgar wins the first flip each turn; Krark's Thumb makes winning likelier", () => {
    const { s, A } = setup('izzet');
    put(s, A, EDGAR);
    expect(flipCoin(s, A)).toBe(true);
    let wins = 0;
    const t = setup('izzet');
    put(t.s, t.A, THUMB);
    for (let i = 0; i < 400; i++) if (flipCoin(t.s, t.A)) wins++;
    expect(wins / 400).toBeGreaterThan(0.65);
  });

  it('flip a coin: the win branch and the lose branch', () => {
    for (const win of [true, false]) {
      let { s, A } = setup('izzet');
      lands(s, A, 'Island', 2);
      const box = put(s, A, STRONGBOX);
      rig(s, A, win);
      const ab = legalActions(s, A).find((a) => a.cardId === box.id && a.type === 'activate')!;
      const hand = P(s, A).hand.length;
      s = settle(act(s, A, { type: 'activate', cardId: box.id, ability: ab.ability! }));
      expect(P(s, A).hand.length).toBe(win ? hand + 3 : hand);
      expect(s.cards[box.id].zone).toBe(win ? 'graveyard' : 'battlefield');
    }
  });

  it('a win triggers "whenever a player wins a coin flip" (Zndrsplt draws, Okaun doubles)', () => {
    let { s, A } = setup('izzet');
    put(s, A, ZNDRSPLT);
    const ok = put(s, A, OKAUN);
    put(s, A, EDGAR); // first flip wins
    const box = put(s, A, STRONGBOX);
    lands(s, A, 'Island', 2);
    const hand = P(s, A).hand.length;
    const ab = legalActions(s, A).find((a) => a.cardId === box.id && a.type === 'activate')!;
    s = settle(act(s, A, { type: 'activate', cardId: box.id, ability: ab.ability! }));
    expect(P(s, A).hand.length).toBe(hand + 3 + 1);
    expect(s.cards[ok.id].temp.power).toBe(3);
  });

  it('extra turns: Stitch in Time', () => {
    let { s, A } = setup('izzet');
    put(s, A, EDGAR);
    lands(s, A, 'Island', 2);
    lands(s, A, 'Mountain', 1);
    const st = put(s, A, STITCH, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: st.id }));
    expect(s.extraTurns).toEqual([A]);
  });

  it('Krark: a won flip copies the spell', () => {
    let { s, A, B } = setup('izzet');
    put(s, A, KRARK);
    put(s, A, EDGAR);
    lands(s, A, 'Mountain', 1);
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    const life = P(s, B).life;
    s = settle(act(s, A, { type: 'cast', cardId: bolt.id, targets: [player(B)] }));
    expect(P(s, B).life).toBe(life - 6);
  });

  it('Chance Encounter: ten luck counters win the game', () => {
    let { s, A } = setup('izzet');
    const ce = put(s, A, CHANCE);
    s.cards[ce.id].counters.luck = 10;
    for (let i = 0; i < 120 && s.phase !== 'over' && !(s.activePlayer === A && s.step === 'draw' && s.turn > 1); i++) {
      const d = s.decisions[0];
      if (d) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes', cards: (d.cards ?? []).slice(0, d.min ?? 0) } });
      else s = act(s, s.priority!, { type: 'pass' });
    }
    expect(s.winner).toBe(A);
  });
});
