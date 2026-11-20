import type { ActivatedAbility, CardDef, CardFilter } from './cardtypes';

/** "Equip {2}", "Equip legendary creature {3}": attach to target creature you control (matching `filter`). */
export function equipAbility(cost: string, filter: CardFilter = {}, label = ''): ActivatedAbility {
  return {
    text: `Equip ${label ? `${label} ` : ''}${cost}`,
    cost: { mana: cost },
    equip: true,
    sorcerySpeed: true,
    targets: [{ kind: 'creature', filter: { ...filter, controller: 'you' }, label: 'creature to equip', bias: 'self' }],
    effect: (ctx) => {
      const t = ctx.card(0);
      if (t && ctx.self) ctx.self.attachedTo = t.id;
    },
    aiValue: 2,
  };
}

const DB = new Map<string, CardDef>();

/** Abilities that effects grant to other permanents, by a fixed index (2000 + position) so the stack can refer to them. */
export const GRANTED_BASE = 2000;
export const GRANTED: ActivatedAbility[] = [
  // 0: Food (Ragost, Deft Gastronaut makes your artifacts Foods).
  { text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.', cost: { mana: '{2}', tap: true, sacrificeSelf: true }, effect: (ctx) => ctx.gainLife(ctx.controller, 3), aiValue: 0 },
];

/** An activated ability by index: the card's own, or a granted one (index >= GRANTED_BASE). */
export function abilityByIndex(def: CardDef, index: number): ActivatedAbility {
  return index >= GRANTED_BASE ? GRANTED[index - GRANTED_BASE] : def.abilities![index];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
const byLower = new Map<string, CardDef>();

export function registerCards(defs: CardDef[]): void {
  for (const d of defs) {
    if (DB.has(d.name)) throw new Error(`Duplicate card definition: ${d.name}`);
    const def: CardDef = { ...d, abilities: [...(d.abilities ?? [])] };
    if (def.equip !== undefined) def.abilities!.push(equipAbility(def.equip));
    DB.set(def.name, def);
    byLower.set(normalize(def.name), def);
  }
}

export function getDef(name: string): CardDef {
  const d = DB.get(name);
  if (!d) throw new Error(`Unknown card: ${name}`);
  return d;
}

export function findDef(name: string): CardDef | undefined {
  return DB.get(name) ?? byLower.get(normalize(name));
}

export function allDefs(): CardDef[] {
  return [...DB.values()];
}

/** Let a card be found by another name (eg. the full "Front // Back" name of a double-faced card). */
export function registerAlias(alias: string, name: string): void {
  const d = DB.get(name);
  if (d) byLower.set(normalize(alias), d);
}

/** Register a card converted from Scryfall unless a hand-scripted (or earlier) definition exists. */
export function registerGenerated(def: CardDef): CardDef {
  const existing = DB.get(def.name);
  if (existing) {
    if (!existing.image && def.image) existing.image = def.image;
    if (existing.banned === undefined) existing.banned = def.banned;
    return existing;
  }
  registerCards([def]);
  return DB.get(def.name)!;
}

export function normalizeName(name: string): string {
  return normalize(name);
}
