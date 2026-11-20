// Equipment support (Cloud deck), from real oracle text.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import type { GameState } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { getKeywords, getPT } from '../src/engine/state';
import { card as tgt, lands, onField, P, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}
const BLACKBLADE = card({ name: 'Test Blackblade', mana_cost: '{1}', type_line: 'Legendary Artifact — Equipment', oracle_text: 'Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {3}\nEquip {7}' });
const NETTLECYST = card({ name: 'Test Nettlecyst', mana_cost: '{3}', type_line: 'Artifact — Equipment', oracle_text: 'Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +1/+1 for each artifact and/or enchantment you control.\nEquip {2}' });
const HAMMER = card({ name: 'Test Hammer', mana_cost: '{1}', type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +10/+10 and loses flying.\nEquip {8}' });
const PALADIN = card({ name: 'Test Paladin', mana_cost: '{W}{W}', type_line: 'Creature — Human Knight', power: '2', toughness: '2', oracle_text: 'Whenever an Equipment you control enters, you may draw a card.\nMetalcraft — Equipment you control have equip {0} as long as you control three or more artifacts.' });
const SRAM = card({ name: 'Test Sram', mana_cost: '{1}{W}', type_line: 'Legendary Creature — Dwarf Advisor', power: '2', toughness: '2', oracle_text: 'Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.' });
const STONEFORGE = card({ name: 'Test Stoneforge', mana_cost: '{1}{W}', type_line: 'Creature — Kor Artificer', power: '1', toughness: '2', oracle_text: '{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.' });
const ASSAULT = card({ name: 'Test Assault', mana_cost: '{2}{R}', type_line: 'Enchantment', oracle_text: '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.' });
const KUTZIL = card({ name: 'Test Kutzil', mana_cost: '{G}{W}', type_line: 'Legendary Creature — Cat Warrior', power: '2', toughness: '2', oracle_text: "Your opponents can't cast spells during your turn." });
const AID = card({ name: 'Test Aid', mana_cost: '{W}', type_line: 'Enchantment', oracle_text: 'Flash\nWhenever an Equipment you control enters, you may attach it to target creature you control.' });
const BRUENOR = card({ name: 'Test Bruenor', mana_cost: '{2}{W}', type_line: 'Legendary Creature — Dwarf Warrior', power: '5', toughness: '3', oracle_text: 'Each creature you control gets +2/+0 for each Equipment attached to it.\nYou may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.' });

const equipActs = (s: GameState, pid: string, id: string) => legalActions(s, pid).filter((a) => a.cardId === id && a.type === 'activate' && /^Equip/.test(a.label));

describe('equipment', () => {
  it('+1/+1 for each land, and "equip legendary creature" only targets legends', () => {
    const { s, A } = setup('boros');
    const bb = put(s, A, BLACKBLADE);
    const bear = put(s, A, 'Grizzly Bears');
    lands(s, A, 'Plains', 4);
    const legendary = equipActs(s, A, bb.id).find((a) => /legendary/.test(a.label))!;
    expect(legendary).toBeUndefined(); // no legend to equip yet
    bb.attachedTo = bear.id;
    expect(getPT(s, bear).power).toBe(2 + 4);
  });

  it('living weapon makes a Germ wearing the Equipment', () => {
    let { s, A } = setup('boros');
    lands(s, A, 'Plains', 3);
    const n = put(s, A, NETTLECYST, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: n.id }));
    const germ = onField(s, A, 'Phyrexian Germ Token')[0];
    expect(s.cards[n.id].attachedTo).toBe(germ.id);
    expect(getPT(s, germ).power).toBeGreaterThanOrEqual(1);
  });

  it('"loses flying"', () => {
    const { s, A } = setup('boros');
    const h = put(s, A, HAMMER);
    const bird = put(s, A, 'Birds of Paradise');
    h.attachedTo = bird.id;
    expect(getKeywords(s, bird)).not.toContain('Flying');
    expect(getPT(s, bird).power).toBe(10);
  });

  it('Puresteel Paladin: equip {0} with three artifacts; Bruenor: first equip free', () => {
    const { s, A } = setup('boros');
    put(s, A, PALADIN);
    const h = put(s, A, HAMMER);
    expect(equipActs(s, A, h.id).length).toBe(0); // {8}, no mana
    put(s, A, 'Sol Ring');
    put(s, A, 'Sol Ring');
    expect(equipActs(s, A, h.id).length).toBe(1);
    const t = setup('boros');
    put(t.s, t.A, BRUENOR);
    const h2 = put(t.s, t.A, HAMMER);
    expect(equipActs(t.s, t.A, h2.id).length).toBe(1);
  });

  it('Bruenor: +2/+0 for each Equipment attached', () => {
    const { s, A } = setup('boros');
    put(s, A, BRUENOR);
    const bear = put(s, A, 'Grizzly Bears');
    put(s, A, HAMMER).attachedTo = bear.id;
    put(s, A, BLACKBLADE).attachedTo = bear.id;
    expect(getPT(s, bear).power).toBe(2 + 10 + 4 + 0);
  });

  it('Sram draws on Equipment spells; Sigarda\'s Aid attaches it', () => {
    let { s, A } = setup('boros');
    put(s, A, SRAM);
    put(s, A, AID);
    const bear = put(s, A, 'Grizzly Bears');
    lands(s, A, 'Plains', 1);
    const h = put(s, A, HAMMER, 'hand');
    const hand = P(s, A).hand.length;
    s = settle(act(s, A, { type: 'cast', cardId: h.id }), (d) => (d.kind === 'chooseTargets' ? { targets: [tgt(bear.id)] } : undefined));
    expect(P(s, A).hand.length).toBe(hand - 1 + 1);
    expect(s.cards[h.id].attachedTo).toBe(bear.id);
  });

  it('Stoneforge Mystic puts an Equipment from hand onto the battlefield', () => {
    let { s, A } = setup('boros');
    const sm = put(s, A, STONEFORGE);
    sm.sick = false;
    lands(s, A, 'Plains', 2);
    const h = put(s, A, HAMMER, 'hand');
    const ab = legalActions(s, A).find((a) => a.cardId === sm.id && a.type === 'activate')!;
    s = settle(act(s, A, { type: 'activate', cardId: sm.id, ability: ab.ability! }), (d) => (d.kind === 'chooseCards' ? { cards: [h.id] } : undefined));
    expect(s.cards[h.id].zone).toBe('battlefield');
  });

  it('Aggravated Assault: an additional combat after this main phase', () => {
    let { s, A } = setup('boros');
    const as = put(s, A, ASSAULT);
    lands(s, A, 'Mountain', 5);
    const ab = legalActions(s, A).find((a) => a.cardId === as.id && a.type === 'activate')!;
    s = settle(act(s, A, { type: 'activate', cardId: as.id, ability: ab.ability! }));
    expect(s.extraCombats?.afterMain).toBe(1);
    const steps: string[] = [];
    for (let i = 0; i < 80 && s.activePlayer === A; i++) {
      if (steps[steps.length - 1] !== s.step) steps.push(s.step);
      const d = s.decisions[0];
      s = d ? act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : { cards: [] } }) : act(s, s.priority!, { type: 'pass' });
    }
    expect(steps.filter((x) => x === 'beginCombat').length).toBe(2);
    expect(steps.filter((x) => x === 'main2').length).toBe(2);
  });

  it("Kutzil: opponents can't cast spells during your turn", () => {
    const { s, A, B } = setup('boros');
    lands(s, B, 'Mountain', 1);
    put(s, B, 'Lightning Bolt', 'hand');
    s.priority = B;
    expect(legalActions(s, B).some((a) => a.type === 'cast')).toBe(true);
    put(s, A, KUTZIL);
    expect(legalActions(s, B).some((a) => a.type === 'cast')).toBe(false);
  });
});
