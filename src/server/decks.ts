import { checkDeck, commanderCandidates, type DeckCheck } from '../engine/deck';
import { findDef } from '../engine/registry';
import type { CardLook, FoilKind } from '../engine/types';
import { loadCards, type PrintingInfo } from './carddb';
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
  const printings: Record<string, CardLook[]> = {};
  const canonical = (e: DeckEntry) => found.get(e.name)?.def.name;
  for (const e of raw.entries) {
    const key = e.set && e.cn ? `${e.set.toLowerCase()}:${e.cn}` : '';
    const f = found.get(`${e.name}|${key}`) ?? found.get(e.name);
    if (!f) continue;
    if (f.image && !art[f.def.name]) art[f.def.name] = f.image;
    const look = lookOf(f.image, f.printing, e.finish);
    for (let i = 0; i < e.count; i++) (printings[f.def.name] ??= []).push(look);
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

  const check = checkDeck(commanders, mainNames, { art, printings });
  for (const n of notFound) check.errors.unshift(`Scryfall doesn't know a card named "${n}".`);
  check.ok = check.errors.length === 0;
  return { ...check, deckName: raw.name ?? `${commanders.join(' & ')} deck`, commanderCandidates: commanderCandidates(mainNames.concat(commanders)) };
}

const PROMO_FOILS: Record<string, FoilKind> = {
  galaxyfoil: 'galaxy',
  surgefoil: 'surge',
  halofoil: 'halo',
  confettifoil: 'confetti',
  textured: 'textured',
  oilslick: 'oilslick',
  gilded: 'gilded',
  doublerainbow: 'rainbow',
  fracturefoil: 'fracture',
  ripplefoil: 'ripple',
  raisedfoil: 'raised',
  neonink: 'neon',
};

/** How one copy looks: its finish (from the list, or the only finish it was printed in) and its frame treatments. */
export function lookOf(image: string | undefined, info: PrintingInfo | undefined, finish: 'foil' | 'etched' | undefined): CardLook {
  const finishes = info?.finishes ?? [];
  const only = finishes.length === 1 && finishes[0] !== 'nonfoil' ? (finishes[0] as 'foil' | 'etched' | 'glossy') : undefined;
  const want = finish ?? (only === 'glossy' ? undefined : only);
  let foil: FoilKind | undefined;
  if (want === 'etched') foil = 'etched';
  else if (want === 'foil') foil = (info?.promo_types ?? []).map((p) => PROMO_FOILS[p]).find(Boolean) ?? 'foil';
  const fx = info?.frame_effects ?? [];
  const promos = info?.promo_types ?? [];
  const treatments: string[] = [];
  if (fx.includes('showcase')) treatments.push('Showcase');
  if (info?.border_color === 'borderless') treatments.push('Borderless');
  if (fx.includes('extendedart')) treatments.push('Extended art');
  if (info?.full_art) treatments.push('Full art');
  if (info?.frame === '1993' || info?.frame === '1997') treatments.push('Retro frame');
  if (fx.includes('inverted')) treatments.push('Inverted');
  if (info?.textless) treatments.push('Textless');
  if (promos.includes('serialized')) treatments.push('Serialized');
  if (promos.includes('stepandcompleat')) treatments.push('Step-and-compleat');
  const look: CardLook = {};
  if (image) look.image = image;
  if (foil) look.foil = foil;
  if (treatments.length) look.treatments = treatments;
  return look;
}
