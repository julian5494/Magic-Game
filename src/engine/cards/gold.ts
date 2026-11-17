import type { CardDef } from '../cardtypes';
import { getDef } from '../registry';
import { getPlayer, getPT } from '../state';
import type { GameState, PlayerId } from '../types';
import { basicLandFilter, creature, enchantment, instant, legend, sorcery, T } from './helpers';

const spellsIn = (state: GameState, pid: PlayerId, zones: ('graveyard' | 'exile')[]) => {
  const p = state.players.find((x) => x.id === pid);
  if (!p) return 0;
  return zones
    .flatMap((z) => p[z])
    .filter((id) => {
      const c = state.cards[id];
      return !!c && getDef(c.def).types.some((t) => t === 'Instant' || t === 'Sorcery');
    }).length;
};

export const GOLD: CardDef[] = [
  // ----- Selesnya (GW) -----
  legend("Trostani, Selesnya's Voice", '{3}{G}{W}', ['Dryad'], 2, 5, {
    text: "Whenever another creature you control enters, you gain life equal to that creature's toughness.\n{1}{G}{W}, {T}: Populate. (Create a token that's a copy of a creature token you control.)",
    triggers: [
      {
        on: 'otherCreatureEtbYours',
        text: "Gain life equal to that creature's toughness.",
        effect: (ctx) => {
          if (ctx.event?.t !== 'etb') return;
          const c = ctx.state.cards[ctx.event.card];
          if (c && c.zone === 'battlefield') ctx.gainLife(ctx.controller, Math.max(0, getPT(ctx.state, c).toughness));
        },
      },
    ],
    abilities: [
      {
        text: '{1}{G}{W}, {T}: Populate.',
        cost: { mana: '{1}{G}{W}', tap: true },
        aiValue: 2,
        effect: (ctx) => {
          const tokens = ctx.creatures({ controller: 'you', token: true });
          if (tokens.length === 0) return;
          const kinds = [...new Set(tokens.map((t) => t.def))];
          if (kinds.length === 1) ctx.createToken(ctx.controller, kinds[0]);
          else ctx.chooseCards(ctx.controller, 'Populate: choose a creature token to copy', tokens.map((t) => t.id), 1, 1, 'populate');
        },
      },
    ],
    handlers: {
      populate: (ctx, a) => {
        const c = a.cards?.[0] ? ctx.state.cards[a.cards[0]] : null;
        if (c) ctx.createToken(ctx.controller, c.def);
      },
    },
  }),
  creature('Qasali Pridemage', '{G}{W}', ['Cat', 'Wizard'], 2, 2, {
    keywords: ['Exalted'],
    text: 'Exalted\n{1}, Sacrifice Qasali Pridemage: Destroy target artifact or enchantment.',
    abilities: [
      {
        text: '{1}, Sacrifice: Destroy target artifact or enchantment.',
        cost: { mana: '{1}', sacrificeSelf: true },
        targets: [T.permanent('target artifact or enchantment', { types: ['Artifact', 'Enchantment'], controller: 'opponent' })],
        effect: (ctx) => ctx.destroy(ctx.card(0)),
        aiValue: 0,
      },
    ],
  }),
  legend('Emmara, Soul of the Accord', '{G}{W}', ['Elf', 'Cleric'], 2, 2, {
    text: 'Whenever Emmara, Soul of the Accord becomes tapped, create a 1/1 white Soldier creature token with lifelink.',
    triggers: [{ on: 'becomesTapped', text: 'Create a 1/1 white Soldier token with lifelink.', effect: (ctx) => ctx.createToken(ctx.controller, 'Lifelink Soldier Token') }],
  }),
  legend('Sigarda, Host of Herons', '{2}{G}{W}{W}', ['Angel'], 5, 5, {
    keywords: ['Flying', 'Hexproof'],
    text: "Flying, hexproof\nSpells and abilities your opponents control can't cause you to sacrifice permanents.",
    statics: [{ kind: 'oppsCantMakeYouSacrifice' }],
  }),
  creature('Armada Wurm', '{5}{G}{G}{W}{W}', ['Wurm'], 5, 5, {
    keywords: ['Trample'],
    text: 'Trample\nWhen Armada Wurm enters, create a 5/5 green Wurm creature token with trample.',
    triggers: [{ on: 'etb', text: 'Create a 5/5 green Wurm token with trample.', effect: (ctx) => ctx.createToken(ctx.controller, 'Wurm Token') }],
  }),

  // ----- Izzet (UR) -----
  legend('Adeliz, the Cinder Wind', '{1}{U}{R}', ['Djinn', 'Wizard'], 2, 2, {
    keywords: ['Flying', 'Haste'],
    text: 'Flying, haste\nWhenever you cast an instant or sorcery spell, Wizards you control get +1/+1 until end of turn.',
    triggers: [
      {
        on: 'youCast',
        spellTypes: ['Instant', 'Sorcery'],
        text: 'Wizards you control get +1/+1 until end of turn.',
        effect: (ctx) => ctx.creatures({ controller: 'you', subtypes: ['Wizard'] }).forEach((c) => ctx.pump(c, 1, 1)),
      },
    ],
  }),
  creature('Sage of the Inward Eye', '{2}{U}{R}', ['Djinn', 'Wizard'], 3, 4, {
    text: 'Whenever you cast a noncreature spell, creatures you control gain lifelink until end of turn.',
    triggers: [
      {
        on: 'youCast',
        spellNotTypes: ['Creature'],
        text: 'Creatures you control gain lifelink until end of turn.',
        effect: (ctx) => ctx.creatures({ controller: 'you' }).forEach((c) => ctx.pump(c, 0, 0, ['Lifelink'])),
      },
    ],
  }),
  creature('Crackling Drake', '{U}{U}{R}{R}', ['Drake'], 0, 4, {
    keywords: ['Flying'],
    text: "Flying\nCrackling Drake's power is equal to the total number of instant and sorcery cards you own in exile and in your graveyard.\nWhen Crackling Drake enters, draw a card.",
    dynamicPT: (state, self) => ({ power: spellsIn(state, self.owner, ['graveyard', 'exile']), toughness: 0 }),
    triggers: [{ on: 'etb', text: 'Draw a card.', effect: (ctx) => ctx.draw(ctx.controller, 1) }],
  }),
  creature('Enigma Drake', '{1}{U}{R}', ['Drake'], 0, 4, {
    keywords: ['Flying'],
    text: "Flying\nEnigma Drake's power is equal to the number of instant and sorcery cards in your graveyard.",
    dynamicPT: (state, self) => ({ power: spellsIn(state, self.controller, ['graveyard']), toughness: 0 }),
  }),
  creature('Wee Dragonauts', '{1}{U}{R}', ['Faerie', 'Wizard'], 1, 3, {
    keywords: ['Flying'],
    text: 'Flying\nWhenever you cast an instant or sorcery spell, Wee Dragonauts gets +2/+0 until end of turn.',
    triggers: [{ on: 'youCast', spellTypes: ['Instant', 'Sorcery'], text: '+2/+0 until end of turn.', effect: (ctx) => ctx.pump(ctx.self, 2, 0) }],
  }),

  // ----- Golgari (BG) -----
  legend('Izoni, Thousand-Eyed', '{2}{B}{B}{G}{G}', ['Elf', 'Shaman'], 2, 3, {
    text: 'Undergrowth — When Izoni, Thousand-Eyed enters, create a 1/1 black and green Insect creature token for each creature card in your graveyard.\n{B}{G}, Sacrifice another creature: You gain 1 life and draw a card.',
    triggers: [
      {
        on: 'etb',
        text: 'Create a 1/1 Insect for each creature card in your graveyard.',
        effect: (ctx) => {
          const n = getPlayer(ctx.state, ctx.controller).graveyard.filter((id) => getDef(ctx.state.cards[id].def).types.includes('Creature')).length;
          if (n > 0) ctx.createToken(ctx.controller, 'Insect Token', n);
        },
      },
    ],
    abilities: [
      {
        text: '{B}{G}, Sacrifice another creature: You gain 1 life and draw a card.',
        cost: { mana: '{B}{G}', sacrifice: { types: ['Creature'], other: true } },
        effect: (ctx) => {
          ctx.gainLife(ctx.controller, 1);
          ctx.draw(ctx.controller, 1);
        },
        aiValue: 0,
      },
    ],
  }),
  instant('Putrefy', '{1}{B}{G}', "Destroy target artifact or creature. It can't be regenerated.", {
    targets: [T.permanent('target artifact or creature', { types: ['Artifact', 'Creature'] })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  instant("Assassin's Trophy", '{B}{G}', 'Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.', {
    targets: [T.permanent('target permanent an opponent controls', { controller: 'opponent' })],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      const ctl = c.controller;
      ctx.destroy(c);
      ctx.search({ player: ctl, filter: basicLandFilter, max: 1, dest: 'battlefield', label: "You may search for a basic land (Assassin's Trophy)" });
    },
  }),
  instant('Abrupt Decay', '{B}{G}', "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.", {
    statics: [{ kind: 'cantBeCountered' }],
    targets: [T.permanent('target nonland permanent with mana value 3 or less', { nonland: true, maxCmc: 3 })],
    effect: (ctx) => ctx.destroy(ctx.card(0)),
  }),
  sorcery('Maelstrom Pulse', '{1}{B}{G}', 'Destroy target nonland permanent and all other permanents with the same name as that permanent.', {
    targets: [T.permanent('target nonland permanent', { nonland: true })],
    effect: (ctx) => {
      const c = ctx.card(0);
      if (!c) return;
      ctx.permanents().filter((p) => p.def === c.def).forEach((p) => ctx.destroy(p));
    },
  }),
  creature('Golgari Findbroker', '{B}{B}{G}{G}', ['Elf', 'Shaman'], 3, 4, {
    text: 'When Golgari Findbroker enters, return target permanent card from your graveyard to your hand.',
    triggers: [
      {
        on: 'etb',
        text: 'Return target permanent card from your graveyard to your hand.',
        targets: [T.yourGraveyard('target permanent card in your graveyard', { notTypes: ['Instant', 'Sorcery'] })],
        effect: (ctx) => {
          const c = ctx.card(0);
          if (c) ctx.moveCard(c.id, 'hand');
        },
      },
    ],
  }),

  // ----- Boros (RW) -----
  legend("Tajic, Legion's Edge", '{1}{R}{W}', ['Human', 'Soldier'], 3, 2, {
    keywords: ['Haste'],
    text: 'Haste\nMentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nPrevent all noncombat damage that would be dealt to other creatures you control.\n{R}{W}: Tajic gains first strike until end of turn.',
    statics: [{ kind: 'preventNoncombatDamageToOtherCreatures' }],
    triggers: [
      {
        on: 'attacks',
        text: 'Mentor: put a +1/+1 counter on target attacking creature with lesser power.',
        targets: [
          T.creature('target attacking creature with lesser power', {
            attacking: true,
            custom: (s, card, _ctl, src) => !!s.cards[src] && getPT(s, card).power < getPT(s, s.cards[src]).power,
          }, { bias: 'self' }),
        ],
        effect: (ctx) => ctx.addCounters(ctx.card(0), '+1/+1', 1),
      },
    ],
    abilities: [{ text: '{R}{W}: Tajic gains first strike until end of turn.', cost: { mana: '{R}{W}' }, effect: (ctx) => ctx.pump(ctx.self, 0, 0, ['First strike']), aiValue: 0 }],
  }),
  instant('Lightning Helix', '{R}{W}', 'Lightning Helix deals 3 damage to any target and you gain 3 life.', {
    targets: [T.any()],
    effect: (ctx) => {
      ctx.damage(ctx.targets[0], 3);
      ctx.gainLife(ctx.controller, 3);
    },
  }),
  enchantment('Assemble the Legion', '{3}{R}{W}', 'At the beginning of your upkeep, put a muster counter on Assemble the Legion. Then create a 1/1 red and white Soldier creature token with haste for each muster counter on Assemble the Legion.', {
    triggers: [
      {
        on: 'yourUpkeep',
        text: 'Add a muster counter, then create that many 1/1 Soldiers with haste.',
        effect: (ctx) => {
          if (!ctx.self) return;
          ctx.addCounters(ctx.self, 'muster', 1);
          ctx.createToken(ctx.controller, 'Haste Soldier Token', ctx.self.counters.muster ?? 0);
        },
      },
    ],
  }),
  creature('Swiftblade Vindicator', '{R}{W}', ['Human', 'Soldier'], 1, 1, {
    keywords: ['Double strike', 'Vigilance', 'Trample'],
    text: 'Double strike, vigilance, trample',
  }),
  creature('Boros Swiftblade', '{R}{W}', ['Human', 'Soldier'], 1, 2, { keywords: ['Double strike'], text: 'Double strike' }),
];
