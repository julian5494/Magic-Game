// Game updates map to the right animations.
import { describe, expect, it } from 'vitest';
import { act, buildView } from '../src/engine';
import type { GameState } from '../src/engine';
import { fxFor } from '../src/client/gameFx';
import { card, lands, player, put, settle, setup } from './helpers';

/** Resolve everything, collecting the effects of each update as A sees it. */
function run(s: GameState, A: string, step: (s: GameState) => GameState) {
  let v = buildView(s, A);
  const kinds: string[] = [];
  s = step(s);
  for (let i = 0; i < 30; i++) {
    const nv = buildView(s, A);
    kinds.push(...fxFor(v, nv).map((f) => f.kind));
    v = nv;
    if (!s.stack.length && !s.decisions.length) break;
    s = settle(s, () => undefined);
  }
  return { s, kinds };
}

describe('animations', () => {
  it('a burn spell flies a bolt at its target', () => {
    const { s, A, B } = setup('izzet');
    lands(s, A, 'Mountain', 1);
    const bolt = put(s, A, 'Lightning Bolt', 'hand');
    const { kinds } = run(s, A, (st) => act(st, A, { type: 'cast', cardId: bolt.id, targets: [player(B)] }));
    expect(kinds).toContain('bolt');
  });

  it('targeted destroy shatters; a board wipe sends a shockwave', () => {
    let { s, A, B } = setup('golgari');
    lands(s, A, 'Swamp', 3);
    const bear = put(s, B, 'Grizzly Bears');
    const murder = put(s, A, 'Murder', 'hand');
    let r = run(s, A, (st) => act(st, A, { type: 'cast', cardId: murder.id, targets: [card(bear.id)] }));
    expect(r.kinds).toContain('shatter');
    s = r.s;
    for (let i = 0; i < 4; i++) put(s, B, 'Grizzly Bears');
    lands(s, A, 'Swamp', 4);
    const wipe = put(s, A, 'Damnation', 'hand');
    r = run(s, A, (st) => act(st, A, { type: 'cast', cardId: wipe.id }));
    expect(r.kinds).toContain('wipe');
    expect(r.kinds.filter((k) => k === 'crumble').length).toBe(4);
  });

  it('nothing on the first view', () => {
    const { s, A } = setup();
    expect(fxFor(null, buildView(s, A))).toEqual([]);
  });
});
