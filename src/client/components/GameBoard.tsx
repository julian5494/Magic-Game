import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import type { Anchors } from '../three/TableScene';
import { useTable3D, useTableSettings } from '../three/useTable3D';
import type { Action, AutoPassMode, CardId, ManaSym, PlayableAction, PlayerId, Step, Target, TargetSpecView } from '../../engine/types';
import type { CardView, GameView, PlayerView, StackView } from '../../engine/view';
import { DEFAULT_STOPS } from '../../engine/types';
import type { ClientMessage } from '../../shared/protocol';
import type { NetState } from '../net';
import { previewCombat, type CombatPreview, type PlannedAttack } from '../combat';
import { trackFoilPointer } from '../foil';
import { useGameSounds } from '../gameSounds';
import { sound } from '../sound';
import { artUrl, Battlefield, MatPicker, SEAT_COLORS, useMats, type PermProps, type PreviewMark } from './Board';
import { FxLayer } from './FxLayer';
import { Card, CardPreview, IMAGES_KEY, imagesEnabled, ManaText } from './Card';
import { DecisionModal, LogPanel, nameOfPlayer, PhaseTracker, StackPanel, STEP_LABELS, XModal, ZoneModal, type ZoneOpen } from './parts';
import { CmdDamage, CommandSlot, D20, ManaBar, MatPiles, Portrait } from './Seats';

interface Pending {
  action: PlayableAction;
  stage: 'x' | 'sacrifice' | 'targets';
  x?: number;
  sacrifice?: CardId;
  targets: (Target | null)[];
  color?: ManaSym;
}

/** A choice of what to do with a card: its abilities (on the table) or how to cast it (held out of the hand). */
interface Menu {
  cardId: CardId;
}

/** The phase-rail step a game step is shown under. */
function railStep(step: Step): Step {
  if (step === 'untap') return 'upkeep';
  if (step === 'firstStrikeDamage' || step === 'endCombat') return 'combatDamage';
  if (step === 'cleanup') return 'end';
  return step;
}
const sameTarget = (a: Target, b: Target) => a.type === b.type && a.id === b.id;

const CLICK_KEY = 'commander-arena-click-to-play';
const CALM_KEY = 'commander-arena-calm';
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}
function readClickToPlay(): boolean {
  try {
    return localStorage.getItem(CLICK_KEY) === 'on';
  } catch {
    return false;
  }
}

type DragKind = 'hand' | 'attacker' | 'blocker';
/** Where something can be dropped: a card, a player, or a board area. */
type DropTarget = { type: 'card'; id: CardId } | { type: 'player'; id: PlayerId } | { type: 'area'; owner: PlayerId };
type Extra = HTMLAttributes<HTMLDivElement> & { draggable?: boolean };

