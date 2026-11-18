// "No cheating" guarantees: the server only accepts actions the rules allow, never leaks hidden
// information, and nothing resolves until every player has had the chance to respond.
import { describe, expect, it } from 'vitest';
import { act, buildPrecon, buildView, chooseBotAction, createGame, legalActions, RulesError } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/engine';
import { makeCard, moveCard } from '../src/engine/ops';

function setup(n = 2, autoPass: 'smart' | 'stack' | 'none' = 'smart') {
  const decks = ['izzet', 'golgari', 'boros', 'selesnya'];
  let s = createGame(
    Array.from({ length: n }, (_, i) => {
      const d = buildPrecon(decks[i]);
      return { id: `p${i}`, name: `P${i}`, commander: d.commanders, cards: d.cards };
    }),
    7,
  );
  for (const d of [...s.decisions]) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: { option: 'keep' } });
  for (const p of s.players) {
    p.autoPass = autoPass;
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return s;
}

function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' | 'library' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  c.sick = false;
  s.events = [];
  return c;
}

const rejects = (s: GameState, pid: PlayerId, a: Action) => expect(() => act(s, pid, a)).toThrow(RulesError);

describe('illegal actions are rejected', () => {
  it('there is no way to draw, shuffle or move cards by hand', () => {
    const s = setup();
    const me = s.priority!;
    for (const type of ['draw', 'drawCard', 'untap', 'moveCard', 'setLife', 'shuffle', 'tutor']) {
      rejects(s, me, { type } as unknown as Action);
    }
  });

  it('players without priority cannot act', () => {
    const s = setup();
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    const land = put(s, other, 'Mountain', 'hand');
    rejects(s, other, { type: 'pass' });
    rejects(s, other, { type: 'playLand', cardId: land.id });
  });

  it('only one land per turn, only from your own hand', () => {
    let s = setup();
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    const a = put(s, me, 'Island', 'hand');
    const b = put(s, me, 'Island', 'hand');
    const theirs = put(s, other, 'Swamp', 'hand');
    const inLibrary = put(s, me, 'Island', 'library');
    rejects(s, me, { type: 'playLand', cardId: theirs.id });
    rejects(s, me, { type: 'playLand', cardId: inLibrary.id });
    s = act(s, me, { type: 'playLand', cardId: a.id });
    rejects(s, me, { type: 'playLand', cardId: b.id });
  });

  it("can't cast without mana, at the wrong speed, or at illegal targets", () => {
    let s = setup();
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    const bolt = put(s, me, 'Lightning Bolt', 'hand');
    rejects(s, me, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: other }] }); // no mana
    put(s, me, 'Mountain');
    const sphinx = put(s, other, 'Sphinx of Jwar Isle'); // shroud
    rejects(s, me, { type: 'cast', cardId: bolt.id, targets: [{ type: 'card', id: sphinx.id }] });
    rejects(s, me, { type: 'cast', cardId: bolt.id, targets: [] });
    // Opponent's sorcery on my turn:
    const theirSorcery = put(s, other, 'Blaze', 'hand');
    put(s, other, 'Mountain');
    rejects(s, other, { type: 'cast', cardId: theirSorcery.id, targets: [{ type: 'player', id: me }], x: 1 });
    s = act(s, me, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: other }] });
    expect(s.players.find((p) => p.id === other)!.life).toBe(37);
  });

  it("can't answer someone else's decision or pick cards that weren't offered", () => {
    let s = setup();
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    put(s, me, 'Forest');
    put(s, me, 'Forest');
    const growth = put(s, me, 'Rampant Growth', 'hand');
    const nonBasic = put(s, me, 'Sol Ring', 'library');
    s = act(s, me, { type: 'cast', cardId: growth.id });
    s.players.forEach((p) => (p.autoPass = 'smart'));
    for (let i = 0; i < 5 && !s.decisions.length; i++) s = act(s, s.priority!, { type: 'pass' });
    const d = s.decisions[0];
    expect(d.handler).toBe('core:search');
    rejects(s, other, { type: 'decide', decisionId: d.id, answer: { cards: [d.cards![0]] } });
    rejects(s, me, { type: 'decide', decisionId: d.id, answer: { cards: [nonBasic.id] } });
    rejects(s, me, { type: 'decide', decisionId: d.id, answer: { cards: [d.cards![0], d.cards![1]] } });
  });
});

