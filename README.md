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

## Bring your own deck

There's no card collection: import any Commander deck.

- **Archidekt link**: paste the deck URL.
- **Moxfield**: Moxfield blocks automated downloads, so open the deck, choose *More → Export*, copy the text and paste it. A Moxfield link is tried first and you'll get these instructions if it's blocked.
- **Any other site** (MTGGoldfish, EDHREC, Arena, MTGO…): paste the exported text. `1 Sol Ring (CMR) 472` lines keep the printing, so your chosen card art is what everyone sees.

Every card is looked up on [Scryfall](https://scryfall.com) (cached in `.cache/`), and its rules text is turned into automated effects by `src/engine/oracle.ts`. Deck validation enforces 100 cards, singleton (with "any number of cards named" exceptions), color identity, partner and background pairings, and the Commander banned list.

After importing, you get a coverage report:

- **Fully automated**: everything on the card works.
- **Partly automated**: playable, but some abilities (for example flashback or a cost reduction) aren't automated yet. Those abilities simply don't happen, and the card shows a "!" with details.
- **Can't be played yet**: the card has a drawback or core effect the engine can't enforce (for example "doesn't untap during your untap step" or "As an additional cost, discard a card"). These stay in your deck but can't be cast, because casting them without the drawback would be cheating.

The server downloads Scryfall's free **bulk card database** (every card, about 25 MB, refreshed weekly) into `.cache/`, so every Commander-legal card is known locally. Imports don't depend on Scryfall being reachable, and only specific printings (for art) are looked up live.

Current automation, across all 32,700 Commander-legal cards (run `npx tsx tests/coverage-all.ts`):

| Cards (by EDHREC popularity) | Fully automated | Playable, some abilities missing | Can't be played yet |
|---|---|---|---|
| Top 100 | 82% | 12% | 6% |
| Top 500 | 60% | 32% | 9% |
| Top 2,000 | 35% | 51% | 14% |
| All cards | 22% | 61% | 16% |

Tools for growing coverage:
- `npx tsx tests/signatures.ts 2000` lists the most common sentences and triggers the parser still fails on.
- `npx tsx tests/stress-bulk.ts 40 40000` has bots play games with random decks from the whole card pool, to catch runtime errors.

## Fair play: no manual actions

Unlike tabletop simulators, there's no way to drag a card, draw, shuffle, untap or change a life total by hand. The server is authoritative: every message is checked against the rules, and only actions from the current legal set are accepted. Cards you can't see (hands, libraries, search results) are never sent to your browser. `tests/security.test.ts` checks this, including a fuzz test that throws random illegal actions at the engine.

## Priority, like at a real table

- Nothing resolves until **every player passes priority in turn**; any response restarts the round. Player panels show who has passed and who is responding.
- Triggered abilities go on the stack and can be responded to. If several of your abilities trigger at once, you choose their order.
- **Hold priority** (checkbox) keeps priority after you cast something, so you can respond to your own spell.
- **Stops** setting:
  - *Smart* (Arena-like): skips moments where you have no possible response.
  - *Every spell & ability opponents use*: always gives you a chance to respond, so pausing never reveals that you hold nothing.
  - *Full control*: stops at every step.

## What's automated

- **Turn structure & priority**: all steps and phases. Space bar presses the main button.
- **Stack**: spells, modal spells ("Choose one —"), activated and triggered abilities, and counterspells. Targets are re-checked on resolution (fizzling).
- **Mana**: auto-payment that taps basics before flexible sources, avoids painlands and sacrifice sources, and pays hybrid costs. Multi-mana lands, shock/check/fast/bounce lands, and Signet-style abilities work.
- **Combat**: attacking specific opponents, blocking (flying/reach, menace, unblockable), first strike, double strike, trample, deathtouch and lifelink.
- **State-based actions**: lethal damage, 0 toughness, the legend rule, aura/equipment cleanup, and counter cancellation. Players lose at 0 life, on drawing from an empty library, or at 21 commander damage.
- **Commander rules**: 40 life, command zone, commander tax, partners, the choice to move your commander to the command zone, and a free first mulligan (London mulligan).
- **Card mechanics**: planeswalkers (loyalty abilities, damage, being attacked); kicker, flashback, overload and cycling; alternative and free casts; ward; storm and spell copies; "counter unless pays" and Rhystic Study-style taxes; clones and token copies; exile-and-play; modal double-faced lands; counting ("for each…", "equal to…"); variable power/toughness; surveil, proliferate and monarch; activation restrictions; and many trigger types.

## Layout

```
src/engine/   rules engine (pure TypeScript, JSON game state, no I/O)
src/server/   WebSocket server: tables, seats, bots, reconnection
src/client/   React UI
src/shared/   client/server protocol types
tests/        rules tests and bot-vs-bot simulation (npx tsx tests/simulate.ts 20)
```

## Hosting notes

The server needs outbound HTTPS to `api.scryfall.com` and `archidekt.com` (and tries `api2.moxfield.com`). Behind a corporate proxy, start it with `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`. Players' browsers load card images from `cards.scryfall.io`.

## Not yet supported

Transforming double-faced cards and back-face spells, sagas and classes, "choose a creature type", replacement effects (Doubling Season, etc.), protection, damage division, and modal triggered abilities. Cards that need these are marked as described above. Bots are heuristic and fairly weak.

Card images are loaded from Scryfall. This is unofficial fan content permitted under the Wizards of the Coast Fan Content Policy; it is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
