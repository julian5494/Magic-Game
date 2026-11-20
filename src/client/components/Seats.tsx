import { useId, type HTMLAttributes } from 'react';
import type { CardId } from '../../engine/types';
import type { CardView, GameView, PlayerView } from '../../engine/view';
import { artUrl, ManaPip, Pile3D, type PermProps } from './Board';
import { Card } from './Card';
import type { ZoneOpen } from './parts';

type Extra = HTMLAttributes<HTMLDivElement>;

const HEX = [
  [0, -48],
  [41.6, -24],
  [41.6, 24],
  [0, 48],
  [-41.6, 24],
  [-41.6, -24],
];
const A = [0, -27];
const B = [23.4, 13.5];
const C = [-23.4, 13.5];
const pts = (list: number[][]) => list.map((p) => p.join(',')).join(' ');
const tone = (pct: number, base: string) => `color-mix(in srgb, var(--seat) ${pct}%, ${base})`;
const FACES: [number[][], string][] = [
  [[A, HEX[0], HEX[1]], tone(70, '#fff')],
  [[A, HEX[5], HEX[0]], tone(80, '#fff')],
  [[A, HEX[1], B], tone(85, '#000')],
  [[A, C, HEX[5]], tone(75, '#fff')],
  [[B, HEX[1], HEX[2]], tone(62, '#000')],
  [[B, HEX[2], HEX[3]], tone(45, '#000')],
  [[C, HEX[3], HEX[4]], tone(52, '#000')],
  [[C, HEX[4], HEX[5]], tone(70, '#000')],
  [[B, HEX[3], C], tone(55, '#000')],
];

/** A player's life total on a d20 in their seat color. It's also the target/drop spot for that player. */
export function D20({
  p,
  color,
  size = 84,
  after,
  selectable,
  active,
  extra,
  onClick,
  ghost,
}: {
  p: PlayerView;
  color: string;
  /** Invisible hit area over the 3D die: keeps the target ring, combat preview and drops. */
  ghost?: boolean;
  size?: number;
  after?: number;
  selectable?: boolean;
  active?: boolean;
  extra?: Extra;
  onClick?: () => void;
}) {
  const gid = useId().replace(/:/g, '');
  return (
    <div
      className={`d20 ${ghost ? 'ghost' : ''} ${active ? 'active' : ''} ${selectable ? 'selectable' : ''} ${p.lost ? 'lost' : ''}`}
      style={{ ['--seat' as string]: color, width: size, height: size }}
      data-player-id={p.id}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      {...extra}
    >
      <svg viewBox="-50 -50 100 100">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {FACES.map(([f, fill], i) => (
          <polygon key={i} className="f" points={pts(f)} style={{ fill }} />
        ))}
        <polygon className="f" points={pts([A, B, C])} style={{ fill: tone(78, '#fff') }} />
        <polygon points={pts([A, B, C])} fill={`url(#${gid})`} opacity=".55" />
        <text className="tiny" x="13" y="-26" transform="rotate(30 13 -26)">
          14
        </text>
        <text className="tiny" x="-13" y="-26" transform="rotate(-30 -13 -26)">
          8
        </text>
        <text className="tiny" x="0" y="26">
          2
        </text>
        <text className="num" x="0" y="0" style={{ fontSize: Math.abs(p.life) >= 100 ? 19 : 25 }}>
          {p.life}
        </text>
      </svg>
      {after !== undefined && after !== p.life && <div className={`after ${after > p.life ? 'up' : ''}`}>→ {after}</div>}
      {p.poison > 0 && <div className="poison">☠{p.poison}</div>}
    </div>
  );
}

/** Commander art as a round portrait. */
export function Portrait({ p, view, color, size = 56 }: { p: PlayerView; view: GameView; color: string; size?: number }) {
  const c = p.commanders.map((id) => view.cards[id]).find(Boolean);
  return <div className="portrait" style={{ width: size, height: size, ['--seat' as string]: color, backgroundImage: c ? `url("${artUrl(c)}")` : undefined }} />;
}

/** Commander damage this player has taken. */
export function CmdDamage({ p }: { p: PlayerView }) {
  const list = p.commanderDamage.filter((d) => d.amount > 0);
  if (!list.length) return null;
  return (
    <div className="cmd-dmg">
      {list.map((d) => (
        <span key={d.commander} className={d.amount >= 15 ? 'danger' : ''}>
          {d.name.split(',')[0]} ★{d.amount}
        </span>
      ))}
    </div>
  );
}

/** The command slot printed on a playmat. Only shown while a commander is in the command zone. */
export function CommandSlot({
  view,
  ids,
  cardProps,
  onCardClick,
  onHover,
  w,
}: {
  view: GameView;
  ids: CardId[];
  cardProps: (id: CardId) => PermProps;
  onCardClick: (id: CardId) => void;
  onHover: (c: CardView | null) => void;
  w: number;
}) {
  return (
    <div className="cmd-slot">
      <span className="slot-cap">Commander</span>
      {ids.map((id) => {
        const c = view.cards[id];
        if (!c) return null;
        const props = cardProps(id);
        return (
          <div key={id} className={`cmd-card ${props.selectable ? 'castable' : ''}`}>
            {/* Click, double-click and drag live on this wrapper: on the 3D table the browser hit-tests the wrapper, not the card inside it. */}
            <div
              className="cmd-hit"
              style={{ width: w, height: Math.round(w * 1.396) }}
              {...props.extra}
              onClick={(e) => {
                e.stopPropagation();
                onCardClick(id);
              }}
            >
              <Card card={c} size="large" showTapped={false} selectable={props.selectable} selected={props.selected} onHover={onHover} />
            </div>
            <span className="slot-tax">Tax +{c.commanderTax ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Library, graveyard and exile as 3D piles on the mat. */
export function MatPiles({
  p,
  view,
  onZone,
  w,
  flip,
  onTop,
  onHover,
}: {
  p: PlayerView;
  view: GameView;
  onZone: (z: ZoneOpen) => void;
  w: number;
  flip?: boolean;
  /** Play the top card of the library (when a card lets you). */
  onTop?: (id: CardId) => void;
  onHover?: (c: CardView | null) => void;
}) {
  const cards = (ids: CardId[]) => ids.map((id) => view.cards[id]).filter(Boolean);
  const top = p.top ? view.cards[p.top] : undefined;
  return (
    <div className="mat-piles">
      <Pile3D
        kind="library"
        count={p.libraryCount}
        cards={[]}
        w={w}
        label={top && p.topRevealed ? 'Library (top revealed)' : 'Library'}
        flip={flip}
        top={top}
        topPlayable={!!top && view.legal.some((a) => a.cardId === top.id)}
        onTop={onTop}
        onHover={onHover}
      />
      <Pile3D kind="graveyard" count={p.graveyard.length} cards={cards(p.graveyard)} w={w} label="Graveyard" onClick={() => onZone({ title: `${p.name}'s graveyard`, cards: p.graveyard })} />
      <Pile3D kind="exile" count={p.exile.length} cards={cards(p.exile)} w={w} label="Exile" onClick={() => onZone({ title: `${p.name}'s exile`, cards: p.exile })} />
    </div>
  );
}

/** Mana you can make right now, as mana pips. */
export function ManaBar({ p }: { p: PlayerView }) {
  return (
    <div className="mana-bar">
      <span className="total">{p.mana.total}</span>
      {p.mana.groups.map((g) => (
        <span key={g.produces.join('')} className="mgroup">
          <ManaPip colors={g.produces} /> {g.amount}
        </span>
      ))}
    </div>
  );
}
