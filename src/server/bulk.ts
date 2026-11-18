// Scryfall's free "Oracle Cards" bulk file: one entry per card, ~25 MB compressed.
// Downloaded once (refreshed weekly) so every card is known locally and imports are instant.
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { ScryCard } from '../engine/oracle';
import { normalizeName } from '../engine/registry';

export const BULK_FILE = resolve(process.env.BULK_FILE ?? '.cache/oracle-cards.jsonl.gz');
const MAX_AGE_MS = 7 * 24 * 3600_000;
const HEADERS = { 'User-Agent': 'CommanderArena/0.1', Accept: 'application/json' };

export interface BulkCard extends ScryCard {
  edhrec_rank?: number;
}

const byName = new Map<string, BulkCard>();
let loading: Promise<number> | null = null;

export function slimCard(c: any): BulkCard {
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
    edhrec_rank: c.edhrec_rank,
  };
}

/** A real paper card someone could put in a Commander deck (legal or banned). */
function isRealCard(c: any): boolean {
  const l = c.legalities?.commander;
  return (l === 'legal' || l === 'banned') && !['token', 'double_faced_token', 'emblem', 'art_series'].includes(c.layout);
}

async function download(): Promise<void> {
  const meta: any = await (await fetch('https://api.scryfall.com/bulk-data/oracle-cards', { headers: HEADERS })).json();
  const url: string = meta.jsonl_download_uri ?? meta.download_uri;
  if (!url) throw new Error('Scryfall bulk data has no download link');
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`Bulk download failed: ${res.status}`);
  mkdirSync(dirname(BULK_FILE), { recursive: true });
  const tmp = `${BULK_FILE}.part`;
  // Store gzipped regardless of how it was served.
  const body = Readable.fromWeb(res.body as any);
  if (url.endsWith('.gz')) await pipeline(body, createWriteStream(tmp));
  else await pipeline(body, createGzip(), createWriteStream(tmp));
  renameSync(tmp, BULK_FILE);
}

async function readFile(): Promise<number> {
  byName.clear();
  const rl = createInterface({ input: createReadStream(BULK_FILE).pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (let line of rl) {
    line = line.trim();
    if (first && line.startsWith('[')) line = line.slice(1); // tolerate the JSON-array variant
    first = false;
    if (!line || line === ']') continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    let c: any;
    try {
      c = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRealCard(c)) continue;
    const s = slimCard(c);
    byName.set(normalizeName(s.name), s);
    const front = s.card_faces?.[0]?.name;
    if (front && !byName.has(normalizeName(front))) byName.set(normalizeName(front), s);
  }
  return byName.size;
}

/** Load the bulk card list (downloading or refreshing it if needed). Safe to call repeatedly. */
export function loadBulk(opts: { download?: boolean } = {}): Promise<number> {
  if (!loading) {
    loading = (async () => {
      const stale = !existsSync(BULK_FILE) || Date.now() - statSync(BULK_FILE).mtimeMs > MAX_AGE_MS;
      if (stale && opts.download !== false) {
        try {
          await download();
        } catch (e) {
          if (!existsSync(BULK_FILE)) throw e;
          console.warn('Could not refresh Scryfall bulk data, using the old copy:', (e as Error).message);
        }
      }
      if (!existsSync(BULK_FILE)) return 0;
      return readFile();
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

export function bulkCard(name: string): BulkCard | undefined {
  return byName.get(normalizeName(name));
}

export function bulkCards(): BulkCard[] {
  return [...new Set(byName.values())];
}

export function bulkSize(): number {
  return byName.size;
}
