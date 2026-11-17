import type { CardDef } from './cardtypes';

const DB = new Map<string, CardDef>();

function normalize(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
const byLower = new Map<string, CardDef>();

export function registerCards(defs: CardDef[]): void {
  for (const d of defs) {
    if (DB.has(d.name)) throw new Error(`Duplicate card definition: ${d.name}`);
    const def: CardDef = { ...d, abilities: [...(d.abilities ?? [])] };
    if (def.equip !== undefined) {
      def.abilities!.push({
        text: `Equip ${def.equip}`,
        cost: { mana: def.equip },
        equip: true,
        sorcerySpeed: true,
        targets: [{ kind: 'creature', filter: { controller: 'you' }, label: 'creature to equip', bias: 'self' }],
        effect: (ctx) => {
          const t = ctx.card(0);
          if (t && ctx.self) ctx.self.attachedTo = t.id;
        },
        aiValue: 2,
      });
    }
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
