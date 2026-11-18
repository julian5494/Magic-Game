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
              Import a deck
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
              <p className="muted small">
                Paste an <strong>Archidekt</strong> or <strong>Moxfield</strong> link, or the decklist text exported from any site
                (Moxfield: <em>More → Export</em>; Archidekt, MTGGoldfish, EDHREC and Arena exports all work). Every card is looked up on
                Scryfall, including the printing (art) you picked.
              </p>
              <textarea
                value={list}
                onChange={(e) => setList(e.target.value)}
                placeholder={'https://archidekt.com/decks/123456/my-deck\n\n— or —\n\nCommander\n1 Atraxa, Praetors\' Voice (2X2) 190\n\nDeck\n1 Sol Ring (CMR) 472\n...'}
                rows={12}
              />
              <div className="row">
                <button className="primary" disabled={!list.trim() || net.deckCheck?.pending} onClick={() => send({ t: 'setDeck', source: list })}>
                  {net.deckCheck?.pending ? 'Importing…' : 'Import deck'}
                </button>
              </div>
              <DeckReport net={net} onPickCommander={(c) => send({ t: 'setDeck', source: list, commanders: c })} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DeckReport({ net, onPickCommander }: { net: NetState; onPickCommander: (c: string[]) => void }) {
  const r = net.deckCheck;
  const [picked, setPicked] = useState<string[]>([]);
  const [showPartial, setShowPartial] = useState(false);
  if (!r || r.pending) return null;
  const cov = r.coverage;
  return (
    <div className="deck-report">
      {r.ok ? <p className="ok">Deck accepted{r.deckName ? `: ${r.deckName}` : ''}.</p> : null}
      {r.errors.length > 0 && (
        <ul className="errors">
          {r.errors.slice(0, 12).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
          {r.errors.length > 12 && <li>…and {r.errors.length - 12} more</li>}
        </ul>
      )}
      {r.commanderCandidates && r.commanderCandidates.length > 0 && !r.ok && (
        <div className="cmd-pick">
          <span>Commander (pick 1, or 2 partners):</span>
          <div className="chips">
            {r.commanderCandidates.map((c) => (
              <button
                key={c}
                className={picked.includes(c) ? 'active' : ''}
                onClick={() => setPicked(picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c].slice(-2))}
              >
                {c}
              </button>
            ))}
          </div>
          <button className="primary" disabled={!picked.length} onClick={() => onPickCommander(picked)}>
            Use as commander
          </button>
        </div>
      )}
      {cov && (
        <div className="coverage">
          <div className="cov-bar">
            <span className="cov-auto" style={{ flex: cov.automated }} title="Fully automated" />
            <span className="cov-partial" style={{ flex: cov.partial.length }} title="Partly automated" />
            <span className="cov-blocked" style={{ flex: cov.blocked.length }} title="Can't be played yet" />
          </div>
          <div className="small">
            <span className="cov-dot auto" /> {cov.automated} fully automated · <span className="cov-dot partial" /> {cov.partial.length} partly ·{' '}
            <span className="cov-dot blocked" /> {cov.blocked.length} can't be played yet
            <button className="link" onClick={() => setShowPartial(!showPartial)}>
              {showPartial ? 'hide details' : 'details'}
            </button>
          </div>
          {showPartial && (
            <ul className="cov-list small">
              {cov.blocked.map((b) => (
                <li key={b.name}>
                  <strong className="blocked-text">{b.name}</strong> — can't be cast yet: {b.missing.join(' / ') || 'its effect isn\'t supported'}
                </li>
              ))}
              {cov.partial.map((b) => (
                <li key={b.name}>
                  <strong>{b.name}</strong> — not automated (won't happen): {b.missing.join(' / ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {r.warnings.length > 0 && !cov && (
        <ul className="muted small">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
