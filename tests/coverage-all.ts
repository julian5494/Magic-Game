// Coverage across every Commander-legal card in Scryfall's bulk data.
// Usage: npx tsx tests/coverage-all.ts [--patterns] [--list N]
import '../src/engine';
import type { CardDef } from '../src/engine/cardtypes';
import { convertScryfall } from '../src/engine/oracle';
import { findDef, registerGenerated } from '../src/engine/registry';
import { bulkCards, loadBulk } from '../src/server/bulk';

const CATEGORIES: [string, RegExp][] = [
  ['counting ("for each", "equal to the number")', /for each|equal to the number|equal to (its|that|the greatest|your)/i],
  ['cost reductions & free casts', /costs? \{?\w*\}? (less|more)|without paying|rather than pay/i],
  ['kicker/flashback/cycling/cascade/etc', /^(kicker|flashback|overload|cascade|cycling|\w+cycling|channel|buyback|convoke|delve|escape|madness|ninjutsu|retrace|jump-start|evoke|dash|unearth|embalm|eternalize|blitz|disturb|foretell|mutate|emerge|suspend|affinity|improvise|bestow|prototype)\b/i],
  ['replacement effects ("would … instead")', /\bwould\b|\binstead\b/i],
  ['choose a creature type/color/name', /choose a (creature type|color|card name)/i],
  ['copy effects', /\bcop(y|ies)\b/i],
  ['"unless … pays"', /unless/i],
  ['planeswalker loyalty', /^[+−-]?\d+: |^\[[+−-]?\d+\]/],
  ['other faces / split / adventure', /Other face|Split card|adventure/i],
  ['counters other than +1/+1', /(loyalty|charge|oil|stun|shield|time|lore|energy|experience|poison|age|fade|quest) counters?/i],
  ['exile-then-play / look at top', /look at the top|exile the top|reveal the top|you may (play|cast)/i],
  ['protection / phasing / "until your next turn"', /protection|phase|until your next turn/i],
  ['static "can\'t" restrictions', /can't|cannot/i],
  ['sagas / classes / rooms', /^(I|II|III|IV|V)(, \w+)* — |level \d/i],
  ['spell copies & storm', /storm|magecraft/i],
  ['"activate only" restrictions', /activate only/i],
];

(async () => {
  const n = await loadBulk({ download: false });
  if (!n) {
    console.log('No bulk file. Start the server once (or run with network) to download it.');
    return;
  }
  const cards = bulkCards();
  type Row = { name: string; rank: number; def: CardDef };
  const rows: Row[] = [];
  for (const c of cards) {
    const front = c.card_faces?.[0]?.name && !c.oracle_text ? c.card_faces[0].name : c.name;
    let def = findDef(front);
    if (!def || def.token) {
      try {
        def = registerGenerated(convertScryfall(c));
      } catch (e) {
        console.log('CRASH converting', c.name, (e as Error).message);
        continue;
      }
    }
    rows.push({ name: c.name, rank: c.edhrec_rank ?? 1e9, def });
  }
  rows.sort((a, b) => a.rank - b.rank);
  const stat = (list: Row[]) => {
    const full = list.filter((r) => !r.def.unsupported?.length && !r.def.cannotCast).length;
    const blocked = list.filter((r) => r.def.cannotCast).length;
    const pct = (x: number) => `${Math.round((100 * x) / list.length)}%`;
    return `${pct(full)} fully, ${pct(list.length - full - blocked)} partly, ${pct(blocked)} not playable yet`;
  };
  console.log(`Cards in database: ${rows.length}`);
  for (const top of [100, 500, 2000, 10000]) console.log(`  top ${top} most-played: ${stat(rows.slice(0, top))}`);
  console.log(`  all cards: ${stat(rows)}`);

  if (process.argv.includes('--patterns')) {
    const scope = rows.slice(0, 5000);
    console.log('\nWhat blocks the top 5000 (cards not fully automated, by reason):');
    const counts = CATEGORIES.map(([label, re]) => ({
      label,
      n: scope.filter((r) => (r.def.unsupported ?? []).some((u) => re.test(u))).length,
    }));
    const missing = scope.filter((r) => r.def.unsupported?.length || r.def.cannotCast);
    const other = missing.filter((r) => !(r.def.unsupported ?? []).some((u) => CATEGORIES.some(([, re]) => re.test(u))));
    for (const c of counts.sort((a, b) => b.n - a.n)) console.log(`  ${String(c.n).padStart(5)}  ${c.label}`);
    console.log(`  ${String(other.length).padStart(5)}  other (${missing.length} not fully automated in total)`);
    const listN = Number(process.argv[process.argv.indexOf('--list') + 1]) || 0;
    if (listN) for (const r of other.slice(0, listN)) console.log(`   - ${r.name}: ${(r.def.unsupported ?? []).join(' | ').slice(0, 160)}`);
  }
})();
