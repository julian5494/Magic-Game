// Game updates map to the right sound cues.
import { describe, expect, it } from 'vitest';
import { act, buildPrecon, buildView, createGame } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { makeCard, moveCard } from '../src/engine/ops';
import { soundsFor } from '../src/client/gameSounds';

function setup(): { s: GameState; A: PlayerId; B: PlayerId } {
  const d = buildPrecon('boros');
  let s = createGame(
    [
      { id: 'a', name: 'A', commander: d.commanders, cards: d.cards },
      { id: 'b', name: 'B', commander: d.commanders, cards: d.cards },
    ],
    9,
  );
  for (const dec of [...s.decisions]) s = act(s, dec.player, { type: 'decide', decisionId: dec.id, answer: { option: 'keep' } });
  for (const p of s.players) {
    p.autoPass = 'none';
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return { s, A: s.activePlayer, B: s.players.find((p) => p.id !== s.activePlayer)!.id };
}
function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  c.sick = false;
  s.events = [];
  return c;
}
const names = (cues: ReturnType<typeof soundsFor>) => cues.map(([n]) => n);

describe('game sounds', () => {
  it('a land played thuds onto the table', () => {
    const { s, A } = setup();
    const land = put(s, A, 'Mountain', 'hand');
    const before = buildView(s, A);
    const after = buildView(act(s, A, { type: 'playLand', cardId: land.id }), A);
    expect(names(soundsFor(before, after))).toContain('land');
  });

  it('casting shimmers in the spell colors, then the creature lands and the bolt resolves', () => {
    let { s, A, B } = setup();
    for (let i = 0; i < 3; i++) put(s, A, 'Mountain');
    const lions = put(s, A, 'Monastery Swiftspear', 'hand');
    let v0 = buildView(s, A);
    s = act(s, A, { type: 'cast', cardId: lions.id });
    let v1 = buildView(s, A);
    const cast = soundsFor(v0, v1).find(([n]) => n === 'cast');
    expect(cast?.[1].colors).toEqual(['R']);
    s = act(s, A, { type: 'pass' });
    s = act(s, B, { type: 'pass' });
    expect(names(soundsFor(v1, buildView(s, A)))).toContain('creature');

    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    v0 = buildView(s, A);
    s = act(s, A, { type: 'cast', cardId: bolt.id, targets: [{ type: 'player', id: B }] });
    v1 = buildView(s, A);
    // Prowess triggers above the bolt; resolve everything.
    const cues: string[] = [];
    for (let i = 0; i < 10 && s.stack.length; i++) {
      s = act(s, s.priority!, { type: 'pass' });
      const v2 = buildView(s, A);
      cues.push(...names(soundsFor(v1, v2)));
      v1 = v2;
    }
    expect(cues.filter((c) => c === 'resolve').length).toBe(1);
    expect(cues).toContain('resolve');
    expect(cues).toContain('lifeLoss');
  });

  it('a creature dying crunches, and a board wipe stays a handful of sounds', () => {
    const { s, A, B } = setup();
    const bears = Array.from({ length: 8 }, () => put(s, B, 'Grizzly Bears'));
    const before = buildView(s, A);
    for (const b of bears) moveCard(s, b.id, 'graveyard');
    const cues = soundsFor(before, buildView(s, A)).filter(([n]) => n === 'dies');
    expect(cues.length).toBe(4);
    expect(cues[1][1].delay).toBeGreaterThan(0);
  });

  it('nothing plays on the first view', () => {
    const { s, A } = setup();
    expect(soundsFor(null, buildView(s, A))).toEqual([]);
  });
});
