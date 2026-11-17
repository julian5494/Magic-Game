import { findDef } from './registry';
import { colorIdentity } from './state';

export interface DeckList {
  commander: string;
  cards: string[];
}

export interface DeckCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  deck?: DeckList;
}

/**
 * Parse a decklist in the common "1 Card Name" format.
 * The commander is taken from a "Commander" section header, a "*CMDR*" marker, or the first line.
 */
export function parseDeckList(text: string): { commander: string | null; entries: { count: number; name: string }[] } {
  let commander: string | null = null;
  const entries: { count: number; name: string }[] = [];
  let inCommander = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const header = line.replace(/:$/, '').toLowerCase();
    if (header === 'commander') {
      inCommander = true;
      continue;
    }
    if (['deck', 'mainboard', 'main', 'sideboard', 'maybeboard', 'lands', 'creatures', 'spells'].includes(header)) {
      inCommander = false;
      continue;
    }
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    let count = 1;
    let name = line;
    if (m) {
      count = parseInt(m[1], 10);
      name = m[2];
    }
    // Strip set codes / collector numbers like "(CMR) 123" and markers.
    let isCmdr = false;
    if (/\*cmdr\*/i.test(name)) {
      isCmdr = true;
      name = name.replace(/\*cmdr\*/i, '');
    }
    name = name.replace(/\s*\([A-Z0-9]{2,6}\)\s*[\w-]*\s*$/i, '').replace(/\s*\*[A-Z]\*\s*$/i, '').trim();
    if (inCommander || isCmdr) {
      commander = name;
      inCommander = false;
      continue;
    }
    entries.push({ count, name });
  }
  if (!commander && entries.length) {
    // Assume first card is the commander if it's legendary and there is no explicit section.
    const first = findDef(entries[0].name);
    if (first && (first.supertypes ?? []).includes('Legendary') && first.types.includes('Creature')) {
      commander = first.name;
      entries[0].count -= 1;
      if (entries[0].count <= 0) entries.shift();
    }
  }
  return { commander, entries };
}

export function validateDeck(text: string, opts: { allowSmall?: boolean } = {}): DeckCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { commander, entries } = parseDeckList(text);
  if (!commander) {
    return { ok: false, errors: ['No commander found. Add a "Commander" section or put your commander first.'], warnings };
  }
  const cmdDef = findDef(commander);
  if (!cmdDef) errors.push(`Unknown or unsupported commander: ${commander}`);
  else if (!(cmdDef.supertypes ?? []).includes('Legendary') || !cmdDef.types.includes('Creature')) {
    errors.push(`${cmdDef.name} is not a legendary creature.`);
  }
  const identity = new Set(cmdDef ? colorIdentity(cmdDef) : []);
  const cards: string[] = [];
  const counts = new Map<string, number>();
  for (const e of entries) {
    const def = findDef(e.name);
    if (!def) {
      errors.push(`Unsupported card: ${e.name}`);
      continue;
    }
    counts.set(def.name, (counts.get(def.name) ?? 0) + e.count);
    for (let i = 0; i < e.count; i++) cards.push(def.name);
    const outside = colorIdentity(def).filter((c) => !identity.has(c));
    if (cmdDef && outside.length) errors.push(`${def.name} is outside your commander's color identity.`);
    if (def.token) errors.push(`${def.name} is a token.`);
  }
  for (const [name, n] of counts) {
    const def = findDef(name)!;
    const basic = (def.supertypes ?? []).includes('Basic');
    if (n > 1 && !basic) errors.push(`Singleton: ${n} copies of ${name}.`);
  }
  const total = cards.length + 1;
  if (total !== 100) {
    if (opts.allowSmall && total >= 40) warnings.push(`Deck has ${total} cards (Commander requires exactly 100).`);
    else errors.push(`Deck has ${total} cards including the commander; Commander decks need exactly 100.`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    deck: cmdDef ? { commander: cmdDef.name, cards } : undefined,
  };
}

export function deckToText(deck: DeckList): string {
  const counts = new Map<string, number>();
  for (const c of deck.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  return ['Commander', `1 ${deck.commander}`, '', 'Deck', ...[...counts].map(([n, c]) => `${c} ${n}`)].join('\n');
}
