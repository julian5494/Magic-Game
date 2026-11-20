// Regenerates src/server/flavor-names.json: crossover printings sold under another name
// ("Balamb Garden" is Command Beacon, "Piko Piko Hammer" is Hammer of Nazahn).
// Run with: npx tsx scripts/flavor-names.ts
import { writeFileSync } from 'fs';

async function main() {
  const out: Record<string, string> = {};
  let url: string | null = 'https://api.scryfall.com/cards/search?q=has%3Aflavorname&unique=prints';
  while (url) {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MagicGame/1.0' } });
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    const page: any = await res.json();
    for (const c of page.data) {
      const names = [c.flavor_name, ...(c.card_faces ?? []).map((f: any) => f.flavor_name)].filter(Boolean);
      for (const n of names) if (n !== c.name) out[n] = c.name;
    }
    url = page.has_more ? page.next_page : null;
    await new Promise((r) => setTimeout(r, 120));
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(new URL('../src/server/flavor-names.json', import.meta.url), JSON.stringify(sorted, null, 1) + '\n');
  console.log(`${Object.keys(sorted).length} flavor names`);
}

main();
