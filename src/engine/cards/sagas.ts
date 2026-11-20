// Sagas whose chapters grant abilities to the Saga itself.
import type { CardDef } from '../cardtypes';
import { getDef } from '../registry';
import { battlefieldCards, hasType } from '../state';

const manaCostIs = (cost: string | undefined, allowed: string[]) => allowed.includes(cost ?? '');

export const SAGAS: CardDef[] = [
  {
    name: 'Construct Token',
    types: ['Artifact', 'Creature'],
    subtypes: ['Construct'],
    colors: [],
    power: 0,
    toughness: 0,
    token: true,
    text: 'This token gets +1/+1 for each artifact you control.',
    dynamicPT: (state, self) => {
      const n = battlefieldCards(state).filter((c) => c.controller === self.controller && hasType(c, 'Artifact')).length;
      return { power: n, toughness: n };
    },
  },
  {
    name: "Urza's Saga",
    types: ['Enchantment', 'Land'],
    subtypes: ["Urza's", 'Saga'],
    colors: [],
    sagaChapters: 3,
    text:
      '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains "{T}: Add {C}."\nII — This Saga gains "{2}, {T}: Create a 0/0 colorless Construct artifact creature token with \'This token gets +1/+1 for each artifact you control.\'"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.',
    abilities: [
      { text: '{T}: Add {C}.', cost: { tap: true }, mana: { colors: ['C'] }, condition: (_s, c) => (c.counters.lore ?? 0) >= 1 },
      {
        text: '{2}, {T}: Create a 0/0 Construct token with "+1/+1 for each artifact you control."',
        cost: { mana: '{2}', tap: true },
        condition: (_s, c) => (c.counters.lore ?? 0) >= 2,
        effect: (ctx) => void ctx.createToken(ctx.controller, 'Construct Token'),
        aiValue: 2,
      },
    ],
    triggers: [
      {
        on: 'chapter',
        text: 'III — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.',
        condition: (_s, e) => e.t === 'lore' && e.n === 3,
        effect: (ctx) =>
          ctx.search({
            filter: { types: ['Artifact'], custom: (_st, c) => manaCostIs(getDef(c.def).cost, ['{0}', '{1}']) },
            max: 1,
            dest: 'battlefield',
            label: 'Search for an artifact card with mana cost {0} or {1}',
          }),
      },
    ],
  },
];
