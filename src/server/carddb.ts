// Loads card data from Scryfall (with an on-disk cache) and turns it into engine card definitions.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CardDef } from '../engine/cardtypes';
import { convertScryfall, type ScryCard } from '../engine/oracle';
import { findDef, normalizeName, registerAlias, registerGenerated } from '../engine/registry';
import { bulkCard } from './bulk';

const CACHE_FILE = resolve(process.env.CARD_CACHE ?? '.cache/scryfall-cards.json');
const HEADERS = { 'User-Agent': 'CommanderArena/0.1', Accept: 'application/json', 'Content-Type': 'application/json' };

/** Cache by normalized name and by "set:collector" printing key. */
const cache = new Map<string, ScryCard>();
let loaded = false;
let dirty = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, ScryCard>;
      for (const [k, v] of Object.entries(data)) cache.set(k, v);
    }
  } catch (e) {
    console.warn('Card cache unreadable, starting fresh', e);
  }
}

function save() {
  if (!dirty) return;
  dirty = false;
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
  } catch (e) {
    console.warn('Could not write card cache', e);
  }
}

function slim(c: any): ScryCard {
  const face = (f: any) => ({
    name: f.name,
    mana_cost: f.mana_cost,
    type_line: f.type_line,
    oracle_text: f.oracle_text,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    colors: f.colors,
    image_uris: f.image_uris ? { normal: f.image_uris.normal } : undefined,
  });
  return {
    ...face(c),
    id: c.id,
    color_identity: c.color_identity,
    keywords: c.keywords,
    layout: c.layout,
    card_faces: c.card_faces?.map(face),
    legalities: c.legalities ? { commander: c.legalities.commander } : undefined,
    set: c.set,
    collector_number: c.collector_number,
  };
}

function remember(c: ScryCard, printingKey?: string) {
  cache.set(normalizeName(c.name), c);
  const front = c.card_faces?.[0]?.name;
  if (front) cache.set(normalizeName(front), c);
  if (printingKey) cache.set(printingKey, c);
  dirty = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postCollection(identifiers: object[]): Promise<{ data: any[]; not_found: any[] }> {
  const res = await fetch('https://api.scryfall.com/cards/collection', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
  return (await res.json()) as any;
}

async function fuzzy(name: string): Promise<any | null> {
  const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { headers: HEADERS });
  if (!res.ok) return null;
  return res.json();
}

export interface CardRequest {
  name: string;
  set?: string;
  cn?: string;
}

export interface LoadedCard {
  def: CardDef;
  /** Image for the requested printing (falls back to the card's default image). */
  image?: string;
}

/**
 * Make sure every requested card is registered with the engine. Returns the resolved
 * definitions keyed by the requested name, plus names Scryfall didn't recognise.
 */
export async function loadCards(requests: CardRequest[]): Promise<{ found: Map<string, LoadedCard>; notFound: string[] }> {
  load();
  const found = new Map<string, LoadedCard>();
  const notFound: string[] = [];
  const pending: CardRequest[] = [];
  const keyOf = (r: CardRequest) => (r.set && r.cn ? `${r.set.toLowerCase()}:${r.cn}` : undefined);
  const nameMatches = (r: CardRequest, s: ScryCard) =>
    [s.name, ...(s.card_faces ?? []).map((f) => f.name)].some((n) => normalizeName(n) === normalizeName(r.name));
  /** The cached printing for a request, only if it really is that card. */
  const printingOf = (r: CardRequest) => {
    const p = keyOf(r) ? cache.get(keyOf(r)!) : undefined;
    return p && nameMatches(r, p) ? p : undefined;
  };

  const seen = new Set<string>();
  for (const r of requests) {
    const k = `${normalizeName(r.name)}|${keyOf(r) ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const printing = printingOf(r);
    const byName = cache.get(normalizeName(r.name)) ?? bulkCard(r.name);
    if (printing || (byName && (!keyOf(r) || cache.has(keyOf(r)!)))) continue;
    pending.push(r);
  }

  for (let i = 0; i < pending.length; i += 75) {
    const chunk = pending.slice(i, i + 75);
    const ids = chunk.map((r) => (r.set && r.cn ? { set: r.set.toLowerCase(), collector_number: r.cn } : { name: r.name }));
    let res: { data: any[]; not_found: any[] };
    try {
      res = await postCollection(ids);
    } catch (e) {
      // Scryfall unreachable: fall back to the local bulk card list (default art).
      console.warn('Scryfall lookup failed, using local card data:', (e as Error).message);
      continue;
    }
    const retry: CardRequest[] = [];
    for (const c of res.data) {
      const s = slim(c);
      const req = chunk.find((r) => r.set && r.cn && r.set.toLowerCase() === s.set && r.cn === s.collector_number);
      if (req && !nameMatches(req, s)) {
        // Wrong set/number in the list: ignore the printing, look the card up by name instead.
        retry.push({ name: req.name });
        continue;
      }
      remember(s, req ? keyOf(req) : undefined);
    }
    if (retry.length) {
      await sleep(100);
      const again = await postCollection(retry.map((r) => ({ name: r.name })));
      for (const c of again.data) remember(slim(c));
      res.not_found.push(...again.not_found);
    }
    // Retry misses by name (bad set codes, split-card names, typos).
    for (const miss of res.not_found) {
      const req = chunk.find((r) =>
        miss.name ? normalizeName(r.name) === normalizeName(miss.name) : r.set?.toLowerCase() === miss.set && r.cn === miss.collector_number,
      );
      if (!req || cache.has(normalizeName(req.name)) || bulkCard(req.name)) continue;
      await sleep(100);
      const alt = (await fuzzy(req.name)) ?? (req.name.includes('//') ? await fuzzy(req.name.split('//')[0].trim()) : null);
      if (alt) {
        const s = slim(alt);
        remember(s);
        cache.set(normalizeName(req.name), s);
      }
    }
    await sleep(100);
  }
  save();

  for (const r of requests) {
    const printing = printingOf(r);
    const card = printing ?? cache.get(normalizeName(r.name)) ?? bulkCard(r.name);
    if (!card) {
      if (!notFound.includes(r.name)) notFound.push(r.name);
      continue;
    }
    const def = ensureDef(card);
    const image = imageOf(printing ?? card);
    found.set(r.name, { def, image });
  }
  return { found, notFound };
}

function imageOf(c: ScryCard): string | undefined {
  return c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;
}

/** Register a Scryfall card with the engine (hand-scripted cards keep their scripts). */
export function ensureDef(card: ScryCard): CardDef {
  const frontName = card.card_faces?.[0]?.name && !card.oracle_text ? card.card_faces[0].name : card.name;
  const existing = findDef(frontName);
  if (existing && !existing.token) {
    if (!existing.image) existing.image = imageOf(card);
    if (existing.banned === undefined && card.legalities) existing.banned = card.legalities.commander === 'banned';
    if (existing.name !== card.name) registerAlias(card.name, existing.name);
    return existing;
  }
  const def = registerGenerated(convertScryfall(card));
  if (card.name !== def.name) registerAlias(card.name, def.name);
  return def;
}
