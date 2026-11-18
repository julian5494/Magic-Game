// Most common sentences / trigger conditions the parser fails on among the top N most-played cards.
// Usage: npx tsx tests/signatures.ts [N] [limit]
import '../src/engine';
import { convertScryfall, parseDiagnostics } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { bulkCards, loadBulk } from '../src/server/bulk';

const shape = (s: string) =>
  s
    .replace(/\{[^}]+\}/g, '{M}')
    .replace(/\b(\d+|X|one|two|three|four|five)\b/gi, 'N')
    .replace(/[+-]N\/[+-]N/g, '±N/±N')
    .slice(0, 90);

(async () => {
  await loadBulk({ download: false });
  const N = Number(process.argv[2] ?? 2000);
  const limit = Number(process.argv[3] ?? 50);
  parseDiagnostics.enabled = true;
  const cards = bulkCards().sort((a, b) => (a.edhrec_rank ?? 1e9) - (b.edhrec_rank ?? 1e9)).slice(0, N);
  for (const c of cards) {
    const front = c.card_faces?.[0]?.name && !c.oracle_text ? c.card_faces[0].name : c.name;
    if (findDef(front) && !findDef(front)!.token) continue;
    registerGenerated(convertScryfall(c));
  }
  for (const [title, map] of [['Failing sentences', parseDiagnostics.sentences], ['Failing trigger conditions', parseDiagnostics.triggers]] as const) {
    const grouped = new Map<string, { n: number; ex: string }>();
    for (const [s, n] of map) {
      const k = shape(s);
      const g = grouped.get(k) ?? { n: 0, ex: s };
      g.n += n;
      grouped.set(k, g);
    }
    console.log(`\n${title}:`);
    for (const [k, g] of [...grouped].sort((a, b) => b[1].n - a[1].n).slice(0, limit)) console.log(String(g.n).padStart(4), k);
  }
})();
