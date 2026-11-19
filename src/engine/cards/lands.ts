import type { CardDef } from '../cardtypes';
import type { Color } from '../types';
import { basicLandFilter, land, manaAbility, T } from './helpers';

const basic = (name: string, color: Color): CardDef =>
  land(name, [color], { supertypes: ['Basic'], subtypes: [name], text: `({T}: Add {${color}}.)` });

const fetchLand = (name: string): CardDef =>
  land(name, [], {
    text: '{T}, Sacrifice: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    abilities: [
      {
        text: '{T}, Sacrifice: Search for a basic land and put it onto the battlefield tapped.',
        cost: { tap: true, sacrificeSelf: true },
        effect: (ctx) => ctx.search({ filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'Search for a basic land' }),
        aiValue: 3,
      },
    ],
  });

const gate = (name: string, a: Color, b: Color): CardDef =>
  land(name, [a, b], { subtypes: ['Gate'], entersTapped: true, text: `${name} enters tapped.\n{T}: Add {${a}} or {${b}}.` });

const temple = (name: string, a: Color, b: Color): CardDef =>
  land(name, [a, b], {
    entersTapped: true,
    text: `${name} enters tapped.\nWhen ${name} enters, scry 1.\n{T}: Add {${a}} or {${b}}.`,
    triggers: [{ on: 'etb', text: 'Scry 1.', effect: (ctx) => ctx.scry(ctx.controller, 1) }],
  });

export const LANDS: CardDef[] = [
  basic('Plains', 'W'),
  basic('Island', 'U'),
  basic('Swamp', 'B'),
  basic('Mountain', 'R'),
  basic('Forest', 'G'),
  land('Command Tower', [], {
    text: "{T}: Add one mana of any color in your commander's color identity.",
    abilities: [manaAbility('identity')],
  }),
  fetchLand('Evolving Wilds'),
  fetchLand('Terramorphic Expanse'),
  gate('Selesnya Guildgate', 'G', 'W'),
  gate('Izzet Guildgate', 'U', 'R'),
  gate('Golgari Guildgate', 'B', 'G'),
  gate('Boros Guildgate', 'R', 'W'),
  gate('Azorius Guildgate', 'W', 'U'),
  gate('Dimir Guildgate', 'U', 'B'),
  gate('Rakdos Guildgate', 'B', 'R'),
  gate('Gruul Guildgate', 'R', 'G'),
  gate('Simic Guildgate', 'G', 'U'),
  gate('Orzhov Guildgate', 'W', 'B'),
  temple('Temple of Plenty', 'G', 'W'),
  temple('Temple of Epiphany', 'U', 'R'),
  temple('Temple of Malady', 'B', 'G'),
  temple('Temple of Triumph', 'R', 'W'),
  temple('Temple of Malice', 'B', 'R'),
  temple('Temple of Mystery', 'G', 'U'),
  temple('Temple of Enlightenment', 'W', 'U'),
  temple('Temple of Silence', 'W', 'B'),
  land('Reliquary Tower', ['C'], { text: 'You have no maximum hand size.\n{T}: Add {C}.', statics: [{ kind: 'noMaxHandSize' }] }),
  land("Rogue's Passage", ['C'], {
    text: "{T}: Add {C}.\n{4}, {T}: Target creature can't be blocked this turn.",
    abilities: [
      manaAbility(['C']),
      {
        text: "{4}, {T}: Target creature can't be blocked this turn.",
        cost: { mana: '{4}', tap: true },
        targets: [T.creature('target creature', undefined, { bias: 'self' })],
        effect: (ctx) => ctx.pump(ctx.card(0), 0, 0, ['Unblockable']),
        aiValue: 0,
      },
    ],
  }),
];
