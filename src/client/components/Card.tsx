import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import type { CardView } from '../../engine/view';
import { ensureFoilTextures, FOIL_LAYERS, foilSeed, NEON } from '../foil';

export const IMAGES_KEY = 'commander-arena-images';

const FOIL_NAMES: Record<string, string> = {
  foil: 'Foil',
  etched: 'Etched foil',
  galaxy: 'Galaxy foil',
  surge: 'Surge foil',
  halo: 'Halo foil',
  confetti: 'Confetti foil',
  textured: 'Textured foil',
  oilslick: 'Oil slick foil',
  gilded: 'Gilded foil',
  rainbow: 'Double rainbow foil',
  fracture: 'Fracture foil',
  ripple: 'Ripple foil',
  raised: 'Raised foil',
  neon: 'Neon ink',
};

/**
 * The finish over a foil card. Each kind is a few blended groups of layers (see FOIL_LAYERS):
 * moving light (the rainbow, the sheen) over the pattern printed into that finish (stars, waves, shards...).
 * `art` is the image under it, for finishes that follow the art; `tile` means only the art is showing.
 */
export function Foil({ kind, id = '', art, tile }: { kind?: string; id?: string; art?: string; tile?: boolean }) {
  if (!kind || !imagesEnabled()) return null;
  ensureFoilTextures();
  const groups = FOIL_LAYERS[kind] ?? FOIL_LAYERS.foil;
  const seed = foilSeed(id);
  const style = { '--seed': seed, '--neon': NEON[seed % NEON.length], ...(art ? { '--art': `url("${art}")` } : {}) } as CSSProperties;
  return (
    <div className={`foil foil-${kind} ${tile ? 'tile' : ''}`} style={style} aria-hidden>
      {groups.map((layers, g) => (
        <div key={g} className={`fx g${g}`}>
          {layers.map((l, i) => (
            <i key={i} className={`m ${l}`} />
          ))}
        </div>
      ))}
      <i className="glare" />
    </div>
  );
}

/** "Galaxy foil · Showcase · Borderless" */
export function lookLabel(card: CardView): string {
  return [card.foil ? FOIL_NAMES[card.foil] ?? 'Foil' : '', ...(card.treatments ?? [])].filter(Boolean).join(' · ');
}

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
  const useImage = imagesEnabled() && (!card.token || !!card.image) && !imgFailed;
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
      {useImage && <Foil kind={card.foil} id={card.id} art={src} />}
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

/**
 * The big card shown while you hover a card. The image box has a fixed size (no jump while it loads);
 * with the image showing, only what the printed card doesn't tell you is listed underneath.
 */
export function CardPreview({ card }: { card: CardView }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const useImage = imagesEnabled() && (!card.token || !!card.image) && !imgFailed;
  const changedPT =
    card.power !== undefined && (card.power !== card.basePower || card.toughness !== card.baseToughness || card.damage > 0);
  const counters = Object.entries(card.counters).filter(([, n]) => n > 0);
  const label = lookLabel(card);
  const extras = (
    <>
      {label && <div className="preview-look">✦ {label}</div>}
      {changedPT && (
        <div className="preview-pt">
          {card.power}/{card.toughness}
          {card.damage > 0 && <span className="dmg"> ({card.damage} damage)</span>}
        </div>
      )}
      {counters.length > 0 && <div className="preview-kw">{counters.map(([k, n]) => `${n} ${k}`).join(' · ')} counters</div>}
      {card.keywords.length > 0 && <div className="preview-kw">{card.keywords.map(keywordLabel).join(', ')}</div>}
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
    </>
  );
  return (
    <div className="preview">
      {useImage ? (
        <div className={`preview-img ${loaded ? 'loaded' : ''}`}>
          <img src={card.image ?? imageUrl(card.name)} alt={card.name} onLoad={() => setLoaded(true)} onError={() => setImgFailed(true)} />
          {!loaded && <span className="preview-img-name">{card.name}</span>}
          <Foil kind={card.foil} id={card.id} art={card.image ?? imageUrl(card.name)} />
        </div>
      ) : (
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
          {card.power !== undefined && !changedPT && (
            <div className="preview-pt">
              {card.power}/{card.toughness}
            </div>
          )}
        </div>
      )}
      <div className="preview-text preview-extra">{extras}</div>
    </div>
  );
}

const PRO_NAMES: Record<string, string> = { ProW: 'white', ProU: 'blue', ProB: 'black', ProR: 'red', ProG: 'green' };

/** Readable keyword names ("ProR" → "Protection from red"). */
export function keywordLabel(k: string): string {
  if (PRO_NAMES[k]) return `Protection from ${PRO_NAMES[k]}`;
  if (k === 'Unblockable') return "Can't be blocked";
  if (k === 'CantBlock') return "Can't block";
  if (k === 'CantAttack') return "Can't attack";
  if (k === 'NoUntap') return "Doesn't untap";
  return k;
}
