// Sagas, Classes, split cards and a few renamed crossover cards, from real oracle text.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import type { GameState } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { getKeywords, getPT } from '../src/engine/state';
import { card as tgt, lands, onField, P, player, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const BENALIA = card({ name: 'Test Benalia', mana_cost: '{1}{W}{W}', type_line: 'Enchantment — Saga', oracle_text: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.' });
const WIZARD = card({ name: 'Test Wizard Class', mana_cost: '{U}', type_line: 'Enchantment — Class', oracle_text: '(Gain the next level as a sorcery to add its ability.)\nYou have no maximum hand size.\n{2}{U}: Level 2\nWhen this Class becomes level 2, draw two cards.\n{4}{U}: Level 3\nWhenever you draw a card, put a +1/+1 counter on target creature you control.' });
const FIREICE = (() => {
  const name = 'Test Fire';
  if (!findDef(name))
    registerGenerated(
      convertScryfall({
        name: 'Test Fire // Test Ice',
        layout: 'split',
        type_line: 'Instant // Instant',
        color_identity: ['U', 'R'],
        card_faces: [
          { name: 'Test Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Test Fire deals 2 damage to any target.\nFuse (You may cast one or both halves of this card from your hand.)' },
          { name: 'Test Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.\nFuse (You may cast one or both halves of this card from your hand.)' },
        ],
      } as unknown as ScryCard),
    );
  return name;
})();
const CLEAVER = card({ name: 'Test Cleaver', mana_cost: '{2}{R}', type_line: 'Legendary Artifact — Equipment', oracle_text: 'Equipped creature gets +3/+3 and has trample and "Whenever this creature deals combat damage to a player or planeswalker, create that many Treasure tokens."\nEquip {3}' });
const NAZAHN = card({ name: 'Test Nazahn', mana_cost: '{4}', type_line: 'Legendary Artifact — Equipment', oracle_text: 'Whenever this Equipment or another Equipment you control enters, you may attach that Equipment to target creature you control.\nEquipped creature gets +2/+0 and has indestructible.\nEquip {4}' });

const knights = (s: GameState, pid: string) => s.battlefield.filter((id) => s.cards[id].controller === pid && /^Knight/.test(s.cards[id].def)).length;

/** Pass and answer until `done`. */
function run(s: GameState, done: (s: GameState) => boolean) {
  for (let i = 0; i < 200 && !done(s) && s.phase !== 'over'; i++) {
    const d = s.decisions[0];
    s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: { cards: (d.cards ?? []).slice(0, d.min ?? 0), option: d.options?.[0]?.id, attackers: [], blocks: [] } }) : act(s, s.priority!, { type: 'pass' });
  }
  return s;
}

describe('Sagas, Classes and split cards', () => {
  it('a Saga does chapter I on entering, II after the next draw step, then III and is sacrificed', () => {
    let { s, A } = setup('boros');
    lands(s, A, 'Plains', 3);
    const h = put(s, A, BENALIA, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: h.id }));
    expect(s.cards[h.id].counters.lore).toBe(1);
    expect(knights(s, A)).toBe(1);
    s = run(s, (x) => x.activePlayer === A && x.step === 'main1' && x.turn > 1);
    s = settle(s);
    expect(knights(s, A)).toBe(2);
    s = run(s, (x) => x.activePlayer !== A);
    s = run(s, (x) => x.activePlayer === A && x.step === 'main1');
    s = settle(s);
    expect(s.cards[h.id].zone).toBe('graveyard');
  });

  it('a Class levels up as a sorcery and gains the new abilities', () => {
    let { s, A } = setup('izzet');
    const w = put(s, A, WIZARD);
    expect(s.cards[w.id].counters.level).toBe(1);
    lands(s, A, 'Island', 3);
    const lv2 = legalActions(s, A).find((a) => a.cardId === w.id && /Level 2/.test(a.label))!;
    expect(legalActions(s, A).some((a) => a.cardId === w.id && /Level 3/.test(a.label))).toBe(false);
    const hand = P(s, A).hand.length;
    s = settle(act(s, A, { type: 'activate', cardId: w.id, ability: lv2.ability! }));
    expect(s.cards[w.id].counters.level).toBe(2);
    expect(P(s, A).hand.length).toBe(hand + 2);
  });

  it('split cards: cast either half, or both with fuse', () => {
    let { s, A, B } = setup('izzet');
    lands(s, A, 'Island', 2);
    const fi = put(s, A, FIREICE, 'hand');
    const target = put(s, B, 'Sol Ring');
    const ice = legalActions(s, A).find((a) => a.cardId === fi.id && /Test Ice/.test(a.label))!;
    expect(ice).toBeDefined();
    const hand = P(s, A).hand.length;
    s = settle(act(s, A, { type: 'cast', cardId: fi.id, variant: ice.variant, targets: [tgt(target.id)] }));
    expect(s.cards[target.id].tapped).toBe(true);
    expect(P(s, A).hand.length).toBe(hand - 1 + 1);
    // Fused: both halves, four mana.
    const t = setup('izzet');
    lands(t.s, t.A, 'Island', 2);
    lands(t.s, t.A, 'Mountain', 2);
    const fi2 = put(t.s, t.A, FIREICE, 'hand');
    const tr = put(t.s, t.B, 'Sol Ring');
    const fuse = legalActions(t.s, t.A).find((a) => a.cardId === fi2.id && /fuse/.test(a.label))!;
    const life = P(t.s, t.B).life;
    const s2 = settle(act(t.s, t.A, { type: 'cast', cardId: fi2.id, variant: fuse.variant, targets: [player(t.B), tgt(tr.id)] }));
    expect(P(s2, t.B).life).toBe(life - 2);
    expect(s2.cards[tr.id].tapped).toBe(true);
  });

  it('The Reaver Cleaver (Knuckles\'s Gloves): Treasures equal to the combat damage', () => {
    let { s, A, B } = setup('boros');
    const bear = put(s, A, 'Grizzly Bears');
    bear.sick = false;
    put(s, A, CLEAVER).attachedTo = bear.id;
    expect(getPT(s, bear).power).toBe(5);
    for (let i = 0; i < 40 && !s.decisions.some((d) => d.kind === 'declareAttackers'); i++) s = act(s, s.priority!, { type: 'pass' });
    const d = s.decisions[0];
    s = act(s, A, { type: 'decide', decisionId: d.id, answer: { attackers: [{ id: bear.id, defender: B }] } });
    s = run(s, (x) => x.step === 'main2');
    expect(onField(s, A, 'Treasure Token').length).toBe(5);
  });

  it('Hammer of Nazahn (Piko Piko Hammer): attaches itself as it enters', () => {
    let { s, A } = setup('boros');
    const bear = put(s, A, 'Grizzly Bears');
    lands(s, A, 'Plains', 4);
    const h = put(s, A, NAZAHN, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: h.id }), (d) => (d.kind === 'chooseTargets' ? { targets: [tgt(bear.id)] } : d.kind === 'chooseOption' ? { option: 'yes' } : undefined));
    expect(s.cards[h.id].attachedTo).toBe(bear.id);
    expect(getKeywords(s, bear)).toContain('Indestructible');
  });
});
