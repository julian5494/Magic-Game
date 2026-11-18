import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { CardId, Keyword, PlayerId } from '../../engine/types';
import type { CardView, GameView } from '../../engine/view';
import { imagesEnabled, imageUrl, ManaText } from './Card';

type Extra = HTMLAttributes<HTMLDivElement> & { draggable?: boolean };

export interface PermProps {
  card: CardView;
  selectable: boolean;
  selected: boolean;
  attacking: boolean;
  blocking: boolean;
  badge?: string;
  extra?: Extra;
  dropOk?: boolean;
  dim?: boolean;
}

export interface PreviewMark {
  damage?: number;
  dies?: boolean;
  survives?: string;
}

// ---------- Images ----------

/** Scryfall art crop for a printing (falls back to a name lookup). */
export function artUrl(c: CardView): string {
  if (c.image?.includes('/normal/')) return c.image.replace('/normal/', '/art_crop/');
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(c.name)}&format=image&version=art_crop`;
}

export function fullUrl(c: CardView): string {
  return c.image ?? imageUrl(c.name);
}

// ---------- Keyword icons ----------

const ICONS: Partial<Record<Keyword | 'Ward', string>> = {
  Flying: 'M2 19c5-1 9-4 12-8s5-7 8-9c-1 6-3 10-7 13s-8 4-13 4z',
  Reach: 'M4 20L18 6M14 6h4v4M6 14l4 4M3 21l3-1-2-2z',
  Trample: 'M4 20l3-9 4 3 4-9 4 15z',
  Haste: 'M13 2L4 14h6l-2 8 10-13h-6z',
  Vigilance: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z',
  Deathtouch: 'M12 2a9 9 0 00-9 9c0 3 1.5 5 3.5 6.2V21h11v-3.8C19.5 16 21 14 21 11a9 9 0 00-9-9zM8.5 13a2 2 0 110-4 2 2 0 010 4zm7 0a2 2 0 110-4 2 2 0 010 4z',
  Lifelink: 'M12 21C5 15 2 11.5 2 8a5 5 0 0110-1 5 5 0 0110 1c0 3.5-3 7-10 13z',
  'First strike': 'M4 20L16 8l2 2L6 22zM15 3l6 6-3 1-4-4z',
  'Double strike': 'M2 18L12 8l2 2L4 20zM10 18L20 8l2 2-10 10zM13 3l5 5-2 1-4-4z',
  Menace: 'M3 4l5 6-3 9 7-5 7 5-3-9 5-6-7 3z',
  Defender: 'M4 4h16v6c0 6-4 9-8 11-4-2-8-5-8-11z',
  Hexproof: 'M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z',
  Shroud: 'M3 12c3-6 15-6 18 0-3 6-15 6-18 0zM4 4l16 16',
  Indestructible: 'M3 7h13c0 3 2 4 5 4v2h-6l2 5h3v2H4v-2h3l2-5H3z',
  Prowess: 'M12 2l2.5 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.5-.5z',
  Unblockable: 'M4 12h12M12 6l6 6-6 6M3 3v18',
  Ward: 'M12 2l9 5v10l-9 5-9-5V7zM12 7v10M7 9.5l10 5M17 9.5l-10 5',
};
const STROKED = new Set(['Reach', 'Shroud', 'Unblockable', 'Ward']);
const SKULL = ICONS.Deathtouch!;

function KeywordRail({ card, small }: { card: CardView; small: boolean }) {
  const kws: (Keyword | 'Ward')[] = card.keywords.filter((k) => ICONS[k]);
  if (card.ward) kws.push('Ward');
  if (!kws.length) return null;
  return (
    <div className={`kw-rail ${small ? 'small' : ''}`}>
      {kws.slice(0, small ? 3 : 6).map((k) => (
        <div key={k} className={`coin kw ${STROKED.has(k) ? 'stroked' : ''}`}>
          <svg viewBox="0 0 24 24">
            <path d={ICONS[k]} />
          </svg>
        </div>
      ))}
    </div>
  );
}

// ---------- Rune circle (hexproof / ward / shroud) ----------

const GLYPHS: string[] = Array.from({ length: 16 }, (_, i) => {
  const seed = (i * 7919) % 97;
  const pts = [
    [0, -3, 0, 3],
    [0, -3, 2.2, -1],
    [0, 0, -2.2, 2],
    [0, -1, 2.2, 1],
    [-2, -3, 0, -1],
    [0, 1, 2.2, 3],
  ];
  return pts
    .filter((_, j) => j === 0 || ((seed >> j) & 1) === 1 || j === (seed % 5) + 1)
    .map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`)
    .join('');
});

