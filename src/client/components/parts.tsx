import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardId, Decision, LogEntry, PlayerId, Step, Target } from '../../engine/types';
import type { CardView, GameView, StackView } from '../../engine/view';
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
  const [collapsed, setCollapsed] = useState(false);
  if (!view.stack.length) return null;
  const nameOf = (t: Target | null) => {
    if (!t) return null;
    if (t.type === 'player') return view.players.find((p) => p.id === t.id)?.name;
    if (t.type === 'card') return view.cards[t.id]?.name ?? 'a card';
    return view.stack.find((s) => s.id === t.id)?.name ?? 'a spell';
  };
  const items = [...view.stack].reverse(); // top of the stack first
  return (
    <div className={`stack-float ${collapsed ? 'collapsed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="stack-head">
        <span>Stack ({view.stack.length}) — top resolves first</span>
        <button className="link" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? 'show' : 'hide'}
        </button>
      </div>
      {!collapsed && (
        <div className="stack-cards">
          {items.map((s, i) => {
            const card = view.cards[s.cardId];
            const sel = selectable({ type: 'stack', id: s.id });
            const targets = s.targets.map(nameOf).filter(Boolean);
            const who = view.players.find((p) => p.id === s.controller)?.name;
            return (
              <div key={s.id} className={`stack-entry ${i === 0 ? 'top' : ''} ${sel ? 'selectable' : ''}`} data-stack-id={s.id} onClick={() => onClick(s)}>
                {card ? (
                  <Card card={card} size={i === 0 ? 'medium' : 'small'} showTapped={false} selectable={sel} onHover={onHover} />
                ) : (
                  <div className="stack-nocard">{s.name}</div>
                )}
                <div className="stack-info">
                  <div className="stack-name">
                    {s.kind === 'spell' ? s.name : `⚡ ${s.name} ability`}
                  </div>
                  <div className="stack-text muted">{who}</div>
                  {s.kind !== 'spell' && <div className="stack-text">{s.text}</div>}
                  {targets.length > 0 && <div className="stack-text target-line">→ {targets.join(', ')}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Game log with card names you can hover, a chat tab, and an expanded view. */
export function LogPanel({
  log,
  chat,
  onChat,
  view,
  onHover,
}: {
  log: LogEntry[];
  chat: ChatLine[];
  onChat: (t: string) => void;
  view: GameView;
  onHover: (c: CardView | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [expanded, setExpanded] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length, chat.length, tab, expanded]);
  useEffect(() => {
    if (tab === 'chat') setSeenChat(chat.length);
  }, [tab, chat.length]);

  // Card names that appear in the log -> a card we can preview.
  const byName = useMemo(() => {
    const m = new Map<string, CardView>();
    for (const c of Object.values(view.cards)) if (!m.has(c.name)) m.set(c.name, c);
    return m;
  }, [view.cards]);
  const nameRe = useMemo(() => {
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return names.length ? new RegExp(`(${names.join('|')})`, 'g') : null;
  }, [byName]);
  const rich = (line: string) => {
    if (!nameRe) return line;
    return line.split(nameRe).map((part, i) => {
      const c = byName.get(part);
      return c ? (
        <span key={i} className="log-card" onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}>
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      );
    });
  };
  const unread = chat.length - seenChat;
  return (
    <div className={`log ${expanded ? 'expanded' : ''}`}>
      <div className="log-tabs">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Game log
        </button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          Chat{unread > 0 && tab !== 'chat' ? ` (${unread})` : ''}
        </button>
        <button className="link expand" title={expanded ? 'Shrink' : 'Expand'} onClick={() => setExpanded(!expanded)}>
          {expanded ? '⤡' : '⤢'}
        </button>
      </div>
      <div className="log-lines" ref={ref}>
        {tab === 'log' &&
          log.map((l, i) => (
            <div key={i} className={l.text.startsWith('—') ? 'log-turn' : /casts |activates |plays /.test(l.text) ? 'log-play' : /dies|loses the game|is exiled|deals \d+ (combat )?damage/.test(l.text) ? 'log-hit' : ''}>
              {rich(l.text)}
            </div>
          ))}
        {tab === 'chat' &&
          chat.map((c, i) => (
            <div key={i} className="log-chat">
              <strong>{c.from}:</strong> {c.text}
            </div>
          ))}
        {tab === 'log' && log.length === 0 && <div className="muted">Nothing has happened yet.</div>}
        {tab === 'chat' && chat.length === 0 && <div className="muted">No messages yet.</div>}
      </div>
      {tab === 'chat' && (
        <input
          placeholder="Say something…"
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
      )}
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
