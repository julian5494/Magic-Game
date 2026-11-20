// The user's commanders that needed new engine support: Vihaan (Treasures become creatures) and Ragost (artifacts are Foods).
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { canAttack } from '../src/engine/rules';
import { getKeywords, getPT, hasType, subtypesOf } from '../src/engine/state';
import { lands, P, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const VIHAAN = card({ name: 'Test Vihaan', mana_cost: '{R}{W}{B}', type_line: 'Legendary Creature — Dwarf Warlock', power: '3', toughness: '3', oracle_text: 'Other outlaws you control have vigilance and haste. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws.)\nAt the beginning of combat on your turn, you may have Treasures you control become 3/3 Construct Assassin artifact creatures in addition to their other types until end of turn.' });
const RAGOST = card({ name: 'Test Ragost', mana_cost: '{R}{W}', type_line: 'Legendary Creature — Lobster Citizen', power: '2', toughness: '2', oracle_text: 'Artifacts you control are Foods in addition to their other types and have "{2}, {T}, Sacrifice this artifact: You gain 3 life."\n{1}, {T}, Sacrifice a Food: Test Ragost deals 3 damage to each opponent.\nAt the beginning of each end step, if you gained life this turn, untap Test Ragost.' });
const NUKA = card({ name: 'Test Nuka', mana_cost: '{2}', type_line: 'Artifact', oracle_text: 'Whenever you sacrifice a Food, create a tapped Treasure token.' });

describe("the user's commanders", () => {
  it('Vihaan: Treasures become 3/3 Construct Assassins that can attack (outlaws get haste)', () => {
    let { s, A } = setup('rakdos');
    put(s, A, VIHAAN);
    const tr = put(s, A, 'Treasure Token');
    tr.sick = true; // made this turn: haste from Vihaan (it's an Assassin)
    for (let i = 0; i < 20 && s.step !== 'beginCombat'; i++) s = act(s, s.priority!, { type: 'pass' });
    s = settle(s, (d) => (d.kind === 'chooseOption' ? { option: 'yes' } : undefined));
    const t = s.cards[tr.id];
    expect(hasType(t, 'Creature')).toBe(true);
    expect(getPT(s, t)).toEqual({ power: 3, toughness: 3 });
    expect(subtypesOf(s, t)).toContain('Assassin');
    expect(getKeywords(s, t)).toContain('Haste');
    expect(canAttack(s, t)).toBe(true);
  });

  it('Ragost: artifacts are Foods with the Food ability; sacrificing one counts as a Food', () => {
    let { s, A, B } = setup('boros');
    put(s, A, RAGOST).sick = false;
    put(s, A, NUKA);
    const ring = put(s, A, 'Sol Ring');
    expect(subtypesOf(s, ring)).toContain('Food');
    lands(s, A, 'Plains', 3);
    const food = legalActions(s, A).find((a) => a.cardId === ring.id && a.type === 'activate' && /gain 3 life/.test(a.label))!;
    expect(food).toBeDefined();
    const life = P(s, A).life;
    s = settle(act(s, A, { type: 'activate', cardId: ring.id, ability: food.ability! }));
    expect(P(s, A).life).toBe(life + 3);
    expect(s.cards[ring.id].zone).toBe('graveyard');
    expect(P(s, A).life).toBeGreaterThan(0);
    expect(Object.values(s.cards).some((c) => c.def === 'Treasure Token' && c.zone === 'battlefield')).toBe(true);
    void B;
  });

  it('Ragost untaps at end step after you gained life', () => {
    let { s, A, B } = setup('boros');
    const r = put(s, A, RAGOST);
    r.sick = false;
    const ring = put(s, A, 'Sol Ring');
    lands(s, A, 'Plains', 1);
    const ab = legalActions(s, A).find((a) => a.cardId === r.id && a.type === 'activate')!;
    const life = P(s, B).life;
    s = settle(act(s, A, { type: 'activate', cardId: r.id, ability: ab.ability!, sacrifice: ring.id }));
    expect(P(s, B).life).toBe(life - 3);
    expect(s.cards[r.id].tapped).toBe(true);
    P(s, A).lifeGainedThisTurn = 1;
    for (let i = 0; i < 60 && !(s.step === 'end' && s.stack.length === 0 && s.cards[r.id].tapped === false); i++) {
      const d = s.decisions[0];
      s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : { cards: [] } }) : act(s, s.priority!, { type: 'pass' });
    }
    expect(s.cards[r.id].tapped).toBe(false);
  });
});
