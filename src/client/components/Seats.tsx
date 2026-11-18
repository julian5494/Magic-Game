import type { HTMLAttributes, ReactNode } from 'react';
import { manaValue } from '../../engine/mana';
import type { CardId } from '../../engine/types';
import type { CardView, GameView, PlayerView } from '../../engine/view';
import { artUrl, ManaPips, MatPicker, type PermProps } from './Board';
import { Card, ManaText } from './Card';
import type { ZoneOpen } from './parts';

type Extra = HTMLAttributes<HTMLDivElement>;

export function LifeMedallion({
  p,
  color,
  size = 'md',
  after,
  selectable,
  extra,
  onClick,
  label = 'LIFE',
}: {
  p: PlayerView;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  after?: number;
  selectable?: boolean;
  extra?: Extra;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <div
      className={`life life-${size} ${selectable ? 'selectable' : ''} ${after !== undefined && after !== p.life ? 'preview' : ''} ${p.lost ? 'lost' : ''}`}
      style={{ ['--c' as string]: color }}
      data-player-id={p.id}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={`${p.name}: ${p.life} life${p.poison ? `, ${p.poison} poison` : ''}`}
      {...extra}
    >
      {p.life}
      <small>{p.lost ? 'OUT' : label}</small>
      {after !== undefined && after !== p.life && <span className={`after ${after > p.life ? 'up' : ''}`}>→ {after}</span>}
      {p.poison > 0 && <span className="poison">☠{p.poison}</span>}
    </div>
  );
}

/** Commander damage this player has taken, shown under their life. */
export function CmdDamage({ p }: { p: PlayerView }) {
  const list = p.commanderDamage.filter((d) => d.amount > 0);
  if (!list.length) return null;
  return (
    <div className="cmd-dmg">
      {list.map((d) => (
        <span key={d.commander} title={`Commander damage from ${d.name} (21 loses)`} className={d.amount >= 15 ? 'danger' : ''}>
          {d.name.split(',')[0]} ★{d.amount}
        </span>
      ))}
    </div>
  );
}

/** The command zone: big, front and center for your commander. */
export function CommandZone({
  view,
  p,
  cardProps,
  onCardClick,
  onHover,
}: {
  view: GameView;
  p: PlayerView;
  cardProps: (id: CardId) => PermProps;
  onCardClick: (id: CardId) => void;
  onHover: (c: CardView | null) => void;
}) {
  const cmds = p.commanders.map((id) => view.cards[id]).filter(Boolean);
  return (
    <div className={`cz ${cmds.length > 1 ? 'partners' : ''}`}>
      <h5>✦ Command zone ✦</h5>
      <div className="cz-cards">
        {cmds.map((c) => {
          const inZone = c.zone === 'command';
          const props = cardProps(c.id);
          const tax = c.commanderTax ?? 0;
          const casts = tax / 2;
          return (
            <div key={c.id} className={`cz-card ${inZone ? '' : 'away'} ${props.selectable && inZone ? 'castable' : ''}`}>
              <div onClick={() => inZone && onCardClick(c.id)}>
                <Card card={c} size={cmds.length > 1 ? 'small' : 'large'} showTapped={false} selectable={inZone && props.selectable} selected={props.selected} onHover={onHover} extra={inZone ? props.extra : undefined} />
              </div>
              {!inZone && <div className="cz-away">{c.zone === 'battlefield' ? 'On the battlefield' : `In ${c.zone}`}</div>}
              <div className="cz-info">
                {casts > 0 ? `Cast ${casts}× · ` : ''}
                {inZone ? (
                  <>
                    tax <b>+{tax}</b>
                    <div className="cz-cost">
                      {c.cost && <ManaText text={c.cost} />}
                      {tax > 0 && <span className="tax">+{tax}</span>} = {manaValue(c.cost) + tax}
                    </div>
                  </>
                ) : (
                  <>next cast +{tax}</>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Library / graveyard / exile piles. */
export function Piles({ p, view, onZone, small }: { p: PlayerView; view: GameView; onZone: (z: ZoneOpen) => void; small?: boolean }) {
  const top = (ids: CardId[]) => (ids.length ? view.cards[ids[ids.length - 1]] : undefined);
  const pile = (label: string, n: number, card: CardView | undefined, open?: () => void) => (
    <button className={`pile ${small ? 'small' : ''}`} onClick={(e) => { e.stopPropagation(); open?.(); }} disabled={!open} title={label}>
      {card && <span className="pile-art" style={{ backgroundImage: `url("${artUrl(card)}")` }} />}
      <span className="pile-label">{label}</span>
      <span className="pile-n">{n}</span>
    </button>
  );
  return (
    <div className="piles">
      {pile('Library', p.libraryCount, undefined)}
      {pile('Graveyard', p.graveyard.length, top(p.graveyard), () => onZone({ title: `${p.name}'s graveyard`, cards: p.graveyard }))}
      {pile('Exile', p.exile.length, top(p.exile), () => onZone({ title: `${p.name}'s exile`, cards: p.exile }))}
    </div>
  );
}

/** "12 mana available" with the sources grouped by color. */
export function ManaAvailable({ p }: { p: PlayerView }) {
  const costly = p.mana.groups.reduce((n, g) => n + g.costly, 0);
  return (
    <div className="mana-avail" title="Mana you can make right now (untapped sources + floating mana)">
      <div className="total">
        {p.mana.total} <small>mana available</small>
      </div>
      <div className="groups">
        {p.mana.groups.map((g) => (
          <span key={g.produces.join('')} className="mgroup">
            <ManaPips produces={g.produces} /> {g.amount}
          </span>
        ))}
      </div>
      {costly > 0 && <div className="sub">includes {costly} from cards used up when spent</div>}
    </div>
  );
}

/** Header for a seat: name, life, and the seat controls. */
export function SeatHeader({
  p,
  view,
  color,
  mat,
  onMat,
  life,
  children,
}: {
  p: PlayerView;
  view: GameView;
  color: string;
  mat: string;
  onMat: (m: string) => void;
  life: ReactNode;
  children?: ReactNode;
}) {
  const passed = view.stack.length > 0 && view.passes.includes(p.id);
  const waiting = view.waitingOn.includes(p.id);
  return (
    <div className="seat-head" style={{ ['--c' as string]: color }}>
      {life}
      <div className="seat-name">
        <div className="nm">
          {p.name}
          {p.isBot && <span className="tag">BOT</span>}
          {p.id === view.you && <span className="tag">YOU</span>}
        </div>
        <div className="sub">
          ✋ {p.handCount}
          {view.activePlayer === p.id && <span className="turn-chip">their turn</span>}
          {view.stack.length > 0 && !p.lost && <span className={`pass-chip ${passed ? 'passed' : waiting ? 'deciding' : ''}`}>{passed ? 'passed' : waiting ? 'responding…' : 'to act'}</span>}
          {view.stack.length === 0 && waiting && view.activePlayer !== p.id && <span className="pass-chip deciding">deciding…</span>}
        </div>
        <CmdDamage p={p} />
      </div>
      <div className="seat-ctl">
        {children}
        <MatPicker value={mat} onChange={onMat} />
      </div>
    </div>
  );
}
