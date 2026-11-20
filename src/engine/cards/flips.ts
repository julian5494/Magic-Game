// Coin-flip cards whose wording is one of a kind.
import type { CardDef, Ctx } from '../cardtypes';
import { getPlayer, hasType } from '../state';
import { creature, enchantment, instant, legend, sorcery, T } from './helpers';

/** Keep flipping while you win, up to a limit or until the player stops (AI: stop after two wins). */
const flipStreak = (ctx: Ctx, max: number) => {
  let wins = 0;
  while (wins < max && ctx.flipCoin(ctx.controller)) wins++;
  return wins;
};

export const FLIPS: CardDef[] = [
  legend('Yusri, Fortune\'s Flame', '{1}{U}{R}', ['Efreet'], 2, 3, {
    keywords: ['Flying'],
    colors: ['U', 'R'],
    text: "Flying\nWhenever Yusri attacks, choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For each flip you lose, Yusri deals 2 damage to you. If you won five flips this way, you may cast spells from your hand this turn without paying their mana costs.",
    triggers: [
      {
        on: 'attacks',
        text: 'Choose how many coins to flip (1–5).',
        effect: (ctx) =>
          ctx.chooseOption(ctx.controller, 'Yusri: how many coins?', [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${n} coin${n > 1 ? 's' : ''}` })), 'flips'),
      },
    ],
    handlers: {
      flips: (ctx, a) => {
        const n = Math.max(1, Math.min(5, Number(a.option) || 1));
        let won = 0;
        for (let i = 0; i < n; i++) {
          if (ctx.flipCoin(ctx.controller)) {
            won++;
            ctx.draw(ctx.controller, 1);
          } else ctx.damage(ctx.controller, 2);
        }
        if (won === 5) {
          getPlayer(ctx.state, ctx.controller).freeCastTurn = ctx.state.turn;
          ctx.log('Yusri won five flips! Spells from your hand are free this turn.');
        }
      },
    },
  }),
  sorcery('Fiery Gambit', '{2}{R}', 'Flip a coin until you lose a flip or choose to stop flipping. If you lose a flip, Fiery Gambit has no effect. If you win one or more flips, Fiery Gambit deals 3 damage to target creature. If you win two or more flips, Fiery Gambit deals 6 damage to each opponent. If you win three or more flips, draw nine cards and untap all lands you control.', {
    targets: [T.creature()],
    effect: (ctx) => ctx.chooseOption(ctx.controller, 'Fiery Gambit: flip how many times at most?', [1, 2, 3].map((n) => ({ id: String(n), label: `Stop after ${n} win${n > 1 ? 's' : ''}` })), 'go'),
    handlers: {
      go: (ctx, a) => {
        const goal = Number(a.option) || 1;
        const wins = flipStreak(ctx, goal);
        if (wins < goal) return ctx.log('Fiery Gambit lost a flip and does nothing.');
        if (wins >= 1) ctx.damage(ctx.targets[0], 3);
        if (wins >= 2) ctx.opponents().forEach((p) => ctx.damage(p, 6));
        if (wins >= 3) {
          ctx.draw(ctx.controller, 9);
          ctx.permanents({ controller: 'you', types: ['Land'] }).forEach((l) => ctx.untap(l));
        }
      },
    },
  }),
  instant("Squee's Revenge", '{1}{U}{R}', 'Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.', {
    effect: (ctx) => ctx.chooseOption(ctx.controller, "Squee's Revenge: choose a number", [1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: String(n) })), 'go'),
    handlers: {
      go: (ctx, a) => {
        const n = Number(a.option) || 1;
        const wins = flipStreak(ctx, n);
        if (wins === n) ctx.draw(ctx.controller, 2 * n);
      },
    },
  }),
  sorcery('Mana Clash', '{R}', "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.", {
    targets: [T.opponent()],
    effect: (ctx) => {
      const opp = ctx.player(0);
      if (!opp) return;
      for (let i = 0; i < 40; i++) {
        const mine = ctx.flipCoin(ctx.controller);
        const theirs = ctx.flipCoin(opp);
        if (!mine) ctx.damage(ctx.controller, 1);
        if (!theirs) ctx.damage(opp, 1);
        if (mine && theirs) break;
        if (getPlayer(ctx.state, ctx.controller).lost || getPlayer(ctx.state, opp).lost) break;
      }
    },
  }),
  creature('Tavern Scoundrel', '{1}{R}', ['Human', 'Rogue'], 1, 3, {
    text: 'Whenever you win a coin flip, create two Treasure tokens.\n{1}, {T}, Sacrifice another permanent: Flip a coin.',
    triggers: [{ on: 'youWinFlip', text: 'Create two Treasure tokens.', effect: (ctx) => ctx.createToken(ctx.controller, 'Treasure Token', 2) }],
    abilities: [{ text: '{1}, {T}, Sacrifice another permanent: Flip a coin.', cost: { mana: '{1}', tap: true, sacrifice: { other: true } }, effect: (ctx) => void ctx.flipCoin(ctx.controller), aiValue: 0 }],
  }),
  instant('Desperate Gambit', '{R}', 'Choose a source you control and flip a coin. If you win the flip, the next time that source would deal damage this turn, it deals double that damage instead. If you lose the flip, the next time it would deal damage this turn, prevent that damage.', {
    effect: (ctx) => {
      const mine = ctx.permanents({ controller: 'you' }).map((c) => c.id);
      if (mine.length) ctx.chooseCards(ctx.controller, 'Desperate Gambit: choose a source you control', mine, 1, 1, 'go');
    },
    handlers: {
      go: (ctx, a) => {
        const c = a.cards?.[0] ? ctx.state.cards[a.cards[0]] : null;
        if (!c) return;
        const won = ctx.flipCoin(ctx.controller);
        (c.dmgMod ??= []).push({ mult: won ? 2 : 0, turn: ctx.state.turn });
        ctx.log(won ? `The next damage ${c.def} deals this turn is doubled.` : `The next damage ${c.def} would deal this turn is prevented.`);
      },
    },
  }),
  enchantment('Impulsive Maneuvers', '{2}{R}{R}', 'Whenever a creature attacks, flip a coin. If you win the flip, the next time that creature would deal combat damage this turn, it deals double that damage instead. If you lose the flip, the next time that creature would deal combat damage this turn, prevent that damage.', {
    triggers: [
      {
        on: 'anyCreatureAttacks',
        text: 'Flip a coin: double or prevent that creature\'s next combat damage this turn.',
        effect: (ctx) => {
          const c = ctx.event?.t === 'attacks' ? ctx.state.cards[ctx.event.card] : null;
          if (!c) return;
          const won = ctx.flipCoin(ctx.controller);
          (c.dmgMod ??= []).push({ mult: won ? 2 : 0, turn: ctx.state.turn, combatOnly: true });
        },
      },
    ],
  }),
  sorcery('Game of Chaos', '{R}{R}{R}', 'Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.', {
    targets: [T.opponent()],
    effect: (ctx) => {
      const opp = ctx.player(0);
      if (opp) gameOfChaos(ctx, opp, 1);
    },
    handlers: {
      again: (ctx, a, data) => {
        if (a.option === 'yes') gameOfChaos(ctx, data.opp, data.stake * 2);
      },
    },
  }),
  instant('Invert Polarity', '{U}{U}{R}', 'Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell.', {
    targets: [T.spell()],
    effect: (ctx) => {
      const t = ctx.targets[0];
      const item = t && t.type === 'stack' ? ctx.state.stack.find((x) => x.id === t.id) : undefined;
      if (!item) return;
      if (ctx.flipCoin(ctx.controller)) {
        item.controller = ctx.controller;
        if (ctx.state.cards[item.cardId]?.zone === 'stack') ctx.state.cards[item.cardId].controller = ctx.controller;
        ctx.log(`You gain control of ${item.def}.`);
      } else ctx.counterSpell(item.id);
    },
  }),
  creature('Karplusan Minotaur', '{2}{R}{R}', ['Minotaur', 'Warrior'], 3, 3, {
    text: "Cumulative upkeep—Flip a coin.\nWhenever you win a coin flip, this creature deals 1 damage to any target.\nWhenever you lose a coin flip, this creature deals 1 damage to any target of an opponent's choice.",
    triggers: [
      {
        on: 'yourUpkeep',
        text: 'Cumulative upkeep—Flip a coin (once for each age counter).',
        effect: (ctx) => {
          if (!ctx.self) return;
          ctx.addCounters(ctx.self, 'age', 1);
          for (let i = 0; i < (ctx.self.counters.age ?? 1); i++) ctx.flipCoin(ctx.controller);
        },
      },
      { on: 'youWinFlip', text: 'Deal 1 damage to any target.', targets: [T.any()], effect: (ctx) => ctx.damage(ctx.targets[0], 1) },
      {
        on: 'youLoseFlip',
        text: "Deal 1 damage to any target of an opponent's choice.",
        effect: (ctx) => {
          const opp = ctx.opponents()[0];
          if (!opp) return;
          const options = [
            ...ctx.players().map((p) => ({ id: `player:${p}`, label: getPlayer(ctx.state, p).name })),
            ...ctx.creatures().map((c) => ({ id: `card:${c.id}`, label: c.def })),
          ];
          ctx.chooseOption(opp, 'Karplusan Minotaur deals 1 damage: choose the target', options, 'pick');
        },
      },
    ],
    handlers: {
      pick: (ctx, a) => {
        const [kind, id] = String(a.option).split(':');
        if (id) ctx.damage(kind === 'player' ? id : ctx.state.cards[id] ? { type: 'card', id } : null, 1);
      },
    },
  }),
  creature('Goblin Traprunner', '{3}{R}', ['Goblin'], 4, 2, {
    text: 'Whenever this creature attacks, flip three coins. For each flip you win, create a 1/1 red Goblin creature token that\'s tapped and attacking.',
    triggers: [
      {
        on: 'attacks',
        text: 'Flip three coins; a 1/1 Goblin token tapped and attacking for each win.',
        effect: (ctx) => {
          let wins = 0;
          for (let i = 0; i < 3; i++) if (ctx.flipCoin(ctx.controller)) wins++;
          const defender = ctx.event?.t === 'attacks' ? ctx.event.defender : ctx.opponents()[0];
          for (const t of ctx.createToken(ctx.controller, 'Goblin Token', wins)) attackWith(ctx, t.id, defender);
        },
      },
    ],
  }),
  enchantment('Mirror March', '{5}{R}', 'Whenever a nontoken creature you control enters, flip a coin until you lose a flip. For each flip you won, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.', {
    triggers: [
      {
        on: 'anyEtb',
        text: 'Flip until you lose; a hasty token copy for each win (exiled at end step).',
        condition: (s, e, self) => e.t === 'etb' && !!s.cards[e.card] && !s.cards[e.card].token && s.cards[e.card].controller === self.controller && hasType(s.cards[e.card], 'Creature'),
        effect: (ctx) => {
          const c = ctx.event?.t === 'etb' ? ctx.state.cards[ctx.event.card] : null;
          if (!c) return;
          let wins = 0;
          while (wins < 20 && ctx.flipCoin(ctx.controller)) wins++;
          const made = ctx.createToken(ctx.controller, c.def, wins);
          for (const t of made) ctx.pump(t, 0, 0, ['Haste']);
          if (made.length) ctx.delay('nextEnd', 'exile', { ids: made.map((t) => t.id) });
        },
      },
    ],
    handlers: {
      exile: (ctx, _a, data) => {
        for (const id of data?.ids ?? []) if (ctx.state.cards[id]?.zone === 'battlefield') ctx.exile(id);
      },
    },
  }),
];

/** Game of Chaos: flip, move the stakes, and let the flip's winner decide whether to go again. */
function gameOfChaos(ctx: Ctx, opp: string, stake: number) {
  if (stake > 1 << 20) return;
  const won = ctx.flipCoin(ctx.controller);
  const [winner, loser] = won ? [ctx.controller, opp] : [opp, ctx.controller];
  ctx.gainLife(winner, stake);
  ctx.loseLife(loser, stake);
  if (getPlayer(ctx.state, loser).life <= 0) return;
  ctx.chooseOption(winner, `Game of Chaos: flip again for ${stake * 2} life?`, [{ id: 'yes', label: `Flip again (${stake * 2})` }, { id: 'no', label: 'Stop' }], 'again', { opp, stake });
}

/** Put a permanent into combat as an attacker ("tapped and attacking"). */
function attackWith(ctx: Ctx, id: string, defender: string) {
  const c = ctx.state.cards[id];
  if (!c || !ctx.state.combat) return;
  c.tapped = true;
  ctx.state.combat.attackers.push({ id, defender, blockedBy: [], blocked: false });
}