describe('fuzzing: random garbage never gets through', () => {
  it('every accepted action was a legal one', () => {
    let s = setup(3);
    for (const p of s.players) p.isBot = true;
    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const allIds = () => Object.keys(s.cards);
    let accepted = 0;
    for (let i = 0; i < 1500 && s.phase !== 'over'; i++) {
      const pid = s.players[Math.floor(rand() * s.players.length)].id;
      const id = allIds()[Math.floor(rand() * allIds().length)];
      const victim = s.players[Math.floor(rand() * s.players.length)].id;
      const garbage: Action[] = [
        { type: 'playLand', cardId: id },
        { type: 'cast', cardId: id, targets: [{ type: 'player', id: victim }] },
        { type: 'cast', cardId: id },
        { type: 'activate', cardId: id, ability: Math.floor(rand() * 3), targets: [{ type: 'card', id: allIds()[0] }] },
        { type: 'manaTap', cardId: id, ability: 0 },
        { type: 'decide', decisionId: s.decisions[0]?.id ?? 'd1', answer: { cards: [id], option: 'keep', targets: [{ type: 'card', id }] } },
      ];
      const a = rand() < 0.5 ? chooseBotAction(s, pid) ?? garbage[0] : garbage[Math.floor(rand() * garbage.length)];
      const legalBefore = legalActions(s, pid);
      const decisionBefore = s.decisions[0];
      try {
        const next = act(s, pid, a);
        accepted++;
        if (a.type === 'playLand' || a.type === 'cast' || a.type === 'activate' || a.type === 'manaTap') {
          expect(legalBefore.some((l) => l.type === a.type && l.cardId === a.cardId)).toBe(true);
        }
        if (a.type === 'decide') expect(decisionBefore?.player).toBe(pid);
        if (a.type === 'pass') expect(s.priority).toBe(pid);
        s = next;
      } catch (e) {
        if (!(e instanceof RulesError)) throw e;
      }
      // Cards never appear out of nowhere: hand + library + other zones stay consistent.
      for (const p of s.players) {
        for (const cid of p.hand) expect(s.cards[cid]?.zone).toBe('hand');
        for (const cid of p.library) expect(s.cards[cid]?.zone).toBe('library');
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });
});

describe('hidden information', () => {
  it("views never include opponents' hands, any library, or decision internals", () => {
    let s = setup(3);
    const me = s.priority!;
    put(s, me, 'Forest');
    put(s, me, 'Forest');
    const growth = put(s, me, 'Rampant Growth', 'hand');
    s = act(s, me, { type: 'cast', cardId: growth.id });
    for (let i = 0; i < 5 && !s.decisions.length; i++) s = act(s, s.priority!, { type: 'pass' });
    for (const viewer of s.players) {
      const v = buildView(s, viewer.id);
      for (const p of s.players) {
        for (const id of p.library) {
          // Library cards are only visible to the searching player, inside their own search.
          if (v.cards[id]) expect(viewer.id === me && v.decision?.cards?.includes(id)).toBe(true);
        }
        if (p.id !== viewer.id) for (const id of p.hand) expect(v.cards[id]).toBeUndefined();
      }
      expect((v.decision as any)?.data).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain('"seed"');
      if (viewer.id !== me) expect(v.decision).toBeNull();
    }
  });
});

describe('priority', () => {
  it('a spell resolves only after every player has passed in turn', () => {
    let s = setup(3, 'none');
    const order = s.players.map((p) => p.id);
    const me = s.priority!;
    put(s, me, 'Island');
    const opt = put(s, me, 'Divination', 'hand');
    put(s, me, 'Island');
    put(s, me, 'Island');
    s = act(s, me, { type: 'cast', cardId: opt.id });
    expect(s.priority).toBe(me); // caster gets priority first
    s = act(s, me, { type: 'pass' });
    const second = order[(order.indexOf(me) + 1) % 3];
    const third = order[(order.indexOf(me) + 2) % 3];
    expect(s.priority).toBe(second);
    expect(s.stack.length).toBe(1);
    s = act(s, second, { type: 'pass' });
    expect(s.priority).toBe(third);
    expect(s.stack.length).toBe(1);
    s = act(s, third, { type: 'pass' });
    expect(s.stack.length).toBe(0);
    expect(s.cards[opt.id].zone).toBe('graveyard');
  });

  it('a response restarts the round of passes, and the stack resolves last-in first-out', () => {
    let s = setup(2, 'none');
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    put(s, me, 'Mountain');
    const bolt = put(s, me, 'Lightning Bolt', 'hand');
    const bear = put(s, me, 'Grizzly Bears');
    put(s, other, 'Forest');
    const growth = put(s, other, 'Giant Growth', 'hand');
    s = act(s, me, { type: 'cast', cardId: bolt.id, targets: [{ type: 'card', id: bear.id }] });
    s = act(s, me, { type: 'pass' });
    expect(s.priority).toBe(other);
    s = act(s, other, { type: 'cast', cardId: growth.id, targets: [{ type: 'card', id: bear.id }] });
    expect(s.stack.length).toBe(2);
    s = act(s, other, { type: 'pass' });
    s = act(s, me, { type: 'pass' }); // Giant Growth resolves
    expect(s.stack.length).toBe(1);
    s = act(s, me, { type: 'pass' });
    s = act(s, other, { type: 'pass' }); // Bolt resolves into a 5/5
    expect(s.cards[bear.id].zone).toBe('battlefield');
  });

  it('"respond to everything" mode stops even with no possible response; smart mode does not', () => {
    let s = setup(2, 'stack');
    const me = s.priority!;
    const other = s.players.find((p) => p.id !== me)!.id;
    put(s, me, 'Island');
    put(s, me, 'Island');
    put(s, me, 'Island');
    const div = put(s, me, 'Divination', 'hand');
    s = act(s, me, { type: 'cast', cardId: div.id });
    expect(s.priority).toBe(other); // caster auto-passed, opponent gets a stop
    s.players.find((p) => p.id === other)!.autoPass = 'smart';
    s = act(s, other, { type: 'setAutoPass', mode: 'smart' });
    expect(s.stack.length).toBe(0);
  });

  it('hold priority lets you respond to your own spell', () => {
    let s = setup(2, 'smart');
    const me = s.priority!;
    put(s, me, 'Island');
    put(s, me, 'Island');
    put(s, me, 'Island');
    put(s, me, 'Island');
    const div = put(s, me, 'Divination', 'hand');
    const opt = put(s, me, 'Opt', 'hand');
    s = act(s, me, { type: 'cast', cardId: div.id, hold: true });
    expect(s.priority).toBe(me);
    expect(s.stack.length).toBe(1);
    s = act(s, me, { type: 'cast', cardId: opt.id });
    expect(s.stack.length).toBeGreaterThanOrEqual(1);
  });

  it('a player chooses the order of their simultaneous triggers', () => {
    let s = setup(2, 'none');
    const me = s.priority!;
    put(s, me, 'Soul Warden');
    put(s, me, "Ajani's Pridemate");
    put(s, me, 'Forest');
    put(s, me, 'Forest');
    const bear = put(s, me, 'Grizzly Bears', 'hand');
    s = act(s, me, { type: 'cast', cardId: bear.id });
    s = act(s, me, { type: 'pass' });
    s = act(s, s.priority!, { type: 'pass' });
    // Bear enters: only Soul Warden triggers (one trigger) — no ordering prompt.
    expect(s.decisions.find((d) => d.handler === 'core:orderTrigger')).toBeUndefined();
    // Two different simultaneous triggers: Thragtusk ETB + Soul Warden.
    for (let i = 0; i < 6; i++) put(s, me, 'Forest');
    const tusk = put(s, me, 'Thragtusk', 'hand');
    while (s.stack.length) s = act(s, s.priority!, { type: 'pass' });
    s = act(s, me, { type: 'cast', cardId: tusk.id });
    s = act(s, me, { type: 'pass' });
    s = act(s, s.priority!, { type: 'pass' });
    const d = s.decisions.find((x) => x.handler === 'core:orderTrigger');
    expect(d?.player).toBe(me);
    expect(d?.options?.length).toBe(2);
  });
});
