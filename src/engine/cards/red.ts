import type { CardDef } from '../cardtypes';
import { getKeywords, getPlayer } from '../state';
import { creature, dmg, enchantment, instant, sorcery, T } from './helpers';

export const RED: CardDef[] = [
  instant('Lightning Bolt', '{R}', 'Lightning Bolt deals 3 damage to any target.', { targets: [T.any()], effect: dmg(3) }),
  instant('Shock', '{R}', 'Shock deals 2 damage to any target.', { targets: [T.any()], effect: dmg(2) }),
  instant('Lightning Strike', '{1}{R}', 'Lightning Strike deals 3 damage to any target.', { targets: [T.any()], effect: dmg(3) }),
  instant('Searing Spear', '{1}{R}', 'Searing Spear deals 3 damage to any target.', { targets: [T.any()], effect: dmg(3) }),
  instant('Magma Jet', '{1}{R}', 'Magma Jet deals 2 damage to any target. Scry 2.', {
    targets: [T.any()],
    effect: (ctx) => {
      ctx.damage(ctx.targets[0], 2);
      ctx.scry(ctx.controller, 2);
    },
  }),
  sorcery('Blaze', '{X}{R}', 'Blaze deals X damage to any target.', { targets: [T.any()], effect: (ctx) => ctx.damage(ctx.targets[0], ctx.x) }),
  sorcery('Pyroclasm', '{1}{R}', 'Pyroclasm deals 2 damage to each creature.', {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.damage(c.id, 2)),
    ai: { value: -1 },
  }),
  instant('Shatter', '{1}{R}', 'Destroy target artifact.', {
    targets: [T.permanent('target artifact', { types: ['Artifact'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  sorcery('Act of Treason', '{2}{R}', 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.', {
    targets: [T.creature()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      ctx.gainControlUntilEndOfTurn(c);
      ctx.untap(c);
      ctx.pump(c, 0, 0, ['Haste']);
    },
  }),
  sorcery("Krenko's Command", '{1}{R}', 'Create two 1/1 red Goblin creature tokens.', { effect: (ctx) => ctx.createToken(ctx.controller, 'Goblin Token', 2) }),
  sorcery('Hordeling Outburst', '{1}{R}{R}', 'Create three 1/1 red Goblin creature tokens.', { effect: (ctx) => ctx.createToken(ctx.controller, 'Goblin Token', 3) }),
  sorcery('Wheel of Fortune', '{2}{R}', 'Each player discards their hand, then draws seven cards.', {
    effect: (ctx) => {
      for (const p of ctx.players()) for (const id of [...getPlayer(ctx.state, p).hand]) ctx.moveCard(id, 'graveyard');
      for (const p of ctx.players()) ctx.draw(p, 7);
    },
  }),
  creature('Monastery Swiftspear', '{R}', ['Human', 'Monk'], 1, 2, { keywords: ['Haste', 'Prowess'], text: 'Haste\nProwess' }),
  creature('Raging Goblin', '{R}', ['Goblin', 'Berserker'], 1, 1, { keywords: ['Haste'], text: 'Haste' }),
  creature('Young Pyromancer', '{1}{R}', ['Human', 'Shaman'], 2, 1, {
    text: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
    triggers: [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'], text: 'Create a 1/1 red Elemental token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Elemental Token') }],
  }),
  creature('Guttersnipe', '{2}{R}', ['Goblin', 'Shaman'], 2, 2, {
    text: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.',
    triggers: [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'], text: 'Deal 2 damage to each opponent.', effect: (ctx) => ctx.opponents().forEach((p) => ctx.damage(p, 2)) }],
  }),
  creature('Shivan Dragon', '{4}{R}{R}', ['Dragon'], 5, 5, {
    keywords: ['Flying'],
    text: 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.',
    abilities: [{ text: '{R}: +1/+0 until end of turn.', cost: { mana: '{R}' }, effect: (ctx) => ctx.pump(ctx.self, 1, 0), aiValue: 0 }],
  }),
  creature('Furnace Whelp', '{2}{R}{R}', ['Dragon'], 2, 2, {
    keywords: ['Flying'],
    text: 'Flying\n{R}: Furnace Whelp gets +1/+0 until end of turn.',
    abilities: [{ text: '{R}: +1/+0 until end of turn.', cost: { mana: '{R}' }, effect: (ctx) => ctx.pump(ctx.self, 1, 0), aiValue: 0 }],
  }),
  enchantment('Goblin Bombardment', '{1}{R}', 'Sacrifice a creature: Goblin Bombardment deals 1 damage to any target.', {
    abilities: [{ text: 'Sacrifice a creature: Deal 1 damage to any target.', cost: { sacrifice: { types: ['Creature'] } }, targets: [T.any()], effect: dmg(1), aiValue: 0 }],
  }),
  creature('Hellrider', '{2}{R}{R}', ['Devil'], 3, 3, {
    keywords: ['Haste'],
    text: "Haste\nWhenever a creature you control attacks, Hellrider deals 1 damage to the player it's attacking.",
    triggers: [
      {
        on: 'creatureYouControlAttacks',
        text: 'Deal 1 damage to the defending player.',
        effect: (ctx) => {
          if (ctx.event?.t === 'attacks') ctx.damage(ctx.event.defender, 1);
        },
      },
    ],
  }),
  creature('Goblin Instigator', '{1}{R}', ['Goblin', 'Rogue'], 1, 1, {
    text: 'When Goblin Instigator enters, create a 1/1 red Goblin creature token.',
    triggers: [{ on: 'etb', text: 'Create a 1/1 red Goblin token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Goblin Token') }],
  }),
  creature('Goblin Chieftain', '{1}{R}{R}', ['Goblin'], 2, 2, {
    keywords: ['Haste'],
    text: 'Haste\nOther Goblin creatures you control get +1/+1 and have haste.',
    statics: [{ kind: 'anthem', filter: { types: ['Creature'], subtypes: ['Goblin'], controller: 'you', other: true }, power: 1, toughness: 1, keywords: ['Haste'] }],
  }),
  creature('Goblin Matron', '{2}{R}', ['Goblin'], 1, 1, {
    text: 'When Goblin Matron enters, you may search your library for a Goblin card, reveal it, put it into your hand, then shuffle.',
    triggers: [{ on: 'etb', text: 'Search for a Goblin card.', effect: (ctx) => ctx.search({ filter: { subtypes: ['Goblin'] }, max: 1, dest: 'hand', label: 'Search for a Goblin card' }) }],
  }),
  creature('Thundermaw Hellkite', '{3}{R}{R}', ['Dragon'], 5, 5, {
    keywords: ['Flying', 'Haste'],
    text: 'Flying, haste\nWhen Thundermaw Hellkite enters, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.',
    triggers: [
      {
        on: 'etb',
        text: 'Deal 1 damage to and tap each flier your opponents control.',
        effect: (ctx) => {
          const fliers = ctx.creatures({ controller: 'opponent' }).filter((c) => getKeywords(ctx.state, c).includes('Flying'));
          fliers.forEach((c) => ctx.damage(c.id, 1));
          fliers.forEach((c) => ctx.tap(c));
        },
      },
    ],
  }),
  creature('Ember Hauler', '{R}{R}', ['Goblin'], 2, 2, {
    text: '{1}, Sacrifice Ember Hauler: It deals 2 damage to any target.',
    abilities: [{ text: '{1}, Sacrifice: Deal 2 damage to any target.', cost: { mana: '{1}', sacrificeSelf: true }, targets: [T.any()], effect: dmg(2), aiValue: 0 }],
  }),
  creature('Flametongue Kavu', '{3}{R}', ['Kavu'], 4, 2, {
    text: 'When Flametongue Kavu enters, it deals 4 damage to target creature.',
    triggers: [{ on: 'etb', text: 'Deal 4 damage to target creature.', targets: [T.creature()], effect: dmg(4) }],
  }),
  creature('Fire Imp', '{2}{R}', ['Imp'], 2, 1, {
    text: 'When Fire Imp enters, it deals 2 damage to target creature.',
    triggers: [{ on: 'etb', text: 'Deal 2 damage to target creature.', targets: [T.creature()], effect: dmg(2) }],
  }),
];
