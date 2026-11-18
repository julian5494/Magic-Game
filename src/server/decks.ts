import { checkDeck, commanderCandidates, type DeckCheck } from '../engine/deck';
import { findDef } from '../engine/registry';
import { loadCards } from './carddb';
import { type DeckEntry, importFromUrl, parseDeckText } from './importer';

export interface DeckReport extends DeckCheck {
  deckName?: string;
  /** Set when we couldn't tell which card is the commander: ask the player to pick. */
  commanderCandidates?: string[];
}

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Import a deck from a URL or pasted text, fetch card data, and validate it for Commander. */
export async function prepareDeck(input: { source: string; commanders?: string[] }): Promise<DeckReport> {
  const src = input.source.trim();
  if (!src) return { ok: false, errors: ['Paste a deck link or decklist.'], warnings: [] };
  const raw = isUrl(src) ? await importFromUrl(src) : parseDeckText(src);
  const blocks = (raw as { blocks?: DeckEntry[][] }).blocks;
  if (!raw.entries.length) return { ok: false, errors: ['No cards found in that list.'], warnings: [] };
  if (raw.entries.length > 250) return { ok: false, errors: ['That list is too long for a Commander deck.'], warnings: [] };

  const { found, notFound } = await loadCards(raw.entries.map((e) => ({ name: e.name, set: e.set, cn: e.cn })));
  const art: Record<string, string> = {};
  const canonical = (e: DeckEntry) => found.get(e.name)?.def.name;
  for (const e of raw.entries) {
    const f = found.get(e.name);
    if (f?.image && !art[f.def.name]) art[f.def.name] = f.image;
  }
  const total = raw.entries.reduce((n, e) => n + e.count, 0);

  // Work out the commander(s).
  let commanders: string[] = [];
  if (input.commanders?.length) {
    commanders = input.commanders.map((c) => findDef(c)?.name ?? c);
  } else if (raw.commandersMarked) {
    commanders = raw.entries.filter((e) => e.commander).map(canonical).filter(Boolean) as string[];
  } else {
    const last = blocks && blocks.length > 1 ? blocks[blocks.length - 1] : null;
    const lastNames = last?.map(canonical).filter(Boolean) as string[] | undefined;
    if (last && last.length <= 2 && lastNames && lastNames.length === last.length && commanderCandidates(lastNames).length === lastNames.length) {
      commanders = lastNames; // MTGO-style export: commander in a final block
    } else {
      const first = canonical(raw.entries[0]);
      if (first && total === 100 && commanderCandidates([first]).length) commanders = [first];
    }
  }

  const mainNames: string[] = [];
  const toRemove = [...commanders];
  for (const e of raw.entries) {
    const name = canonical(e);
    if (!name) continue;
    if (e.commander && !input.commanders?.length) continue;
    for (let i = 0; i < e.count; i++) {
      const idx = toRemove.indexOf(name);
      if (idx >= 0) {
        toRemove.splice(idx, 1);
        continue;
      }
      mainNames.push(name);
    }
  }

  if (!commanders.length) {
    const candidates = commanderCandidates(mainNames);
    return {
      ok: false,
      errors: ['Which card is your commander? Pick it below.'],
      warnings: [],
      deckName: raw.name,
      commanderCandidates: candidates,
    };
  }

  const check = checkDeck(commanders, mainNames, { art });
  for (const n of notFound) check.errors.unshift(`Scryfall doesn't know a card named "${n}".`);
  check.ok = check.errors.length === 0;
  return { ...check, deckName: raw.name ?? `${commanders.join(' & ')} deck`, commanderCandidates: commanderCandidates(mainNames.concat(commanders)) };
}
