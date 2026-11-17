import type { Action } from '../engine/types';
import type { GameView } from '../engine/view';

export interface PreconInfo {
  id: string;
  name: string;
  description: string;
  commander: string;
}

export interface SeatView {
  playerId: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  deckName: string | null;
  ready: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  seats: SeatView[];
  started: boolean;
  maxPlayers: number;
}

export interface RoomSummary {
  code: string;
  players: number;
  maxPlayers: number;
  started: boolean;
  host: string;
}

export type ClientMessage =
  | { t: 'hello'; token?: string; name?: string }
  | { t: 'setName'; name: string }
  | { t: 'listRooms' }
  | { t: 'createRoom' }
  | { t: 'joinRoom'; code: string }
  | { t: 'leaveRoom' }
  | { t: 'setDeck'; precon?: string; list?: string }
  | { t: 'addBot'; precon?: string }
  | { t: 'removeSeat'; playerId: string }
  | { t: 'startGame' }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string };

export type ServerMessage =
  | { t: 'welcome'; token: string; playerId: string; name: string; precons: PreconInfo[]; cardPool: string[] }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomView | null }
  | { t: 'game'; view: GameView | null }
  | { t: 'deckCheck'; ok: boolean; errors: string[]; warnings: string[]; deckName?: string }
  | { t: 'error'; message: string }
  | { t: 'chat'; from: string; text: string; at: number };
