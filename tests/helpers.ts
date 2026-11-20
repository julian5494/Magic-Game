// Shared helpers for engine tests: a two-player game with empty hands, putting cards into play,
// and letting the stack resolve with sensible default answers.
import { act, buildPrecon, createGame } from '../src/engine';
import type { GameState, PlayerId, Target } from '../src/engine';
import { makeCard, moveCard } from '../src/engine/ops';
import { collectTriggers, processTriggers } from '../src/engine/rules';

/** Two players on the same ready-made deck, mulligans kept, hands emptied, nobody auto-passing. */
export function setup(deck = 'rakdos', seed = 5): { s: GameState; A: PlayerId; B: PlayerId } {
  const d = buildPrecon(deck);
  let s = createGame(
    [
      { id: 'a', name: 'A', commander: d.commanders, cards: d.cards },
      { id: 'b', name: 'B', commander: d.commanders, cards: d.cards },
    ],
    seed,
  );
  for (const dec of [...s.decisions]) s = act(s, dec.player, { type: 'decide', decisionId: dec.id, answer: { option: 'keep' } });
  for (const p of s.players) {
    p.autoPass = 'none';
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return { s, A: s.activePlayer, B: s.players.find((p) => p.id !== s.activePlayer)!.id };
}

/** Create a card for a player straight into a zone (permanents arrive ready to use). */
export function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' | 'graveyard' | 'library' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  c.sick = false;
  s.events = [];
  return c;
}

export const lands = (s: GameState, pid: PlayerId, name: string, n: number) => {
  for (let i = 0; i < n; i++) put(s, pid, name);
};

export const P = (s: GameState, pid: PlayerId) => s.players.find((p) => p.id === pid)!;

/** Permanents a player controls with this name. */
export const onField = (s: GameState, pid: PlayerId, name: string) =>
  Object.values(s.cards).filter((c) => c.zone === 'battlefield' && c.controller === pid && c.def === name);

/** Move a card straight to a zone (a creature dying, say), then let the game notice what triggered. */
export function moveAndFlush(s: GameState, id: string, zone: 'graveyard' | 'battlefield' | 'exile' | 'hand'): void {
  moveCard(s, id, zone);
  collectTriggers(s);
  processTriggers(s);
}

/**
 * Let everything on the stack resolve. Decisions are answered by `pick` when it returns an answer,
 * otherwise: targets → the first legal option, yes/no → yes, card choices → the minimum.
 */
export function settle(s: GameState, pick: (d: GameState['decisions'][number]) => any = () => undefined): GameState {
  for (let i = 0; i < 60; i++) {
    const d = s.decisions[0];
    if (d) {
      let answer = pick(d);
      if (!answer) {
        if (d.kind === 'chooseTargets') answer = { targets: (d.targetSpecs ?? []).map((t) => t.options[0] ?? null) };
        else if (d.kind === 'chooseOption') answer = { option: d.options?.find((o) => o.id === 'yes')?.id ?? d.options?.[0]?.id };
        else if (d.kind === 'chooseCards') answer = { cards: (d.cards ?? []).slice(0, d.min ?? 0) };
        else if (d.kind === 'declareAttackers') answer = { attackers: [] };
        else if (d.kind === 'declareBlockers') answer = { blocks: [] };
        else answer = {};
      }
      s = act(s, d.player, { type: 'decide', decisionId: d.id, answer });
      continue;
    }
    if (!s.stack.length) break;
    s = act(s, s.priority!, { type: 'pass' });
  }
  return s;
}

export const player = (id: PlayerId): Target => ({ type: 'player', id });
export const card = (id: string): Target => ({ type: 'card', id });
