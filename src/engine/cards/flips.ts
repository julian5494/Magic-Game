// Coin-flip cards whose wording is one of a kind.
import type { CardDef, Ctx } from '../cardtypes';
import { getPlayer } from '../state';
import { creature, instant, legend, sorcery, T } from './helpers';

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
        if (won === 5) ctx.log('Yusri won five flips! (Casting spells for free this turn is not automated yet.)');
      },
    },
    unsupported: ['If you won five flips, you may cast spells from your hand this turn without paying their mana costs.'],
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
];
