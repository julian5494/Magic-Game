import { useEffect, useRef, useState } from 'react';
import type { CardId, Decision, LogEntry, PlayerId, Step, Target } from '../../engine/types';
import type { CardView, GameView, PlayerView, StackView } from '../../engine/view';
import type { ChatLine } from '../net';
import { Card, ManaText } from './Card';

export const STEP_LABELS: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Combat',
  declareAttackers: 'Attackers',
  declareBlockers: 'Blockers',
  firstStrikeDamage: 'First strike',
  combatDamage: 'Damage',
  endCombat: 'End combat',
  main2: 'Main 2',
  end: 'End',
  cleanup: 'Cleanup',
};
const TRACKER: Step[] = ['upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'main2', 'end'];

export function PhaseTracker({ view }: { view: GameView }) {
  const active = view.players.find((p) => p.id === view.activePlayer);
  const step = view.step === 'firstStrikeDamage' ? 'combatDamage' : view.step === 'endCombat' ? 'combatDamage' : view.step;
  return (
    <div className="phases">
      <span className="turn-label">
        Turn {view.turn} · {active?.id === view.you ? 'Your turn' : `${active?.name}'s turn`}
      </span>
      {TRACKER.map((s) => (
        <span key={s} className={`phase ${s === step ? 'current' : ''}`}>
          {STEP_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

export interface ZoneOpen {
  title: string;
  cards: CardId[];
}

export function PlayerPanel({
  p,
  view,
  selectable,
  attackTarget,
  onClick,
  onZone,
  onHover,
  isMe,
}: {
  p: PlayerView;
  view: GameView;
  selectable: boolean;
  attackTarget: boolean;
  onClick: () => void;
  onZone: (z: ZoneOpen) => void;
  onHover: (c: CardView | null) => void;
  isMe?: boolean;
}) {
  const active = view.activePlayer === p.id;
  const waiting = view.waitingOn.includes(p.id);
  const passed = view.stack.length > 0 && view.passes.includes(p.id);
  const pool = Object.entries(p.manaPool).filter(([, n]) => n > 0);
  return (
    <div
      className={`player-panel ${active ? 'active' : ''} ${waiting ? 'waiting' : ''} ${selectable ? 'selectable' : ''} ${attackTarget ? 'attack-target' : ''} ${p.lost ? 'lost' : ''}`}
      onClick={onClick}
    >
      <div className="pp-top">
        <span className="pp-name">
          {p.name}
          {p.isBot && <span className="tag">BOT</span>}
          {isMe && <span className="tag">YOU</span>}
        </span>
        {view.stack.length > 0 && !p.lost && (
          <span className={`pass-chip ${passed ? 'passed' : waiting ? 'deciding' : ''}`} title="Priority">
            {passed ? 'passed' : waiting ? 'responding…' : 'to act'}
          </span>
        )}
        <span className="pp-life" title="Life">
          {p.life}
        </span>
      </div>
      {p.lost ? (
        <div className="pp-lost">Out — {p.lossReason}</div>
      ) : (
        <>
          <div className="pp-stats">
            <span title="Cards in hand">✋ {p.handCount}</span>
            <span title="Library">📚 {p.libraryCount}</span>
            <button className="link" onClick={(e) => { e.stopPropagation(); onZone({ title: `${p.name}'s graveyard`, cards: p.graveyard }); }}>
              🪦 {p.graveyard.length}
            </button>
            <button className="link" onClick={(e) => { e.stopPropagation(); onZone({ title: `${p.name}'s exile`, cards: p.exile }); }}>
              ⛔ {p.exile.length}
            </button>
            {p.poison > 0 && <span title="Poison">☠ {p.poison}</span>}
            <span className="identity">
              {p.colorIdentity.map((c) => (
                <span key={c} className={`pip pip-${c}`}>{c}</span>
              ))}
            </span>
          </div>
          {p.commanderDamage.filter((d) => d.amount > 0).length > 0 && (
            <div className="pp-cmd-dmg">
              {p.commanderDamage.filter((d) => d.amount > 0).map((d) => (
                <span key={d.commander} title="Commander damage taken">
                  ★ {d.name}: {d.amount}/21
                </span>
              ))}
            </div>
          )}
          {pool.length > 0 && (
            <div className="pp-pool">
              {pool.map(([k, n]) => (
                <span key={k}>
                  <ManaText text={`{${k}}`} />×{n}
                </span>
              ))}
            </div>
          )}
          {p.command.length > 0 && (
            <div className="pp-command">
              {p.command.map((id) => view.cards[id] && <Card key={id} card={view.cards[id]} size="tiny" onHover={onHover} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function StackPanel({
  view,
  selectable,
  onClick,
  onHover,
}: {
  view: GameView;
  selectable: (t: Target) => boolean;
  onClick: (item: StackView) => void;
  onHover: (c: CardView | null) => void;
}) {
  if (!view.stack.length) return null;
  const nameOf = (t: Target | null) => {
    if (!t) return null;
    if (t.type === 'player') return view.players.find((p) => p.id === t.id)?.name;
    if (t.type === 'card') return view.cards[t.id]?.name ?? 'a card';
    return view.stack.find((s) => s.id === t.id)?.name ?? 'a spell';
  };
  return (
    <div className="stack">
      <div className="stack-title">Stack</div>
      {[...view.stack].reverse().map((s) => {
        const card = view.cards[s.cardId];
        const sel = selectable({ type: 'stack', id: s.id });
        const targets = s.targets.map(nameOf).filter(Boolean);
        return (
          <div key={s.id} className={`stack-item ${sel ? 'selectable' : ''}`} onClick={() => onClick(s)} onMouseEnter={() => card && onHover(card)} onMouseLeave={() => onHover(null)}>
            <div className="stack-name">
              {s.kind === 'spell' ? '' : '⚡ '}
              {s.name}
              <span className="muted"> — {view.players.find((p) => p.id === s.controller)?.name}</span>
            </div>
            {s.kind !== 'spell' && <div className="stack-text">{s.text}</div>}
            {targets.length > 0 && <div className="stack-text">→ {targets.join(', ')}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function LogPanel({ log, chat, onChat }: { log: LogEntry[]; chat: ChatLine[]; onChat: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const merged = [...log.map((l, i) => ({ k: `l${i}`, text: l.text, chat: false })), ...chat.map((c, i) => ({ k: `c${i}`, text: `${c.from}: ${c.text}`, chat: true }))];
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length, chat.length]);
  return (
    <div className="log">
      <div className="log-lines" ref={ref}>
        {log.map((l, i) => (
          <div key={`l${i}`} className={l.text.startsWith('—') ? 'log-turn' : ''}>
            {l.text}
          </div>
        ))}
        {chat.map((c, i) => (
          <div key={`c${i}`} className="log-chat">
            <strong>{c.from}:</strong> {c.text}
          </div>
        ))}
        {merged.length === 0 && <div className="muted">Game log</div>}
      </div>
      <input
        placeholder="Chat…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && text.trim()) {
            onChat(text);
            setText('');
          }
        }}
      />
    </div>
  );
}

/** Modal used for choosing cards, options, mulligans and similar. */
export function DecisionModal({
  decision,
  view,
  onAnswer,
  onHover,
}: {
  decision: Decision;
  view: GameView;
  onAnswer: (a: { cards?: CardId[]; option?: string }) => void;
  onHover: (c: CardView | null) => void;
}) {
  const [chosen, setChosen] = useState<CardId[]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => setChosen([]), [decision.id]);
  const min = decision.min ?? 0;
  const max = decision.max ?? decision.cards?.length ?? 0;

  if (hidden) {
    return (
      <div className="modal-peek">
        <button className="primary" onClick={() => setHidden(false)}>
          Show choice: {decision.prompt}
        </button>
      </div>
    );
  }
  const toggle = (id: CardId) => {
    if (decision.kind !== 'chooseCards') return;
    if (chosen.includes(id)) setChosen(chosen.filter((c) => c !== id));
    else if (max === 1) setChosen([id]);
    else if (chosen.length < max) setChosen([...chosen, id]);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <h3>{decision.prompt}</h3>
          <button className="small" onClick={() => setHidden(true)} title="Look at the battlefield">
            Peek at board
          </button>
        </div>
        {decision.cards && decision.cards.length > 0 && (
          <div className="modal-cards">
            {decision.cards.map((id) => {
              const c = view.cards[id];
              if (!c) return null;
              const idx = chosen.indexOf(id);
              return (
                <Card
                  key={id}
                  card={c}
                  size="medium"
                  showTapped={false}
                  selectable={decision.kind === 'chooseCards'}
                  selected={idx >= 0}
                  badge={idx >= 0 && max > 1 ? String(idx + 1) : undefined}
                  onClick={() => toggle(id)}
                  onHover={onHover}
                />
              );
            })}
          </div>
        )}
        {decision.cards && decision.cards.length === 0 && decision.kind === 'chooseCards' && <p className="muted">No valid cards.</p>}
        <div className="modal-actions">
          {decision.kind === 'chooseCards' && (
            <>
              <span className="muted">
                Selected {chosen.length} {min === max ? `of ${max}` : `(choose ${min}–${max})`}
              </span>
              <button className="primary" disabled={chosen.length < min || chosen.length > max} onClick={() => onAnswer({ cards: chosen })}>
                Confirm
              </button>
            </>
          )}
          {(decision.kind === 'chooseOption' || decision.kind === 'mulligan') &&
            decision.options!.map((o, i) => (
              <button key={o.id} className={i === 0 ? 'primary' : ''} onClick={() => onAnswer({ option: o.id })}>
                {o.label}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export function XModal({ max, onConfirm, onCancel }: { max: number; onConfirm: (x: number) => void; onCancel: () => void }) {
  const [x, setX] = useState(max);
  return (
    <div className="modal-backdrop">
      <div className="modal small-modal">
        <h3>Choose X (max {max})</h3>
        <input type="range" min={0} max={max} value={x} onChange={(e) => setX(Number(e.target.value))} />
        <div className="x-value">X = {x}</div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onConfirm(x)}>
            Cast
          </button>
        </div>
      </div>
    </div>
  );
}

export function ZoneModal({
  zone,
  view,
  onClose,
  onHover,
  selectable,
  onPick,
}: {
  zone: ZoneOpen;
  view: GameView;
  onClose: () => void;
  onHover: (c: CardView | null) => void;
  selectable?: (id: CardId) => boolean;
  onPick?: (id: CardId) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{zone.title}</h3>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-cards">
          {zone.cards.length === 0 && <p className="muted">Empty.</p>}
          {[...zone.cards].reverse().map((id) => {
            const c = view.cards[id];
            if (!c) return null;
            const sel = selectable?.(id) ?? false;
            return <Card key={id} card={c} size="medium" showTapped={false} selectable={sel} dim={!!selectable && !sel} onClick={() => sel && onPick?.(id)} onHover={onHover} />;
          })}
        </div>
      </div>
    </div>
  );
}

export function nameOfPlayer(view: GameView, id: PlayerId): string {
  return view.players.find((p) => p.id === id)?.name ?? '?';
}
