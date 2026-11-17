import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { cardPool, PRECONS } from '../engine';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { type Client, Lobby } from './rooms';

const PORT = Number(process.env.PORT ?? 3000);
const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Commander Arena server is running. In development open the Vite client at http://localhost:5173 (npm run dev).');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

interface Session extends Client {
  token: string;
  socket: WebSocket | null;
}

const sessions = new Map<string, Session>(); // token -> session
const clients = new Map<string, Client>(); // playerId -> session
const lobby = new Lobby(clients);
const POOL = cardPool();
const PRECON_INFO = PRECONS.map(({ id, name, description, commander }) => ({ id, name, description, commander }));

function cleanName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 24);
  return s || `Planeswalker${Math.floor(Math.random() * 1000)}`;
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  let session: Session | null = null;
  const send = (msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const fail = (message: string) => send({ t: 'error', message });

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return fail('Bad message');
    }
    try {
      if (msg.t === 'hello') {
        const existing = msg.token ? sessions.get(msg.token) : undefined;
        if (existing) {
          session = existing;
          if (msg.name) session.name = cleanName(msg.name);
        } else {
          const token = randomUUID();
          session = { token, playerId: randomUUID(), name: cleanName(msg.name), connected: true, socket: null, send: () => {} };
          sessions.set(token, session);
        }
        const s = session;
        s.socket?.close();
        s.socket = socket;
        s.connected = true;
        s.send = (m) => {
          if (s.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(JSON.stringify(m));
        };
        clients.set(s.playerId, s);
        send({ t: 'welcome', token: s.token, playerId: s.playerId, name: s.name, precons: PRECON_INFO, cardPool: POOL });
        const room = lobby.roomOf(s.playerId);
        send({ t: 'room', room: room?.view() ?? null });
        if (room?.state) room.sendGameTo(s.playerId);
        room?.broadcastRoom();
        return;
      }
      if (!session) return fail('Say hello first');
      const me = session;
      const room = lobby.roomOf(me.playerId);
      switch (msg.t) {
        case 'setName':
          me.name = cleanName(msg.name);
          if (room) {
            const seat = room.seats.find((x) => x.playerId === me.playerId);
            if (seat && !room.state) seat.name = me.name;
            room.broadcastRoom();
          }
          return;
        case 'listRooms':
          lobby.cleanup();
          send({ t: 'rooms', rooms: lobby.list() });
          return;
        case 'createRoom': {
          if (room) room.leave(me.playerId);
          const r = lobby.create(me);
          r.broadcastRoom();
          return;
        }
        case 'joinRoom': {
          const r = lobby.rooms.get(String(msg.code).toUpperCase().trim());
          if (!r) return fail('No table with that code');
          if (room && room !== r) room.leave(me.playerId);
          r.join(me);
          r.broadcastRoom();
          if (r.state) r.sendGameTo(me.playerId);
          return;
        }
        case 'leaveRoom':
          if (room) {
            room.leave(me.playerId);
            if (!room.state) room.broadcastRoom();
            if (room.state) {
              room.seats = room.seats.filter((x) => x.playerId !== me.playerId || x.isBot);
            }
          }
          send({ t: 'room', room: null });
          send({ t: 'game', view: null });
          lobby.cleanup();
          return;
        case 'setDeck':
          if (!room) return fail('Join a table first');
          send(room.setDeck(me.playerId, msg.precon, msg.list));
          room.broadcastRoom();
          return;
        case 'addBot':
          if (!room) return fail('Join a table first');
          if (room.hostId !== me.playerId) return fail('Only the host can add bots');
          room.addBot(msg.precon);
          room.broadcastRoom();
          return;
        case 'removeSeat':
          if (!room) return fail('Join a table first');
          if (room.hostId !== me.playerId) return fail('Only the host can remove players');
          room.removeSeat(msg.playerId);
          room.broadcastRoom();
          clients.get(msg.playerId)?.send({ t: 'room', room: null });
          return;
        case 'startGame':
          if (!room) return fail('Join a table first');
          if (room.hostId !== me.playerId) return fail('Only the host can start the game');
          room.start();
          room.broadcastRoom();
          return;
        case 'action':
          if (!room) return fail('You are not in a game');
          room.applyAction(me.playerId, msg.action);
          return;
        case 'chat': {
          if (!room) return;
          const text = String(msg.text ?? '').slice(0, 300).trim();
          if (text) room.broadcast({ t: 'chat', from: me.name, text, at: Date.now() });
          return;
        }
      }
    } catch (e) {
      fail((e as Error).message);
    }
  });

  socket.on('close', () => {
    if (session && session.socket === socket) {
      session.connected = false;
      session.socket = null;
      lobby.roomOf(session.playerId)?.broadcastRoom();
    }
  });
});

// Drop empty tables periodically.
setInterval(() => lobby.cleanup(), 60_000).unref();

server.listen(PORT, () => {
  console.log(`Commander Arena server listening on http://localhost:${PORT}`);
});
