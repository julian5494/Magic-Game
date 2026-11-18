// Stress test: bots play many games with random decks from the most-played real cards (needs the bulk file).
// Usage: npx tsx tests/stress-bulk.ts [games] [poolSize]
import '../src/engine';
import { act, chooseBotAction, createGame } from '../src/engine';
import { convertScryfall } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { colorIdentity } from '../src/engine/state';
import { bulkCards, loadBulk } from '../src/server/bulk';

(async () => {
  await loadBulk({ download: false });
  const games = Number(process.argv[2] ?? 20);
  const poolSize = Number(process.argv[3] ?? 3000);
  const cards = bulkCards().sort((a, b) => (a.edhrec_rank ?? 1e9) - (b.edhrec_rank ?? 1e9)).slice(0, poolSize);
  const defs = cards.map((c) => {
    const front = c.card_faces?.[0]?.name && !c.oracle_text ? c.card_faces[0].name : c.name;
    const d = findDef(front);
    return d && !d.token ? d : registerGenerated(convertScryfall(c));
  });
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const basics: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const deck = () => {
    const cmds = defs.filter((d) => (d.supertypes ?? []).includes('Legendary') && d.types.includes('Creature') && !d.cannotCast);
    const cmd = cmds[Math.floor(rand() * cmds.length)];
    const id = new Set(colorIdentity(cmd));
    const pool = defs.filter((d) => d.name !== cmd.name && !(d.supertypes ?? []).includes('Basic') && colorIdentity(d).every((c) => id.has(c)));
    const picked = [...new Set(pool.sort(() => rand() - 0.5).slice(0, 62).map((d) => d.name))];
    const cols = [...id];
    while (picked.length < 99) picked.push(basics[cols[picked.length % Math.max(1, cols.length)]] ?? 'Plains');
    return { commander: cmd.name, cards: picked };
  };
  let errors = 0;
  let turns = 0;
  let casts = 0;
  let wins = 0;
  const start = Date.now();
  for (let g = 0; g < games; g++) {
    const n = g % 2 ? 2 : 4;
    let s = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot${i}`, ...deck(), isBot: true })), g + 1);
    let steps = 0;
    try {
      while (s.phase !== 'over' && s.turn < 35 && steps < 5000) {
        const p = s.players.find((pl) => chooseBotAction(s, pl.id));
        if (!p) throw new Error(`stuck in ${s.step}`);
        const a = chooseBotAction(s, p.id)!;
        try {
          s = act(s, p.id, a);
        } catch (e) {
          throw new Error(`${(e as Error).message} on ${JSON.stringify(a).slice(0, 150)} :: ${s.log.slice(-3).map((l) => l.text).join(' / ')}`);
        }
        steps++;
      }
      turns += s.turn;
      casts += s.log.filter((l) => / casts /.test(l.text)).length;
      if (s.phase === 'over') wins++;
    } catch (e) {
      errors++;
      console.log(`game ${g + 1}: ${(e as Error).message.slice(0, 400)}`);
    }
  }
  console.log(`avg turns ${(turns / games).toFixed(1)}, spells cast ${casts}, games won ${wins}`);
  console.log(`${games} games, ${errors} with errors, ${((Date.now() - start) / 1000).toFixed(1)}s`);
})();
