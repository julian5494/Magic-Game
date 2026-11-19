// Cards for the Rakdos, Simic, Azorius and Orzhov ready-made decks.
import type { CardDef, Ctx } from '../cardtypes';
import { getDef } from '../registry';
import { getPlayer } from '../state';
import { artifact, creature, dmg, enchantment, instant, legend, sorcery, T } from './helpers';

const counter = (ctx: Ctx) => {
  const t = ctx.targets[0];
  ctx.counterSpell(t && t.type === 'stack' ? t.id : null);
};

/** Each opponent loses 1 life and you gain 1 life. */
const drainEach = (ctx: Ctx) => {
  ctx.opponents().forEach((p) => ctx.loseLife(p, 1));
  ctx.gainLife(ctx.controller, 1);
};

/** Target player loses 1 life and you gain 1 life (Blood Artist). */
const drainTarget = (ctx: Ctx) => {
  const p = ctx.player(0);
  if (p) ctx.loseLife(p, 1);
  ctx.gainLife(ctx.controller, 1);
};

/** Exile a permanent and return it at once (a new object, so it "enters" again). Tokens stay gone. */
const flicker = (ctx: Ctx, ids: string[]) => {
  const unique = [...new Set(ids)];
  const back = unique.filter((id) => ctx.state.cards[id] && !ctx.state.cards[id].token);
  for (const id of unique) ctx.exile(id);
  for (const id of back) {
    const c = ctx.state.cards[id];
    if (c && c.zone === 'exile') ctx.moveCard(id, 'battlefield', { controller: c.owner });
  }
};

