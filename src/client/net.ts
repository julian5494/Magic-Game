import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '../engine/view';
import type { ClientMessage, PreconInfo, RoomSummary, RoomView, ServerMessage } from '../shared/protocol';

export interface ChatLine {
  from: string;
  text: string;
  at: number;
}

export interface NetState {
  connected: boolean;
  playerId: string | null;
  name: string;
  precons: PreconInfo[];
  cardPool: string[];
  rooms: RoomSummary[];
  room: RoomView | null;
  view: GameView | null;
  errors: { id: number; message: string }[];
  chat: ChatLine[];
  deckCheck: Extract<ServerMessage, { t: 'deckCheck' }> | null;
}

const TOKEN_KEY = 'commander-arena-token';
const NAME_KEY = 'commander-arena-name';

function storage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

let errorId = 0;

export function useConnection() {
  const [state, setState] = useState<NetState>({
    connected: false,
    playerId: null,
    name: storage(NAME_KEY) ?? '',
    precons: [],
    cardPool: [],
    rooms: [],
    room: null,
    view: null,
    errors: [],
    chat: [],
    deckCheck: null,
  });
  const ws = useRef<WebSocket | null>(null);
  const closed = useRef(false);

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    ws.current = socket;
    socket.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
      socket.send(JSON.stringify({ t: 'hello', token: storage(TOKEN_KEY) ?? undefined, name: storage(NAME_KEY) ?? undefined }));
    };
    socket.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      if (!closed.current) setTimeout(connect, 1200);
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      setState((s) => reduce(s, msg));
    };
  }, []);

  useEffect(() => {
    closed.current = false;
    connect();
    return () => {
      closed.current = true;
      ws.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (msg.t === 'setName') store(NAME_KEY, msg.name);
    ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg));
  }, []);

  const dismissError = useCallback((id: number) => {
    setState((s) => ({ ...s, errors: s.errors.filter((e) => e.id !== id) }));
  }, []);

  return { state, send, dismissError };
}

function reduce(s: NetState, msg: ServerMessage): NetState {
  switch (msg.t) {
    case 'welcome':
      store(TOKEN_KEY, msg.token);
      store(NAME_KEY, msg.name);
      return { ...s, playerId: msg.playerId, name: msg.name, precons: msg.precons, cardPool: msg.cardPool };
    case 'rooms':
      return { ...s, rooms: msg.rooms };
    case 'room':
      return { ...s, room: msg.room, view: msg.room ? s.view : null, deckCheck: msg.room ? s.deckCheck : null };
    case 'game':
      return { ...s, view: msg.view };
    case 'deckCheck':
      return { ...s, deckCheck: msg };
    case 'error':
      return { ...s, errors: [...s.errors.slice(-3), { id: ++errorId, message: msg.message }] };
    case 'chat':
      return { ...s, chat: [...s.chat.slice(-99), { from: msg.from, text: msg.text, at: msg.at }] };
  }
}
