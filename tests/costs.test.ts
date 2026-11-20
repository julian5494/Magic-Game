// Alternate, additional and modified costs.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { card as tgt, lands, onField, P, put, settle, setup } from './helpers';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}

const CRUISE = card({ name: 'Test Cruise', mana_cost: '{7}{U}', type_line: 'Sorcery', oracle_text: 'Delve\nDraw three cards.' });
const CONVOKER = card({ name: 'Test Convoke Growth', mana_cost: '{3}{G}', type_line: 'Sorcery', oracle_text: 'Convoke\nDraw two cards.' });
const ELECTRO = card({ name: 'Test Electromancer', mana_cost: '{R}{R}', type_line: 'Creature — Goblin', power: '2', toughness: '2', oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.' });
const THALIA = card({ name: 'Test Thalia', mana_cost: '{1}{W}', type_line: 'Legendary Creature — Human', power: '2', toughness: '1', oracle_text: 'Noncreature spells cost {1} more to cast.' });
const FOW = card({ name: 'Test Force', mana_cost: '{3}{U}{U}', type_line: 'Instant', oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell." });
const SHRIEK = card({ name: 'Test Shriekmaw', mana_cost: '{4}{B}', type_line: 'Creature — Elemental', power: '3', toughness: '2', oracle_text: 'When this creature enters, destroy target creature an opponent controls.\nEvoke {1}{B}' });
const DASHER = card({ name: 'Test Dasher', mana_cost: '{2}{R}', type_line: 'Creature — Monkey', power: '3', toughness: '1', oracle_text: 'Dash {1}{R}' });
const DELUGE = card({ name: 'Test Deluge', mana_cost: '{2}{B}', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, pay X life.\nDraw X cards.' });
const AFFINITY = card({ name: 'Test Thoughtcast', mana_cost: '{4}{U}', type_line: 'Sorcery', oracle_text: 'Affinity for artifacts\nDraw two cards.' });

describe('costs', () => {
  it('delve: exile graveyard cards to pay generic mana', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Island', 1);
    for (let i = 0; i < 7; i++) put(s, A, 'Opt', 'graveyard');
    const c = put(s, A, CRUISE, 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: c.id }));
    expect(P(s, A).exile.length).toBe(7);
    expect(P(s, A).hand.length).toBe(3);
  });

  it('convoke: tapping creatures pays, and "first" uses them before lands', () => {
    let { s, A } = setup('simic');
    lands(s, A, 'Forest', 4);
    const bears = [put(s, A, 'Grizzly Bears'), put(s, A, 'Grizzly Bears')];
    const c = put(s, A, CONVOKER, 'hand');
    const first = legalActions(s, A).find((a) => a.cardId === c.id && a.helpFirst)!;
    expect(first).toBeTruthy();
    s = settle(act(s, A, { type: 'cast', cardId: c.id, helpFirst: true }));
    expect(bears.every((b) => s.cards[b.id].tapped)).toBe(true);
    expect(onField(s, A, 'Forest').filter((f) => f.tapped).length).toBe(2);
  });

  it('cost reductions and taxes change generic mana', () => {
    const { s, A, B } = setup('izzet');
    lands(s, A, 'Island', 1);
    const opt = put(s, A, 'Divination', 'hand'); // {2}{U}
    expect(legalActions(s, A).some((a) => a.cardId === opt.id)).toBe(false);
    put(s, A, ELECTRO);
    lands(s, A, 'Island', 1);
    expect(legalActions(s, A).some((a) => a.cardId === opt.id)).toBe(true);
    put(s, B, THALIA);
    expect(legalActions(s, A).some((a) => a.cardId === opt.id)).toBe(false);
  });

  it('affinity: cheaper for each artifact you control', () => {
    const { s, A } = setup('izzet');
    lands(s, A, 'Island', 1);
    for (let i = 0; i < 4; i++) put(s, A, 'Sol Ring');
    const c = put(s, A, AFFINITY, 'hand');
    // Tap no Sol Rings: one Island alone pays {U}.
    for (const r of onField(s, A, 'Sol Ring')) r.tapped = true;
    expect(legalActions(s, A).some((a) => a.cardId === c.id)).toBe(true);
  });

  it('Force of Will: pay 1 life and exile a blue card instead of mana', () => {
    let { s, A, B } = setup('izzet');
    lands(s, B, 'Mountain', 1);
    const bolt = put(s, B, 'Lightning Bolt', 'hand');
    const force = put(s, A, FOW, 'hand');
    const blue = put(s, A, 'Counterspell', 'hand');
    s.activePlayer = B;
    s.priority = B;
    s = act(s, B, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: A }] });
    if (s.priority !== A) s = act(s, B, { type: 'pass' });
    const alt = legalActions(s, A).find((a) => a.cardId === force.id && a.variant !== undefined)!;
    expect(alt.sacrificeOptions).toEqual([blue.id]);
    const life = P(s, A).life;
    s = act(s, A, { type: 'cast', cardId: force.id, variant: alt.variant, sacrifice: blue.id, targets: [{ type: 'stack', id: s.stack[0].id }] });
    expect(P(s, A).life).toBe(life - 1);
    expect(s.cards[blue.id].zone).toBe('exile');
    s = settle(s);
    expect(s.cards[bolt.id].zone).toBe('graveyard');
    expect(P(s, A).life).toBe(life - 1);
  });

  it('evoke: cheap, its enter trigger happens, then it is sacrificed', () => {
    let { s, A, B } = setup('golgari');
    lands(s, A, 'Swamp', 2);
    const victim = put(s, B, 'Grizzly Bears');
    const c = put(s, A, SHRIEK, 'hand');
    const evoke = legalActions(s, A).find((a) => a.cardId === c.id && a.variant !== undefined)!;
    s = settle(act(s, A, { type: 'cast', cardId: c.id, variant: evoke.variant }), (d) => (d.kind === 'chooseTargets' ? { targets: [tgt(victim.id)] } : undefined));
    expect(s.cards[victim.id].zone).toBe('graveyard');
    expect(s.cards[c.id].zone).toBe('graveyard');
  });

  it('dash: haste now, back to hand at the end step', () => {
    let { s, A } = setup('boros');
    lands(s, A, 'Mountain', 2);
    const c = put(s, A, DASHER, 'hand');
    const dash = legalActions(s, A).find((a) => a.cardId === c.id && a.variant !== undefined)!;
    s = settle(act(s, A, { type: 'cast', cardId: c.id, variant: dash.variant }));
    expect(s.cards[c.id].zone).toBe('battlefield');
    expect(s.cards[c.id].dashed).toBe(true);
    for (let i = 0; i < 80 && s.step !== 'end'; i++) {
      const d = s.decisions[0];
      if (d) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : { blocks: [] } });
      else s = act(s, s.priority!, { type: 'pass' });
    }
    expect(s.cards[c.id].zone).toBe('hand');
  });

  it('"pay X life" as an additional cost', () => {
    let { s, A } = setup('golgari');
    lands(s, A, 'Swamp', 3);
    const c = put(s, A, DELUGE, 'hand');
    const life = P(s, A).life;
    s = settle(act(s, A, { type: 'cast', cardId: c.id, x: 4 }));
    expect(P(s, A).life).toBe(life - 4);
    expect(P(s, A).hand.length).toBe(4);
  });
});