/** "Exile target ... until this leaves the battlefield." */
const exileUntilLeaves = (label: string, filter: Parameters<typeof T.creature>[1]): Partial<CardDef> => ({
  triggers: [
    {
      on: 'etb',
      text: `Exile ${label}.`,
      targets: [T.creature(label, filter)],
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
});

export const GUILDS: CardDef[] = [
  // ----------------------------------------------------------------- Rakdos (BR): sacrifice
  legend('Judith, the Scourge Diva', '{1}{B}{R}', ['Human', 'Shaman'], 2, 2, {
    text: 'Other creatures you control get +1/+0.\nWhenever a nontoken creature you control dies, Judith deals 1 damage to any target.',
    statics: [{ kind: 'anthem', filter: { controller: 'you', types: ['Creature'], other: true }, power: 1, toughness: 0 }],
    triggers: [
      {
        on: 'creatureYouControlDies',
        text: 'Deal 1 damage to any target.',
        condition: (_s, e) => e.t === 'leaves' && !e.snap.token,
        targets: [T.any()],
        effect: dmg(1),
      },
    ],
  }),
  creature('Blood Artist', '{1}{B}', ['Vampire'], 0, 1, {
    text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
    triggers: [{ on: 'anyDies', text: 'Target player loses 1 life and you gain 1 life.', targets: [T.player()], effect: drainTarget }],
  }),
  creature('Falkenrath Noble', '{3}{B}', ['Vampire', 'Warrior'], 2, 2, {
    keywords: ['Flying'],
    text: 'Flying\nWhenever Falkenrath Noble or another creature dies, target player loses 1 life and you gain 1 life.',
    triggers: [{ on: 'anyDies', text: 'Target player loses 1 life and you gain 1 life.', targets: [T.player()], effect: drainTarget }],
  }),
  creature('Mogg Fanatic', '{R}', ['Goblin'], 1, 1, {
    text: 'Sacrifice Mogg Fanatic: It deals 1 damage to any target.',
    abilities: [{ text: 'Sacrifice: Deal 1 damage to any target.', cost: { sacrificeSelf: true }, targets: [T.any()], effect: dmg(1), aiValue: 0 }],
  }),
  creature('Goblin Arsonist', '{R}', ['Goblin', 'Shaman'], 1, 1, {
    text: 'When Goblin Arsonist dies, you may have it deal 1 damage to any target.',
    triggers: [{ on: 'dies', optional: true, text: 'Deal 1 damage to any target.', targets: [T.any()], effect: dmg(1) }],
  }),
  instant('Terminate', '{B}{R}', "Destroy target creature. It can't be regenerated.", { targets: [T.creature()], effect: (ctx) => ctx.destroy(ctx.card(0)) }),
  sorcery('Blightning', '{1}{B}{R}', 'Blightning deals 3 damage to target player or planeswalker. That player discards two cards.', {
    targets: [T.player('target player')],
    effect: (ctx) => {
      const p = ctx.player(0);
      if (!p) return;
      ctx.damage(p, 3);
      ctx.discard(p, 2);
    },
  }),
  enchantment('Bastion of Remembrance', '{2}{B}', 'When Bastion of Remembrance enters, create a 1/1 white Human Soldier creature token.\nWhenever a creature you control dies, each opponent loses 1 life and you gain 1 life.', {
    triggers: [
      { on: 'etb', text: 'Create a 1/1 white Human Soldier token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Human Soldier Token') },
      { on: 'creatureYouControlDies', text: 'Each opponent loses 1 life and you gain 1 life.', effect: drainEach },
    ],
  }),
  creature('Pitiless Plunderer', '{3}{B}', ['Human', 'Pirate'], 1, 4, {
    text: 'Whenever another creature you control dies, create a Treasure token.',
    triggers: [{ on: 'otherCreatureYouControlDies', text: 'Create a Treasure token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Treasure Token') }],
  }),
  enchantment('Dictate of Erebos', '{3}{B}{B}', 'Flash\nWhenever a creature you control dies, each opponent sacrifices a creature.', {
    keywords: ['Flash'],
    triggers: [{ on: 'creatureYouControlDies', text: 'Each opponent sacrifices a creature.', effect: (ctx) => ctx.eachSacrifices(ctx.opponents(), { types: ['Creature'] }, 1) }],
  }),
  creature('Vindictive Vampire', '{3}{B}', ['Vampire'], 2, 3, {
    text: 'Whenever another creature you control dies, Vindictive Vampire deals 1 damage to each opponent and you gain 1 life.',
    triggers: [
      {
        on: 'otherCreatureYouControlDies',
        text: 'Deal 1 damage to each opponent and gain 1 life.',
        effect: (ctx) => {
          ctx.opponents().forEach((p) => ctx.damage(p, 1));
          ctx.gainLife(ctx.controller, 1);
        },
      },
    ],
  }),
  creature('Bloodthrone Vampire', '{1}{B}', ['Vampire'], 1, 1, {
    text: 'Sacrifice a creature: Bloodthrone Vampire gets +2/+2 until end of turn.',
    abilities: [{ text: 'Sacrifice a creature: +2/+2 until end of turn.', cost: { sacrifice: { types: ['Creature'] } }, effect: (ctx) => ctx.pump(ctx.self, 2, 2), aiValue: 0 }],
  }),
  instant("Kolaghan's Command", '{1}{B}{R}', "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.", {
    modeCount: 2,
    modes: [
      {
        text: '• Return target creature card from your graveyard to your hand.',
        targets: [T.yourGraveyard('target creature card in your graveyard', { types: ['Creature'] })],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) ctx.moveCard(c.id, 'hand');
        },
      },
      {
        text: '• Target player discards a card.',
        targets: [T.player()],
        effect: (ctx) => {
          const p = ctx.player(0);
          if (p) ctx.discard(p, 1);
        },
      },
      { text: '• Destroy target artifact.', targets: [T.permanent('target artifact', { types: ['Artifact'] })], effect: (ctx) => ctx.destroy(ctx.card(0)) },
      { text: "• Kolaghan's Command deals 2 damage to any target.", targets: [T.any()], effect: dmg(2) },
    ],
  }),
  instant('Bake into a Pie', '{2}{B}{B}', 'Destroy target creature. Create a Food token.', {
    targets: [T.creature()],
    effect: (ctx) => {
      ctx.destroy(ctx.card(0));
      ctx.createToken(ctx.controller, 'Food Token');
    },
  }),

  // ----------------------------------------------------------------- Simic (GU): landfall
  legend('Tatyova, Benthic Druid', '{3}{G}{U}', ['Merfolk', 'Druid'], 3, 3, {
    text: 'Landfall — Whenever a land you control enters, you gain 1 life and draw a card.',
    triggers: [
      {
        on: 'landfall',
        text: 'Gain 1 life and draw a card.',
        effect: (ctx) => {
          ctx.gainLife(ctx.controller, 1);
          ctx.draw(ctx.controller, 1);
        },
      },
    ],
  }),
  instant('Growth Spiral', '{G}{U}', 'Draw a card. You may put a land card from your hand onto the battlefield.', {
    effect: (ctx) => {
      ctx.draw(ctx.controller, 1);
      const lands = getPlayer(ctx.state, ctx.controller).hand.filter((id) => getDef(ctx.state.cards[id].def).types.includes('Land'));
      if (lands.length) ctx.chooseCards(ctx.controller, 'You may put a land card from your hand onto the battlefield', lands, 0, 1, 'land', undefined, true);
    },
    handlers: { land: (ctx, a) => a.cards?.forEach((id) => ctx.moveCard(id, 'battlefield')) },
  }),
  creature('Lotus Cobra', '{1}{G}', ['Snake'], 2, 1, {
    text: 'Landfall — Whenever a land you control enters, add one mana of any color.',
    triggers: [{ on: 'landfall', text: 'Add one mana of any color.', effect: (ctx) => ctx.addManaChoice(ctx.controller, 1, 'any') }],
  }),
  creature('Rampaging Baloths', '{4}{G}{G}', ['Beast'], 6, 6, {
    keywords: ['Trample'],
    text: 'Trample\nLandfall — Whenever a land you control enters, you may create a 4/4 green Beast creature token.',
    triggers: [{ on: 'landfall', optional: true, text: 'Create a 4/4 green Beast token.', effect: (ctx) => ctx.createToken(ctx.controller, 'Big Beast Token') }],
  }),
  creature('Grazing Gladehart', '{2}{G}', ['Antelope'], 2, 2, {
    text: 'Landfall — Whenever a land you control enters, you may gain 2 life.',
    triggers: [{ on: 'landfall', optional: true, text: 'Gain 2 life.', effect: (ctx) => ctx.gainLife(ctx.controller, 2) }],
  }),
  legend('Azusa, Lost but Seeking', '{2}{G}', ['Human', 'Monk'], 1, 2, {
    text: 'You may play two additional lands on each of your turns.',
    statics: [{ kind: 'extraLand', n: 2 }],
  }),
  creature('Coiling Oracle', '{G}{U}', ['Snake', 'Elf', 'Druid'], 1, 1, {
    text: "When Coiling Oracle enters, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put that card into your hand.",
    triggers: [
      {
        on: 'etb',
        text: 'Reveal the top card: a land goes onto the battlefield, anything else into your hand.',
        effect: (ctx) => {
          const top = getPlayer(ctx.state, ctx.controller).library[0];
          if (!top) return;
          const c = ctx.state.cards[top];
          ctx.log(`${ctx.state.players.find((p) => p.id === ctx.controller)?.name} reveals ${c.def}.`);
          if (getDef(c.def).types.includes('Land')) ctx.moveCard(top, 'battlefield');
          else ctx.moveCard(top, 'hand');
        },
      },
    ],
  }),
  creature("Kiora's Follower", '{G}{U}', ['Merfolk'], 2, 2, {
    text: '{T}: Untap another target permanent.',
    abilities: [{ text: '{T}: Untap another target permanent.', cost: { tap: true }, targets: [T.permanent('another target permanent', { other: true }, { bias: 'self' })], effect: (ctx) => ctx.untap(ctx.card(0)), aiValue: 0 }],
  }),
  legend('Prime Speaker Zegana', '{2}{G}{G}{U}{U}', ['Merfolk', 'Wizard'], 1, 1, {
    text: 'Prime Speaker Zegana enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control.\nWhen Prime Speaker Zegana enters, draw cards equal to its power.',
    triggers: [
      {
        on: 'etb',
        text: 'Gets +1/+1 counters equal to the greatest power among your other creatures, then you draw cards equal to its power.',
        effect: (ctx) => {
          const self = ctx.self;
          if (!self) return;
          const x = Math.max(0, ...ctx.creatures({ controller: 'you', other: true }).map((c) => ctx.power(c)));
          if (x > 0) ctx.addCounters(self, '+1/+1', x);
          ctx.draw(ctx.controller, Math.max(0, ctx.power(self)));
        },
      },
    ],
  }),
  creature('Mystic Snake', '{1}{G}{U}{U}', ['Snake'], 2, 2, {
    keywords: ['Flash'],
    text: 'Flash\nWhen Mystic Snake enters, counter target spell.',
    triggers: [{ on: 'etb', text: 'Counter target spell.', targets: [T.spell()], effect: counter }],
  }),
  sorcery('Skyshroud Claim', '{3}{G}', 'Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.', {
    effect: (ctx) => ctx.search({ filter: { types: ['Land'], subtypes: ['Forest'] }, max: 2, dest: 'battlefield', label: 'Search for up to two Forest cards' }),
  }),

  // ----------------------------------------------------------------- Azorius (WU): blink
  legend('Brago, King Eternal', '{2}{W}{U}', ['Spirit'], 2, 4, {
    keywords: ['Flying'],
    text: "Flying\nWhen Brago deals combat damage to a player, exile any number of target nonland permanents you control, then return those cards to the battlefield under their owner's control.",
    triggers: [
      {
        on: 'dealsCombatDamageToPlayer',
        text: 'Exile any number of nonland permanents you control, then return them.',
        effect: (ctx) => {
          const mine = ctx.permanents({ controller: 'you', nonland: true }).map((c) => c.id);
          if (mine.length) ctx.chooseCards(ctx.controller, 'Brago: choose any number of your nonland permanents to exile and return', mine, 0, mine.length, 'blink');
        },
      },
    ],
    handlers: { blink: (ctx, a) => flicker(ctx, a.cards ?? []) },
  }),
  creature('Cloudblazer', '{3}{W}{U}', ['Human', 'Scout'], 2, 2, {
    keywords: ['Flying'],
    text: 'Flying\nWhen Cloudblazer enters, you gain 2 life and draw two cards.',
    triggers: [
      {
        on: 'etb',
        text: 'Gain 2 life and draw two cards.',
        effect: (ctx) => {
          ctx.gainLife(ctx.controller, 2);
          ctx.draw(ctx.controller, 2);
        },
      },
    ],
  }),
  instant('Absorb', '{W}{U}{U}', 'Counter target spell. You gain 3 life.', {
    targets: [T.spell()],
    effect: (ctx) => {
      counter(ctx);
      ctx.gainLife(ctx.controller, 3);
    },
  }),
  creature('Fiend Hunter', '{1}{W}{W}', ['Human', 'Cleric'], 1, 3, {
    text: 'When Fiend Hunter enters, you may exile another target creature.\nWhen Fiend Hunter leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.',
    ...exileUntilLeaves('another target creature', { other: true, controller: 'opponent' }),
  }),
  creature('Banisher Priest', '{1}{W}{W}', ['Human', 'Cleric'], 2, 2, {
    text: 'When Banisher Priest enters, exile target creature an opponent controls until Banisher Priest leaves the battlefield.',
    ...exileUntilLeaves('target creature an opponent controls', { controller: 'opponent' }),
  }),
  creature('Wall of Omens', '{1}{W}', ['Wall'], 0, 4, {
    keywords: ['Defender'],
    text: 'Defender\nWhen Wall of Omens enters, draw a card.',
    triggers: [{ on: 'etb', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  instant('Cloudshift', '{W}', 'Exile target creature you control, then return that card to the battlefield under your control.', {
    targets: [T.yourCreature()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (c) flicker(ctx, [c.id]);
    },
  }),
  instant('Momentary Blink', '{1}{W}', 'Exile target creature you control, then return it to the battlefield under its owner\'s control.\nFlashback {3}{U}', {
    targets: [T.yourCreature()],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (c) flicker(ctx, [c.id]);
    },
    identity: ['U'],
    castVariants: [{ label: 'Flashback {3}{U}', cost: '{3}{U}', zone: 'graveyard', exileAfter: true }],
  }),
  artifact("Conjurer's Closet", '{5}', "At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.", {
    triggers: [
      {
        on: 'yourEndStep',
        optional: true,
        text: 'Exile target creature you control, then return it.',
        targets: [T.yourCreature()],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) flicker(ctx, [c.id]);
        },
      },
    ],
  }),
  creature('Restoration Angel', '{3}{W}', ['Angel'], 3, 4, {
    keywords: ['Flash', 'Flying'],
    text: 'Flash\nFlying\nWhen Restoration Angel enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.',
    triggers: [
      {
        on: 'etb',
        optional: true,
        text: 'Exile target non-Angel creature you control, then return it.',
        targets: [T.creature('target non-Angel creature you control', { controller: 'you', custom: (_s, c) => !(getDef(c.def).subtypes ?? []).includes('Angel') }, { bias: 'self' })],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) flicker(ctx, [c.id]);
        },
      },
    ],
  }),

  // ----------------------------------------------------------------- Orzhov (WB): drain
  legend('Elenda, the Dusk Rose', '{2}{W}{B}', ['Vampire', 'Knight'], 1, 1, {
    keywords: ['Lifelink'],
    text: "Lifelink\nWhenever another creature dies, put a +1/+1 counter on Elenda, the Dusk Rose.\nWhen Elenda dies, create X 1/1 white Vampire creature tokens with lifelink, where X is Elenda's power.",
    triggers: [
      {
        on: 'anyDies',
        text: 'Put a +1/+1 counter on Elenda.',
        condition: (_s, e, self) => e.t === 'leaves' && e.card !== self.id,
        effect: (ctx) => {
          if (ctx.self) ctx.addCounters(ctx.self, '+1/+1', 1);
        },
      },
      {
        on: 'dies',
        text: "Create a 1/1 lifelink Vampire token for each point of Elenda's power.",
        effect: (ctx) => {
          const x = Math.max(0, ctx.snapshot?.power ?? 0);
          if (x > 0) ctx.createToken(ctx.controller, 'Lifelink Vampire Token', x);
        },
      },
    ],
  }),
  sorcery('Vindicate', '{1}{W}{B}', 'Destroy target permanent.', { targets: [T.permanent()], effect: (ctx) => ctx.destroy(ctx.card(0)) }),
  instant('Anguished Unmaking', '{1}{W}{B}', 'Exile target nonland permanent. You lose 3 life.', {
    targets: [T.permanent('target nonland permanent', { nonland: true })],
    effect: (ctx) => {
      ctx.exile(ctx.card(0));
      ctx.loseLife(ctx.controller, 3);
    },
  }),
  instant('Mortify', '{1}{W}{B}', 'Destroy target creature or enchantment.', {
    targets: [T.permanent('target creature or enchantment', { types: ['Creature', 'Enchantment'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  enchantment('Sanguine Bond', '{3}{B}{B}', 'Whenever you gain life, target opponent loses that much life.', {
    triggers: [
      {
        on: 'youGainLife',
        text: 'Target opponent loses that much life.',
        targets: [T.opponent()],
        effect: (ctx) => {
          const p = ctx.player(0);
          if (p && ctx.event?.t === 'gainLife') ctx.loseLife(p, ctx.event.amount);
        },
      },
    ],
  }),
  sorcery('Debt to the Deathless', '{X}{W}{W}{B}{B}', 'Each opponent loses two times X life. You gain life equal to the life lost this way.', {
    effect: (ctx) => {
      const opps = ctx.opponents();
      opps.forEach((p) => ctx.loseLife(p, 2 * ctx.x));
      ctx.gainLife(ctx.controller, 2 * ctx.x * opps.length);
    },
  }),
  sorcery('Lingering Souls', '{2}{W}', 'Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}', {
    effect: (ctx) => ctx.createToken(ctx.controller, 'Spirit Token', 2),
    identity: ['B'],
    castVariants: [{ label: 'Flashback {1}{B}', cost: '{1}{B}', zone: 'graveyard', exileAfter: true }],
  }),
  instant("Sorin's Thirst", '{B}{B}', "Sorin's Thirst deals 2 damage to target creature and you gain 2 life.", {
    targets: [T.creature()],
    effect: (ctx) => {
      ctx.damage(ctx.targets[0], 2);
      ctx.gainLife(ctx.controller, 2);
    },
  }),
];
