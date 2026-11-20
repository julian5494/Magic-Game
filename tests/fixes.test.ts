// Regression tests for bugs reported while playing.
import { describe, expect, it } from 'vitest';
import { act, legalActions } from '../src/engine';
import { card, lands, onField, put, settle, setup } from './helpers';

describe('equipment', () => {
  it('equip resolves once, and creatures entering later do not ask to move it', () => {
    let { s, A } = setup('boros');
    const greaves = put(s, A, 'Lightning Greaves');
    const bears = put(s, A, 'Grizzly Bears');
    const equip = legalActions(s, A).find((a) => a.type === 'activate' && a.cardId === greaves.id)!;
    s = act(s, A, { type: 'activate', cardId: greaves.id, ability: equip.ability!, targets: [card(bears.id)] });
    expect(s.stack.length).toBe(1);
    s = settle(s);
    expect(s.stack.length).toBe(0);
    expect(s.cards[greaves.id].attachedTo).toBe(bears.id);
    // Already on that creature: equipping it to the same creature isn't offered again.
    const again = legalActions(s, A).find((a) => a.type === 'activate' && a.cardId === greaves.id);
    expect(again?.targets?.[0].options.some((o) => o.id === bears.id) ?? false).toBe(false);
    // Another creature entering: no trigger, no question, Greaves stays put.
    lands(s, A, 'Mountain', 2);
    const lions = put(s, A, 'Monastery Swiftspear', 'hand');
    s = act(s, A, { type: 'cast', cardId: lions.id });
    s = settle(s);
    expect(s.decisions.length).toBe(0);
    expect(onField(s, A, 'Monastery Swiftspear').length).toBe(1);
    expect(s.cards[greaves.id].attachedTo).toBe(bears.id);
  });
});
