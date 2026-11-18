// Behaviour of mechanics parsed from real oracle text (cards written the way Scryfall returns them).
import { describe, expect, it } from 'vitest';
import { act, buildPrecon, createGame, legalActions, RulesError } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { makeCard, moveCard } from '../src/engine/ops';
import { findDef, registerGenerated } from '../src/engine/registry';
import { getPT } from '../src/engine/state';

function card(c: Partial<ScryCard> & { name: string; type_line: string }): string {
  if (!findDef(c.name)) registerGenerated(convertScryfall({ color_identity: [], ...c } as ScryCard));
  return c.name;
}

const COUNT_DRAW = card({ name: 'Test Count Draw', mana_cost: '{1}{G}', type_line: 'Sorcery', oracle_text: 'Draw a card for each creature you control.' });
const STAR = card({ name: 'Test Star Beast', mana_cost: '{1}{G}', type_line: 'Creature — Beast', power: '*', toughness: '*', oracle_text: "This creature's power and toughness are each equal to the number of cards in your hand." });
const KICK = card({ name: 'Test Kick Bolt', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Kicker {2}\nTest Kick Bolt deals 2 damage to any target.\nIf this spell was kicked, you gain 3 life.' });
const FLASH = card({ name: 'Test Flash Draw', mana_cost: '{U}', type_line: 'Sorcery', oracle_text: 'Draw a card.\nFlashback {1}{U}' });
const OVER = card({ name: 'Test Overload Bounce', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: "Return target nonland permanent you don't control to its owner's hand.\nOverload {4}{U}" });
const LEAK = card({ name: 'Test Leak', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Counter target spell unless its controller pays {3}.' });
const WARDED = card({ name: 'Test Warded Bear', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: 'Ward {2}' });
const WALKER = card({
  name: 'Test Walker',
  mana_cost: '{2}{U}',
  type_line: 'Legendary Planeswalker — Test',
  loyalty: '3',
  oracle_text: '+1: Draw a card.\n−2: Return target creature to its owner\'s hand.',
} as any);
const CYCLER = card({ name: 'Test Cycler', mana_cost: '{4}{U}', type_line: 'Creature — Fish', power: '3', toughness: '3', oracle_text: 'Cycling {2}' });
const CLONE = card({ name: 'Test Clone', mana_cost: '{3}{U}', type_line: 'Creature — Shapeshifter', power: '0', toughness: '0', oracle_text: 'You may have this creature enter as a copy of any creature on the battlefield.' });
const IMPULSE = card({ name: 'Test Impulse', mana_cost: '{R}', type_line: 'Sorcery', oracle_text: 'Exile the top card of your library. You may play it this turn.' });
const TAINTED = card({ name: 'Test Tainted Land', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{T}: Add {B}. Activate only if you control a Swamp.' });
const STORM = card({ name: 'Test Storm Shock', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Test Storm Shock deals 1 damage to any target.\nStorm' });
const MDFC = (() => {
  const name = 'Test Spell Side';
  if (!findDef(name)) {
    registerGenerated(
      convertScryfall({
        name: 'Test Spell Side // Test Land Side',
        layout: 'modal_dfc',
        color_identity: ['U'],
        card_faces: [
          { name: 'Test Spell Side', mana_cost: '{2}{U}', type_line: 'Sorcery', oracle_text: 'Draw two cards.' },
          { name: 'Test Land Side', type_line: 'Land', oracle_text: 'Test Land Side enters tapped.\n{T}: Add {U}.' },
        ],
      } as ScryCard),
    );
  }
  return name;
})();

function setup(): { s: GameState; A: PlayerId; B: PlayerId } {
  const d = buildPrecon('izzet');
  let s = createGame(
    [
      { id: 'a', name: 'A', commander: d.commanders, cards: d.cards },
      { id: 'b', name: 'B', commander: d.commanders, cards: d.cards },
    ],
    3,
  );
  for (const dec of [...s.decisions]) s = act(s, dec.player, { type: 'decide', decisionId: dec.id, answer: { option: 'keep' } });
  for (const p of s.players) {
    p.autoPass = 'none';
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return { s, A: s.activePlayer, B: s.players.find((p) => p.id !== s.activePlayer)!.id };
}

function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' | 'graveyard' | 'library' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  c.sick = false;
  s.events = [];
  return c;
}
const lands = (s: GameState, pid: PlayerId, name: string, n: number) => {
  for (let i = 0; i < n; i++) put(s, pid, name);
};
const hand = (s: GameState, pid: PlayerId) => s.players.find((p) => p.id === pid)!.hand;
const life = (s: GameState, pid: PlayerId) => s.players.find((p) => p.id === pid)!.life;
const resolveAll = (s: GameState) => {
  for (let i = 0; i < 20 && s.stack.length && !s.decisions.length; i++) s = act(s, s.priority!, { type: 'pass' });
  return s;
};

describe('parsed mechanics', () => {
  it('counts: "draw a card for each creature you control"', () => {
    let { s, A } = setup();
    lands(s, A, 'Forest', 2);
    put(s, A, 'Grizzly Bears');
    put(s, A, 'Grizzly Bears');
    put(s, A, 'Grizzly Bears');
    const spell = put(s, A, COUNT_DRAW, 'hand');
    s = resolveAll(act(s, A, { type: 'cast', cardId: spell.id }));
    expect(hand(s, A).length).toBe(3);
  });

  it('variable power/toughness follows the game state', () => {
    const { s, A } = setup();
    const beast = put(s, A, STAR);
    put(s, A, 'Island', 'hand');
    put(s, A, 'Island', 'hand');
    expect(getPT(s, beast)).toEqual({ power: 2, toughness: 2 });
  });

  it('kicker: pay more for the extra effect', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Mountain', 3);
    const bolt = put(s, A, KICK, 'hand');
    const kicked = legalActions(s, A).find((a) => a.cardId === bolt.id && a.variant !== undefined)!;
    expect(kicked).toBeTruthy();
    s = resolveAll(act(s, A, { type: 'cast', cardId: bolt.id, variant: kicked.variant, targets: [{ type: 'player', id: B }] }));
    expect(life(s, B)).toBe(38);
    expect(life(s, A)).toBe(43);
  });

  it('flashback: cast from the graveyard, then exiled', () => {
    let { s, A } = setup();
    lands(s, A, 'Island', 2);
    const c = put(s, A, FLASH, 'graveyard');
    const fb = legalActions(s, A).find((a) => a.cardId === c.id)!;
    s = resolveAll(act(s, A, { type: 'cast', cardId: c.id, variant: fb.variant }));
    expect(hand(s, A).length).toBe(1);
    expect(s.cards[c.id].zone).toBe('exile');
  });

  it('overload: affects each matching permanent without targeting', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Island', 5);
    const x = put(s, B, 'Grizzly Bears');
    const y = put(s, B, 'Sol Ring');
    const mine = put(s, A, 'Grizzly Bears');
    const rift = put(s, A, OVER, 'hand');
    const ov = legalActions(s, A).find((a) => a.cardId === rift.id && a.variant !== undefined)!;
    s = resolveAll(act(s, A, { type: 'cast', cardId: rift.id, variant: ov.variant, targets: [] }));
    expect([s.cards[x.id].zone, s.cards[y.id].zone, s.cards[mine.id].zone]).toEqual(['hand', 'hand', 'battlefield']);
  });

  it('"counter unless its controller pays": paying saves the spell, declining counters it', () => {
    for (const pay of [true, false]) {
      let { s, A, B } = setup();
      lands(s, A, 'Mountain', 4);
      lands(s, B, 'Island', 2);
      const bolt = put(s, A, 'Lightning Bolt', 'hand');
      const leak = put(s, B, LEAK, 'hand');
      s = act(s, A, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: B }] });
      s = act(s, A, { type: 'pass' });
      s = act(s, B, { type: 'cast', cardId: leak.id, targets: [{ type: 'stack', id: s.stack[0].id }] });
      s = act(s, B, { type: 'pass' });
      s = act(s, A, { type: 'pass' });
      const d = s.decisions[0];
      expect(d.player).toBe(A);
      s = act(s, A, { type: 'decide', decisionId: d.id, answer: { option: pay ? 'pay' : 'no' } });
      s = resolveAll(s);
      expect(life(s, B)).toBe(pay ? 37 : 40);
    }
  });

  it('ward: targeting it costs extra or the spell is countered', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Mountain', 1);
    const bear = put(s, B, WARDED);
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    s = act(s, A, { type: 'cast', cardId: bolt.id, targets: [{ type: 'card', id: bear.id }] });
    const d = s.decisions[0];
    expect(d.prompt).toMatch(/ward/i);
    s = act(s, A, { type: 'decide', decisionId: d.id, answer: { option: 'pay' } }); // can't actually pay: countered
    expect(s.stack.length).toBe(0);
    expect(s.cards[bear.id].zone).toBe('battlefield');
  });

  it('planeswalkers: loyalty, one loyalty ability per turn, damage removes loyalty', () => {
    let { s, A, B } = setup();
    const pw = put(s, A, WALKER);
    expect(pw.counters.loyalty).toBe(3);
    const plus = legalActions(s, A).find((a) => a.cardId === pw.id && a.label.startsWith('+1'))!;
    s = resolveAll(act(s, A, { type: 'activate', cardId: pw.id, ability: plus.ability! }));
    expect(s.cards[pw.id].counters.loyalty).toBe(4);
    expect(legalActions(s, A).some((a) => a.cardId === pw.id)).toBe(false);
    lands(s, B, 'Mountain', 1);
    const bolt = put(s, B, 'Lightning Bolt', 'hand');
    s.priority = B;
    s = act(s, B, { type: 'cast', cardId: bolt.id, targets: [{ type: 'card', id: pw.id }] });
    s = resolveAll(s);
    expect(s.cards[pw.id].counters.loyalty).toBe(1);
  });

  it('cycling discards the card from hand and draws', () => {
    let { s, A } = setup();
    lands(s, A, 'Island', 2);
    const c = put(s, A, CYCLER, 'hand');
    const cyc = legalActions(s, A).find((a) => a.cardId === c.id && a.type === 'activate')!;
    s = resolveAll(act(s, A, { type: 'activate', cardId: c.id, ability: cyc.ability! }));
    expect(s.cards[c.id].zone).toBe('graveyard');
    expect(hand(s, A).length).toBe(1);
  });

  it('modal double-faced cards can be played as their land face', () => {
    let { s, A } = setup();
    const c = put(s, A, MDFC, 'hand');
    const land = legalActions(s, A).find((a) => a.cardId === c.id && a.type === 'playLand')!;
    expect(land.back).toBe(true);
    s = act(s, A, { type: 'playLand', cardId: c.id, back: true });
    expect(s.cards[c.id].def).toBe('Test Land Side');
    expect(s.cards[c.id].tapped).toBe(true);
    moveCard(s, c.id, 'hand');
    expect(s.cards[c.id].def).toBe(MDFC);
  });

  it('clones enter as a copy and get the copied creature\'s enters-the-battlefield ability', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Island', 4);
    put(s, B, 'Mulldrifter');
    const clone = put(s, A, CLONE, 'hand');
    s = act(s, A, { type: 'cast', cardId: clone.id });
    s = act(s, A, { type: 'pass' });
    s = act(s, B, { type: 'pass' });
    const d = s.decisions[0];
    s = act(s, A, { type: 'decide', decisionId: d.id, answer: { cards: [d.cards![0]] } });
    expect(s.cards[clone.id].def).toBe('Mulldrifter');
    s = resolveAll(s);
    expect(hand(s, A).length).toBe(2);
  });

  it('impulse draw: exiled card is playable this turn only', () => {
    let { s, A } = setup();
    lands(s, A, 'Mountain', 1);
    const top = put(s, A, 'Island', 'library');
    const lib = s.players.find((p) => p.id === A)!.library;
    lib.splice(lib.indexOf(top.id), 1);
    lib.unshift(top.id);
    const sp = put(s, A, IMPULSE, 'hand');
    s = resolveAll(act(s, A, { type: 'cast', cardId: sp.id }));
    expect(s.cards[top.id].zone).toBe('exile');
    expect(legalActions(s, A).some((a) => a.cardId === top.id && a.type === 'playLand')).toBe(true);
    s.turn += 4;
    expect(legalActions(s, A).some((a) => a.cardId === top.id)).toBe(false);
  });

  it('activation conditions are enforced ("Activate only if you control a Swamp")', () => {
    const { s, A } = setup();
    const land = put(s, A, TAINTED);
    const colors = () => legalActions(s, A).filter((a) => a.cardId === land.id).flatMap((a) => a.manaColors ?? []);
    expect(colors()).toEqual(['C']);
    put(s, A, 'Swamp');
    expect(colors().sort()).toEqual(['B', 'C']);
  });

  it('storm copies the spell for each spell cast before it this turn', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Mountain', 3);
    for (let i = 0; i < 2; i++) {
      const c = put(s, A, 'Shock', 'hand');
      s = resolveAll(act(s, A, { type: 'cast', cardId: c.id, targets: [{ type: 'player', id: B }] }));
    }
    const st = put(s, A, STORM, 'hand');
    s = act(s, A, { type: 'cast', cardId: st.id, targets: [{ type: 'player', id: B }] });
    expect(s.stack.length).toBe(3);
    s = resolveAll(s);
    expect(life(s, B)).toBe(40 - 4 - 3);
  });

  it('a modal double-faced land face is rejected when not offered', () => {
    const { s, A } = setup();
    const c = put(s, A, 'Lightning Bolt', 'hand');
    expect(() => act(s, A, { type: 'playLand', cardId: c.id, back: true })).toThrow(RulesError);
  });
});
