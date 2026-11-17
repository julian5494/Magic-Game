import type { ActivatedAbility, CardDef, CardFilter, Ctx, ManaAbilityDef, TargetSpec } from '../cardtypes';
import type { ManaSym } from '../types';

export function creature(
  name: string,
  cost: string,
  subtypes: string[],
  power: number,
  toughness: number,
  opts: Partial<CardDef> = {},
): CardDef {
  return { name, cost, types: ['Creature'], subtypes, power, toughness, ...opts };
}

export function legend(
  name: string,
  cost: string,
  subtypes: string[],
  power: number,
  toughness: number,
  opts: Partial<CardDef> = {},
): CardDef {
  return { ...creature(name, cost, subtypes, power, toughness, opts), supertypes: ['Legendary'] };
}

export function instant(name: string, cost: string, text: string, opts: Partial<CardDef> = {}): CardDef {
  return { name, cost, types: ['Instant'], text, ...opts };
}

export function sorcery(name: string, cost: string, text: string, opts: Partial<CardDef> = {}): CardDef {
  return { name, cost, types: ['Sorcery'], text, ...opts };
}

export function enchantment(name: string, cost: string, text: string, opts: Partial<CardDef> = {}): CardDef {
  return { name, cost, types: ['Enchantment'], text, ...opts };
}

export function artifact(name: string, cost: string, text: string, opts: Partial<CardDef> = {}): CardDef {
  return { name, cost, types: ['Artifact'], text, ...opts };
}

export function manaAbility(colors: ManaAbilityDef['colors'], amount = 1, extra: Partial<ActivatedAbility> = {}): ActivatedAbility {
  const label =
    colors === 'any'
      ? 'one mana of any color'
      : colors === 'identity'
        ? "one mana of any color in your commander's color identity"
        : colors.map((c) => `{${c}}`.repeat(amount)).join(' or ');
  return { text: `{T}: Add ${label}.`, cost: { tap: true }, mana: { colors, amount }, ...extra };
}

export function land(name: string, colors: ManaSym[], opts: Partial<CardDef> = {}): CardDef {
  return {
    name,
    types: ['Land'],
    text: opts.text ?? (colors.length ? `{T}: Add ${colors.map((c) => `{${c}}`).join(' or ')}.` : ''),
    abilities: colors.length ? [manaAbility(colors)] : [],
    identity: colors.filter((c) => c !== 'C') as any,
    ...opts,
  };
}

export const T = {
  creature: (label = 'target creature', filter?: CardFilter, extra: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'creature', label, filter, ...extra }),
  oppCreature: (label = 'target creature an opponent controls'): TargetSpec => ({ kind: 'creature', label, filter: { controller: 'opponent' } }),
  yourCreature: (label = 'target creature you control'): TargetSpec => ({ kind: 'creature', label, filter: { controller: 'you' }, bias: 'self' }),
  permanent: (label = 'target permanent', filter?: CardFilter, extra: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'permanent', label, filter, ...extra }),
  any: (label = 'any target'): TargetSpec => ({ kind: 'any', label }),
  player: (label = 'target player', bias: 'opponent' | 'self' = 'opponent'): TargetSpec => ({ kind: 'player', label, bias }),
  opponent: (label = 'target opponent'): TargetSpec => ({ kind: 'opponent', label }),
  spell: (label = 'target spell', extra: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'spell', label, ...extra }),
  yourGraveyard: (label: string, filter?: CardFilter): TargetSpec => ({ kind: 'graveyardCard', graveyard: 'yours', label, filter, bias: 'self' }),
  anyGraveyard: (label: string, filter?: CardFilter): TargetSpec => ({ kind: 'graveyardCard', graveyard: 'any', label, filter, bias: 'self' }),
};

export const basicLandFilter: CardFilter = { basicLand: true };

/** Effect helper: deal damage to target 0. */
export const dmg = (n: number) => (ctx: Ctx) => ctx.damage(ctx.targets[0], n);

export function sacrificeAnotherCreature(): CardFilter {
  return { types: ['Creature'], other: true };
}
