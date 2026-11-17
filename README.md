# Commander Arena

An online, browser-based Magic: The Gathering **Commander** game with an automated rules engine, in the spirit of MTG Arena. The server enforces the rules: it handles priority, the stack, combat, triggers, state-based actions and mana payment, so players only make the decisions that matter.

## Quick start

```bash
npm install
npm run dev          # server on :3000 + Vite client on http://localhost:5173
```

Production (one process serves the client and the WebSocket):

```bash
npm run build
npm start            # http://localhost:3000  (PORT env var to change)
```

Open the page, create a table, pick a deck, then add bots or share the 4-letter table code with friends (2–4 players). Refreshing the page reconnects you to your seat.

## What's automated

- **Turn structure & priority**: all steps and phases. Arena-style smart auto-pass skips steps where you have nothing to do (turn on *Full control* to stop at every step). Space bar presses the main button.
- **Stack**: spells, activated and triggered abilities, responses, counterspells, and targets re-checked on resolution (fizzling).
- **Mana**: auto-payment that taps basics before flexible sources. You can also click lands to float mana.
- **Combat**: attacking specific opponents, blocking (flying/reach, menace, unblockable), first strike, double strike, trample, deathtouch and lifelink.
- **State-based actions**: lethal damage, 0 toughness, the legend rule, aura/equipment cleanup, +1/+1 and -1/-1 counter cancellation, and losing at 0 life, on drawing from an empty library, or at 21 commander damage.
- **Commander rules**: 40 life, command zone, commander tax, choosing to move your commander to the command zone, a free first mulligan (London mulligan), color identity and singleton deck validation. When a player loses, their cards leave the game.
- **Hidden information**: opponents' hands and libraries are never sent to your browser.

## Cards

About 210 cards are scripted, all playable in custom decks, plus four ready-made 100-card decks:

| Deck | Commander |
|---|---|
| GW tokens & lifegain | Trostani, Selesnya's Voice |
| UR spells | Adeliz, the Cinder Wind |
| BG graveyard | Izoni, Thousand-Eyed |
| RW aggro | Tajic, Legion's Edge |

Custom decklists use the usual `1 Card Name` format with a `Commander` section. Only implemented cards are accepted; the room screen lists them.

### Adding a card

Cards are plain data plus small effect functions in `src/engine/cards/*.ts`:

```ts
creature('Flametongue Kavu', '{3}{R}', ['Kavu'], 4, 2, {
  text: 'When Flametongue Kavu enters, it deals 4 damage to target creature.',
  triggers: [{ on: 'etb', text: 'Deal 4 damage to target creature.', targets: [T.creature()], effect: dmg(4) }],
}),
```

The effect context (`Ctx` in `src/engine/cardtypes.ts`) has the building blocks: damage, draw, destroy, exile, bounce, tokens, counters, pump, search, scry, sacrifice, discard, fight, control changes, and player choices.

## Layout

```
src/engine/   rules engine (pure TypeScript, JSON game state, no I/O)
src/server/   WebSocket server: tables, seats, bots, reconnection
src/client/   React UI
src/shared/   client/server protocol types
tests/        rules tests and bot-vs-bot simulation (npx tsx tests/simulate.ts 20)
```

## Not yet supported

Planeswalkers, partner commanders, copy/clone effects, modal ("choose one") spells, damage division, regeneration and protection. Bots are heuristic and fairly weak.

Card images are loaded from Scryfall. This is unofficial fan content permitted under the Wizards of the Coast Fan Content Policy; it is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
