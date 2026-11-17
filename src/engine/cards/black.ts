import type { CardDef } from '../cardtypes';
import { cmc, devotion } from '../state';
import { creature, enchantment, instant, sorcery, T } from './helpers';

export const BLACK: CardDef[] = [
  instant('Murder', '{1}{B}{B}', 'Destroy target creature.', { targets: [T.creature()], effect: (ctx) => ctx.destroy(ctx.card(0)) }),
  instant('Doom Blade', '{1}{B}', 'Destroy target nonblack creature.', {
    targets: [T.creature('target nonblack creature', { notColors: ['B'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  instant('Go for the Throat', '{1}{B}', 'Destroy target nonartifact creature.', {
    targets: [T.creature('target nonartifact creature', { notTypes: ['Artifact'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  instant('Cast Down', '{1}{B}', 'Destroy target nonlegendary creature.', {
    targets: [T.creature('target nonlegendary creature', { nonlegendary: true })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  sorcery('Damnation', '{2}{B}{B}', "Destroy all creatures. They can't be regenerated.", {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.destroy(c)),
    ai: { value: -1 },
  }),
  sorcery('Infest', '{1}{B}{B}', 'All creatures get -2/-2 until end of turn.', {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.pump(c, -2, -2)),
    ai: { value: -1 },
  }),
  sorcery("Night's Whisper", '{1}{B}', 'You draw two cards and you lose 2 life.', {
    effect: (ctx) => {
      ctx.draw(ctx.controller, 2);
      ctx.loseLife(ctx.controller, 2);
    },
  }),
  sorcery('Sign in Blood', '{B}{B}', 'Target player draws two cards and loses 2 life.', {
    targets: [T.player('target player', 'self')],
    effect: (ctx) => {
      const p = ctx.player(0);
      if (!p) return;
      ctx.draw(p, 2);
      ctx.loseLife(p, 2);
    },
  }),
  sorcery('Read the Bones', '{2}{B}', 'Scry 2, then draw two cards. You lose 2 life.', {
    effect: (ctx) => ctx.scry(ctx.controller, 2, 'rest'),
    handlers: {
      rest: (ctx) => {
        ctx.draw(ctx.controller, 2);
        ctx.loseLife(ctx.controller, 2);
      },
    },
  }),
  sorcery('Demonic Tutor', '{1}{B}', 'Search your library for a card, put that card into your hand, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: {}, max: 1, dest: 'hand', label: 'Search for any card' }),
  }),
  instant('Vampiric Tutor', '{B}', 'Search your library for a card, then shuffle and put that card on top. You lose 2 life.', {
    effect: (ctx) => {
      ctx.search({ filter: {}, max: 1, dest: 'top', label: 'Search for any card to put on top' });
      ctx.loseLife(ctx.controller, 2);
    },
  }),
  sorcery('Raise Dead', '{B}', 'Return target creature card from your graveyard to your hand.', {
    targets: [T.yourGraveyard('target creature card in your graveyard', { types: ['Creature'] })],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (c) ctx.moveCard(c.id, 'hand');
    },
  }),
  sorcery('Reanimate', '{B}', 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.', {
    targets: [T.anyGraveyard('target creature card in a graveyard', { types: ['Creature'] })],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const mv = cmc(c);
      ctx.moveCard(c.id, 'battlefield', { controller: ctx.controller });
      ctx.loseLife(ctx.controller, mv);
    },
  }),
  instant('Dark Ritual', '{B}', 'Add {B}{B}{B}.', { effect: (ctx) => ctx.addMana(ctx.controller, 'B', 3) }),
  sorcery('Exsanguinate', '{X}{B}{B}', 'Each opponent loses X life. You gain life equal to the life lost this way.', {
    effect: (ctx) => {
      const opps = ctx.opponents();
      opps.forEach((p) => ctx.loseLife(p, ctx.x));
      ctx.gainLife(ctx.controller, ctx.x * opps.length);
    },
  }),
  creature('Gravedigger', '{3}{B}', ['Zombie'], 2, 2, {
    text: 'When Gravedigger enters, you may return target creature card from your graveyard to your hand.',
    triggers: [
      {
        on: 'etb',
        text: 'Return target creature card from your graveyard to your hand.',
        targets: [{ ...T.yourGraveyard('target creature card in your graveyard', { types: ['Creature'] }), optional: true }],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) ctx.moveCard(c.id, 'hand');
        },
      },
    ],
  }),
  creature('Vampire Nighthawk', '{1}{B}{B}', ['Vampire', 'Shaman'], 2, 3, {
    keywords: ['Flying', 'Deathtouch', 'Lifelink'],
    text: 'Flying, deathtouch, lifelink',
  }),
  creature('Zulaport Cutthroat', '{1}{B}', ['Human', 'Rogue', 'Ally'], 1, 1, {
    text: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
    triggers: [
      {
        on: 'creatureYouControlDies',
        text: 'Each opponent loses 1 life and you gain 1 life.',
        effect: (ctx) => {
          const opps = ctx.opponents();
          opps.forEach((p) => ctx.loseLife(p, 1));
          ctx.gainLife(ctx.controller, 1);
        },
      },
    ],
  }),
  creature('Viscera Seer', '{B}', ['Vampire', 'Wizard'], 1, 1, {
    text: 'Sacrifice a creature: Scry 1.',
    abilities: [{ text: 'Sacrifice a creature: Scry 1.', cost: { sacrifice: { types: ['Creature'] } }, effect: (ctx) => ctx.scry(ctx.controller, 1), aiValue: 0 }],
  }),
  creature('Diregraf Ghoul', '{B}', ['Zombie'], 2, 2, { entersTapped: true, text: 'Diregraf Ghoul enters tapped.' }),
  creature('Gray Merchant of Asphodel', '{3}{B}{B}', ['Zombie'], 2, 4, {
    text: 'When Gray Merchant of Asphodel enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.',
    triggers: [
      {
        on: 'etb',
        text: 'Drain each opponent for your devotion to black.',
        effect: (ctx) => {
          const x = devotion(ctx.state, ctx.controller, 'B');
          const opps = ctx.opponents();
          opps.forEach((p) => ctx.loseLife(p, x));
          ctx.gainLife(ctx.controller, x * opps.length);
        },
      },
    ],
  }),
  enchantment('Phyrexian Arena', '{1}{B}{B}', 'At the beginning of your upkeep, you draw a card and you lose 1 life.', {
    triggers: [
      {
        on: 'yourUpkeep',
        text: 'Draw a card and lose 1 life.',
        effect: (ctx) => {
          ctx.draw(ctx.controller, 1);
          ctx.loseLife(ctx.controller, 1);
        },
      },
    ],
  }),
  enchantment('Bitterblossom', '{1}{B}', 'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.', {
    subtypes: ['Faerie'],
    triggers: [
      {
        on: 'yourUpkeep',
        text: 'Lose 1 life and create a 1/1 Faerie Rogue with flying.',
        effect: (ctx) => {
          ctx.loseLife(ctx.controller, 1);
          ctx.createToken(ctx.controller, 'Faerie Rogue Token');
        },
      },
    ],
  }),
  creature('Fleshbag Marauder', '{2}{B}', ['Zombie', 'Warrior'], 3, 1, {
    text: 'When Fleshbag Marauder enters, each player sacrifices a creature.',
    triggers: [{ on: 'etb', text: 'Each player sacrifices a creature.', effect: (ctx) => ctx.eachSacrifices(ctx.players(), { types: ['Creature'] }, 1) }],
  }),
  creature('Ravenous Chupacabra', '{2}{B}{B}', ['Beast', 'Horror'], 2, 2, {
    text: 'When Ravenous Chupacabra enters, destroy target creature an opponent controls.',
    triggers: [{ on: 'etb', text: 'Destroy target creature an opponent controls.', targets: [T.oppCreature()], effect: (ctx) => ctx.destroy(ctx.card(0)) }],
  }),
  creature('Grave Titan', '{4}{B}{B}', ['Giant'], 6, 6, {
    keywords: ['Deathtouch'],
    text: 'Deathtouch\nWhenever Grave Titan enters or attacks, create two 2/2 black Zombie creature tokens.',
    triggers: [
      { on: 'etb', text: 'Create two 2/2 black Zombie tokens.', effect: (ctx) => ctx.createToken(ctx.controller, 'Zombie Token', 2) },
      { on: 'attacks', text: 'Create two 2/2 black Zombie tokens.', effect: (ctx) => ctx.createToken(ctx.controller, 'Zombie Token', 2) },
    ],
  }),
  creature('Hypnotic Specter', '{1}{B}{B}', ['Specter'], 2, 2, {
    keywords: ['Flying'],
    text: 'Flying\nWhenever Hypnotic Specter deals combat damage to an opponent, that player discards a card at random.',
    triggers: [
      {
        on: 'dealsCombatDamageToPlayer',
        text: 'That player discards a card at random.',
        effect: (ctx) => {
          if (ctx.event?.t === 'combatDamagePlayer') ctx.discardRandom(ctx.event.player, 1);
        },
      },
    ],
  }),
  creature('Skinrender', '{2}{B}{B}', ['Phyrexian', 'Zombie'], 3, 3, {
    text: 'When Skinrender enters, put three -1/-1 counters on target creature.',
    triggers: [{ on: 'etb', text: 'Put three -1/-1 counters on target creature.', targets: [T.creature()], effect: (ctx) => ctx.addCounters(ctx.card(0), '-1/-1', 3) }],
  }),
  creature('Nantuko Husk', '{2}{B}', ['Phyrexian', 'Zombie', 'Insect'], 2, 2, {
    text: 'Sacrifice a creature: Nantuko Husk gets +2/+2 until end of turn.',
    abilities: [
      {
        text: 'Sacrifice a creature: +2/+2 until end of turn.',
        cost: { sacrifice: { types: ['Creature'], other: true } },
        effect: (ctx) => ctx.pump(ctx.self, 2, 2),
        aiValue: 0,
      },
    ],
  }),
  creature('Butcher of Malakir', '{5}{B}{B}', ['Vampire', 'Warrior'], 5, 4, {
    keywords: ['Flying'],
    text: 'Flying\nWhenever Butcher of Malakir or another creature you control dies, each opponent sacrifices a creature.',
    triggers: [{ on: 'creatureYouControlDies', text: 'Each opponent sacrifices a creature.', effect: (ctx) => ctx.eachSacrifices(ctx.opponents(), { types: ['Creature'] }, 1) }],
  }),
];
