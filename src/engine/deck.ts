import type { CardDef } from './cardtypes';
import { findDef } from './registry';
import { colorIdentity } from './state';

export interface DeckList {
  /** One commander, or two with Partner / Friends forever / Background. */
  commanders: string[];
  cards: string[];
  /** Preferred card image per card name (the printing chosen in the imported list). */
  art?: Record<string, string>;
}

export interface Coverage {
  total: number;
  automated: number;
  partial: { name: string; missing: string[] }[];
  blocked: { name: string; missing: string[] }[];
}

export interface DeckCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  deck?: DeckList;
  coverage?: Coverage;
}

function isCommanderEligible(d: CardDef): boolean {
  if (d.canBeCommander) return true;
  return (d.supertypes ?? []).includes('Legendary') && d.types.includes('Creature');
}

function canPair(a: CardDef, b: CardDef): boolean {
  const pa = a.partner;
  const pb = b.partner;
  if (pa === 'partner' && pb === 'partner') return true;
  if (pa === 'friends' && pb === 'friends') return true;
  if (typeof pa === 'object' && pa.with === b.name) return true;
  if (typeof pb === 'object' && pb.with === a.name) return true;
  if ((pa === 'chooseBackground' && pb === 'background') || (pb === 'chooseBackground' && pa === 'background')) return true;
  return false;
}

export function commanderCandidates(names: string[]): string[] {
  return [...new Set(names)].filter((n) => {
    const d = findDef(n);
    return !!d && (isCommanderEligible(d) || d.partner === 'background');
  });
}

/** Validate a resolved deck. All names must already be registered. */
export function checkDeck(commanders: string[], cards: string[], opts: { art?: Record<string, string> } = {}): DeckCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cmdDefs: CardDef[] = [];
  if (commanders.length === 0) errors.push('Choose a commander.');
  if (commanders.length > 2) errors.push('A deck can have at most two commanders.');
  for (const c of commanders) {
    const d = findDef(c);
    if (!d) {
      errors.push(`Unknown commander: ${c}`);
      continue;
    }
    if (!isCommanderEligible(d) && !(commanders.length === 2 && d.partner === 'background')) {
      errors.push(`${d.name} can't be your commander (it isn't a legendary creature).`);
    }
    if (d.banned) errors.push(`${d.name} is banned as a commander.`);
    cmdDefs.push(d);
  }
  if (cmdDefs.length === 2 && !canPair(cmdDefs[0], cmdDefs[1])) {
    errors.push(`${cmdDefs[0].name} and ${cmdDefs[1].name} can't be used together (they need Partner, Friends forever, or a Background).`);
  }
  const identity = new Set(cmdDefs.flatMap((d) => colorIdentity(d)));
  const resolved: string[] = [];
  const counts = new Map<string, number>();
  for (const name of cards) {
    const def = findDef(name);
    if (!def) {
      errors.push(`Unknown card: ${name}`);
      continue;
    }
    resolved.push(def.name);
    counts.set(def.name, (counts.get(def.name) ?? 0) + 1);
  }
  for (const [name, n] of counts) {
    const def = findDef(name)!;
    if (def.token) errors.push(`${name} is a token, not a card.`);
    if (def.isBackFace) errors.push(`${name} is the back face of a double-faced card; list the front face instead.`);
    const basic = (def.supertypes ?? []).includes('Basic');
    const anyNumber = /any number of cards named/i.test(def.text ?? '');
    if (n > 1 && !basic && !anyNumber) errors.push(`Singleton: ${n} copies of ${name}.`);
    const outside = colorIdentity(def).filter((c) => !identity.has(c));
    if (cmdDefs.length && outside.length) errors.push(`${name} is outside your commander's color identity.`);
    if (def.banned) errors.push(`${name} is banned in Commander.`);
  }
  const total = resolved.length + commanders.length;
  if (total !== 100) errors.push(`Deck has ${total} cards including the commander${commanders.length > 1 ? 's' : ''}; Commander decks need exactly 100.`);

  const coverage: Coverage = { total: 0, automated: 0, partial: [], blocked: [] };
  for (const name of new Set([...cmdDefs.map((d) => d.name), ...resolved])) {
    const def = findDef(name);
    if (!def) continue;
    coverage.total++;
    const missing = def.unsupported ?? [];
    if (def.cannotCast) coverage.blocked.push({ name, missing });
    else if (missing.length) coverage.partial.push({ name, missing });
    else coverage.automated++;
  }
  if (coverage.blocked.length) {
    warnings.push(`${coverage.blocked.length} card(s) have rules the game can't enforce yet, so they can't be played: ${coverage.blocked.map((b) => b.name).join(', ')}.`);
  }
  if (coverage.partial.length) {
    warnings.push(`${coverage.partial.length} card(s) are playable but some of their abilities aren't automated yet (those abilities just won't happen).`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    deck: cmdDefs.length ? { commanders: cmdDefs.map((d) => d.name), cards: resolved, art: opts.art } : undefined,
    coverage,
  };
}

/** Parse "1 Card Name" text against already-registered cards (used for built-in cards and tests). */
export function parseDeckList(text: string): { commanders: string[]; entries: { count: number; name: string }[] } {
  const commanders: string[] = [];
  const entries: { count: number; name: string }[] = [];
  let inCommander = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const header = line.replace(/:$/, '').toLowerCase();
    if (header === 'commander' || header === 'commanders') {
      inCommander = true;
      continue;
    }
    if (['deck', 'mainboard', 'main', 'sideboard', 'maybeboard', 'lands', 'creatures', 'spells'].includes(header)) {
      inCommander = false;
      continue;
    }
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const count = m ? parseInt(m[1], 10) : 1;
    let name = (m ? m[2] : line).replace(/\s*\([A-Z0-9]{2,6}\)\s*[\w-]*\s*$/i, '').trim();
    const isCmdr = /\*cmdr\*/i.test(name);
    name = name.replace(/\*cmdr\*/i, '').trim();
    if (inCommander || isCmdr) commanders.push(name);
    else entries.push({ count, name });
  }
  if (!commanders.length && entries.length) {
    const first = findDef(entries[0].name);
    if (first && (first.supertypes ?? []).includes('Legendary') && first.types.includes('Creature')) {
      commanders.push(first.name);
      entries[0].count -= 1;
      if (entries[0].count <= 0) entries.shift();
    }
  }
  return { commanders, entries };
}

/** Validate decklist text using only cards the engine already knows. */
export function validateDeck(text: string): DeckCheck {
  const { commanders, entries } = parseDeckList(text);
  const unknown = [...commanders, ...entries.map((e) => e.name)].filter((n) => !findDef(n));
  if (unknown.length) return { ok: false, errors: unknown.map((n) => `Unsupported card: ${n}`), warnings: [] };
  return checkDeck(commanders, entries.flatMap((e) => Array(e.count).fill(e.name)));
}

export function deckToText(deck: DeckList): string {
  const counts = new Map<string, number>();
  for (const c of deck.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  return ['Commander', ...deck.commanders.map((c) => `1 ${c}`), '', 'Deck', ...[...counts].map(([n, c]) => `${c} ${n}`)].join('\n');
}
