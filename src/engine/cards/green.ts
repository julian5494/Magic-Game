import type { CardDef } from '../cardtypes';
import { getPT } from '../state';
import { basicLandFilter, creature, enchantment, instant, manaAbility, sorcery, T } from './helpers';

const forest = { types: ['Land' as const], subtypes: ['Forest'] };

export const GREEN: CardDef[] = [
  creature('Llanowar Elves', '{G}', ['Elf', 'Druid'], 1, 1, { text: '{T}: Add {G}.', abilities: [manaAbility(['G'])] }),
  creature('Elvish Mystic', '{G}', ['Elf', 'Druid'], 1, 1, { text: '{T}: Add {G}.', abilities: [manaAbility(['G'])] }),
  creature('Birds of Paradise', '{G}', ['Bird'], 0, 1, {
    keywords: ['Flying'],
    text: 'Flying\n{T}: Add one mana of any color.',
    abilities: [manaAbility('any')],
  }),
  creature('Llanowar Visionary', '{2}{G}', ['Elf', 'Druid'], 2, 2, {
    text: 'When Llanowar Visionary enters, draw a card.\n{T}: Add {G}.',
    abilities: [manaAbility(['G'])],
    triggers: [{ on: 'etb', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  sorcery('Rampant Growth', '{1}{G}', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'Search for a basic land' }),
  }),
  sorcery('Cultivate', '{2}{G}', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 2, dest: 'battlefield', split: true, label: 'Search for up to two basic lands' }),
  }),
  sorcery("Kodama's Reach", '{2}{G}', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', {
    subtypes: ['Arcane'],
    effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 2, dest: 'battlefield', split: true, label: 'Search for up to two basic lands' }),
  }),
  sorcery('Explosive Vegetation', '{3}{G}', 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 2, dest: 'battlefield', tapped: true, label: 'Search for up to two basic lands' }),
  }),
  sorcery("Nature's Lore", '{1}{G}', 'Search your library for a Forest card, put that card onto the battlefield, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: forest, max: 1, dest: 'battlefield', label: 'Search for a Forest' }),
  }),
  sorcery('Three Visits', '{1}{G}', 'Search your library for a Forest card, put that card onto the battlefield, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: forest, max: 1, dest: 'battlefield', label: 'Search for a Forest' }),
  }),
  sorcery('Harmonize', '{2}{G}{G}', 'Draw three cards.', { effect: (ctx) => ctx.draw(ctx.controller, 3) }),
  instant('Giant Growth', '{G}', 'Target creature gets +3/+3 until end of turn.', {
    targets: [T.creature('target creature', undefined, { bias: 'self' })],
    effect: (ctx) => ctx.pump(ctx.card(0), 3, 3),
    ai: { holdForInstant: true },
  }),
  instant('Beast Within', '{2}{G}', 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.', {
    targets: [T.permanent()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const ctl = c.controller;
      ctx.destroy(c);
      ctx.createToken(ctl, 'Beast Token');
    },
  }),
  instant('Naturalize', '{1}{G}', 'Destroy target artifact or enchantment.', {
    targets: [T.permanent('target artifact or enchantment', { types: ['Artifact', 'Enchantment'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  creature('Craterhoof Behemoth', '{5}{G}{G}{G}', ['Beast'], 5, 5, {
    keywords: ['Haste'],
    text: 'Haste\nWhen Craterhoof Behemoth enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.',
    triggers: [
      {
        on: 'etb',
        text: 'Creatures you control gain trample and get +X/+X.',
        effect: (ctx) => {
          const cs = ctx.creatures({ controller: 'you' });
          cs.forEach((c) => ctx.pump(c, cs.length, cs.length, ['Trample']));
        },
      },
    ],
  }),
  creature('Eternal Witness', '{1}{G}{G}', ['Human', 'Shaman'], 2, 1, {
    text: 'When Eternal Witness enters, return target card from your graveyard to your hand.',
    triggers: [
      {
        on: 'etb',
        text: 'Return target card from your graveyard to your hand.',
        targets: [T.yourGraveyard('target card in your graveyard')],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) ctx.moveCard(c.id, 'hand');
        },
      },
    ],
  }),
  creature('Wood Elves', '{2}{G}', ['Elf', 'Scout'], 1, 1, {
    text: 'When Wood Elves enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.',
    triggers: [{ on: 'etb', text: 'Search for a Forest.', effect: (ctx) => ctx.search({ filter: forest, max: 1, dest: 'battlefield', label: 'Search for a Forest' }) }],
  }),
  creature('Elvish Visionary', '{1}{G}', ['Elf', 'Shaman'], 1, 1, {
    text: 'When Elvish Visionary enters, draw a card.',
    triggers: [{ on: 'etb', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  creature('Grizzly Bears', '{1}{G}', ['Bear'], 2, 2),
  creature('Centaur Courser', '{2}{G}', ['Centaur', 'Warrior'], 3, 3),
  creature('Leatherback Baloth', '{G}{G}{G}', ['Beast'], 4, 5),
  creature("Garruk's Packleader", '{4}{G}', ['Beast'], 4, 4, {
    text: 'Whenever another creature with power 3 or greater you control enters, you may draw a card.',
    triggers: [
      {
        on: 'otherCreatureEtbYours',
        optional: true,
        condition: (s, e) => e.t === 'etb' && !!s.cards[e.card] && getPT(s, s.cards[e.card]).power >= 3,
        text: 'Draw a card.',
        effect: (ctx) => ctx.draw(ctx.controller, 1),
      },
    ],
  }),
  creature('Beast Whisperer', '{2}{G}{G}', ['Elf', 'Druid'], 2, 3, {
    text: 'Whenever you cast a creature spell, draw a card.',
    triggers: [{ on: 'youCast', spellTypes: ['Creature'], text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  creature('Craw Wurm', '{4}{G}{G}', ['Wurm'], 6, 4),
  creature('Thragtusk', '{4}{G}', ['Beast'], 5, 3, {
    text: 'When Thragtusk enters, you gain 5 life.\nWhen Thragtusk leaves the battlefield, create a 3/3 green Beast creature token.',
    triggers: [
      { on: 'etb', text: 'You gain 5 life.', effect: (ctx) => ctx.gainLife(ctx.controller, 5) },
      { on: 'leaves', text: 'Create a 3/3 green Beast token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Beast Token') },
    ],
  }),
  creature('Pelakka Wurm', '{4}{G}{G}{G}', ['Wurm'], 7, 7, {
    keywords: ['Trample'],
    text: 'Trample\nWhen Pelakka Wurm enters, you gain 7 life.\nWhen Pelakka Wurm dies, draw a card.',
    triggers: [
      { on: 'etb', text: 'You gain 7 life.', effect: (ctx) => ctx.gainLife(ctx.controller, 7) },
      { on: 'dies', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) },
    ],
  }),
  sorcery('Overrun', '{2}{G}{G}{G}', 'Creatures you control get +3/+3 and gain trample until end of turn.', {
    effect: (ctx) => ctx.creatures({ controller: 'you' }).forEach((c) => ctx.pump(c, 3, 3, ['Trample'])),
  }),
  sorcery('Prey Upon', '{G}', "Target creature you control fights target creature you don't control.", {
    targets: [T.yourCreature(), T.oppCreature("target creature you don't control")],
    effect: (ctx) => ctx.fight(ctx.card(0), ctx.card(1)),
  }),
  enchantment('Rancor', '{G}', "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.", {
    subtypes: ['Aura'],
    targets: [T.creature('creature to enchant', undefined, { bias: 'self' })],
    statics: [{ kind: 'attached', power: 2, toughness: 0, keywords: ['Trample'] }],
    triggers: [
      {
        on: 'toGraveyardFromBattlefield',
        text: "Return Rancor to its owner's hand.",
        effect: (ctx) => {
          const c = ctx.state.cards[ctx.source];
          if (c && c.zone === 'graveyard') ctx.moveCard(c.id, 'hand');
        },
      },
    ],
  }),
  creature('Avenger of Zendikar', '{5}{G}{G}', ['Elemental'], 5, 5, {
    text: 'When Avenger of Zendikar enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    triggers: [
      {
        on: 'etb',
        text: 'Create a 0/1 Plant token for each land you control.',
        effect: (ctx) => ctx.createToken(ctx.controller, 'Plant Token', ctx.permanents({ controller: 'you', types: ['Land'] }).length),
      },
      {
        on: 'landfall',
        optional: true,
        text: 'Put a +1/+1 counter on each Plant you control.',
        effect: (ctx) => ctx.creatures({ controller: 'you', subtypes: ['Plant'] }).forEach((c) => ctx.addCounters(c, '+1/+1', 1)),
      },
    ],
  }),
  creature('Sakura-Tribe Elder', '{1}{G}', ['Snake', 'Shaman'], 1, 1, {
    text: 'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    abilities: [
      {
        text: 'Sacrifice: Search for a basic land and put it onto the battlefield tapped.',
        cost: { sacrificeSelf: true },
        effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'Search for a basic land' }),
        aiValue: 1,
      },
    ],
  }),
  creature('Acidic Slime', '{3}{G}{G}', ['Ooze'], 2, 2, {
    keywords: ['Deathtouch'],
    text: 'Deathtouch\nWhen Acidic Slime enters, destroy target artifact, enchantment, or land.',
    triggers: [
      {
        on: 'etb',
        text: 'Destroy target artifact, enchantment, or land.',
        targets: [T.permanent('target artifact, enchantment, or land', { types: ['Artifact', 'Enchantment', 'Land'] })],
        effect: (ctx) => ctx.destroy(ctx.card(0)),
      },
    ],
  }),
];
