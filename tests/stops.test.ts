// Phase stops: where auto-pass pauses for a player.
import { describe, expect, it } from 'vitest';
import { act } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { DEFAULT_STOPS } from '../src/engine/types';
import { lands, P, put, setup } from './helpers';

/** Let the game run with A on smart auto-pass until A next gets priority (B passes everything). */
function untilAPauses(s: GameState, A: PlayerId, B: PlayerId): GameState {
  P(s, A).autoPass = 'smart';
  P(s, B).autoPass = 'smart';
  P(s, B).isBot = true;
  for (let i = 0; i < 200; i++) {
    const d = s.decisions[0];
    if (d) {
      s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareAttackers' ? { attackers: [] } : d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes', cards: (d.cards ?? []).slice(0, d.min ?? 0) } });
    } else if (s.priority === B) s = act(s, B, { type: 'pass' });
    else if (s.priority === A && i > 0) return s;
    else s = act(s, A, { type: 'pass' });
  }
  return s;
}

describe('phase stops', () => {
  it('everyone starts with the default stops', () => {
    const { s, A } = setup();
    expect(P(s, A).stops ?? DEFAULT_STOPS).toEqual(DEFAULT_STOPS);
  });

  it("with a stop on opponents' upkeep you get to act there; without it you don't", () => {
    for (const stop of [true, false]) {
      let { s, A, B } = setup('izzet');
      lands(s, A, 'Mountain', 1);
      put(s, A, 'Lightning Bolt', 'hand');
      if (stop) s = act(s, A, { type: 'setStops', mine: DEFAULT_STOPS.mine, theirs: ['upkeep', 'end'] });
      // Pass A's own turn away; the next pause on B's turn is the first stop with something to do.
      s = act(s, A, { type: 'passUntilEndOfTurn' });
      s = untilAPauses(s, A, B);
      expect(s.activePlayer).toBe(B);
      expect(s.step).toBe(stop ? 'upkeep' : 'end');
    }
  });

  it('ignores steps that are not on the rail', () => {
    let { s, A } = setup();
    s = act(s, A, { type: 'setStops', mine: ['main1', 'bogus' as any, 'cleanup' as any], theirs: 'nope' as any });
    expect(P(s, A).stops).toEqual({ mine: ['main1'], theirs: [] });
  });
});
