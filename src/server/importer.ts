// Turns a deck URL (Archidekt, Moxfield) or pasted decklist text from any site into deck entries.
export interface DeckEntry {
  name: string;
  count: number;
  set?: string;
  cn?: string;
  commander?: boolean;
}

export interface RawDeck {
  name?: string;
  entries: DeckEntry[];
  /** True if the source said which cards are commanders. */
  commandersMarked: boolean;
}

const UA = { 'User-Agent': 'CommanderArena/0.1', Accept: 'application/json' };

export async function importFromUrl(url: string): Promise<RawDeck> {
  const u = url.trim();
  let m = u.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i);
  if (m) return importArchidekt(m[1]);
  m = u.match(/moxfield\.com\/decks\/([\w-]+)/i);
  if (m) return importMoxfield(m[1]);
  throw new Error('Paste a link to an Archidekt or Moxfield deck, or paste the decklist text itself (any site\'s "Export" text works).');
}

async function importArchidekt(id: string): Promise<RawDeck> {
  const res = await fetch(`https://archidekt.com/api/decks/${id}/`, { headers: UA });
  if (!res.ok) throw new Error(`Archidekt returned ${res.status}. Is the deck public?`);
  const d: any = await res.json();
  const excluded = new Set<string>((d.categories ?? []).filter((c: any) => c.includedInDeck === false).map((c: any) => c.name));
  // The commander category is the "premier" one (usually named "Commander", but owners can rename it).
  const premier = new Set<string>((d.categories ?? []).filter((c: any) => c.isPremier).map((c: any) => c.name));
  premier.add('Commander');
  const inPremier = (d.cards ?? []).filter((c: any) => (c.categories ?? []).some((x: string) => premier.has(x)));
  const premierIsCommander = inPremier.length > 0 && inPremier.length <= 2;
  const entries: DeckEntry[] = [];
  for (const c of d.cards ?? []) {
    const cats: string[] = c.categories ?? [];
    const commander = premierIsCommander && cats.some((x) => premier.has(x));
    if (!commander && cats.some((x) => excluded.has(x))) continue;
    const name: string = c.card?.oracleCard?.name;
    if (!name) continue;
    entries.push({
      name,
      count: c.quantity ?? 1,
      set: c.card?.edition?.editioncode,
      cn: c.card?.collectorNumber,
      commander,
    });
  }
  return { name: d.name, entries, commandersMarked: entries.some((e) => e.commander) };
}

async function importMoxfield(id: string): Promise<RawDeck> {
  let res: Response;
  try {
    res = await fetch(`https://api2.moxfield.com/v3/decks/all/${id}`, { headers: { ...UA, 'User-Agent': 'Mozilla/5.0 CommanderArena' } });
  } catch {
    res = new Response(null, { status: 599 });
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(
      'Moxfield blocks automatic downloads. On the Moxfield deck page choose "More → Export" (or Share → Export), copy the text, and paste it here instead.',
    );
  }
  const d: any = await res.json();
  const entries: DeckEntry[] = [];
  const board = (b: any, commander: boolean) => {
    for (const v of Object.values<any>(b?.cards ?? {})) {
      entries.push({ name: v.card?.name, count: v.quantity ?? 1, set: v.card?.set, cn: v.card?.cn, commander });
    }
  };
  board(d.boards?.commanders, true);
  board(d.boards?.mainboard, false);
  return { name: d.name, entries: entries.filter((e) => e.name), commandersMarked: true };
}

/**
 * Parse decklist text as exported by Moxfield, Archidekt, MTGGoldfish, EDHREC, MTG Arena, etc.
 * Recognises "1 Name", "1x Name", "1 Name (SET) 123", "*CMDR*" markers, and Commander sections.
 */
export function parseDeckText(text: string): RawDeck {
  const entries: DeckEntry[] = [];
  let section: 'main' | 'commander' | 'skip' = 'main';
  let marked = false;
  const blocks: DeckEntry[][] = [[]];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (blocks[blocks.length - 1].length) blocks.push([]);
      continue;
    }
    if (line.startsWith('#')) continue;
    const header = line.replace(/^\/\/\s*/, '').replace(/[:\s]+$/, '').toLowerCase();
    if (/^(commanders?|command zone)( \(\d+\))?$/.test(header)) {
      section = 'commander';
      marked = true;
      continue;
    }
    if (/^(deck|main ?deck|mainboard|main|companion|creatures?|lands?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|spells|other|ramp|removal|draw)( \(\d+\))?$/.test(header)) {
      section = 'main';
      continue;
    }
    if (/^(sideboard|maybeboard|maybe|considering|tokens?)( \(\d+\))?$/.test(header)) {
      section = 'skip';
      continue;
    }
    if (line.startsWith('//')) continue;
    if (section === 'skip') continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    let count = 1;
    let rest = line;
    if (m) {
      count = parseInt(m[1], 10);
      rest = m[2];
    }
    let commander = section === 'commander';
    if (/\*cmdr\*|\[commander\]/i.test(rest)) {
      commander = true;
      marked = true;
    }
    rest = rest.replace(/\*cmdr\*|\[commander[^\]]*\]/gi, '').replace(/\s\*[A-Z]+\*/g, '').replace(/\s\^[^^]*\^/g, '').replace(/\s#\S+/g, '').trim();
    let set: string | undefined;
    let cn: string | undefined;
    const p = rest.match(/^(.*?)\s+[(\[]([A-Za-z0-9]{2,6})[)\]](?:\s+([\w★-]+))?\s*$/);
    if (p) {
      rest = p[1];
      set = p[2].toLowerCase();
      cn = p[3];
    }
    const name = rest.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const e: DeckEntry = { name, count, set, cn, commander };
    entries.push(e);
    blocks[blocks.length - 1].push(e);
  }
  return { entries, commandersMarked: marked, ...(marked ? {} : { blocks: blocks.filter((b) => b.length) }) } as RawDeck & { blocks?: DeckEntry[][] };
}
