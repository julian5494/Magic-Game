import type { CardDef } from '../cardtypes';
import { getPlayer } from '../state';
import { creature, instant, legend, sorcery, T } from './helpers';

const counter = (ctx: Parameters<NonNullable<CardDef['effect']>>[0]) => {
  const t = ctx.targets[0];
  ctx.counterSpell(t && t.type === 'stack' ? t.id : null);
};

export const BLUE: CardDef[] = [
  instant('Counterspell', '{U}{U}', 'Counter target spell.', { targets: [T.spell()], effect: counter }),
  instant('Negate', '{1}{U}', 'Counter target noncreature spell.', {
    targets: [T.spell('target noncreature spell', { spellNotTypes: ['Creature'] })],
    effect: counter,
  }),
  instant('Essence Scatter', '{1}{U}', 'Counter target creature spell.', {
    targets: [T.spell('target creature spell', { spellTypes: ['Creature'] })],
    effect: counter,
  }),
  instant('Exclude', '{2}{U}', 'Counter target creature spell. Draw a card.', {
    targets: [T.spell('target creature spell', { spellTypes: ['Creature'] })],
    effect: (ctx) => {
      counter(ctx);
      ctx.draw(ctx.controller, 1);
    },
  }),
  instant('Dissolve', '{1}{U}{U}', 'Counter target spell. Scry 1.', {
    targets: [T.spell()],
    effect: (ctx) => {
      counter(ctx);
      ctx.scry(ctx.controller, 1);
    },
  }),
  instant('Brainstorm', '{U}', 'Draw three cards, then put two cards from your hand on top of your library in any order.', {
    effect: (ctx) => {
      ctx.draw(ctx.controller, 3);
      const hand = getPlayer(ctx.state, ctx.controller).hand;
      const n = Math.min(2, hand.length);
      if (n > 0) ctx.chooseCards(ctx.controller, 'Put two cards from your hand on top of your library (the first one you pick ends up on top)', [...hand], n, n, 'putBack', undefined, true);
    },
    handlers: {
      putBack: (ctx, a) => {
        const cards = a.cards ?? [];
        for (let i = cards.length - 1; i >= 0; i--) ctx.moveCard(cards[i], 'library');
      },
    },
  }),
  sorcery('Preordain', '{U}', 'Scry 2, then draw a card.', {
    effect: (ctx) => ctx.scry(ctx.controller, 2, 'draw'),
    handlers: { draw: (ctx) => ctx.draw(ctx.controller, 1) },
  }),
  instant('Opt', '{U}', 'Scry 1. Draw a card.', {
    effect: (ctx) => ctx.scry(ctx.controller, 1, 'draw'),
    handlers: { draw: (ctx) => ctx.draw(ctx.controller, 1) },
  }),
  instant('Impulse', '{1}{U}', 'Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.', {
    effect: (ctx) => ctx.lookAndTake(ctx.controller, 4, 1, null, 'Impulse: choose a card to put into your hand'),
  }),
  sorcery('Divination', '{2}{U}', 'Draw two cards.', { effect: (ctx) => ctx.draw(ctx.controller, 2) }),
  sorcery('Concentrate', '{2}{U}{U}', 'Draw three cards.', { effect: (ctx) => ctx.draw(ctx.controller, 3) }),
  sorcery('Tidings', '{3}{U}{U}', 'Draw four cards.', { effect: (ctx) => ctx.draw(ctx.controller, 4) }),
  instant('Unsummon', '{U}', "Return target creature to its owner's hand.", {
    targets: [T.creature()],
    effect: (ctx) => ctx.bounce(ctx.card(0)),
  }),
  instant('Repulse', '{2}{U}', "Return target creature to its owner's hand. Draw a card.", {
    targets: [T.creature()],
    effect: (ctx) => {
      ctx.bounce(ctx.card(0));
      ctx.draw(ctx.controller, 1);
    },
  }),
  instant('Evacuation', '{3}{U}{U}', "Return all creatures to their owners' hands.", {
    effect: (ctx) => ctx.creatures().forEach((c) => ctx.bounce(c)),
    ai: { value: -1 },
  }),
  instant('Frost Breath', '{2}{U}', "Tap up to two target creatures. Those creatures don't untap during their controller's next untap step.", {
    targets: [T.creature('target creature', undefined, { optional: true }), T.creature('second target creature', undefined, { optional: true })],
    effect: (ctx) => {
      for (const i of [0, 1]) {
        const c = ctx.card(i);
        if (!c) continue;
        ctx.tap(c);
        c.skipUntap = 1;
      }
    },
  }),
  instant('Ghostly Flicker', '{2}{U}', 'Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.', {
    targets: [
      T.permanent('target artifact, creature, or land you control', { controller: 'you', types: ['Artifact', 'Creature', 'Land'] }, { bias: 'self' }),
      T.permanent('second target artifact, creature, or land you control', { controller: 'you', types: ['Artifact', 'Creature', 'Land'] }, { bias: 'self', optional: true }),
    ],
    effect: (ctx) => {
      const ids = [ctx.card(0), ctx.card(1)].filter(Boolean).map((c) => c!.id);
      const unique = [...new Set(ids)].filter((id) => !ctx.state.cards[id].token);
      for (const id of [...new Set(ids)]) ctx.exile(id);
      for (const id of unique) ctx.moveCard(id, 'battlefield', { controller: ctx.controller });
    },
  }),
  creature('Air Elemental', '{3}{U}{U}', ['Elemental'], 4, 4, { keywords: ['Flying'], text: 'Flying' }),
  creature("Man-o'-War", '{2}{U}', ['Jellyfish'], 2, 2, {
    text: "When Man-o'-War enters, return target creature to its owner's hand.",
    triggers: [{ on: 'etb', text: "Return target creature to its owner's hand.", targets: [T.creature()], effect: (ctx) => ctx.bounce(ctx.card(0)) }],
  }),
  creature('Mulldrifter', '{4}{U}', ['Elemental'], 2, 2, {
    keywords: ['Flying'],
    text: 'Flying\nWhen Mulldrifter enters, draw two cards.',
    triggers: [{ on: 'etb', text: 'Draw two cards.', effect: (ctx) => ctx.draw(ctx.controller, 2) }],
  }),
  creature('Cloudkin Seer', '{2}{U}', ['Elemental', 'Wizard'], 2, 1, {
    keywords: ['Flying'],
    text: 'Flying\nWhen Cloudkin Seer enters, draw a card.',
    triggers: [{ on: 'etb', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  legend('Talrand, Sky Summoner', '{2}{U}{U}', ['Merfolk', 'Wizard'], 2, 2, {
    text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    triggers: [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'], text: 'Create a 2/2 blue Drake with flying.', effect: (ctx) => ctx.createToken(ctx.controller, 'Drake Token') }],
  }),
  creature('Merfolk Looter', '{1}{U}', ['Merfolk', 'Rogue'], 1, 1, {
    text: '{T}: Draw a card, then discard a card.',
    abilities: [
      {
        text: '{T}: Draw a card, then discard a card.',
        cost: { tap: true },
        effect: (ctx) => {
          ctx.draw(ctx.controller, 1);
          ctx.discard(ctx.controller, 1);
        },
        aiValue: 1,
      },
    ],
  }),
  creature('Archaeomancer', '{2}{U}{U}', ['Human', 'Wizard'], 1, 2, {
    text: 'When Archaeomancer enters, return target instant or sorcery card from your graveyard to your hand.',
    triggers: [
      {
        on: 'etb',
        text: 'Return target instant or sorcery card from your graveyard to your hand.',
        targets: [T.yourGraveyard('target instant or sorcery card in your graveyard', { types: ['Instant', 'Sorcery'] })],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) ctx.moveCard(c.id, 'hand');
        },
      },
    ],
  }),
  creature('Augur of Bolas', '{1}{U}', ['Merfolk', 'Wizard'], 1, 3, {
    text: 'When Augur of Bolas enters, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
    triggers: [
      {
        on: 'etb',
        text: 'Look at the top three cards; you may take an instant or sorcery.',
        effect: (ctx) => ctx.lookAndTake(ctx.controller, 3, 1, { types: ['Instant', 'Sorcery'] }, 'Augur of Bolas: you may take an instant or sorcery card'),
      },
    ],
  }),
  creature('Spectral Sailor', '{U}', ['Spirit', 'Pirate'], 1, 1, {
    keywords: ['Flash', 'Flying'],
    text: 'Flash\nFlying\n{3}{U}: Draw a card.',
    abilities: [{ text: '{3}{U}: Draw a card.', cost: { mana: '{3}{U}' }, effect: (ctx) => ctx.draw(ctx.controller, 1), aiValue: 1 }],
  }),
  creature('Phantom Warrior', '{1}{U}{U}', ['Illusion', 'Warrior'], 2, 2, {
    keywords: ['Unblockable'],
    text: "Phantom Warrior can't be blocked.",
  }),
  creature('Sphinx of Jwar Isle', '{4}{U}{U}', ['Sphinx'], 5, 5, { keywords: ['Flying', 'Shroud'], text: 'Flying, shroud' }),
];
