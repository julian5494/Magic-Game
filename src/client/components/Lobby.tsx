import { useEffect, useState } from 'react';
import type { ClientMessage } from '../../shared/protocol';
import type { NetState } from '../net';

export function Lobby({ net, send }: { net: NetState; send: (m: ClientMessage) => void }) {
  const [name, setName] = useState(net.name);
  const [code, setCode] = useState('');

  useEffect(() => {
    send({ t: 'listRooms' });
    const t = setInterval(() => send({ t: 'listRooms' }), 4000);
    return () => clearInterval(t);
  }, [send]);

  const saveName = () => {
    if (name.trim() && name !== net.name) send({ t: 'setName', name });
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>Commander Arena</h1>
        <p className="tagline">Four-player Commander with automated rules.</p>
      </header>
      <section className="panel">
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
        </label>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              saveName();
              send({ t: 'createRoom' });
            }}
          >
            Create a table
          </button>
          <span className="or">or</span>
          <input className="code-input" placeholder="CODE" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button
            disabled={code.length !== 4}
            onClick={() => {
              saveName();
              send({ t: 'joinRoom', code });
            }}
          >
            Join
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Open tables</h2>
        {net.rooms.length === 0 && <p className="muted">No open tables. Create one and share its code with friends, or add bots to play solo.</p>}
        <ul className="room-list">
          {net.rooms.map((r) => (
            <li key={r.code}>
              <span className="room-code">{r.code}</span>
              <span>{r.host}'s table</span>
              <span className="muted">
                {r.players}/{r.maxPlayers} {r.started ? '· in progress' : ''}
              </span>
              <button disabled={r.started || r.players >= r.maxPlayers} onClick={() => send({ t: 'joinRoom', code: r.code })}>
                Join
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel muted small">
        <p>
          Bring any Commander deck: paste an Archidekt or Moxfield link or any exported decklist. Card rules are read from
          Scryfall and automated; anything the game can't enforce yet is clearly marked, and there are no manual "move a card"
          actions, so nobody can draw or tutor when they shouldn't.
        </p>
      </section>
    </div>
  );
}
