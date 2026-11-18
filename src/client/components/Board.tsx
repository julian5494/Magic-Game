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

function fullUrl(c: CardView): string {
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

const KW_HELP: Partial<Record<Keyword | 'Ward', string>> = {
  Flying: "Flying — can't be blocked except by creatures with flying or reach",
  Reach: 'Reach — can block creatures with flying',
  Trample: 'Trample — excess combat damage goes to the player',
  Haste: 'Haste — can attack and tap the turn it comes in',
  Vigilance: "Vigilance — attacking doesn't cause it to tap",
  Deathtouch: 'Deathtouch — any damage it deals to a creature is lethal',
  Lifelink: 'Lifelink — damage it deals also gains you that much life',
  'First strike': 'First strike — deals combat damage before creatures without it',
  'Double strike': 'Double strike — deals first-strike and regular combat damage',
  Menace: "Menace — can't be blocked except by two or more creatures",
  Defender: "Defender — can't attack",
  Hexproof: "Hexproof — can't be the target of opponents' spells or abilities",
  Shroud: "Shroud — can't be the target of any spells or abilities",
  Indestructible: "Indestructible — damage and \"destroy\" effects don't destroy it",
  Prowess: 'Prowess — +1/+1 until end of turn whenever you cast a noncreature spell',
  Unblockable: "Can't be blocked",
  Ward: 'Ward — opponents must pay extra when targeting it, or their spell is countered',
};

function KeywordRail({ card, small }: { card: CardView; small: boolean }) {
  const kws: (Keyword | 'Ward')[] = card.keywords.filter((k) => ICONS[k]);
  if (card.ward) kws.push('Ward');
  if (!kws.length) return null;
  const shown = kws.slice(0, small ? 3 : 6);
  return (
    <div className={`kw-rail ${small ? 'small' : ''}`}>
      {shown.map((k) => (
        <div key={k} className={`kw kw-${k.replace(/\s/g, '-')}`} title={k === 'Ward' ? `Ward ${card.ward ?? ''}` : KW_HELP[k] ?? k}>
          <svg viewBox="0 0 24 24">
            <path d={ICONS[k]} />
          </svg>
        </div>
      ))}
    </div>
  );
}

// ---------- Rune circle (hexproof / ward / shroud) ----------

/** Deterministic little rune glyphs drawn from line segments. */
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
        {Array.from({ length: 48 }, (_, i) => (
          <line key={i} x1="0" y1="-46" x2="0" y2={i % 4 === 0 ? -49 : -47.5} transform={`rotate(${i * 7.5})`} className="rune-line thin" />
        ))}
      </g>
      <g className="rune-inner">
        <polygon points="0,-30 26,15 -26,15" className="rune-line thin" />
        <polygon points="0,30 26,-15 -26,-15" className="rune-line thin" />
        <circle r="13" className="rune-line thin" />
        <circle r="3" className="rune-dot" />
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
  seatColor,
}: {
  p: PermProps;
  mode: FaceMode;
  w: number;
  count?: number;
  attachments?: { p: PermProps; onClick: () => void }[];
  preview?: PreviewMark;
  onClick: () => void;
  onHover: (c: CardView | null) => void;
  seatColor: string;
}) {
  const c = p.card;
  const [imgFailed, setImgFailed] = useState(false);
  const { h } = faceSize(mode, w);
  const kw = (k: Keyword) => c.keywords.includes(k);
  const attackingTilt = p.attacking && !kw('Vigilance');
  const tapped = c.tapped && !p.attacking && !p.blocking;
  const isCreature = c.types.includes('Creature');
  const fx: string[] = [];
  if (kw('Flying') && isCreature) fx.push('fx-fly');
  if (kw('Deathtouch')) fx.push('fx-death');
  if (kw('Indestructible')) fx.push('fx-indestructible');
  if (kw('Lifelink')) fx.push('fx-lifelink');
  const rune: 'hexproof' | 'ward' | 'shroud' | null = kw('Shroud') ? 'shroud' : kw('Hexproof') ? 'hexproof' : c.ward ? 'ward' : null;
  if (rune) fx.push('fx-rune');

  // Footprint: tapped permanents lie sideways.
  const scaleTapped = mode === 'tile' ? h / w : 1;
  const footW = tapped ? Math.round(mode === 'tile' ? (h * h) / w : h) : w;
  const stackPad = Math.min(count - 1, 2) * 4;
  const attachPad = attachments.length * Math.round(w * 0.18);
  const showImg = imagesEnabled() && !imgFailed && !c.token;
  const small = w < 70;

  const cls = [
    'perm',
    `perm-${mode}`,
    tapped ? 'tapped' : '',
    attackingTilt ? 'att tilt' : p.attacking ? 'att' : '',
    p.blocking ? 'blk' : '',
    p.selectable ? 'selectable' : '',
    p.selected ? 'selected' : '',
    p.dropOk ? 'drop-ok' : '',
    p.dim ? 'dim' : '',
    preview?.dies ? 'pv-dies' : '',
    ...fx,
  ].join(' ');

  const face = (
    <div
      className="face"
      style={{
        width: w,
        height: h,
        backgroundImage: showImg ? `url("${mode === 'full' ? fullUrl(c) : artUrl(c)}")` : undefined,
      }}
    >
      {showImg && <img src={mode === 'full' ? fullUrl(c) : artUrl(c)} alt="" style={{ display: 'none' }} onError={() => setImgFailed(true)} />}
      {!showImg && <TextFace card={c} mode={mode} />}
      {mode === 'tile' && showImg && <div className="banner">{c.name}</div>}
      {rune && <RuneCircle kind={rune} />}
      {kw('Indestructible') && <div className="shine" />}
    </div>
  );

  return (
    <div
      className="perm-slot"
      style={{ width: footW + stackPad + attachPad, height: h }}
    >
      {attachments.map((a, i) => (
        <div
          key={a.p.card.id}
          className="attachment"
          style={{ left: (attachments.length - i) * Math.round(w * 0.18), zIndex: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
          onMouseEnter={() => onHover(a.p.card)}
          onMouseLeave={() => onHover(null)}
          {...a.p.extra}
          data-card-id={a.p.card.id}
        >
          <div className={`face ${a.p.selectable ? 'selectable' : ''}`} style={{ width: w, height: h, backgroundImage: imagesEnabled() && !a.p.card.token ? `url("${mode === 'full' ? fullUrl(a.p.card) : artUrl(a.p.card)}")` : undefined }}>
            {(!imagesEnabled() || a.p.card.token) && <TextFace card={a.p.card} mode={mode} />}
          </div>
        </div>
      ))}
      <div
        className={cls}
        data-card-id={c.id}
        style={{ ['--seat' as string]: seatColor, ['--tap-scale' as string]: String(scaleTapped), width: w, height: h }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onMouseEnter={() => onHover(c)}
        onMouseLeave={() => onHover(null)}
        {...p.extra}
      >
        {fx.includes('fx-fly') && <div className="fly-shadow" />}
        {fx.includes('fx-death') && (
          <>
            <div className="ground-glow" />
            <i className="wisp" style={{ left: '18%', ['--dx' as string]: '-8px', animationDelay: '0s' }} />
            <i className="wisp" style={{ left: '55%', ['--dx' as string]: '10px', animationDelay: '1.1s' }} />
            <i className="wisp" style={{ left: '35%', ['--dx' as string]: '4px', animationDelay: '2.2s' }} />
          </>
        )}
        {count > 1 && (
          <>
            <div className="stack-ghost" style={{ width: w, height: h, transform: 'translate(8px,-8px)' }} />
            <div className="stack-ghost" style={{ width: w, height: h, transform: 'translate(4px,-4px)' }} />
          </>
        )}
        <div className="lift">
          {face}
          {(p.attacking || p.blocking) && (
            <div className="emblem">
              <svg viewBox="0 0 24 24">
                <path d={p.attacking ? 'M3 2l9 9-2 2-9-9zM21 2l-9 9 2 2 9-9zM6 15l3 3-3 3-3-3zM18 15l-3 3 3 3 3-3z' : 'M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z'} />
              </svg>
            </div>
          )}
          {isCreature && <KeywordRail card={c} small={small} />}
          {c.power !== undefined && (
            <div className={`pt ${ptTone(c)}`}>
              {c.power}/{(c.toughness ?? 0) - c.damage}
            </div>
          )}
          {c.types.includes('Planeswalker') && <div className="loyalty">{c.counters.loyalty ?? 0}</div>}
          <Counters card={c} />
          {c.commander && <div className="star" title="Commander">★</div>}
          {c.sick && isCreature && !kw('Haste') && <div className="zz" title="Summoning sick">z</div>}
          {c.ward && <div className="wardcost" title="Ward">ward <ManaText text={c.ward} /></div>}
          {(c.unsupported || c.cannotCast) && <div className={`warn-dot ${c.cannotCast ? 'blocked' : ''}`} title="Some abilities are not automated">!</div>}
          {count > 1 && <div className="count">×{count}</div>}
          {p.badge && <div className="perm-badge">{p.badge}</div>}
          {preview?.damage ? <div className="pv-dmg">−{preview.damage}</div> : null}
          {preview?.dies && (
            <div className="skull" title="Dies">
              <svg viewBox="0 0 24 24">
                <path d={ICONS.Deathtouch} />
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
      {card.token && <div className="tf-token">token</div>}
    </div>
  );
}

// ---------- Board: three rows ----------

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

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) > 1 || Math.abs(s.h - r.height) > 1 ? { w: r.width, h: r.height } : s));
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
  /** Small side seats: no labels, tighter spacing. */
  mini?: boolean;
  cardProps: (id: CardId) => PermProps;
  onCardClick: (id: CardId) => void;
  onHover: (c: CardView | null) => void;
  seatColor: string;
  /** Cards that must not be folded into a stack (eg. creatures you're declaring attacks with). */
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

export function Battlefield({ view, owner, mode, mini, cardProps, onCardClick, onHover, seatColor, noGroup, preview }: BoardProps) {
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

  // Fit the rows into the space we have.
  const labelPad = mini ? 4 : 16;
  const gap = mini ? 5 : 12;
  const rowGap = mini ? 4 : 8;
  const H = Math.max(60, size.h - (mini ? 6 : 16));
  const W = Math.max(120, size.w - (mini ? 8 : 24));
  const rowH = [H * 0.42, H * 0.29, H * 0.29].map((r) => r - rowGap);
  const ratio = mode === 'full' ? 1.396 : 0.78;
  const maxW = mode === 'full' ? 130 : mini ? 64 : 104;
  const widthFor = (row: number, items: Item[], avail: number) => {
    const fh = Math.max(20, rowH[row] - labelPad - (mode === 'full' ? 8 : 6));
    let w = Math.min(maxW, fh / ratio);
    const need = (w: number) =>
      items.reduce((n, it) => {
        const c = view.cards[it.pick];
        const h = w * ratio;
        const foot = c.tapped && !cardProps(it.pick).attacking ? h : w;
        return n + foot + gap + (it.ids.length > 1 ? 8 : 0) + attachmentsOf(it.pick).length * w * 0.18;
      }, 0);
    const total = need(w);
    if (total > avail && total > 0) w = Math.max(mini ? 16 : 28, (w * avail) / total);
    return Math.floor(w);
  };
  const half = (W - (mini ? 6 : 14)) / 2 - (mini ? 4 : 24);
  const widths = {
    creatures: widthFor(0, sections.creatures, W - (mini ? 0 : 20)),
    artifacts: widthFor(1, sections.artifacts, half),
    enchantments: widthFor(1, sections.enchantments, half),
    lands: widthFor(2, sections.lands, half),
    tokens: widthFor(2, sections.tokens, half),
  };
  // Keep a row visually consistent: both halves use the smaller size.
  widths.artifacts = widths.enchantments = Math.min(widths.artifacts, widths.enchantments);
  widths.lands = widths.tokens = Math.min(widths.lands, widths.tokens);

  const render = (s: Section) =>
    sections[s].map((it) => (
      <Permanent
        key={it.key}
        p={cardProps(it.pick)}
        mode={mode}
        w={widths[s]}
        count={it.ids.length}
        seatColor={seatColor}
        preview={preview?.[it.pick]}
        attachments={attachmentsOf(it.pick).map((a) => ({ p: cardProps(a), onClick: () => onCardClick(a) }))}
        onClick={() => onCardClick(it.pick)}
        onHover={onHover}
      />
    ));

  const group = (s: Section, label: string) => (
    <div className={`bf-group g-${s}`}>
      {!mini && <span className="row-tag">{label}</span>}
      {render(s)}
    </div>
  );

  return (
    <div ref={ref} className={`bf3 ${mini ? 'mini' : ''} ${mode}`} style={{ ['--row-gap' as string]: `${rowGap}px`, ['--gap' as string]: `${gap}px` }}>
      {size.w > 0 && (
        <>
          <div className="bf-row3 r-creatures" style={{ height: rowH[0] }}>
            {!mini && <span className="row-tag">Creatures</span>}
            {render('creatures')}
          </div>
          <div className="bf-row3 split" style={{ height: rowH[1] }}>
            {group('artifacts', 'Artifacts')}
            {group('enchantments', 'Enchantments')}
          </div>
          <div className="bf-row3 split" style={{ height: rowH[2] }}>
            {group('lands', 'Lands')}
            {group('tokens', 'Tokens to use')}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Small shared pieces ----------

export const SEAT_COLORS = ['#2ec4b6', '#b48cff', '#f2b33d', '#ef5d6b'];

export const MATS: { id: string; label: string }[] = [
  { id: 'nebula', label: 'Nebula' },
  { id: 'forest', label: 'Grove' },
  { id: 'ember', label: 'Ember' },
  { id: 'ocean', label: 'Tide' },
  { id: 'stone', label: 'Slate' },
  { id: 'gilded', label: 'Gilded' },
];
const MAT_KEY = 'commander-arena-mats';

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

export function MatPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="mat-picker" onClick={(e) => e.stopPropagation()}>
      <button className="chip-btn" title="Playmat" onClick={() => setOpen(!open)}>
        <span className={`swatch mat-${value}`} /> Mat
      </button>
      {open && (
        <span className="mat-menu">
          {MATS.map((m) => (
            <button
              key={m.id}
              className={`swatch-btn ${m.id === value ? 'on' : ''}`}
              title={m.label}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            >
              <span className={`swatch mat-${m.id}`} />
              {m.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ManaPips({ produces }: { produces: string[] }): ReactNode {
  if (produces.length >= 5) return <span className="pip pip-any" title="Any color" />;
  if (produces.length > 1) {
    return (
      <span className="pip-multi" title={produces.join('/')}>
        {produces.map((s) => (
          <span key={s} className={`pip pip-${s}`}>
            {s}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={`pip pip-${produces[0]}`} title={produces[0]}>
      {produces[0] === 'C' ? '◇' : produces[0]}
    </span>
  );
}
