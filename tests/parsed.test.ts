// Bots play full games with random decks built from real (Scryfall-parsed) cards to shake out
// runtime errors in the oracle parser's generated effects.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { act, chooseBotAction, createGame } from '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { colorIdentity } from '../src/engine/state';
import type { GameState } from '../src/engine/types';

const cards: ScryCard[] = JSON.parse(readFileSync(new URL('./fixtures/edhrec-top.json', import.meta.url), 'utf8'));
for (const c of cards) {
  const front = c.card_faces?.[0]?.name && !c.oracle_text ? c.card_faces[0].name : c.name;
  if (!findDef(front)) registerGenerated(convertScryfall(c));
}
const defs = cards.map((c) => findDef(c.card_faces?.[0]?.name && !c.oracle_text ? c.card_faces[0].name : c.name)!).filter(Boolean);

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

const BASICS: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

function randomDeck(seed: number) {
  const r = rng(seed);
  const commanders = defs.filter((d) => (d.supertypes ?? []).includes('Legendary') && d.types.includes('Creature') && !d.cannotCast);
  const cmd = commanders[Math.floor(r() * commanders.length)];
  const id = new Set(colorIdentity(cmd));
  const pool = defs.filter((d) => d.name !== cmd.name && !(d.supertypes ?? []).includes('Basic') && colorIdentity(d).every((c) => id.has(c)));
  const picked = pool.sort(() => r() - 0.5).slice(0, 60).map((d) => d.name);
  const colors = [...id];
  while (picked.length < 99) picked.push(colors.length ? BASICS[colors[picked.length % colors.length]] : 'Wastes' in BASICS ? 'Wastes' : 'Plains');
  return { commander: cmd.name, cards: picked };
}

function play(seed: number, n: number): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i}`, ...randomDeck(seed * 10 + i), isBot: true }));
  let s = createGame(players, seed);
  for (let i = 0; i < 4000 && s.phase !== 'over' && s.turn < 40; i++) {
    let acted = false;
    for (const p of s.players) {
      const a = chooseBotAction(s, p.id);
      if (!a) continue;
      try {
        s = act(s, p.id, a);
      } catch (e) {
        throw new Error(`seed ${seed}: ${JSON.stringify(a)} ${(e as Error).stack}\n${s.log.slice(-10).map((l) => l.text).join('\n')}`);
      }
      acted = true;
      break;
    }
    if (!acted) throw new Error(`stuck at seed ${seed} step ${s.step}`);
  }
  return s;
}

describe('games with real parsed cards', () => {
  it('bots play 4-player and 2-player games with random real decks without engine errors', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) play(seed, seed % 2 ? 4 : 2);
    expect(true).toBe(true);
  }, 120_000);
});
