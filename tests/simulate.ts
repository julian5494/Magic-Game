import { act, buildPrecon, chooseBotAction, createGame, PRECONS, validateDeck, deckToText } from '../src/engine';
import type { GameState } from '../src/engine';

export function simulate(seed: number, decks: string[], maxActions = 6000): { state: GameState; actions: number } {
  const players = decks.map((id, i) => {
    const d = buildPrecon(id);
    return { id: `p${i}`, name: `Bot ${i} (${id})`, commander: d.commanders, cards: d.cards, isBot: true };
  });
  let state = createGame(players, seed);
  let n = 0;
  while (state.phase !== 'over' && n < maxActions) {
    let acted = false;
    for (const p of state.players) {
      const a = chooseBotAction(state, p.id);
      if (a) {
        try {
          state = act(state, p.id, a);
        } catch (e) {
          throw new Error(`seed ${seed} action ${n} by ${p.id} ${JSON.stringify(a)}: ${(e as Error).stack}\n${state.log.slice(-15).map((l) => l.text).join('\n')}`);
        }
        acted = true;
        n++;
        break;
      }
    }
    if (!acted) throw new Error(`Stuck at seed ${seed}: step ${state.step} priority ${state.priority} decisions ${JSON.stringify(state.decisions.map((d) => d.kind + ':' + d.player))}`);
    if (state.turn > 60) break;
  }
  return { state, actions: n };
}

if (process.argv[1]?.endsWith('simulate.ts')) {
  for (const p of PRECONS) {
    const v = validateDeck(deckToText(buildPrecon(p.id)));
    if (!v.ok) console.log(p.id, v.errors);
  }
  const ids = PRECONS.map((p) => p.id);
  for (let seed = 1; seed <= Number(process.argv[2] ?? 10); seed++) {
    const { state, actions } = simulate(seed, seed % 2 ? ids : ids.slice(0, 2));
    const w = state.players.find((p) => p.id === state.winner);
    console.log(`seed ${seed}: turn ${state.turn}, ${actions} actions, winner: ${w?.name ?? 'none'}; life ${state.players.map((p) => p.life).join('/')}`);
  }
}