export function RuneCircle({ kind }: { kind: 'hexproof' | 'ward' | 'shroud' }) {
  return (
    <svg className={`rune-circle rune-${kind}`} viewBox="-50 -50 100 100" aria-hidden>
      <g className="rune-outer">
        <circle r="46" className="rune-line" />
        <circle r="43" className="rune-line thin" />
        {GLYPHS.map((g, i) => (
          <g key={i} transform={`rotate(${(360 / GLYPHS.length) * i}) translate(0 -38.5) scale(0.95)`}>
            <path d={g} className="rune-glyph" />
          </g>
        ))}
        <circle r="34" className="rune-line thin" />
      </g>
      <g className="rune-inner">
        <polygon points="0,-30 26,15 -26,15" className="rune-line thin" />
        <polygon points="0,30 26,-15 -26,-15" className="rune-line thin" />
        <circle r="13" className="rune-line thin" />
      </g>
    </svg>
  );
}

// ---------- One permanent ----------

export type FaceMode = 'full' | 'tile';

export function faceSize(mode: FaceMode, w: number) {
  return { w, h: Math.round(mode === 'full' ? w * 1.396 : w * 0.78) };
}

export function Permanent({
  p,
  mode,
  w,
  count = 1,
  attachments = [],
  preview,
  onClick,
  onHover,
}: {
  p: PermProps;
  mode: FaceMode;
  w: number;
  count?: number;
  attachments?: { p: PermProps; onClick: () => void }[];
  preview?: PreviewMark;
  onClick: () => void;
  onHover: (c: CardView | null) => void;
}) {
  const c = p.card;
  const [imgFailed, setImgFailed] = useState(false);
  const { h } = faceSize(mode, w);
  const kw = (k: Keyword) => c.keywords.includes(k);
  const tapped = c.tapped && !p.attacking && !p.blocking;
  const isCreature = c.types.includes('Creature');
  const fly = kw('Flying') && isCreature && !p.attacking && !p.blocking && !tapped;
  const rune: 'hexproof' | 'ward' | 'shroud' | null = kw('Shroud') ? 'shroud' : kw('Hexproof') ? 'hexproof' : c.ward ? 'ward' : null;
  const showImg = imagesEnabled() && !imgFailed && (!c.token || !!c.image);
  const small = w < 70;
  const src = mode === 'full' ? fullUrl(c) : artUrl(c);

  const footW = tapped ? Math.round(mode === 'tile' ? (h * h) / w : h) : w;
  const stackPad = Math.min(count - 1, 2) * 4;
  const attachPad = attachments.length * Math.round(w * 0.2);

  const cls = [
    'perm',
    `perm-${mode}`,
    tapped ? 'tapped' : '',
    p.attacking ? (kw('Vigilance') ? 'att' : 'att tilt') : '',
    p.blocking ? 'blk' : '',
    p.selectable ? 'selectable' : '',
    p.selected ? 'selected' : '',
    p.dropOk ? 'drop-ok' : '',
    p.dim ? 'dim' : '',
    preview?.dies ? 'pv-dies' : '',
    fly ? 'fx-fly' : '',
    kw('Deathtouch') ? 'fx-death' : '',
    kw('Indestructible') ? 'fx-indestructible' : '',
    kw('Lifelink') ? 'fx-lifelink' : '',
  ].join(' ');

  const faceStyle = (card: CardView, url: string) => ({ width: w, height: h, backgroundImage: imagesEnabled() && (!card.token || card.image) ? `url("${url}")` : undefined });

  return (
    <div className="perm-slot" style={{ width: footW + stackPad + attachPad, height: h }}>
      {attachments.map((a, i) => (
        <div
          key={a.p.card.id}
          className={`attachment ${a.p.selectable ? 'selectable' : ''}`}
          style={{ left: (attachments.length - i) * Math.round(w * 0.2) }}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
          onMouseEnter={() => onHover(a.p.card)}
          onMouseLeave={() => onHover(null)}
          {...a.p.extra}
          data-card-id={a.p.card.id}
        >
          <div className="face" style={faceStyle(a.p.card, mode === 'full' ? fullUrl(a.p.card) : artUrl(a.p.card))}>
            {(!imagesEnabled() || (a.p.card.token && !a.p.card.image)) && <TextFace card={a.p.card} mode={mode} />}
          </div>
        </div>
      ))}
      <div
        className={cls}
        data-card-id={c.id}
        style={{ width: w, height: h, ['--tap-scale' as string]: String(mode === 'tile' ? h / w : 1) }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onMouseEnter={() => onHover(c)}
        onMouseLeave={() => onHover(null)}
        {...p.extra}
      >
        {fly && <div className="fly-shadow" />}
        {kw('Deathtouch') && (
          <>
            <i className="smoke" style={{ left: '12%', animationDelay: '0s' }} />
            <i className="smoke" style={{ left: '38%', animationDelay: '1.1s' }} />
            <i className="smoke" style={{ left: '62%', animationDelay: '2.2s' }} />
          </>
        )}
        <div className="lift">
          {count > 1 && (
            <>
              <div className="face ghost" style={{ ...faceStyle(c, src), transform: 'translate(8px,-8px)' }} />
              <div className="face ghost" style={{ ...faceStyle(c, src), transform: 'translate(4px,-4px)' }} />
            </>
          )}
          <div className="face main" style={{ width: w, height: h, backgroundImage: showImg ? `url("${src}")` : undefined }}>
            {showImg && <img src={src} alt="" style={{ display: 'none' }} onError={() => setImgFailed(true)} />}
            {!showImg && <TextFace card={c} mode={mode} />}
            {mode === 'tile' && showImg && <div className="banner">{c.name}</div>}
            {rune && <RuneCircle kind={rune} />}
            {kw('Indestructible') && <div className="shine" />}
          </div>
          {(p.attacking || p.blocking) && (
            <svg className="emblem" viewBox="0 0 24 24">
              <path d={p.attacking ? 'M3 2l9 9-2 2-9-9zM21 2l-9 9 2 2 9-9zM6 15l3 3-3 3-3-3zM18 15l-3 3 3 3 3-3z' : 'M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z'} />
            </svg>
          )}
          {isCreature && <KeywordRail card={c} small={small} />}
          {c.power !== undefined && (
            <div className={`pt ${ptTone(c)}`}>
              {c.power}/{(c.toughness ?? 0) - c.damage}
            </div>
          )}
          {c.types.includes('Planeswalker') && <div className="loyalty">{c.counters.loyalty ?? 0}</div>}
          <Counters card={c} />
          {c.commander && (
            <div className="coin star">
              <svg viewBox="0 0 24 24">
                <path d="M12 2l2.6 6.6L21 9l-5 4.5L17.6 21 12 17l-5.6 4L8 13.5 3 9l6.4-.4z" />
              </svg>
            </div>
          )}
          {c.sick && isCreature && !kw('Haste') && <div className="zz">z</div>}
          {c.ward && (
            <div className="wardcost">
              ward <ManaText text={c.ward} />
            </div>
          )}
          {(c.unsupported || c.cannotCast) && <div className={`warn-dot ${c.cannotCast ? 'blocked' : ''}`}>!</div>}
          {count > 1 && <div className="coin count">×{count}</div>}
          {p.badge && <div className="perm-badge">{p.badge}</div>}
          {preview?.damage ? <div className="pv-dmg">−{preview.damage}</div> : null}
          {preview?.dies && (
            <div className="pv-skull">
              <svg viewBox="0 0 24 24">
                <path d={SKULL} />
              </svg>
            </div>
          )}
          {preview?.survives && <div className="pv-ok">survives {preview.survives}</div>}
        </div>
      </div>
    </div>
  );
}

function ptTone(c: CardView): string {
  if (c.damage > 0) return 'hurt';
  if (c.basePower === undefined) return '';
  if ((c.power ?? 0) > c.basePower || (c.toughness ?? 0) > (c.baseToughness ?? 0)) return 'buff';
  if ((c.power ?? 0) < c.basePower || (c.toughness ?? 0) < (c.baseToughness ?? 0)) return 'hurt';
  return '';
}

function Counters({ card }: { card: CardView }) {
  const list = Object.entries(card.counters).filter(([k, n]) => n > 0 && k !== 'loyalty');
  if (!list.length) return null;
  return (
    <div className="ctrs">
      {list.map(([k, n]) => (
        <span key={k} className={`ctr ${k === '-1/-1' ? 'neg' : ''}`}>
          {k === '+1/+1' ? `+${n}` : k === '-1/-1' ? `−${n}` : `${n} ${k}`}
        </span>
      ))}
    </div>
  );
}

function frameColor(c: CardView): string {
  if (c.types.includes('Land')) return 'land';
  if (c.colors.length > 1) return 'gold';
  if (c.colors.length === 0) return 'colorless';
  return c.colors[0];
}

/** Used for tokens (no printed image) and when card images are off. */
function TextFace({ card, mode }: { card: CardView; mode: FaceMode }) {
  return (
    <div className={`text-face tf-${frameColor(card)} ${mode}`}>
      <div className="tf-name">{card.name}</div>
      {mode === 'full' && <div className="tf-type">{card.typeLine}</div>}
      {mode === 'full' && <div className="tf-text">{card.text}</div>}
    </div>
  );
}

// ---------- 3D piles ----------

/** A pile with real thickness: the library is a solid block; graveyard and exile are loose piles. */
export function Pile3D({
  kind,
  count,
  cards,
  w,
  label,
  onClick,
  flip,
}: {
  kind: 'library' | 'graveyard' | 'exile';
  count: number;
  cards: CardView[];
  w: number;
  label: string;
  onClick?: () => void;
  flip?: boolean;
}) {
  const h = Math.round(w * 1.396);
  const t = kind === 'library' ? Math.max(count ? 3 : 0, Math.round((count * w) / 330)) : Math.min(cards.length, 3) * 2;
  const loose = cards.slice(-3);
  return (
    <div
      className={`pile3d ${kind} ${onClick ? 'clickable' : ''}`}
      style={{ width: w, height: h, ['--t' as string]: `${t}px` }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <div className="shade" />
      {kind === 'library' ? (
        count > 0 && (
          <>
            <div className="front" />
            <div className={`side ${flip ? 'r' : ''}`} />
            <div className="top cardback" />
          </>
        )
      ) : (
        loose.map((c, i) => (
          <div
            key={c.id}
            className="loose"
            style={{
              backgroundImage: imagesEnabled() ? `url("${fullUrl(c)}")` : undefined,
              transform: `translateZ(${i * 2}px) rotateZ(${(i - loose.length + 1) * 6 + (i % 2 ? 3 : -2)}deg) translate(${(i - loose.length + 1) * 3}px, ${(loose.length - 1 - i) * 2}px)`,
            }}
          >
            {!imagesEnabled() && <span className="loose-name">{c.name}</span>}
          </div>
        ))
      )}
      {count === 0 && <div className="empty-slot" />}
      <div className="coin count">{count}</div>
      <span className="pile-lbl">{label}</span>
    </div>
  );
}

// ---------- Board rows ----------

const CONSUMABLE = new Set(['Treasure', 'Clue', 'Food', 'Blood', 'Gold', 'Map', 'Powerstone', 'Junk', 'Shard', 'Incubator']);

type Section = 'creatures' | 'artifacts' | 'enchantments' | 'lands' | 'tokens';

export function sectionOf(c: CardView): Section {
  const t = c.types;
  if (t.includes('Creature') || t.includes('Planeswalker') || t.includes('Battle')) return 'creatures';
  if (t.includes('Land')) return 'lands';
  if (c.token && t.includes('Artifact') && CONSUMABLE.has(c.name)) return 'tokens';
  if (t.includes('Artifact')) return 'artifacts';
  if (t.includes('Enchantment')) return 'enchantments';
  return 'artifacts';
}

/** Layout size of an element (ignores 3D transforms on ancestors). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((s) => (Math.abs(s.w - w) > 1 || Math.abs(s.h - h) > 1 ? { w, h } : s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export interface BoardProps {
  view: GameView;
  owner: PlayerId;
  mode: FaceMode;
  /** Across the table: rows run the other way (lands far, creatures facing you). */
  far?: boolean;
  /** Small side views: tighter spacing. */
  mini?: boolean;
  cardProps: (id: CardId) => PermProps;
  onCardClick: (id: CardId) => void;
  onHover: (c: CardView | null) => void;
  noGroup?: (id: CardId) => boolean;
  preview?: Record<CardId, PreviewMark>;
}

interface Item {
  key: string;
  ids: CardId[];
  pick: CardId;
}

function groupKey(c: CardView): string {
  return [c.name, c.tapped, c.power, c.toughness, c.damage, JSON.stringify(c.counters), c.keywords.join(','), c.sick, c.commander].join('|');
}

/**
 * A player's permanents in three rows (creatures; artifacts | enchantments; lands | tokens to use).
 * No boxes: cards sit straight on the mat, centered, and shrink to fit the space.
 */
export function Battlefield({ view, owner, mode, far, mini, cardProps, onCardClick, onHover, noGroup, preview }: BoardProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const mine = view.battlefield.map((id) => view.cards[id]).filter((c) => c && c.controller === owner);
  const hosted = new Set(mine.filter((c) => c.attachedTo && view.cards[c.attachedTo]?.zone === 'battlefield').map((c) => c.id));
  const attachmentsOf = (id: CardId) => view.battlefield.filter((a) => view.cards[a]?.attachedTo === id);

  const sections: Record<Section, Item[]> = { creatures: [], artifacts: [], enchantments: [], lands: [], tokens: [] };
  for (const c of mine) {
    if (hosted.has(c.id)) continue;
    const list = sections[sectionOf(c)];
    const canGroup = !noGroup?.(c.id) && attachmentsOf(c.id).length === 0 && !preview?.[c.id];
    const key = canGroup ? groupKey(c) : c.id;
    const g = canGroup ? list.find((x) => x.key === key) : undefined;
    if (g) g.ids.push(c.id);
    else list.push({ key, ids: [c.id], pick: c.id });
  }
  for (const list of Object.values(sections)) {
    for (const g of list) g.pick = g.ids.find((id) => cardProps(id).selectable) ?? g.ids.find((id) => !view.cards[id].tapped) ?? g.ids[0];
  }

  const gap = mini ? 6 : 18;
  const groupGap = mini ? 12 : 44;
  const rowGap = mini ? 4 : 6;
  const H = Math.max(40, size.h - rowGap * 2);
  const W = Math.max(100, size.w - (mini ? 4 : 16));
  const frac = [0.44, 0.29, 0.27];
  const rowH = frac.map((f) => H * f);
  const ratio = mode === 'full' ? 1.396 : 0.78;
  const caps = mode === 'full' ? [150, 112, 100] : mini ? [56, 40, 40] : [124, 92, 84];
  const fit = (row: number, groups: Item[][]) => {
    const items = groups.flat();
    const fh = Math.max(16, rowH[row] - (mini ? 4 : 14));
    let w = Math.min(caps[row], fh / ratio);
    const need = (w: number) =>
      items.reduce((n, it) => {
        const c = view.cards[it.pick];
        const h = w * ratio;
        const foot = c.tapped && !cardProps(it.pick).attacking ? (mode === 'tile' ? (h * h) / w : h) : w;
        return n + foot + gap + (it.ids.length > 1 ? 8 : 0) + attachmentsOf(it.pick).length * w * 0.2;
      }, 0) + groupGap * (groups.filter((g) => g.length).length - 1);
    const total = need(w);
    if (total > W && total > 0) w = Math.max(mini ? 14 : 26, (w * W) / total);
    return Math.floor(w);
  };
  const wCreatures = fit(0, [sections.creatures]);
  const wMid = fit(1, [sections.artifacts, sections.enchantments]);
  const wBack = fit(2, [sections.lands, sections.tokens]);

  const render = (list: Item[], w: number) =>
    list.map((it) => (
      <Permanent
        key={it.key}
        p={cardProps(it.pick)}
        mode={mode}
        w={w}
        count={it.ids.length}
        preview={preview?.[it.pick]}
        attachments={attachmentsOf(it.pick).map((a) => ({ p: cardProps(a), onClick: () => onCardClick(a) }))}
        onClick={() => onCardClick(it.pick)}
        onHover={onHover}
      />
    ));
  const grp = (list: Item[], w: number) => (list.length ? <div className="grp">{render(list, w)}</div> : null);

  const rows = [
    <div key="c" className="brow front" style={{ height: rowH[0] }}>
      {grp(sections.creatures, wCreatures)}
    </div>,
    <div key="m" className="brow" style={{ height: rowH[1] }}>
      {grp(sections.artifacts, wMid)}
      {grp(sections.enchantments, wMid)}
    </div>,
    <div key="b" className="brow" style={{ height: rowH[2] }}>
      {grp(sections.lands, wBack)}
      {grp(sections.tokens, wBack)}
    </div>,
  ];
  return (
    <div ref={ref} className={`rows3 ${mini ? 'mini' : ''} ${mode}`} style={{ ['--gap' as string]: `${gap}px`, ['--ggap' as string]: `${groupGap}px`, ['--rgap' as string]: `${rowGap}px` }}>
      {size.w > 0 && (far ? rows.reverse() : rows)}
    </div>
  );
}

// ---------- Seat colors, playmats ----------

export const SEAT_COLORS = ['#2ec4b6', '#b48cff', '#f2b33d', '#ef5d6b'];

/** Leather playmats for the tavern table. */
export const MATS: { id: string; label: string }[] = [
  { id: 'green', label: 'Green leather' },
  { id: 'oxblood', label: 'Oxblood' },
  { id: 'navy', label: 'Navy' },
  { id: 'black', label: 'Black' },
  { id: 'tan', label: 'Tan' },
  { id: 'plum', label: 'Plum' },
];
const MAT_KEY = 'commander-arena-mats-v2';

/** Playmat choice per player, remembered in this browser. */
export function useMats(): [Record<PlayerId, string>, (pid: PlayerId, mat: string) => void] {
  const [mats, setMats] = useState<Record<PlayerId, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(MAT_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(MAT_KEY, JSON.stringify(mats));
    } catch {
      /* ignore */
    }
  }, [mats]);
  return [mats, (pid, mat) => setMats((m) => ({ ...m, [pid]: mat }))];
}