export function GameBoard({ view, net, send }: { view: GameView; net: NetState; send: (m: ClientMessage) => void }) {
  // Hover preview: shows after a short pause, swaps instantly between cards, and lingers a moment
  // after the pointer leaves, so it doesn't flicker across card edges, badges or a drifting camera.
  const [hoverCard, setHoverCard] = useState<CardView | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverShown = useRef<CardView | null>(null);
  const pointerX = useRef(0);
  const setHover = useCallback((c: CardView | null) => {
    window.clearTimeout(hoverTimer.current);
    const show = (v: CardView | null) => {
      // Put the preview on the side away from the pointer so it never covers the card you're reading.
      const x = pointerX.current;
      if (v && (!hoverShown.current || x < 380 || x > window.innerWidth - 400)) setPreviewSide(x < window.innerWidth * 0.42 ? 'right' : 'left');
      hoverShown.current = v;
      setHoverCard(v);
    };
    if (c && hoverShown.current) show(c);
    else if (c) hoverTimer.current = window.setTimeout(() => show(c), 130);
    else hoverTimer.current = window.setTimeout(() => show(null), 200);
  }, []);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // Foil cards catch the light where the pointer is.
  useEffect(() => trackFoilPointer(), []);
  // Sounds: game events, a soft click on buttons, and the hearth crackling while you play.
  useGameSounds(view);
  useEffect(() => {
    sound.wantHearth(true);
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('.tbtn, .pop-use, .pop-cancel, .held-caption button')) sound.play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => {
      sound.wantHearth(false);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  const soundPrefs = useSoundPrefs();
  /** Clicking empty table space on the 3D table: whatever prop is there reacts (with its sound). */
  const pokeTable = (e: React.MouseEvent) => {
    if (!table3d || !(e.target instanceof Element)) return;
    if (e.target.closest('[data-card-id], [data-player-id], button, input, select, label, .hud, .hand-fan, .rail, .seat-tab, .modal, .preview-wrap, .stack-panel, .log, .action-pop')) return;
    const kind = table3d.poke(e.clientX, e.clientY);
    const SOUND = { candle: 'whoosh', mug: 'clink', box: 'knock', coins: 'coins', hourglass: 'flip', dagger: 'shing', ink: 'clink', paper: 'rustle', tray: 'knock', barrel: 'knock', chair: 'creak' } as const;
    if (kind) sound.play(SOUND[kind]);
  };
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('left');
  const hover = hoverCard ? view.cards[hoverCard.id] ?? hoverCard : null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // The phase-rail step whose stop settings are open.
  const [stopMenu, setStopMenu] = useState<Step | null>(null);
  const [zone, setZone] = useState<ZoneOpen | null>(null);
  const [attacks, setAttacks] = useState<Record<CardId, PlayerId>>({});
  const [attackTarget, setAttackTarget] = useState<PlayerId | null>(null);
  const [blocks, setBlocks] = useState<Record<CardId, CardId>>({});
  const [selBlocker, setSelBlocker] = useState<CardId | null>(null);
  const [trigTargets, setTrigTargets] = useState<(Target | null)[]>([]);
  const [, forceRender] = useState(0);
  const [hold, setHold] = useState(false);
  const [drag, setDrag] = useState<{ id: CardId; kind: DragKind } | null>(null);
  /** True while aiming (an attacker, a blocker, or a card pulled out of the hand). */
  const [aiming, setAiming] = useState(false);
  /** A card taken out of the hand (or command zone) to be played: shown above the hand until it's cast or cancelled. */
  const [held, setHeldState] = useState<CardId | null>(null);
  // Where the held card came from (hand, command zone, graveyard, the top of the library...): it's put down once it leaves.
  const heldZone = useRef<string | null>(null);
  const setHeld = (id: CardId | null) => {
    heldZone.current = id ? view.cards[id]?.zone ?? null : null;
    setHeldState(id);
  };
  // Lifting a card out of the hand makes a soft whoosh.
  const heldBefore = useRef<CardId | null>(null);
  useEffect(() => {
    if (held && !heldBefore.current) sound.play('pickup');
    heldBefore.current = held;
  }, [held]);
  const suppressClick = useRef(false);
  const [topPin, setTopPin] = useState<PlayerId | null>(null);
  // On the 3D table: an opponent's whole board brought across the table at full size (until you go back).
  const [farFocus, setFarFocus] = useState<PlayerId | null>(null);
  const [fullBoard, setFullBoard] = useState<PlayerId | null>(null);
  const [calm, setCalm] = useState(() => readFlag(CALM_KEY));
  const table = useTableSettings();
  const tableRef = useRef<HTMLDivElement>(null);
  const { scene: table3d, boardEl } = useTable3D(tableRef);
  const [anchors, setAnchors] = useState<Anchors>({});
  const dieAt = table3d ? anchors.me ?? null : null;
  const [mats, setMat] = useMats();
  const [clickToPlay, setClickToPlay] = useState(readClickToPlay);
  const [selectedHand, setSelectedHand] = useState<CardId | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const act = useCallback((action: Action) => send({ t: 'action', action }), [send]);
  const decision = view.decision;
  const myDecisionNow = decision && decision.player === view.you ? decision : null;
  const me = view.players.find((p) => p.id === view.you)!;
  const myStops = me.stops ?? DEFAULT_STOPS;

  // Opponents in turn order starting after me.
  const opponents = useMemo(() => {
    const idx = view.players.findIndex((p) => p.id === view.you);
    return [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
  }, [view.players, view.you]);

  useEffect(() => {
    setAttacks({});
    setBlocks({});
    setSelBlocker(null);
    setTrigTargets([]);
    if (decision?.kind === 'declareAttackers') {
      const alive = decision.defenders ?? [];
      setAttackTarget(alive[0] ?? null);
    }
  }, [decision?.id]);

  // Drop an in-progress cast if it stopped being legal (eg. priority moved), and close a menu whose card can't act.
  useEffect(() => {
    if (pending && !view.legal.some((a) => a.cardId === pending.action.cardId && a.type === pending.action.type && a.ability === pending.action.ability)) {
      setPending(null);
    }
    if (menu && !view.legal.some((a) => a.cardId === menu.cardId)) setMenu(null);
    if (held && view.cards[held]?.zone !== heldZone.current) setHeld(null);
  }, [view]);

  // A held card goes back to the hand (or on to the stack) once nothing is being done with it.
  useEffect(() => {
    if (!held || pending || drag || (menu && menu.cardId === held)) return;
    const t = window.setTimeout(() => setHeld(null), 380);
    return () => window.clearTimeout(t);
  }, [held, pending, drag, menu]);

  /** A card that can't be played right now gives a little shake and says why (as best we can tell). */
  const [nope, setNope] = useState<{ id: CardId; text: string } | null>(null);
  const refuse = (id: CardId) => {
    const name = view.cards[id]?.name ?? 'That card';
    const text = view.phase !== 'playing' || !view.canPass
      ? `Wait for your priority to play ${name}.`
      : `You can't play ${name} right now: not enough mana, or not the right time for it.`;
    setNope({ id, text });
  };
  useEffect(() => {
    if (!nope) return;
    const t = window.setTimeout(() => setNope(null), 2200);
    return () => window.clearTimeout(t);
  }, [nope]);

  /** Put everything down: pending cast/ability, menus, held card, half-made blocks. */
  const cancelAll = useCallback(() => {
    if (heldBefore.current) sound.play('cancel');
    setPending(null);
    setMenu(null);
    setHeld(null);
    setSelBlocker(null);
    setSelectedHand(null);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelAll();
        setFarFocus(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelAll]);

  // ---------- Targeting ----------
  const targeting: { specs: TargetSpecView[]; chosen: (Target | null)[] } | null =
    pending?.stage === 'targets'
      ? { specs: pending.action.targets, chosen: pending.targets }
      : decision?.kind === 'chooseTargets'
        ? { specs: decision.targetSpecs!, chosen: trigTargets }
        : null;
  const spec = targeting ? targeting.specs[targeting.chosen.length] : undefined;
  const sacrificing = pending?.stage === 'sacrifice' ? pending.action.sacrificeOptions ?? [] : null;

  const isTargetable = (t: Target) => !!spec && spec.options.some((o) => sameTarget(o, t)) && !targeting!.chosen.some((c) => c && sameTarget(c, t));
  const offBoardOptions = spec ? spec.options.filter((o) => o.type === 'card' && view.cards[o.id]?.zone !== 'battlefield') : [];

  const finishPending = (p: Pending) => {
    const a = p.action;
    if (a.type === 'cast') act({ type: 'cast', cardId: a.cardId, targets: p.targets, x: p.x, sacrifice: p.sacrifice, modes: a.modes, variant: a.variant, helpFirst: a.helpFirst, hold });
    else if (a.type === 'activate') {
      act({ type: 'activate', cardId: a.cardId, ability: a.ability!, targets: p.targets, x: p.x, sacrifice: p.sacrifice, color: p.color, hold: a.isMana ? undefined : hold });
    }
    setPending(null);
  };

  const advancePending = (p: Pending) => {
    if (p.stage === 'x') {
      if (p.action.sacrificeOptions) return setPending({ ...p, stage: 'sacrifice' });
      p = { ...p, stage: 'targets' };
    }
    if (p.stage === 'sacrifice' && p.sacrifice) p = { ...p, stage: 'targets' };
    if (p.stage === 'targets' && p.targets.length >= p.action.targets.length) return finishPending(p);
    setPending(p);
  };

  const chooseTarget = (t: Target | null) => {
    if (!targeting) return;
    const full = t ? spec!.options.find((o) => sameTarget(o, t))! : null;
    const chosen = [...targeting.chosen, full];
    if (pending) advancePending({ ...pending, targets: chosen });
    else if (decision?.kind === 'chooseTargets') {
      if (chosen.length >= targeting.specs.length) {
        act({ type: 'decide', decisionId: decision.id, answer: { targets: chosen } });
        setTrigTargets([]);
      } else setTrigTargets(chosen);
    }
  };

  const startAction = (a: PlayableAction, color?: ManaSym) => {
    setMenu(null);
    if (a.type === 'playLand') return act({ type: 'playLand', cardId: a.cardId, back: a.back });
    if (a.type === 'manaTap') return act({ type: 'manaTap', cardId: a.cardId, ability: a.ability!, color: color ?? a.manaColors?.[0] });
    const p: Pending = { action: a, stage: a.xMax !== undefined ? 'x' : a.sacrificeOptions ? 'sacrifice' : 'targets', targets: [], color };
    if (p.stage === 'targets' && a.targets.length === 0) return finishPending(p);
    setPending(p);
  };

  const actionsFor = (id: CardId) => view.legal.filter((a) => a.cardId === id);
  /** A card outside the battlefield that you can play or use right now (from the graveyard, exile, the library top). */
  const playableHere = (id: CardId) => actionsFor(id).some((a) => a.type === 'cast' || a.type === 'playLand' || a.type === 'activate');

  /** The buttons for a card's menu, built from what is legal right now. */
  const menuItems = (id: CardId): { label: string; run: () => void }[] => {
    const items: { label: string; run: () => void }[] = [];
    for (const a of actionsFor(id)) {
      if ((a.type === 'manaTap' || a.isMana) && a.manaColors && a.manaColors.length > 1) {
        for (const c of a.manaColors) items.push({ label: `${a.isMana ? a.label.split(':')[0] + ': ' : ''}Add {${c}}`, run: () => startAction(a, c) });
      } else {
        items.push({ label: a.type === 'cast' && !a.modes ? `Cast ${view.cards[id]?.name}` : a.type === 'playLand' ? `Play ${view.cards[id]?.name}` : a.label, run: () => startAction(a) });
      }
    }
    return items;
  };

  /** Clicking a card on the table: select it and ask which ability to use (nothing happens until you confirm). */
  const openMenu = (id: CardId) => {
    if (isInHand(id)) return playFromHand(id);
    if (actionsFor(id).length) setMenu({ cardId: id });
  };

  /**
   * Play a card from your hand or command zone. Lands go straight onto the table; spells come out of the hand
   * and wait above it while you pick targets (or how to cast them, when there's more than one way).
   */
  const playFromHand = (id: CardId) => {
    const acts = actionsFor(id).filter((a) => a.type !== 'manaTap' && !a.isMana);
    if (!acts.length) return refuse(id);
    setSelectedHand(null);
    setMenu(null);
    if (acts.length === 1 && acts[0].type === 'playLand') {
      setHeld(id);
      return startAction(acts[0]);
    }
    setHeld(id);
    if (acts.length === 1) startAction(acts[0]);
    else setMenu({ cardId: id });
  };

  // ---------- Clicks ----------
  const onCardClick = (id: CardId) => {
    const card = view.cards[id];
    if (!card || suppressClick.current) return;
    if (sacrificing) {
      if (sacrificing.includes(id)) advancePending({ ...pending!, sacrifice: id });
      return;
    }
    if (targeting) {
      const t: Target = { type: 'card', id };
      if (isTargetable(t)) chooseTarget(t);
      return;
    }
    if (decision?.kind === 'declareAttackers' && decision.player === view.you) {
      if (decision.planeswalkers?.includes(id)) {
        setAttackTarget(id);
        return;
      }
      if (!decision.attackers!.includes(id)) return;
      const next = { ...attacks };
      if (next[id]) delete next[id];
      else next[id] = attackTarget ?? decision.defenders![0];
      setAttacks(next);
      return;
    }
    if (decision?.kind === 'declareBlockers' && decision.player === view.you) {
      if (decision.blockers!.includes(id)) {
        if (blocks[id]) {
          const next = { ...blocks };
          delete next[id];
          setBlocks(next);
          setSelBlocker(null);
        } else setSelBlocker(selBlocker === id ? null : id);
        return;
      }
      if (decision.attacking!.includes(id) && selBlocker) {
        setBlocks({ ...blocks, [selBlocker]: id });
        setSelBlocker(null);
      }
      return;
    }
    if (isInHand(id) && clickToPlay) return playFromHand(id);
    if (isInHand(id) && !clickToPlay) {
      // Cards in hand are played by double-clicking or dragging them onto the table.
      setSelectedHand(selectedHand === id ? null : id);
      return;
    }
    if (menu?.cardId === id) return setMenu(null);
    openMenu(id);
  };

  const isInHand = (id: CardId) => view.hand.includes(id) || me.command.includes(id);

  // ---------- Drag & drop ----------
  const dragKindFor = (id: CardId): DragKind | null => {
    if (targeting || sacrificing || pending) return null;
    if (myDecisionNow?.kind === 'declareAttackers') return myDecisionNow.attackers!.includes(id) ? 'attacker' : null;
    if (myDecisionNow?.kind === 'declareBlockers') return myDecisionNow.blockers!.includes(id) ? 'blocker' : null;
    if (!decision && isInHand(id) && actionsFor(id).some((a) => a.type !== 'manaTap' && !a.isMana)) return 'hand';
    return null;
  };

  /** Single-target spells can be dropped straight onto their target. */
  const directCast = (id: CardId, t: Target) =>
    view.legal.find(
      (a) => a.cardId === id && a.type === 'cast' && a.targets.length === 1 && a.xMax === undefined && !a.sacrificeOptions && a.targets[0].options.some((o) => sameTarget(o, t)),
    );

  type Drag = { id: CardId; kind: DragKind };
  const canDrop = (t: DropTarget, d: Drag | null = drag): boolean => {
    if (!d) return false;
    const drag = d;
    if (drag.kind === 'hand') {
      if (t.type === 'area') return t.owner === view.you;
      return !!directCast(drag.id, t.type === 'card' ? { type: 'card', id: t.id } : { type: 'player', id: t.id });
    }
    if (drag.kind === 'attacker' && myDecisionNow?.kind === 'declareAttackers') {
      if (t.type === 'player') return myDecisionNow.defenders!.includes(t.id);
      if (t.type === 'card') return !!myDecisionNow.planeswalkers?.includes(t.id);
      return t.owner === view.you || myDecisionNow.defenders!.includes(t.owner);
    }
    if (drag.kind === 'blocker' && myDecisionNow?.kind === 'declareBlockers') {
      if (t.type === 'card') return myDecisionNow.attacking!.includes(t.id);
      return t.type === 'area' && t.owner === view.you;
    }
    return false;
  };

  const handleDrop = (t: DropTarget, d: Drag | null = drag) => {
    setDrag(null);
    if (!d || !canDrop(t, d)) return;
    if (d.kind === 'hand') {
      if (t.type !== 'area') {
        const a = directCast(d.id, t.type === 'card' ? { type: 'card', id: t.id } : { type: 'player', id: t.id })!;
        const full = a.targets[0].options.find((o) => sameTarget(o, t.type === 'card' ? { type: 'card', id: t.id } : { type: 'player', id: t.id }))!;
        act({ type: 'cast', cardId: d.id, targets: [full], modes: a.modes, variant: a.variant, helpFirst: a.helpFirst, hold });
      } else openMenu(d.id);
      return;
    }
    if (d.kind === 'attacker') {
      const next = { ...attacks };
      if (t.type === 'area' && t.owner === view.you) delete next[d.id];
      else next[d.id] = t.type === 'area' ? t.owner : t.id;
      setAttacks(next);
      return;
    }
    const next = { ...blocks };
    if (t.type === 'card') next[d.id] = t.id;
    else delete next[d.id];
    setBlocks(next);
  };

  /** What's under the pointer, as a drop target for `d` (cards first, then players, then a board). */
  const dropTargetAt = (x: number, y: number, d: Drag): DropTarget | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cardEl = el.closest('[data-card-id]');
    const cid = cardEl?.getAttribute('data-card-id');
    if (cid && cid !== d.id && canDrop({ type: 'card', id: cid }, d)) return { type: 'card', id: cid };
    const pid = el.closest('[data-player-id]')?.getAttribute('data-player-id');
    if (pid && canDrop({ type: 'player', id: pid }, d)) return { type: 'player', id: pid };
    const owner = el.closest('[data-owner]')?.getAttribute('data-owner');
    if (owner && canDrop({ type: 'area', owner }, d)) return { type: 'area', owner };
    return null;
  };

  /**
   * Attackers and blockers aren't dragged around: pressing on one draws an arrow from it to the pointer,
   * and letting go over a target assigns it. A press without moving is an ordinary click.
   */
  const startAim = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (started || Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
      started = true;
      setHover(null);
      setMenu(null);
      setDrag(d);
      setAiming(true);
      if (d.kind === 'hand') {
        setPending(null);
        setSelectedHand(null);
        setHeld(d.id);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!started) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setAiming(false);
      if (ev.type !== 'pointerup') return setDrag(null);
      if (d.kind === 'hand') return dropFromHand(ev.clientX, ev.clientY, d);
      const t = dropTargetAt(ev.clientX, ev.clientY, d);
      if (t) handleDrop(t, d);
      else setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /**
   * Let go of a card pulled out of the hand: over a legal target, a single-target spell is cast at it;
   * back over the hand, it's put back; anywhere else on the table, it's played (targets are chosen next).
   */
  const dropFromHand = (x: number, y: number, d: Drag) => {
    setDrag(null);
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('.hand-fan, .strip')) return setHeld(null);
    const cardId = el.closest('[data-card-id]')?.getAttribute('data-card-id');
    const playerId = el.closest('[data-player-id]')?.getAttribute('data-player-id');
    const t: Target | null = cardId && cardId !== d.id ? { type: 'card', id: cardId } : playerId ? { type: 'player', id: playerId } : null;
    const a = t ? directCast(d.id, t) : undefined;
    if (a && t) {
      const full = a.targets[0].options.find((o) => sameTarget(o, t))!;
      act({ type: 'cast', cardId: d.id, targets: [full], modes: a.modes, variant: a.variant, helpFirst: a.helpFirst, hold });
      return;
    }
    playFromHand(d.id);
  };

  const dropProps = (t: DropTarget): Extra => {
    if (!drag || !canDrop(t)) return {};
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        handleDrop(t);
      },
    };
  };

  const onPlayerClick = (pid: PlayerId) => {
    if (targeting) {
      const t: Target = { type: 'player', id: pid };
      if (isTargetable(t)) chooseTarget(t);
      return;
    }
    if (decision?.kind === 'declareAttackers' && decision.defenders!.includes(pid)) setAttackTarget(pid);
  };

  const onStackClick = (s: StackView) => {
    if (targeting) {
      const t: Target = { type: 'stack', id: s.id };
      if (isTargetable(t)) chooseTarget(t);
    }
  };

  // ---------- Card state helpers ----------
  const combat = view.combat;
  const blockerOf = new Map<CardId, CardId>();
  combat?.attackers.forEach((a) => a.blockedBy.forEach((b) => blockerOf.set(b, a.id)));

  const cardProps = (id: CardId): PermProps => {
    const c = view.cards[id];
    const legal = !targeting && !sacrificing && !decision && actionsFor(id).some((a) => a.type !== 'manaTap' && !a.isMana);
    let selectable = legal;
    let selected = false;
    const badge: string | undefined = undefined;
    let attacking = !!combat?.attackers.some((a) => a.id === id);
    let blocking = blockerOf.has(id);
    if (targeting) selectable = isTargetable({ type: 'card', id });
    if (sacrificing) selectable = sacrificing.includes(id);
    if (decision?.kind === 'declareAttackers' && decision.player === view.you) {
      selectable = decision.attackers!.includes(id) || !!decision.planeswalkers?.includes(id);
      if (attackTarget === id) selected = true;
      attacking = !!attacks[id];
    }
    if (decision?.kind === 'declareBlockers' && decision.player === view.you) {
      selectable = decision.blockers!.includes(id) || (!!selBlocker && decision.attacking!.includes(id));
      selected = selBlocker === id;
      if (blocks[id]) blocking = true;
    }
    const extra: Extra = { ...dropProps({ type: 'card', id }) };
    const dropOk = !!drag && drag.id !== id && canDrop({ type: 'card', id });
    const kind = dragKindFor(id);
    if (kind) extra.onPointerDown = (e) => startAim(e, { id, kind });
    if (isInHand(id)) {
      extra.onDoubleClick = () => {
        setSelectedHand(null);
        if (decision || targeting || pending) return;
        playFromHand(id);
      };
      if (selectedHand === id) selected = true;
    }
    if (menu?.cardId === id) selected = true;
    if (drag?.id === id) selected = true;
    return { card: c, selectable: selectable || dropOk, selected, attacking, blocking, badge, extra, dropOk };
  };

  // ---------- Prompt & buttons ----------
  // Each button says where it sits: under a step of the phase rail, at the end of the rail, on the stack, or with the prompt.
  const myDecision = decision && decision.player === view.you ? decision : null;
  let prompt = '';
  type Where = Step | 'tail' | 'stack' | 'prompt';
  const buttons: { label: string; primary?: boolean; run: () => void; disabled?: boolean; at: Where }[] = [];

  if (pending) {
    const name = view.cards[pending.action.cardId]?.name ?? '';
    if (pending.stage === 'sacrifice') prompt = `${name}: ${pending.action.sacrificeLabel ?? 'choose a permanent to sacrifice'}`;
    else if (spec) prompt = `${name}: choose ${spec.label}`;
    if (spec?.optional) buttons.push({ label: 'No target', run: () => chooseTarget(null), at: 'prompt' });
    buttons.push({ label: 'Cancel', run: () => setPending(null), at: 'prompt' });
  } else if (myDecision?.kind === 'chooseTargets') {
    prompt = `${myDecision.prompt}: choose ${spec?.label}`;
    if (spec?.optional) buttons.push({ label: 'No target', run: () => chooseTarget(null), at: 'prompt' });
  } else if (myDecision?.kind === 'declareAttackers') {
    const n = Object.keys(attacks).length;
    const at = attackTarget ? view.cards[attackTarget]?.name ?? nameOfPlayer(view, attackTarget) : '';
    prompt = opponents.filter((o) => !o.lost).length > 1 || myDecision.planeswalkers?.length ? `Choose attackers · attacking ${at}` : 'Choose attackers';
    buttons.push({
      label: 'All attack',
      at: 'declareAttackers',
      run: () => setAttacks(Object.fromEntries(myDecision.attackers!.map((id) => [id, attacks[id] ?? attackTarget ?? myDecision.defenders![0]]))),
    });
    buttons.push({
      label: n ? `Attack with ${n}` : 'No attacks',
      primary: true,
      at: 'declareAttackers',
      run: () =>
        act({
          type: 'decide',
          decisionId: myDecision.id,
          answer: {
            attackers: Object.entries(attacks).map(([id, target]) =>
              view.cards[target] ? { id, defender: view.cards[target].controller, planeswalker: target } : { id, defender: target },
            ),
          },
        }),
    });
  } else if (myDecision?.kind === 'declareBlockers') {
    const n = Object.keys(blocks).length;
    prompt = selBlocker ? `Choose what ${view.cards[selBlocker]?.name} blocks` : 'Choose blockers';
    if (n) buttons.push({ label: 'Clear', run: () => setBlocks({}), at: 'declareBlockers' });
    buttons.push({
      label: n ? `Confirm ${n} block${n > 1 ? 's' : ''}` : 'No blocks',
      primary: true,
      at: 'declareBlockers',
      run: () => act({ type: 'decide', decisionId: myDecision.id, answer: { blocks: Object.entries(blocks).map(([blocker, attacker]) => ({ blocker, attacker })) } }),
    });
  } else if (view.canPass) {
    const myTurn = view.activePlayer === view.you;
    const toCombat = myTurn && view.step === 'main1' && !view.stack.length;
    const endTurn = myTurn && view.step === 'main2' && !view.stack.length;
    const label = view.stack.length ? 'Resolve' : toCombat ? 'To combat ▸' : endTurn ? 'End turn ▸' : 'Pass ▸';
    const at: Where = view.stack.length ? 'stack' : toCombat ? 'beginCombat' : endTurn ? 'end' : railStep(view.step);
    buttons.push({ label, primary: true, run: () => act({ type: 'pass' }), at });
    buttons.push({ label: 'Pass turn ▸▸', run: () => act({ type: 'passUntilEndOfTurn' }), at: 'tail' });
  } else if (view.phase !== 'over') {
    const waiting = view.waitingOn.filter((id) => id !== view.you).map((id) => nameOfPlayer(view, id));
    if (waiting.length) prompt = `Waiting for ${waiting.join(', ')}…`;
  }

  // Space bar = primary button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      e.preventDefault();
      const primary = buttons.find((b) => b.primary);
      primary?.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });


  const [handHover, setHandHover] = useState(false);
  // Track the pointer globally: when a card you just played disappears from under the cursor, the hand still tucks away.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerX.current = e.clientX;
      setHandHover(!!(e.target as Element | null)?.closest?.('.hand-fan, .my-die3d'));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const [logSeen, setLogSeen] = useState(0);
  const modalDecision = myDecision && ['chooseCards', 'chooseOption', 'mulligan'].includes(myDecision.kind) ? myDecision : null;
  const myTurn = view.activePlayer === view.you;

  // ---------- Seats ----------
  const seatIndex = (pid: PlayerId) => Math.max(0, view.players.findIndex((p) => p.id === pid));
  const colorOf = (pid: PlayerId) => SEAT_COLORS[seatIndex(pid) % SEAT_COLORS.length];
  const matOf = (pid: PlayerId) => mats[pid] ?? (pid === view.you ? 'green' : ['oxblood', 'navy', 'plum', 'tan'][seatIndex(pid) % 4]);
  const liveOpps = opponents.filter((p) => !p.lost);
  // The active player sits across the table; on your turn it's the next opponent. You can pin someone else there.
  useEffect(() => setTopPin(null), [view.activePlayer]);
  const autoTop = myTurn ? (liveOpps[0] ?? opponents[0])?.id : view.activePlayer;
  const valid = (pid: PlayerId | null) => !!pid && view.players.some((p) => p.id === pid && p.id !== view.you);
  const focused = table3d && valid(farFocus) ? farFocus : null;
  const topId = focused ?? (valid(topPin) ? topPin : autoTop);
  const topP = view.players.find((p) => p.id === topId);
  const sideSeats = opponents.filter((p) => p.id !== topId);
  // The board across the table is shown big on its owner's turn, or while you're looking at it.
  const topActive = topP?.id === view.activePlayer || !!focused;
  /** "Full board": on the 3D table, bring it across the table; otherwise open it in a window. */
  const viewBoard = (pid: PlayerId) => (table3d ? setFarFocus(pid) : setFullBoard(pid));

  // ---------- Combat preview ----------
  let preview: CombatPreview | null = null;
  const previewMarks: Record<CardId, PreviewMark> = {};
  if (view.combat && view.combat.attackers.length && view.step === 'declareBlockers') {
    const proposing = myDecision?.kind === 'declareBlockers';
    const planned: PlannedAttack[] = view.combat.attackers.map((a) => ({
      id: a.id,
      defender: a.defender,
      planeswalker: a.planeswalker,
      blockers: proposing && a.defender === view.you ? Object.entries(blocks).filter(([, at]) => at === a.id).map(([b]) => b) : a.blockedBy,
    }));
    preview = previewCombat(view, planned, view.you);
    for (const [id, d] of Object.entries(preview.damage)) {
      const c = view.cards[id];
      if (!c) continue;
      previewMarks[id] = {
        damage: d,
        dies: preview.dies.has(id),
        survives: !preview.dies.has(id) && c.toughness !== undefined ? `${c.power}/${c.toughness - c.damage - d}` : undefined,
      };
    }
  }
  const lifeAfter = (pid: PlayerId) => (preview && preview.life[pid] ? (view.players.find((p) => p.id === pid)?.life ?? 0) + preview.life[pid] : undefined);

  // ---------- Arrows ----------
  const arrows: Arrow[] = [];
  const toSel = (t: Target | string) =>
    typeof t === 'string'
      ? view.cards[t]
        ? `[data-card-id="${t}"]`
        : `[data-player-id="${t}"]`
      : t.type === 'player'
        ? `[data-player-id="${t.id}"]`
        : t.type === 'card'
          ? `[data-card-id="${t.id}"]`
          : `[data-stack-id="${t.id}"]`;
  if (myDecision?.kind === 'declareAttackers') {
    for (const [id, t] of Object.entries(attacks)) arrows.push({ from: `[data-card-id="${id}"]`, to: toSel(t), kind: 'attack', pending: true });
  }
  for (const a of view.combat?.attackers ?? []) {
    const proposed = myDecision?.kind === 'declareBlockers' && a.defender === view.you;
    const blockers = proposed ? Object.entries(blocks).filter(([, at]) => at === a.id).map(([b]) => b) : a.blockedBy;
    const target = toSel(a.planeswalker ?? a.defender);
    if (blockers.length) {
      // A blocked attacker's arrow points at what's blocking it.
      for (const b of blockers) arrows.push({ from: `[data-card-id="${a.id}"]`, to: `[data-card-id="${b}"]`, kind: 'attack', pending: proposed });
      const over = preview?.trample[a.id];
      if (over) arrows.push({ from: `[data-card-id="${blockers[blockers.length - 1]}"]`, to: target, kind: 'trample', label: `${over} trample` });
    } else if (!a.blocked) {
      arrows.push({ from: `[data-card-id="${a.id}"]`, to: target, kind: 'attack' });
    }
  }
  for (const s of view.stack) {
    for (const t of s.targets) if (t) arrows.push({ from: `[data-stack-id="${s.id}"]`, to: toSel(t), kind: 'target' });
  }
  // Aiming arrows are only drawn on your screen, until the action is confirmed.
  if (drag && aiming) {
    const from = drag.kind === 'hand' ? '.held-card .card' : `[data-card-id="${drag.id}"]`;
    arrows.push({ from, to: '', toPointer: true, kind: drag.kind === 'blocker' ? 'block' : drag.kind === 'hand' ? 'target' : 'attack', pending: true });
  }
  if (pending && !drag) {
    const from = held === pending.action.cardId ? '.held-card .card' : `[data-card-id="${pending.action.cardId}"]`;
    for (const t of pending.targets) if (t) arrows.push({ from, to: toSel(t), kind: 'target' });
    if (pending.stage === 'targets' && spec) arrows.push({ from, to: '', toPointer: true, kind: 'target', pending: true });
  }

  const playerSelectable = (pid: PlayerId) =>
    (!!targeting && isTargetable({ type: 'player', id: pid })) ||
    (!!drag && canDrop({ type: 'player', id: pid })) ||
    (myDecision?.kind === 'declareAttackers' && !!myDecision.defenders?.includes(pid) && liveOpps.length > 1);

  const noGroup = (id: CardId) =>
    !!view.combat?.attackers.some((a) => a.id === id || a.blockedBy.includes(id)) ||
    (myDecision?.kind === 'declareAttackers' && !!myDecision.attackers?.includes(id)) ||
    (myDecision?.kind === 'declareBlockers' && (!!myDecision.blockers?.includes(id) || !!myDecision.attacking?.includes(id))) ||
    (!!targeting && isTargetable({ type: 'card', id }));

  const board = (pid: PlayerId, mode: 'full' | 'tile', far: boolean, mini = false) => (
    <Battlefield
      view={view}
      owner={pid}
      mode={mode}
      far={far}
      mini={mini}
      cardProps={cardProps}
      onCardClick={onCardClick}
      onHover={setHover}
      noGroup={noGroup}
      preview={previewMarks}
    />
  );

  const die = (p: PlayerView, size: number, ghost = false) => (
    <D20
      p={p}
      ghost={ghost}
      color={colorOf(p.id)}
      size={size}
      after={lifeAfter(p.id)}
      active={view.activePlayer === p.id}
      selectable={playerSelectable(p.id)}
      extra={dropProps({ type: 'player', id: p.id })}
      onClick={() => onPlayerClick(p.id)}
    />
  );

  const passChip = (p: PlayerView) => {
    const passed = view.stack.length > 0 && view.passes.includes(p.id);
    const waiting = view.waitingOn.includes(p.id);
    if (p.lost) return <span className="chip out">out</span>;
    if (passed) return <span className="chip ok">passed</span>;
    if (waiting && p.id !== view.you) return <span className="chip wait">thinking…</span>;
    return null;
  };

  /** A playmat on the table: [command slot][rows][piles] on your side, mirrored across the table. */
  const mat = (p: PlayerView, side: 'near' | 'far', mode: 'full' | 'tile', big: boolean) => {
    const inZone = p.commanders.filter((id) => view.cards[id]?.zone === 'command');
    const pileW = side === 'near' ? (big ? 70 : 52) : big ? 58 : 36;
    const cmd = inZone.length ? (
      <CommandSlot view={view} ids={inZone} cardProps={cardProps} onCardClick={(id) => (p.id === view.you ? onCardClick(id) : undefined)} onHover={setHover} w={side === 'near' ? (big ? 116 : 84) : big ? 96 : 70} />
    ) : null;
    const piles = <MatPiles p={p} view={view} onZone={setZone} w={pileW} flip={side === 'far'} onTop={(id) => playFromHand(id)} onHover={setHover} />;
    return (
      <section
        data-owner={p.id}
        className={`mat ${side} leather-${matOf(p.id)} ${view.activePlayer === p.id ? 'active' : ''} ${drag && canDrop({ type: 'area', owner: p.id }) ? 'drop-zone' : ''}`}
        style={{ ['--seat' as string]: colorOf(p.id) }}
        {...dropProps({ type: 'area', owner: p.id })}
      >
        <div className="grain" />
        <div className="stitch" />
        {side === 'near' && drag?.kind === 'hand' && <div className="drop-hint">Let go anywhere on the table to play {view.cards[drag.id]?.name}</div>}
        <div className="matgrid">
          {side === 'near' ? cmd : piles}
          <div className="mat-rows">{board(p.id, mode, side === 'far')}</div>
          {side === 'near' ? piles : cmd}
        </div>
      </section>
    );
  };

  const btn = (b: (typeof buttons)[number]) => (
    <button key={b.label} className={`tbtn ${b.primary ? 'glow' : 'quiet'}`} disabled={b.disabled} onClick={(e) => { e.stopPropagation(); b.run(); }}>
      {b.label}
    </button>
  );
  const RAIL: Step[] = ['upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'main2', 'end'];
  const curStep = railStep(view.step);

  // Hand: tucked into the table's front edge so the board stays visible; it rises while you hover it.
  const handOpen = handHover && !drag && !targeting && !modalDecision;
  const n = view.hand.length;
  const leftN = Math.ceil(n / 2);
  const halfAvail = Math.max(240, Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 1600) / 2 - 330));
  const handPos = (i: number) => {
    const side = i < leftN ? -1 : 1;
    const k = i < leftN ? leftN - 1 - i : i - leftN;
    const per = side < 0 ? leftN : n - leftN;
    const step = Math.min(104, (halfAvail - 70) / Math.max(1, per - 1));
    return { x: side * (118 + k * step), a: side * (5 + k * Math.min(4, 16 / per)), y: k * 6, z: side < 0 ? i : n - i };
  };

  const fullP = fullBoard ? view.players.find((p) => p.id === fullBoard) : null;
  const logNew = view.log.length > logSeen;

  // Keep the 3D table in step with the game.
  useEffect(() => {
    if (!table3d) return;
    table3d.onLayout = setAnchors;
    table3d.setInsets({ top: 64, bottom: 128, left: 46, right: 86 });
    return () => {
      table3d.onLayout = null;
    };
  }, [table3d]);
  useEffect(() => table3d?.setLife(me.life), [table3d, me.life]);
  useEffect(() => table3d?.setDieColor(parseInt(colorOf(me.id).slice(1), 16)), [table3d, me.id]);
  useEffect(() => table3d?.setPropSet(table.propSet), [table3d, table.propSet]);
  useEffect(() => table3d?.setCalm(calm), [table3d, calm]);
  const cmdKey = me.commanderDamage.map((d) => `${d.commander}:${d.amount}`).join('|');
  useEffect(() => {
    table3d?.setCommanderDamage(
      me.commanderDamage.map((d) => ({ amount: d.amount, color: parseInt(colorOf(view.cards[d.commander]?.owner ?? '').slice(1), 16) || 0x9b6cff })),
    );
  }, [table3d, cmdKey]);
  const topCmd = topP?.commanders.map((id) => view.cards[id]).find(Boolean);
  const topArt = topCmd ? artUrl(topCmd) : null;
  useEffect(() => {
    table3d?.setOpponent(topP && !topP.lost ? { id: topP.id, life: topP.life, color: parseInt(colorOf(topP.id).slice(1), 16), art: topArt } : null);
  }, [table3d, topP?.id, topP?.life, topP?.lost, topArt]);
  useEffect(() => {
    if (!table3d) return;
    const onMove = (e: PointerEvent) => table3d.setPointer(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [table3d]);
  useEffect(() => table3d?.setMonarch(view.monarch === view.you ? 'me' : view.monarch && view.monarch === topP?.id ? 'across' : null), [table3d, view.monarch, topP?.id]);

  // The table surface: drawn flat in CSS, or laid on the 3D tavern table when it's running.
  const planeEl = (
    <div className={`plane ${topActive ? 'far-big' : 'near-big'}`}>
            <div className="lightpool" />
            {topP && mat(topP, 'far', topActive ? 'full' : 'tile', topActive)}
            <div className="rail">
              {RAIL.map((s) => {
                const here = buttons.filter((b) => b.at === s);
                const mine = myStops.mine.includes(s);
                const theirs = myStops.theirs.includes(s);
                return (
                  <span key={s} className={`step ${s === curStep ? 'on' : ''}`} data-step={s}>
                    <button
                      className={`step-lbl ${stopMenu === s ? 'open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(null);
                        setStopMenu(stopMenu === s ? null : s);
                      }}
                    >
                      {STEP_LABELS[s]}
                      {(mine || theirs) && (
                        <span className="stop-flags">
                          {mine && <i className="flag mine" />}
                          {theirs && <i className="flag theirs" />}
                        </span>
                      )}
                    </button>
                    {here.length > 0 && <span className="go">{here.map(btn)}</span>}
                  </span>
                );
              })}
              <span className="rail-tail">{buttons.filter((b) => b.at === 'tail').map(btn)}</span>
            </div>
            {mat(me, 'near', myTurn && !focused ? 'full' : 'tile', !topActive)}
          </div>
  );

  return (
    <div className={`tavern ${table3d ? 'three' : ''} ${myTurn ? 'my-turn' : 'their-turn'} ${calm ? 'calm' : ''} ${drag ? 'dragging' : ''}`} onClick={(e) => { setMenu(null); setStopMenu(null); pokeTable(e); }} onContextMenu={(e) => { if (held || pending || menu || selBlocker) { e.preventDefault(); cancelAll(); } }}>
      <div className="table3d" ref={tableRef} />
      {table3d ? createPortal(planeEl, boardEl) : <div className="stage">{planeEl}</div>}

      {/* Across the table: who it is, their life, and the seat controls. */}
      {topP && (
        <div className="hud topseat">
          {/* On the 3D table their portrait and d20 are models on the table edge; these stay for the flat table. */}
          {!table3d && <Portrait p={topP} view={view} color={colorOf(topP.id)} />}
          {!table3d && die(topP, 62)}
          <div className="nameplate">
            {topP.name}
            <small>
              ✋ {topP.handCount} {passChip(topP)}
            </small>
            <CmdDamage p={topP} />
          </div>
          <button className="tbtn quiet tiny" onClick={(e) => { e.stopPropagation(); viewBoard(topP.id); }}>
            ⤢
          </button>
        </div>
      )}

      {/* Other players: tabs on the right edge that open on hover. */}
      <div className="hud tabs-right">
        {sideSeats.map((p) => {
          const hasTarget = playerSelectable(p.id) || view.battlefield.some((id) => view.cards[id]?.controller === p.id && cardProps(id).selectable && !!(targeting || drag || myDecision));
          return (
            <div key={p.id} className={`seat-tab ${hasTarget ? 'has-target' : ''} ${p.lost ? 'lost' : ''}`} style={{ ['--seat' as string]: colorOf(p.id) }}>
              <div className="tab-panel">
                <div className="tp-head">
                  <span className="nameplate">{p.name}</span>
                  <span className="muted">✋ {p.handCount}</span>
                  {passChip(p)}
                </div>
                <div className="tp-btns">
                  <button className="tbtn quiet tiny" onClick={(e) => { e.stopPropagation(); setTopPin(p.id); }}>
                    ⇅ Top seat
                  </button>
                  <button className="tbtn quiet tiny" onClick={(e) => { e.stopPropagation(); viewBoard(p.id); }}>
                    ⤢ Full board
                  </button>
                  <MatPicker value={matOf(p.id)} onChange={(m) => setMat(p.id, m)} />
                </div>
                <div className={`glass leather-${matOf(p.id)}`} data-owner={p.id} {...dropProps({ type: 'area', owner: p.id })}>
                  {board(p.id, 'tile', true, true)}
                </div>
                <div className="tp-piles">
                  <span>Library {p.libraryCount}</span>
                  <button className="link" onClick={(e) => { e.stopPropagation(); setZone({ title: `${p.name}'s graveyard`, cards: p.graveyard }); }}>
                    Graveyard {p.graveyard.length}
                  </button>
                  <button className="link" onClick={(e) => { e.stopPropagation(); setZone({ title: `${p.name}'s exile`, cards: p.exile }); }}>
                    Exile {p.exile.length}
                  </button>
                </div>
                <CmdDamage p={p} />
              </div>
              <div className="knob">
                <Portrait p={p} view={view} color={colorOf(p.id)} size={46} />
                <div className="knob-die">{die(p, 38)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* The chronicle (game log + chat): a tab on the left edge. */}
      <div className="hud chron" onMouseEnter={() => setLogSeen(view.log.length)} onMouseLeave={() => setLogSeen(view.log.length)}>
        <div className="knob">
          <span>Chronicle</span>
          {logNew && <i />}
        </div>
        <div className="chron-panel">
          <LogPanel log={view.log} chat={net.chat} onChat={(text) => send({ t: 'chat', text })} view={view} onHover={setHover} />
        </div>
      </div>

      {/* Only shown when you need to choose something. */}
      {(prompt || buttons.some((b) => b.at === 'prompt')) && !(held && pending) && (
        <div className="hud prompt-pill">
          <span>{prompt}</span>
          {buttons.filter((b) => b.at === 'prompt').map(btn)}
        </div>
      )}

      {view.stack.length > 0 && (
        <div className="hud stack-col">
          <StackPanel view={view} selectable={isTargetable} onClick={onStackClick} onHover={setHover} />
          {buttons.some((b) => b.at === 'stack') && <div className="stack-btns">{buttons.filter((b) => b.at === 'stack').map(btn)}</div>}
        </div>
      )}

      {preview && preview.lines.length > 0 && (
        <div className="hud combat-preview">
          <h4>Combat preview</h4>
          {preview.lines.map((l, i) => (
            <div key={i} className="pv-row">
              <b>{l.title}</b>
              <span className={l.tone}>{l.result}</span>
            </div>
          ))}
          {view.players
            .filter((p) => preview!.life[p.id])
            .map((p) => (
              <div key={p.id} className="pv-row">
                <b>{p.id === view.you ? 'You' : p.name}</b>
                <span className={preview!.life[p.id] < 0 ? 'bad' : 'good'}>
                  {p.life} → {p.life + preview!.life[p.id]}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* The opponent's 3D d20: an invisible spot over it takes clicks, drops and shows the combat preview. */}
      {table3d && topP && anchors.opp && (
        <div className="my-die3d opp" style={{ left: anchors.opp.x, top: anchors.opp.y, width: anchors.opp.r * 2, height: anchors.opp.r * 2 }}>
          {die(topP, Math.round(anchors.opp.r * 2), true)}
        </div>
      )}

      {/* With the 3D table your d20 sits in the dice tray; this invisible spot over it takes clicks and drops. */}
      {table3d && dieAt && (
        <div className="my-die3d" style={{ left: dieAt.x, top: dieAt.y, width: dieAt.r * 2, height: dieAt.r * 2 }}>
          {die(me, Math.round(dieAt.r * 2), true)}
        </div>
      )}

      {/* The table's front edge: your hand fanned around your d20, and your mana. */}
      <div className="hud strip">
        <div className={`hand-fan ${handOpen ? 'open' : ''}`} style={table3d && anchors.home ? { left: anchors.home.x } : undefined}>
          {view.hand.map((id, i) => {
            const props = cardProps(id);
            const pos = handPos(i);
            return (
              props.card && (
                <div
                  key={id}
                  className={`handcard ${held === id ? 'out' : ''} ${nope?.id === id ? 'nope' : ''}`}
                  style={{ ['--x' as string]: `${pos.x}px`, ['--a' as string]: `${pos.a}deg`, ['--y' as string]: `${pos.y}px`, zIndex: pos.z }}
                >
                  <Card {...props} size="large" onClick={() => onCardClick(id)} onHover={setHover} />
                </div>
              )
            );
          })}
          {!table3d && <div className="my-die">{die(me, 84)}</div>}
        </div>
        <div className="me-name">
          {me.name} <CmdDamage p={me} />
        </div>
        <ManaBar p={me} />
        <button className="tbtn quiet gear" title="Settings" onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}>
          ⚙
        </button>
        {showSettings && (
          <div className="settings-pop" onClick={(e) => e.stopPropagation()}>
            <label>
              Stops{' '}
              <select value={me.autoPass} onChange={(e) => act({ type: 'setAutoPass', mode: e.target.value as AutoPassMode })}>
                <option value="smart">Smart</option>
                <option value="stack">Every spell & ability</option>
                <option value="none">Every step</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Hold priority
            </label>
            <label>
              <input
                type="checkbox"
                checked={imagesEnabled()}
                onChange={(e) => {
                  try {
                    localStorage.setItem(IMAGES_KEY, e.target.checked ? 'on' : 'off');
                  } catch {
                    /* ignore */
                  }
                  forceRender((x) => x + 1);
                }}
              />{' '}
              Card images
            </label>
            <label>
              <input
                type="checkbox"
                checked={clickToPlay}
                onChange={(e) => {
                  setClickToPlay(e.target.checked);
                  writeFlag(CLICK_KEY, e.target.checked);
                }}
              />{' '}
              Single-click plays cards
            </label>
            <label>
              <input
                type="checkbox"
                checked={calm}
                onChange={(e) => {
                  setCalm(e.target.checked);
                  writeFlag(CALM_KEY, e.target.checked);
                }}
              />{' '}
              Reduce effects
            </label>
            {table3d && (
              <label>
                Table props{' '}
                <select value={table.propSet} onChange={(e) => table.setPropSet(e.target.value as 'candle' | 'lantern')}>
                  <option value="candle">Candle, tankard, leather deck box</option>
                  <option value="lantern">Lantern, stein, carved deck box</option>
                </select>
              </label>
            )}
            <label className="sound-row">
              Sound{' '}
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(soundPrefs.volume * 100)}
                onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
                onPointerUp={() => sound.play('counter')}
                aria-label="Sound volume"
              />
            </label>
            <label>
              <input type="checkbox" checked={soundPrefs.muted} onChange={(e) => sound.setMuted(e.target.checked)} /> Mute
            </label>
            <label>
              <input type="checkbox" checked={soundPrefs.ambience} onChange={(e) => sound.setAmbience(e.target.checked)} /> Crackling hearth
            </label>
            <MatPicker value={matOf(view.you)} onChange={(m) => setMat(view.you, m)} label="My playmat" />
            <button className="tbtn quiet" onClick={() => confirm('Concede this game?') && act({ type: 'concede' })}>
              Concede
            </button>
          </div>
        )}
      </div>

      {fullP && (
        <div className="modal-backdrop full-board" onClick={() => setFullBoard(null)}>
          <section className={`mat flat leather-${matOf(fullP.id)}`} style={{ ['--seat' as string]: colorOf(fullP.id) }} onClick={(e) => e.stopPropagation()}>
            <div className="grain" />
            <div className="stitch" />
            <div className="full-head">
              {die(fullP, 54)}
              <span className="nameplate">{fullP.name}</span>
              <button className="tbtn quiet" onClick={() => setFullBoard(null)}>
                ✕ Close
              </button>
            </div>
            <div className="matgrid">
              <div className="mat-rows">{board(fullP.id, 'full', false)}</div>
              <MatPiles p={fullP} view={view} onZone={setZone} w={70} />
            </div>
          </section>
        </div>
      )}

      {focused && topP && (
        <div className="focus-banner" style={{ ['--seat' as string]: colorOf(topP.id) }}>
          Looking at <strong>{topP.name}</strong>'s board
          {opponents.filter((p) => p.id !== topP.id && !p.lost).map((p) => (
            <button key={p.id} className="tbtn quiet tiny" onClick={(e) => { e.stopPropagation(); setFarFocus(p.id); }}>
              {p.name}
            </button>
          ))}
          <button className="tbtn glow tiny" onClick={(e) => { e.stopPropagation(); setFarFocus(null); }}>
            ◀ Back to my board
          </button>
        </div>
      )}
      <ArrowLayer arrows={arrows} />
      <FxLayer view={view} calm={calm} />

      {hover && !drag && !aiming && (
        <div className={`preview-wrap side-${previewSide}`}>
          <CardPreview key={hover.id} card={hover} />
        </div>
      )}

      {nope && <div className="hud nope-hint">{nope.text}</div>}

      {/* The card you're playing, out of your hand: what it's doing next, with a way to put it back. */}
      {held && view.cards[held] && (
        <div className={`held-card ${pending ? 'busy' : ''}`}>
          <Card card={view.cards[held]} size="large" showTapped={false} />
          {(pending || menu?.cardId === held) && (
            <div className="held-caption" onClick={(e) => e.stopPropagation()}>
              {pending && <div className="held-prompt">{prompt}</div>}
              {!pending && menu?.cardId === held && (
                <div className="held-options">
                  {menuItems(held).map((it, i) => (
                    <button key={i} className="tbtn" onClick={() => it.run()}>
                      <ManaText text={it.label} />
                    </button>
                  ))}
                </div>
              )}
              <div className="held-buttons">
                {buttons.filter((b) => b.at === 'prompt' && b.label !== 'Cancel').map(btn)}
                <button className="tbtn quiet" onClick={cancelAll}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {stopMenu && (
        <ActionPopover anchor={`[data-step="${stopMenu}"]`} onClose={() => setStopMenu(null)}>
          <div className="pop-title">Stop at {STEP_LABELS[stopMenu]}</div>
          {(['mine', 'theirs'] as const).map((whose) => (
            <label key={whose} className="pop-check">
              <input
                type="checkbox"
                checked={myStops[whose].includes(stopMenu)}
                onChange={(e) => {
                  const next = { ...myStops, [whose]: e.target.checked ? [...myStops[whose], stopMenu] : myStops[whose].filter((x) => x !== stopMenu) };
                  act({ type: 'setStops', mine: next.mine, theirs: next.theirs });
                }}
              />{' '}
              {whose === 'mine' ? 'On my turns' : "On opponents' turns"}
              <i className={`flag ${whose}`} />
            </label>
          ))}
          <div className="pop-note">The game pauses here when you have something you could play.</div>
        </ActionPopover>
      )}
      {menu && menu.cardId !== held && view.cards[menu.cardId] && (
        <ActionPopover anchor={`[data-card-id="${menu.cardId}"]`} onClose={() => setMenu(null)}>
          <div className="pop-title">{view.cards[menu.cardId].name}</div>
          {menuItems(menu.cardId).map((it, i) => (
            <button
              key={i}
              className="pop-use"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                it.run();
              }}
            >
              <span className="pop-verb">Use</span>
              <span className="pop-label">
                <ManaText text={it.label} />
              </span>
            </button>
          ))}
          <button className="tbtn quiet pop-cancel" onClick={(e) => { e.stopPropagation(); setMenu(null); }}>
            Cancel
          </button>
        </ActionPopover>
      )}

      {pending?.stage === 'x' && (
        <XModal max={pending.action.xMax ?? 0} onCancel={() => setPending(null)} onConfirm={(x) => advancePending({ ...pending, x })} />
      )}

      {targeting && offBoardOptions.length > 0 && (
        <ZoneModal
          zone={{ title: `Choose ${spec!.label}`, cards: offBoardOptions.map((o) => o.id) }}
          view={view}
          onClose={() => (pending ? setPending(null) : spec?.optional && chooseTarget(null))}
          onHover={setHover}
          selectable={(id) => isTargetable({ type: 'card', id })}
          onPick={(id) => chooseTarget({ type: 'card', id })}
        />
      )}

      {modalDecision && (
        <DecisionModal
          decision={modalDecision}
          view={view}
          onHover={setHover}
          onAnswer={(answer) => act({ type: 'decide', decisionId: modalDecision.id, answer })}
        />
      )}

      {zone && (
        <ZoneModal
          zone={zone}
          view={view}
          onClose={() => setZone(null)}
          onHover={setHover}
          // Your own cards that can be played from here (flashback, lands from the graveyard...).
          selectable={zone.cards.some(playableHere) ? playableHere : undefined}
          onPick={(id) => {
            setZone(null);
            playFromHand(id);
          }}
        />
      )}

      {view.phase === 'over' && (
        <div className="modal-backdrop">
          <div className="modal small-modal">
            <h2>{view.winner === view.you ? 'Victory!' : `${nameOfPlayer(view, view.winner ?? '')} wins`}</h2>
            <p className="muted">{view.log[view.log.length - 1]?.text}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => send({ t: 'leaveRoom' })}>
                Back to lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Ability popover ----------

/** A small panel above a card (follows it while the camera drifts), with the card's choices. */
function ActionPopover({ anchor, onClose, children }: { anchor: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without restarting the placement loop on every render.
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const el = ref.current;
      const target = document.querySelector(anchor);
      if (el && target) {
        const r = target.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let x = r.left + r.width / 2 - w / 2;
        let y = r.top - h - 12;
        if (y < 8) y = r.bottom + 12;
        x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
        y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.style.visibility = 'visible';
      } else if (!target) close.current();
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);
  return (
    <div ref={ref} className="action-pop" style={{ visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

// ---------- Arrows ----------

interface Arrow {
  from: string;
  to: string;
  /** Point the arrow at the mouse pointer (aiming). */
  toPointer?: boolean;
  kind: 'attack' | 'block' | 'target' | 'trample';
  pending?: boolean;
  label?: string;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: string;
  pending?: boolean;
  label?: string;
  free?: boolean;
}

/**
 * Draws curved arrows between on-screen elements. Positions are re-measured every animation frame,
 * so arrows stay attached when the 3D camera moves or cards shift.
 */
function ArrowLayer({ arrows }: { arrows: Arrow[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const arrowsRef = useRef(arrows);
  arrowsRef.current = arrows;
  const last = useRef('');
  // The pointer is tracked here, not in React state, so aiming doesn't re-render the whole table.
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const measure = useCallback(() => {
    const center = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const next = arrowsRef.current
      .map((a) => {
        const p = center(a.from);
        const q = a.toPointer ? pointer.current : center(a.to);
        return p && q ? { x1: p.x, y1: p.y, x2: q.x, y2: q.y, kind: a.kind, pending: a.pending, label: a.label, free: !!a.toPointer } : null;
      })
      .filter(Boolean) as Line[];
    const sig = JSON.stringify(next.map((l) => [Math.round(l.x1), Math.round(l.y1), Math.round(l.x2), Math.round(l.y2), l.kind, l.label, l.pending]));
    if (sig !== last.current) {
      last.current = sig;
      setLines(next);
    }
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (arrowsRef.current.length || last.current !== '[]') measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measure]);
  if (!lines.length) return null;
  return (
    <svg className="arrow-layer">
      <defs>
        {['attack', 'block', 'target', 'trample'].map((k) => (
          <marker key={k} id={`head-${k}`} markerWidth="5" markerHeight="5" refX="3.2" refY="2.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L5,2.5 L0,5 z" className={`head-${k}`} />
          </marker>
        ))}
      </defs>
      {lines.map((l, i) => {
        // Stop short of the target's centre so the head stays visible, and bend the line a little.
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) || 1;
        const shorten = l.free ? 0 : Math.min(26, len / 3);
        const x2 = l.x2 - (dx / len) * shorten;
        const y2 = l.y2 - (dy / len) * shorten;
        const bend = Math.min(60, len * 0.18);
        const cx = (l.x1 + x2) / 2 + (-dy / len) * bend;
        const cy = (l.y1 + y2) / 2 + (dx / len) * bend;
        const d = `M${l.x1},${l.y1} Q${cx},${cy} ${x2},${y2}`;
        return (
          <g key={i}>
            <path d={d} className="arrow-glow" />
            <path d={d} className={`arrow arrow-${l.kind} ${l.pending ? 'pending' : ''}`} markerEnd={`url(#head-${l.kind})`} />
            {l.label && (
              <text x={x2 + 34} y={y2 - 22} className="arrow-label">
                {l.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Re-render when the sound settings change. */
function useSoundPrefs() {
  const [, bump] = useState(0);
  useEffect(() => sound.subscribe(() => bump((n) => n + 1)), []);
  return { volume: sound.volume, muted: sound.muted, ambience: sound.ambience };
}
