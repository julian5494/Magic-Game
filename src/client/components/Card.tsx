import { useState, type HTMLAttributes, type ReactNode } from 'react';
import type { CardView } from '../../engine/view';

export const IMAGES_KEY = 'commander-arena-images';

export function imagesEnabled(): boolean {
  try {
    return localStorage.getItem(IMAGES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function imageUrl(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

/** Render text with {W}{U}{T} style symbols as mana pips. */
export function ManaText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{([^}]+)\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const sym = m[1];
        return (
          <span key={i} className={`pip pip-${sym}`} title={sym}>
            {sym === 'T' ? '↷' : sym}
          </span>
        );
      })}
    </>
  );
}

function frameClass(c: CardView): string {
  if (c.types.includes('Land')) return 'frame-land';
  if (c.colors.length > 1) return 'frame-gold';
  if (c.colors.length === 0) return 'frame-colorless';
  return `frame-${c.colors[0]}`;
}

export interface CardProps {
  card: CardView;
  size?: 'tiny' | 'small' | 'medium' | 'large';
  selectable?: boolean;
  selected?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  dim?: boolean;
  badge?: string;
  onClick?: () => void;
  onHover?: (c: CardView | null) => void;
  showTapped?: boolean;
  /** Extra DOM props (drag & drop, double-click). */
  extra?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  dropOk?: boolean;
}

export function Card({ card, size = 'medium', selectable, selected, attacking, blocking, dim, badge, onClick, onHover, showTapped = true, extra, dropOk }: CardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const useImage = imagesEnabled() && !card.token && !imgFailed;
  const src = card.image ?? imageUrl(card.name);
  const tapped = showTapped && card.tapped;
  const buffed = card.power !== undefined && card.basePower !== undefined && (card.power > card.basePower || (card.toughness ?? 0) > (card.baseToughness ?? 0));
  const debuffed = card.power !== undefined && card.basePower !== undefined && (card.power < card.basePower || (card.toughness ?? 0) < (card.baseToughness ?? 0));
  const cls = [
    'card',
    `card-${size}`,
    tapped ? 'tapped' : '',
    selectable ? 'selectable' : '',
    selected ? 'selected' : '',
    attacking ? 'attacking' : '',
    blocking ? 'blocking' : '',
    dim ? 'dim' : '',
    dropOk ? 'drop-ok' : '',
  ].join(' ');
  const counters = Object.entries(card.counters).filter(([, n]) => n > 0);
  return (
    <div
      className={cls}
      data-card-id={card.id}
      onClick={onClick}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      title={size === 'tiny' ? card.name : undefined}
      {...extra}
    >
      {useImage ? (
        <img className="card-img" src={src} alt={card.name} loading="lazy" onError={() => setImgFailed(true)} draggable={false} />
      ) : (
        <div className={`card-frame ${frameClass(card)}`}>
          <div className="card-title">
            <span className="card-name">{card.name}</span>
            {card.cost && <span className="card-cost"><ManaText text={card.cost} /></span>}
          </div>
          <div className="card-type">{card.typeLine}</div>
          <div className="card-text">
            {card.text.split('\n').map((l, i) => (
              <p key={i}>
                <ManaText text={l} />
              </p>
            ))}
          </div>
        </div>
      )}
      {card.power !== undefined && card.zone === 'battlefield' && (
        <div className={`pt ${buffed ? 'buff' : ''} ${debuffed ? 'debuff' : ''} ${card.damage ? 'damaged' : ''}`}>
          {card.power}/{card.toughness! - card.damage}
        </div>
      )}
      {counters.length > 0 && (
        <div className="counters">
          {counters.map(([k, n]) => (
            <span key={k} className="counter">
              {k === '+1/+1' ? `+${n}` : k === '-1/-1' ? `−${n}` : `${n} ${k}`}
            </span>
          ))}
        </div>
      )}
      {card.commander && <div className="cmd-badge" title="Commander">★</div>}
      {card.zone === 'battlefield' && card.sick && card.types.includes('Creature') && !card.keywords.includes('Haste') && (
        <div className="sick-badge" title="Summoning sick">z</div>
      )}
      {card.attachments.length > 0 && <div className="attach-badge" title="Has attachments">⚔{card.attachments.length}</div>}
      {(card.unsupported || card.cannotCast) && (
        <div className={`warn-badge ${card.cannotCast ? 'blocked' : ''}`} title={card.cannotCast ? "Can't be played yet" : 'Some abilities are not automated'}>
          !
        </div>
      )}
      {badge && <div className="order-badge">{badge}</div>}
    </div>
  );
}

export function CardPreview({ card }: { card: CardView }) {
  const [imgFailed, setImgFailed] = useState(false);
  const useImage = imagesEnabled() && !card.token && !imgFailed;
  return (
    <div className="preview">
      {useImage && <img src={card.image ?? imageUrl(card.name)} alt={card.name} onError={() => setImgFailed(true)} />}
      <div className="preview-text">
        <div className="card-title">
          <strong>{card.name}</strong>
          {card.cost && <ManaText text={card.cost} />}
        </div>
        <div className="card-type">{card.typeLine}</div>
        {card.text.split('\n').map((l, i) => (
          <p key={i}>
            <ManaText text={l} />
          </p>
        ))}
        {card.power !== undefined && (
          <div className="preview-pt">
            {card.power}/{card.toughness}
            {card.damage > 0 && <span className="dmg"> ({card.damage} damage)</span>}
          </div>
        )}
        {card.keywords.length > 0 && <div className="preview-kw">{card.keywords.join(', ')}</div>}
        {card.commanderTax ? <div className="preview-kw">Commander tax: +{card.commanderTax}</div> : null}
        {card.cannotCast && <div className="preview-warn">This card can't be played yet: the game can't enforce all of its rules.</div>}
        {card.unsupported && (
          <div className="preview-warn">
            Not automated (these won't happen):
            <ul>
              {card.unsupported.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