export function MatPicker({ value, onChange, label = 'Mat' }: { value: string; onChange: (m: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="mat-picker" onClick={(e) => e.stopPropagation()}>
      <button className="tbtn quiet" onClick={() => setOpen(!open)}>
        <span className={`swatch leather-${value}`} /> {label}
      </button>
      {open && (
        <span className="mat-menu">
          {MATS.map((m) => (
            <button
              key={m.id}
              className={`swatch-btn ${m.id === value ? 'on' : ''}`}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            >
              <span className={`swatch leather-${m.id}`} />
              {m.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// ---------- Mana pips ----------

const PIP_BG: Record<string, string> = { W: '#f8f6d8', U: '#c1d7e9', B: '#bab1ab', R: '#e49977', G: '#a3c095', C: '#ccc2c0' };
const PIP_GLYPH: Record<string, string> = {
  W: 'M16 10.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM16 2l2 7h-4zM16 30l-2-7h4zM2 16l7-2v4zM30 16l-7 2v-4zM6 6l6 3.5-2.5 2.5zM26 26l-6-3.5 2.5-2.5zM26 6l-3.5 6-2.5-2.5zM6 26l3.5-6 2.5 2.5z',
  U: 'M16 3S7 13.5 7 20a9 9 0 0018 0C25 13.5 16 3 16 3zm-4.5 17.5c-.3-2.5 1-5 2.3-6.5-.4 2.2-.6 4.2.6 6.6z',
  B: 'M16 3C9.4 3 5 7.6 5 13.4c0 3.8 1.9 6.4 4.5 7.9V27h3.2v-3h2v3h2.6v-3h2v3h3.2v-5.7c2.6-1.5 4.5-4.1 4.5-7.9C27 7.6 22.6 3 16 3zm-5 14.2a2.8 2.8 0 110-5.6 2.8 2.8 0 010 5.6zm10 0a2.8 2.8 0 110-5.6 2.8 2.8 0 010 5.6z',
  R: 'M17 2c1 5 8 7.5 8 15.5A9 9 0 0116 27a8.5 8.5 0 01-9-8.6c0-4.4 2.8-6.8 4.2-10 1.6 2.4 1.3 4.6 1.3 4.6S16.5 9 17 2zm-1 25.5c-2.4 0-4-1.7-4-4 0-2.8 3-4.6 3.6-7.5 2.4 2.3 4.4 4.8 4.4 7.5 0 2.3-1.6 4-4 4z',
  G: 'M16 2.5c-3.4 0-5.6 2.4-5.8 5.2-2.9.4-5 2.7-5 5.6 0 3.2 2.6 5.6 5.7 5.6h3.4V25l-3.5 3.5h10.4L17.7 25v-6.1h3.4c3.1 0 5.7-2.4 5.7-5.6 0-2.9-2.1-5.2-5-5.6C21.6 4.9 19.4 2.5 16 2.5z',
  C: 'M16 3l11 13-11 13L5 16zm0 5.5L9.6 16 16 23.5 22.4 16z',
};

/** One mana pip. A source that makes several colors is one pip split like a pie chart. */
export function ManaPip({ colors, size = 24 }: { colors: string[]; size?: number }): ReactNode {
  if (colors.length <= 1) {
    const c = colors[0] ?? 'C';
    return (
      <span className="mpip" style={{ width: size, height: size, background: PIP_BG[c] }}>
        <svg viewBox="0 0 32 32">
          <path d={PIP_GLYPH[c]} fillRule="evenodd" />
        </svg>
      </span>
    );
  }
  const step = 360 / colors.length;
  const stops = colors.map((c, i) => `${PIP_BG[c]} ${i * step}deg ${(i + 1) * step}deg`).join(', ');
  const seams = colors.map((_, i) => `#0006 ${i * step}deg ${i * step + 2}deg, transparent ${i * step + 2}deg ${(i + 1) * step}deg`).join(', ');
  return <span className="mpip pie" style={{ width: size, height: size, background: `conic-gradient(from -90deg, ${seams}), conic-gradient(from -90deg, ${stops})` }} />;
}

/** Kept for older callers: renders the pie/symbol pip for a set of colors. */
export function ManaPips({ produces }: { produces: string[] }): ReactNode {
  return <ManaPip colors={produces} />;
}
