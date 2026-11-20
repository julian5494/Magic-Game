import type { CardDef } from '../cardtypes';
import { artifact, basicLandFilter, manaAbility, T } from './helpers';

export const COLORLESS: CardDef[] = [
  artifact('Sol Ring', '{1}', '{T}: Add {C}{C}.', { abilities: [manaAbility(['C'], 2)] }),
  artifact('Arcane Signet', '{2}', "{T}: Add one mana of any color in your commander's color identity.", { abilities: [manaAbility('identity')] }),
  artifact('Mind Stone', '{2}', '{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.', {
    abilities: [
      manaAbility(['C']),
      { text: '{1}, {T}, Sacrifice: Draw a card.', cost: { mana: '{1}', tap: true, sacrificeSelf: true }, effect: (ctx) => ctx.draw(ctx.controller, 1), aiValue: 0 },
    ],
  }),
  artifact("Commander's Sphere", '{3}', "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.", {
    abilities: [
      manaAbility('identity'),
      { text: 'Sacrifice: Draw a card.', cost: { sacrificeSelf: true }, effect: (ctx) => ctx.draw(ctx.controller, 1), aiValue: 0 },
    ],
  }),
  artifact('Thought Vessel', '{2}', 'You have no maximum hand size.\n{T}: Add {C}.', { statics: [{ kind: 'noMaxHandSize' }], abilities: [manaAbility(['C'])] }),
  artifact('Hedron Archive', '{4}', '{T}: Add {C}{C}.\n{2}, {T}, Sacrifice Hedron Archive: Draw two cards.', {
    abilities: [
      manaAbility(['C'], 2),
      { text: '{2}, {T}, Sacrifice: Draw two cards.', cost: { mana: '{2}', tap: true, sacrificeSelf: true }, effect: (ctx) => ctx.draw(ctx.controller, 2), aiValue: 0 },
    ],
  }),
  artifact('Darksteel Ingot', '{3}', 'Indestructible\n{T}: Add one mana of any color.', { keywords: ['Indestructible'], abilities: [manaAbility('any')] }),
  artifact("Wayfarer's Bauble", '{1}', '{2}, {T}, Sacrifice: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Activate only as a sorcery.', {
    abilities: [
      {
        text: '{2}, {T}, Sacrifice: Search for a basic land and put it onto the battlefield tapped.',
        cost: { mana: '{2}', tap: true, sacrificeSelf: true },
        sorcerySpeed: true,
        effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'Search for a basic land' }),
        aiValue: 2,
      },
    ],
  }),
  {
    name: 'Burnished Hart',
    cost: '{3}',
    types: ['Artifact', 'Creature'],
    subtypes: ['Elk'],
    power: 2,
    toughness: 2,
    text: '{3}, Sacrifice Burnished Hart: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
    abilities: [
      {
        text: '{3}, Sacrifice: Search for up to two basic lands and put them onto the battlefield tapped.',
        cost: { mana: '{3}', sacrificeSelf: true },
        effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 2, dest: 'battlefield', tapped: true, label: 'Search for up to two basic lands' }),
        aiValue: 1,
      },
    ],
  },
  {
    name: 'Solemn Simulacrum',
    cost: '{4}',
    types: ['Artifact', 'Creature'],
    subtypes: ['Golem'],
    power: 2,
    toughness: 2,
    text: 'When Solemn Simulacrum enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.\nWhen Solemn Simulacrum dies, you may draw a card.',
    triggers: [
      { on: 'etb', text: 'Search for a basic land.', effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'You may search for a basic land' }) },
      { on: 'dies', optional: true, text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) },
    ],
  },
  {
    name: "Pilgrim's Eye",
    cost: '{3}',
    types: ['Artifact', 'Creature'],
    subtypes: ['Thopter'],
    power: 1,
    toughness: 1,
    keywords: ['Flying'],
    text: "Flying\nWhen Pilgrim's Eye enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
    triggers: [{ on: 'etb', text: 'Search for a basic land card.', effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'hand', label: 'You may search for a basic land card' }) }],
  },
  {
    name: 'Meteor Golem',
    cost: '{7}',
    types: ['Artifact', 'Creature'],
    subtypes: ['Golem'],
    power: 3,
    toughness: 3,
    text: 'When Meteor Golem enters, destroy target nonland permanent an opponent controls.',
    triggers: [
      {
        on: 'etb',
        text: 'Destroy target nonland permanent an opponent controls.',
        targets: [T.permanent('target nonland permanent an opponent controls', { nonland: true, controller: 'opponent' })],
        effect: (ctx) => ctx.destroy(ctx.card(0)),
      },
    ],
  },
  {
    name: 'Wurmcoil Engine',
    cost: '{6}',
    types: ['Artifact', 'Creature'],
    subtypes: ['Phyrexian', 'Wurm'],
    power: 6,
    toughness: 6,
    keywords: ['Deathtouch', 'Lifelink'],
    text: 'Deathtouch, lifelink\nWhen Wurmcoil Engine dies, create a 3/3 colorless Phyrexian Wurm artifact creature token with deathtouch and a 3/3 colorless Phyrexian Wurm artifact creature token with lifelink.',
    triggers: [
      {
        on: 'dies',
        text: 'Create two 3/3 Wurm tokens (one with deathtouch, one with lifelink).',
        effect: (ctx) => {
          ctx.createToken(ctx.controller, 'Deathtouch Wurm Token');
          ctx.createToken(ctx.controller, 'Lifelink Wurm Token');
        },
      },
    ],
  },
  artifact('Lightning Greaves', '{2}', 'Equipped creature has haste and shroud.\nEquip {0}', {
    subtypes: ['Equipment'],
    equip: '{0}',
    statics: [{ kind: 'attached', keywords: ['Haste', 'Shroud'] }],
  }),
  artifact('Swiftfoot Boots', '{2}', 'Equipped creature has hexproof and haste.\nEquip {1}', {
    subtypes: ['Equipment'],
    equip: '{1}',
    statics: [{ kind: 'attached', keywords: ['Hexproof', 'Haste'] }],
  }),
  artifact('Skullclamp', '{1}', 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}', {
    subtypes: ['Equipment'],
    equip: '{1}',
    statics: [{ kind: 'attached', power: 1, toughness: -1 }],
    triggers: [{ on: 'equippedCreatureDies', text: 'Draw two cards.', effect: (ctx) => ctx.draw(ctx.controller, 2) }],
  }),
  artifact('Bonesplitter', '{1}', 'Equipped creature gets +2/+0.\nEquip {1}', {
    subtypes: ['Equipment'],
    equip: '{1}',
    statics: [{ kind: 'attached', power: 2, toughness: 0 }],
  }),
];
