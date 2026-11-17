import type { CardDef } from '../cardtypes';
import { basicLandFilter, creature, enchantment, instant, sorcery, T } from './helpers';

export const WHITE: CardDef[] = [
  instant('Swords to Plowshares', '{W}', 'Exile target creature. Its controller gains life equal to its power.', {
    targets: [T.creature()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const p = ctx.power(c);
      const ctl = c.controller;
      ctx.exile(c);
      ctx.gainLife(ctl, p);
    },
  }),
  instant('Path to Exile', '{W}', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.', {
    targets: [T.creature()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const ctl = c.controller;
      ctx.exile(c);
      ctx.search({ player: ctl, filter: basicLandFilter, max: 1, dest: 'battlefield', tapped: true, label: 'You may search for a basic land (Path to Exile)' });
    },
  }),
  sorcery('Wrath of God', '{2}{W}{W}', "Destroy all creatures. They can't be regenerated.", {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.destroy(c)),
    ai: { value: -1 },
  }),
  sorcery('Day of Judgment', '{2}{W}{W}', 'Destroy all creatures.', {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.destroy(c)),
    ai: { value: -1 },
  }),
  instant('Disenchant', '{1}{W}', 'Destroy target artifact or enchantment.', {
    targets: [T.permanent('target artifact or enchantment', { types: ['Artifact', 'Enchantment'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  instant('Raise the Alarm', '{1}{W}', 'Create two 1/1 white Soldier creature tokens.', {
    effect: (ctx) => ctx.createToken(ctx.controller, 'Soldier Token', 2),
  }),
  creature('Serra Angel', '{3}{W}{W}', ['Angel'], 4, 4, { keywords: ['Flying', 'Vigilance'], text: 'Flying, vigilance' }),
  creature('Savannah Lions', '{W}', ['Cat'], 2, 1),
  creature('Elite Vanguard', '{W}', ['Human', 'Soldier'], 2, 1),
  creature('Soul Warden', '{W}', ['Human', 'Cleric'], 1, 1, {
    text: 'Whenever another creature enters, you gain 1 life.',
    triggers: [{ on: 'anyOtherCreatureEtb', text: 'You gain 1 life.', effect: (ctx) => ctx.gainLife(ctx.controller, 1) }],
  }),
  enchantment('Glorious Anthem', '{1}{W}{W}', 'Creatures you control get +1/+1.', {
    statics: [{ kind: 'anthem', filter: { types: ['Creature'], controller: 'you' }, power: 1, toughness: 1 }],
  }),
  instant('Inspired Charge', '{2}{W}{W}', 'Creatures you control get +2/+1 until end of turn.', {
    effect: (ctx) => ctx.creatures({ controller: 'you' }).forEach((c) => ctx.pump(c, 2, 1)),
    ai: { holdForInstant: true },
  }),
  creature('Baneslayer Angel', '{3}{W}{W}', ['Angel'], 5, 5, {
    keywords: ['Flying', 'First strike', 'Lifelink'],
    text: 'Flying, first strike, lifelink',
  }),
  creature('Attended Knight', '{2}{W}', ['Human', 'Knight'], 2, 2, {
    keywords: ['First strike'],
    text: 'First strike\nWhen Attended Knight enters, create a 1/1 white Soldier creature token.',
    triggers: [{ on: 'etb', text: 'Create a 1/1 white Soldier token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Soldier Token') }],
  }),
  instant('Midnight Haunting', '{2}{W}', 'Create two 1/1 white Spirit creature tokens with flying.', {
    effect: (ctx) => ctx.createToken(ctx.controller, 'Spirit Token', 2),
  }),
  creature('Kor Skyfisher', '{1}{W}', ['Kor', 'Soldier'], 2, 3, {
    keywords: ['Flying'],
    text: "Flying\nWhen Kor Skyfisher enters, return a permanent you control to its owner's hand.",
    triggers: [
      {
        on: 'etb',
        text: "Return a permanent you control to its owner's hand.",
        effect: (ctx) => {
          const opts = ctx.permanents({ controller: 'you' }).map((c) => c.id);
          if (opts.length) ctx.chooseCards(ctx.controller, "Return a permanent you control to its owner's hand", opts, 1, 1, 'bounce');
        },
      },
    ],
    handlers: { bounce: (ctx, a) => a.cards?.forEach((id) => ctx.bounce(id)) },
  }),
  creature("Ajani's Pridemate", '{1}{W}', ['Cat', 'Soldier'], 2, 2, {
    text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
    triggers: [{ on: 'youGainLife', text: 'Put a +1/+1 counter on this creature.', effect: (ctx) => ctx.addCounters(ctx.self, '+1/+1', 1) }],
  }),
  creature('Seraph of Dawn', '{2}{W}{W}', ['Angel'], 2, 4, { keywords: ['Flying', 'Lifelink'], text: 'Flying, lifelink' }),
  instant('Smite the Monstrous', '{3}{W}', 'Destroy target creature with power 4 or greater.', {
    targets: [T.creature('target creature with power 4 or greater', { minPower: 4 })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  enchantment(
    'Oblivion Ring',
    '{2}{W}',
    "When Oblivion Ring enters, exile another target nonland permanent.\nWhen Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
    {
      triggers: [
        {
          on: 'etb',
          text: 'Exile another target nonland permanent.',
          targets: [T.permanent('another target nonland permanent', { nonland: true, other: true })],
          effect: (ctx) => {
            const c = ctx.card(0);
            if (!c) return;
            ctx.exile(c);
            if (ctx.self) ctx.self.linked.push(c.id);
          },
        },
        {
          on: 'leaves',
          text: 'Return the exiled card to the battlefield.',
          effect: (ctx) => {
            for (const id of ctx.snapshot?.linked ?? []) {
              const c = ctx.state.cards[id];
              if (c && c.zone === 'exile') ctx.moveCard(id, 'battlefield');
            }
          },
        },
      ],
    },
  ),
  instant('Divine Verdict', '{3}{W}', 'Destroy target attacking or blocking creature.', {
    targets: [T.creature('target attacking or blocking creature', { attackingOrBlocking: true })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  creature('Archangel of Thune', '{3}{W}{W}', ['Angel'], 3, 4, {
    keywords: ['Flying', 'Lifelink'],
    text: 'Flying, lifelink\nWhenever you gain life, put a +1/+1 counter on each creature you control.',
    triggers: [
      {
        on: 'youGainLife',
        text: 'Put a +1/+1 counter on each creature you control.',
        effect: (ctx) => ctx.creatures({ controller: 'you' }).forEach((c) => ctx.addCounters(c, '+1/+1', 1)),
      },
    ],
  }),
  enchantment('Pacifism', '{1}{W}', "Enchant creature\nEnchanted creature can't attack or block.", {
    subtypes: ['Aura'],
    targets: [T.creature('creature to enchant')],
    statics: [{ kind: 'attached', cantAttackOrBlock: true }],
  }),
  instant('Condemn', '{W}', "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.", {
    targets: [T.creature('target attacking creature', { attacking: true })],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const t = ctx.toughness(c);
      const ctl = c.controller;
      ctx.moveCard(c.id, 'library', { bottom: true });
      ctx.gainLife(ctl, t);
    },
  }),
  creature('Thraben Inspector', '{W}', ['Human', 'Soldier'], 1, 2, {
    text: 'When Thraben Inspector enters, investigate. (Create a Clue token.)',
    triggers: [{ on: 'etb', text: 'Investigate.', effect: (ctx) => ctx.createToken(ctx.controller, 'Clue Token') }],
  }),
  creature('Emeria Angel', '{2}{W}{W}', ['Angel'], 3, 3, {
    keywords: ['Flying'],
    text: 'Flying\nLandfall — Whenever a land you control enters, you may create a 1/1 white Bird creature token with flying.',
    triggers: [{ on: 'landfall', optional: true, text: 'Create a 1/1 white Bird token with flying.', effect: (ctx) => ctx.createToken(ctx.controller, 'Bird Token') }],
  }),
  creature('Captain of the Watch', '{4}{W}{W}', ['Human', 'Soldier'], 3, 3, {
    keywords: ['Vigilance'],
    text: 'Vigilance\nOther Soldier creatures you control get +1/+1 and have vigilance.\nWhen Captain of the Watch enters, create three 1/1 white Soldier creature tokens.',
    statics: [{ kind: 'anthem', filter: { types: ['Creature'], subtypes: ['Soldier'], controller: 'you', other: true }, power: 1, toughness: 1, keywords: ['Vigilance'] }],
    triggers: [{ on: 'etb', text: 'Create three 1/1 white Soldier tokens.', effect: (ctx) => ctx.createToken(ctx.controller, 'Soldier Token', 3) }],
  }),
  creature('Lone Missionary', '{1}{W}', ['Kor', 'Monk'], 2, 1, {
    text: 'When Lone Missionary enters, you gain 4 life.',
    triggers: [{ on: 'etb', text: 'You gain 4 life.', effect: (ctx) => ctx.gainLife(ctx.controller, 4) }],
  }),
  creature('Inspiring Overseer', '{2}{W}', ['Angel', 'Cleric'], 2, 1, {
    keywords: ['Flying'],
    text: 'Flying\nWhen Inspiring Overseer enters, you gain 1 life and draw a card.',
    triggers: [
      {
        on: 'etb',
        text: 'You gain 1 life and draw a card.',
        effect: (ctx) => {
          ctx.gainLife(ctx.controller, 1);
          ctx.draw(ctx.controller, 1);
        },
      },
    ],
  }),
  creature('Sunblast Angel', '{4}{W}{W}', ['Angel'], 4, 5, {
    keywords: ['Flying'],
    text: 'Flying\nWhen Sunblast Angel enters, destroy all tapped creatures.',
    triggers: [{ on: 'etb', text: 'Destroy all tapped creatures.', effect: (ctx) => ctx.creatures().filter((c) => c.tapped).forEach((c) => ctx.destroy(c)) }],
  }),
  enchantment('Intangible Virtue', '{1}{W}', 'Creature tokens you control get +1/+1 and have vigilance.', {
    statics: [{ kind: 'anthem', filter: { types: ['Creature'], controller: 'you', token: true }, power: 1, toughness: 1, keywords: ['Vigilance'] }],
  }),
  creature('Selfless Spirit', '{1}{W}', ['Spirit'], 2, 1, {
    keywords: ['Flying'],
    text: 'Flying\nSacrifice Selfless Spirit: Creatures you control gain indestructible until end of turn.',
    abilities: [
      {
        text: 'Sacrifice: Creatures you control gain indestructible until end of turn.',
        cost: { sacrificeSelf: true },
        effect: (ctx) => ctx.creatures({ controller: 'you' }).forEach((c) => ctx.pump(c, 0, 0, ['Indestructible'])),
        aiValue: 0,
      },
    ],
  }),
];
