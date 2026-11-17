import { useState } from 'react';
import type { ClientMessage } from '../../shared/protocol';
import type { NetState } from '../net';

export function RoomScreen({ net, send }: { net: NetState; send: (m: ClientMessage) => void }) {
  const room = net.room!;
  const isHost = room.hostId === net.playerId;
  const me = room.seats.find((s) => s.playerId === net.playerId);
  const [mode, setMode] = useState<'precon' | 'custom'>('precon');
  const [list, setList] = useState('');
  const [botDeck, setBotDeck] = useState('');
  const [showPool, setShowPool] = useState(false);

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <h1>
            Table <span className="room-code big">{room.code}</span>
          </h1>
          <p className="muted">Share this code so friends can join. Up to {room.maxPlayers} players.</p>
        </div>
        <button onClick={() => send({ t: 'leaveRoom' })}>Leave</button>
      </header>

      <div className="room-grid">
        <section className="panel">
          <h2>Players</h2>
          <ul className="seats">
            {room.seats.map((s) => (
              <li key={s.playerId} className={s.ready ? 'ready' : ''}>
                <span className={`dot ${s.connected ? 'on' : 'off'}`} />
                <strong>{s.name}</strong>
                {s.isBot && <span className="tag">BOT</span>}
                {s.playerId === room.hostId && <span className="tag">HOST</span>}
                <span className="muted deck-name">{s.deckName ?? 'choosing a deck…'}</span>
                {isHost && s.playerId !== net.playerId && (
                  <button className="small" onClick={() => send({ t: 'removeSeat', playerId: s.playerId })}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && room.seats.length < room.maxPlayers && (
            <div className="row">
              <select value={botDeck} onChange={(e) => setBotDeck(e.target.value)}>
                <option value="">Bot deck: any</option>
                {net.precons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button onClick={() => send({ t: 'addBot', precon: botDeck || undefined })}>Add bot</button>
            </div>
          )}
          {isHost ? (
            <button className="primary wide" disabled={room.seats.length < 2 || room.seats.some((s) => !s.ready)} onClick={() => send({ t: 'startGame' })}>
              Start game
            </button>
          ) : (
            <p className="muted">Waiting for the host to start…</p>
          )}
        </section>

        <section className="panel">
          <h2>Your deck {me?.deckName && <span className="muted">— {me.deckName}</span>}</h2>
          <div className="tabs">
            <button className={mode === 'precon' ? 'active' : ''} onClick={() => setMode('precon')}>
              Ready-made decks
            </button>
            <button className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
              Paste a decklist
            </button>
          </div>
          {mode === 'precon' ? (
            <ul className="precons">
              {net.precons.map((p) => (
                <li key={p.id} className={me?.deckName === p.name ? 'chosen' : ''} onClick={() => send({ t: 'setDeck', precon: p.id })}>
                  <strong>{p.name}</strong>
                  <span className="muted">Commander: {p.commander}</span>
                  <span>{p.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="custom-deck">
              <textarea
                value={list}
                onChange={(e) => setList(e.target.value)}
                placeholder={'Commander\n1 Adeliz, the Cinder Wind\n\nDeck\n1 Sol Ring\n1 Lightning Bolt\n...\n30 Island'}
                rows={14}
              />
              <div className="row">
                <button className="primary" onClick={() => send({ t: 'setDeck', list })}>
                  Check &amp; use deck
                </button>
                <button onClick={() => setShowPool(!showPool)}>{showPool ? 'Hide' : 'Show'} supported cards</button>
              </div>
              {net.deckCheck && !net.deckCheck.ok && (
                <ul className="errors">
                  {net.deckCheck.errors.slice(0, 12).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {net.deckCheck.errors.length > 12 && <li>…and {net.deckCheck.errors.length - 12} more</li>}
                </ul>
              )}
              {net.deckCheck?.ok && <p className="ok">Deck accepted.</p>}
              {showPool && <div className="pool">{net.cardPool.join(' · ')}</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
