// Reports how many real Commander cards the oracle parser automates fully.
// Usage: npx tsx tests/coverage.ts [--list]
import { readFileSync } from 'node:fs';
import '../src/engine';
import { convertScryfall, type ScryCard } from '../src/engine/oracle';
import { findDef } from '../src/engine/registry';

const cards: ScryCard[] = JSON.parse(readFileSync(new URL('./fixtures/edhrec-top.json', import.meta.url), 'utf8'));
let full = 0;
const misses: string[] = [];
let scripted = 0;
let blocked = 0;
for (const c of cards) {
  if (findDef(c.name) && !findDef(c.name)!.token) {
    full++;
    scripted++;
    continue;
  }
  const def = convertScryfall(c);
  if (def.cannotCast) blocked++;
  if (!def.unsupported?.length) full++;
  else misses.push(`${c.name}: ${def.unsupported.join(' | ')}`);
}
console.log(`${full}/${cards.length} fully automated (${Math.round((100 * full) / cards.length)}%), ${scripted} hand-scripted, ${blocked} not castable yet`);
if (process.argv.includes('--list')) console.log(misses.join('\n'));
