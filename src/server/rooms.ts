import {
  act, buildPrecon, buildView, chooseBotAction, createGame, PRECONS, RulesError,
} from '../engine';
import type { Action, DeckList, GameState } from '../engine';
import type { GameView } from '../engine/view';
import type { RoomSummary, RoomView, ServerMessage } from '../shared/protocol';
import { bulkCard, tokenImage } from './bulk';
import { prepareDeck } from './decks';

export interface Seat {
  playerId: string;
  name: string;
  isBot: boolean;
  deck: DeckList | null;
  deckName: string | null;
}

export interface Client {
  playerId: string;
  name: string;
  send(msg: ServerMessage): void;
  connected: boolean;
}

const MAX_PLAYERS = 4;
const BOT_DELAY_MS = 450;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;

function code(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

export class Room {
  seats: Seat[] = [];
  state: GameState | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private botCounter = 0;
  emptySince: number | null = null;

  constructor(
    public code: string,
    public hostId: string,
    private clients: Map<string, Client>,
  ) {}

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      started: !!this.state,
      maxPlayers: MAX_PLAYERS,
      seats: this.seats.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        isBot: s.isBot,
        connected: s.isBot || !!this.clients.get(s.playerId)?.connected,
        deckName: s.deckName,
        ready: !!s.deck,
      })),
    };
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      players: this.seats.length,
      maxPlayers: MAX_PLAYERS,
      started: !!this.state,
      host: this.seats.find((s) => s.playerId === this.hostId)?.name ?? '?',
    };
  }

  has(playerId: string): boolean {
    return this.seats.some((s) => s.playerId === playerId);
  }

  join(client: Client): void {
    if (this.has(client.playerId)) return;
    if (this.state) throw new Error('That game has already started');
    if (this.seats.length >= MAX_PLAYERS) throw new Error('That table is full');
    this.seats.push({ playerId: client.playerId, name: client.name, isBot: false, deck: null, deckName: null });
  }

  leave(playerId: string): void {
    if (this.state) {
      // Leaving a running game concedes.
      const p = this.state.players.find((x) => x.id === playerId);
      if (p && !p.lost) this.applyAction(playerId, { type: 'concede' });
      return;
    }
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
    if (this.hostId === playerId) {
      const human = this.seats.find((s) => !s.isBot);
      if (human) this.hostId = human.playerId;
    }
  }

  isEmpty(): boolean {
    return !this.seats.some((s) => !s.isBot && this.clients.get(s.playerId)?.connected);
  }

  async setDeck(playerId: string, precon?: string, source?: string, commanders?: string[]): Promise<ServerMessage> {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat) throw new Error('You are not seated at this table');
    if (this.state) throw new Error('The game has already started');
    if (precon) {
      const p = PRECONS.find((x) => x.id === precon);
      if (!p) throw new Error('Unknown precon');
      seat.deck = buildPrecon(precon);
      seat.deckName = p.name;
      return { t: 'deckCheck', ok: true, errors: [], warnings: [], deckName: p.name };
    }
    const report = await prepareDeck({ source: source ?? '', commanders });
    if (this.state) throw new Error('The game has already started');
    if (report.ok && report.deck) {
      seat.deck = report.deck;
      seat.deckName = report.deckName ?? report.deck.commanders.join(' & ');
    }
    return {
      t: 'deckCheck',
      ok: report.ok,
      errors: report.errors,
      warnings: report.warnings,
      deckName: report.deckName,
      commanderCandidates: report.commanderCandidates,
      coverage: report.coverage,
    };
  }

  addBot(precon?: string): void {
    if (this.state) throw new Error('The game has already started');
    if (this.seats.length >= MAX_PLAYERS) throw new Error('The table is full');
    const used = new Set(this.seats.map((s) => s.deckName));
    const p = PRECONS.find((x) => x.id === precon) ?? PRECONS.find((x) => !used.has(x.name)) ?? PRECONS[0];
    this.botCounter++;
    this.seats.push({
      playerId: `bot-${this.code}-${this.botCounter}`,
      name: `Bot ${this.botCounter}`,
      isBot: true,
      deck: buildPrecon(p.id),
      deckName: p.name,
    });
  }

  removeSeat(playerId: string): void {
    if (this.state) throw new Error('The game has already started');
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
  }

  start(): void {
    if (this.state) throw new Error('Already started');
    if (this.seats.length < 2) throw new Error('Need at least 2 players (add a bot to play solo)');
    const missing = this.seats.find((s) => !s.deck);
    if (missing) throw new Error(`${missing.name} hasn't chosen a deck yet`);
    this.state = createGame(
      this.seats.map((s) => ({ id: s.playerId, name: s.name, commander: s.deck!.commanders, cards: s.deck!.cards, art: s.deck!.art, isBot: s.isBot })),
      Math.floor(Math.random() * 2147483647),
    );
    this.broadcastGame();
    this.scheduleBots();
  }

  applyAction(playerId: string, action: Action): void {
    if (!this.state) throw new Error('No game in progress');
    try {
      this.state = act(this.state, playerId, action);
    } catch (e) {
      if (e instanceof RulesError) throw e;
      console.error('Engine error', e);
      throw new Error(`Engine error: ${(e as Error).message}`);
    }
    this.broadcastGame();
    this.scheduleBots();
  }

  broadcastGame(): void {
    if (!this.state) return;
    for (const seat of this.seats) {
      if (seat.isBot) continue;
      const c = this.clients.get(seat.playerId);
      if (c?.connected) c.send({ t: 'game', view: withTokenArt(buildView(this.state, seat.playerId)) });
    }
  }

  sendGameTo(playerId: string): void {
    const c = this.clients.get(playerId);
    if (c && this.state) c.send({ t: 'game', view: withTokenArt(buildView(this.state, playerId)) });
  }

  broadcastRoom(): void {
    const view = this.view();
    for (const seat of this.seats) {
      if (seat.isBot) continue;
      this.clients.get(seat.playerId)?.send({ t: 'room', room: view });
    }
  }

  broadcast(msg: ServerMessage): void {
    for (const seat of this.seats) if (!seat.isBot) this.clients.get(seat.playerId)?.send(msg);
  }

  private scheduleBots(): void {
    if (this.botTimer || !this.state || this.state.phase === 'over') return;
    const bots = this.seats.filter((s) => s.isBot);
    if (!bots.length) return;
    // Passing and routine decisions happen almost instantly; real plays get a short pause so humans can follow.
    let delay = BOT_DELAY_MS;
    for (const b of bots) {
      const next = chooseBotAction(this.state, b.playerId);
      if (!next) continue;
      const routine = next.type === 'pass' || (next.type === 'decide' && this.state.decisions[0]?.kind !== 'declareAttackers');
      delay = routine ? 40 : BOT_DELAY_MS;
      break;
    }
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (!this.state) return;
      for (const b of bots) {
        const action = chooseBotAction(this.state, b.playerId);
        if (!action) continue;
        try {
          this.applyAction(b.playerId, action);
        } catch (e) {
          console.error(`Bot ${b.name} made an illegal action`, action, e);
          // Fall back to passing / conceding so the game can't get stuck on a bot.
          try {
            this.applyAction(b.playerId, action.type === 'decide' ? { type: 'concede' } : { type: 'pass' });
          } catch {
            this.applyAction(b.playerId, { type: 'concede' });
          }
        }
        return;
      }
    }, delay);
  }
}

export class Lobby {
  rooms = new Map<string, Room>();
  constructor(private clients: Map<string, Client>) {}

  create(host: Client): Room {
    let c = code();
    while (this.rooms.has(c)) c = code();
    const room = new Room(c, host.playerId, this.clients);
    room.join(host);
    this.rooms.set(c, room);
    return room;
  }

  roomOf(playerId: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.has(playerId)) return r;
    return undefined;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.isEmpty()).map((r) => r.summary());
  }

  /** Remove tables that have had no connected humans for a while (keeps them through page refreshes). */
  cleanup(): void {
    const now = Date.now();
    for (const [c, r] of this.rooms) {
      if (!r.isEmpty()) {
        r.emptySince = null;
        continue;
      }
      r.emptySince ??= now;
      if (now - r.emptySince > EMPTY_ROOM_TTL_MS) this.rooms.delete(c);
    }
  }
}

/** Give tokens their real art from Scryfall's token printings. */
function withTokenArt(view: GameView): GameView {
  for (const c of Object.values(view.cards)) {
    if (!c.token || c.image) continue;
    // Engine token names look like "Treasure Token" or "Lifelink Soldier Token"; Scryfall's are "Treasure", "Soldier".
    const bare = c.name.replace(/\s+Token$/i, '');
    const subtypes = c.typeLine.split('—')[1]?.trim().split(/\s+/) ?? [];
    const candidates = [c.name, bare, subtypes.join(' '), ...subtypes, bare.split(/\s+/).pop() ?? ''];
    for (const name of candidates) {
      if (!name) continue;
      c.image = tokenImage(name, c.colors, c.types, c.basePower, c.baseToughness);
      if (c.image) break;
    }
    // A token copy of a real card (e.g. from a clone effect) uses that card's art.
    if (!c.image) {
      const real = bulkCard(c.name);
      c.image = real?.image_uris?.normal ?? real?.card_faces?.[0]?.image_uris?.normal;
    }
  }
  return view;
}
