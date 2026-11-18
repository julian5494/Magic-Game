import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import type { Action, AutoPassMode, CardId, ManaSym, PlayableAction, PlayerId, Target, TargetSpecView } from '../../engine/types';
import type { CardView, GameView, StackView } from '../../engine/view';
import type { ClientMessage } from '../../shared/protocol';
import type { NetState } from '../net';
import { previewCombat, type CombatPreview, type PlannedAttack } from '../combat';
import { Battlefield, MatPicker, SEAT_COLORS, useMats, useSize, type PermProps, type PreviewMark } from './Board';
import { Card, CardPreview, IMAGES_KEY, imagesEnabled, ManaText } from './Card';
import { DecisionModal, LogPanel, nameOfPlayer, PhaseTracker, StackPanel, STEP_LABELS, XModal, ZoneModal, type ZoneOpen } from './parts';
import { CommandZone, LifeMedallion, ManaAvailable, Piles, SeatHeader } from './Seats';

interface Pending {
  action: PlayableAction;
  stage: 'x' | 'sacrifice' | 'targets';
  x?: number;
  sacrifice?: CardId;
  targets: (Target | null)[];
  color?: ManaSym;
}

interface Menu {
  cardId: CardId;
  items: { label: string; run: () => void }[];
}

const HAND_W = 126;
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
  const [hover, setHover] = useState<CardView | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [zone, setZone] = useState<ZoneOpen | null>(null);
  const [attacks, setAttacks] = useState<Record<CardId, PlayerId>>({});
  const [attackTarget, setAttackTarget] = useState<PlayerId | null>(null);
  const [blocks, setBlocks] = useState<Record<CardId, CardId>>({});
  const [selBlocker, setSelBlocker] = useState<CardId | null>(null);
  const [trigTargets, setTrigTargets] = useState<(Target | null)[]>([]);
  const [, forceRender] = useState(0);
  const [hold, setHold] = useState(false);
  const [drag, setDrag] = useState<{ id: CardId; kind: DragKind } | null>(null);
  const [topPin, setTopPin] = useState<PlayerId | null>(null);
  const [fullBoard, setFullBoard] = useState<PlayerId | null>(null);
  const [calm, setCalm] = useState(() => readFlag(CALM_KEY));
  const [mats, setMat] = useMats();
  const [clickToPlay, setClickToPlay] = useState(readClickToPlay);
  const [selectedHand, setSelectedHand] = useState<CardId | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const act = useCallback((action: Action) => send({ t: 'action', action }), [send]);
  const decision = view.decision;
  const myDecisionNow = decision && decision.player === view.you ? decision : null;
  const me = view.players.find((p) => p.id === view.you)!;

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

  // Drop an in-progress cast if it stopped being legal (eg. priority moved).
  useEffect(() => {
    if (pending && !view.legal.some((a) => a.cardId === pending.action.cardId && a.type === pending.action.type && a.ability === pending.action.ability)) {
      setPending(null);
    }
    setMenu(null);
  }, [view]);

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
    if (a.type === 'cast') act({ type: 'cast', cardId: a.cardId, targets: p.targets, x: p.x, sacrifice: p.sacrifice, modes: a.modes, hold });
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

  const openMenu = (id: CardId) => {
    const acts = actionsFor(id);
    const items: Menu['items'] = [];
    for (const a of acts) {
      if ((a.type === 'manaTap' || a.isMana) && a.manaColors && a.manaColors.length > 1) {
        for (const c of a.manaColors) items.push({ label: `${a.isMana ? a.label.split(':')[0] + ': ' : ''}Add {${c}}`, run: () => startAction(a, c) });
      } else {
        items.push({ label: a.type === 'cast' && !a.modes ? `Cast ${view.cards[id]?.name}` : a.label, run: () => startAction(a) });
      }
    }
    if (items.length === 1 && !(acts[0].type === 'manaTap' && (acts[0].manaColors?.length ?? 0) > 1)) return startAction(acts[0]);
    if (items.length) setMenu({ cardId: id, items });
  };

  // ---------- Clicks ----------
  const onCardClick = (id: CardId) => {
    const card = view.cards[id];
    if (!card) return;
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
    if (isInHand(id) && !clickToPlay) {
      // Cards in hand are played by double-clicking or dragging them onto the battlefield.
      setSelectedHand(selectedHand === id ? null : id);
      return;
    }
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

  const canDrop = (t: DropTarget): boolean => {
    if (!drag) return false;
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

  const handleDrop = (t: DropTarget) => {
    const d = drag;
    setDrag(null);
    if (!d || !canDrop(t)) return;
    if (d.kind === 'hand') {
      if (t.type !== 'area') {
        const a = directCast(d.id, t.type === 'card' ? { type: 'card', id: t.id } : { type: 'player', id: t.id })!;
        const full = a.targets[0].options.find((o) => sameTarget(o, t.type === 'card' ? { type: 'card', id: t.id } : { type: 'player', id: t.id }))!;
        act({ type: 'cast', cardId: d.id, targets: [full], modes: a.modes, variant: a.variant, hold });
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
    if (kind) {
      extra.draggable = true;
      extra.onDragStart = (e: DragEvent) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        setHover(null);
        setDrag({ id, kind });
      };
      extra.onDragEnd = () => setDrag(null);
    }
    if (isInHand(id)) {
      extra.onDoubleClick = () => {
        setSelectedHand(null);
        if (!decision && !targeting && !pending) openMenu(id);
      };
      if (selectedHand === id) selected = true;
    }
    if (drag?.id === id) selected = true;
    return { card: c, selectable: selectable || dropOk, selected, attacking, blocking, badge, extra, dropOk };
  };

  // ---------- Prompt & buttons ----------
  const myDecision = decision && decision.player === view.you ? decision : null;
  let prompt = '';
  const buttons: { label: string; primary?: boolean; run: () => void; disabled?: boolean }[] = [];

  if (pending) {
    const name = view.cards[pending.action.cardId]?.name ?? '';
    if (pending.stage === 'sacrifice') prompt = `${name}: ${pending.action.sacrificeLabel ?? 'choose a permanent to sacrifice'}`;
    else if (spec) prompt = `${name}: choose ${spec.label}`;
    if (spec?.optional) buttons.push({ label: 'No target', run: () => chooseTarget(null) });
    buttons.push({ label: 'Cancel', run: () => setPending(null) });
  } else if (myDecision?.kind === 'chooseTargets') {
    prompt = `${myDecision.prompt} — choose ${spec?.label}`;
    if (spec?.optional) buttons.push({ label: 'No target', run: () => chooseTarget(null) });
  } else if (myDecision?.kind === 'declareAttackers') {
    const n = Object.keys(attacks).length;
    prompt = opponents.filter((o) => !o.lost).length > 1
      ? `Click creatures to attack. Click an opponent or their planeswalker to choose what they attack (now: ${attackTarget ? view.cards[attackTarget]?.name ?? nameOfPlayer(view, attackTarget) : '—'}).`
      : myDecision.planeswalkers?.length
        ? `Click creatures to attack. Click a planeswalker to attack it instead (now: ${attackTarget ? view.cards[attackTarget]?.name ?? nameOfPlayer(view, attackTarget) : '—'}).`
        : 'Click creatures to attack.';
    prompt += ' Or drag a creature onto the opponent or planeswalker it should attack.';
    buttons.push({
      label: 'All attack',
      run: () => setAttacks(Object.fromEntries(myDecision.attackers!.map((id) => [id, attacks[id] ?? attackTarget ?? myDecision.defenders![0]]))),
    });
    buttons.push({
      label: n ? `Attack with ${n}` : 'No attacks',
      primary: true,
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
    prompt = selBlocker
      ? `Now click the attacker for ${view.cards[selBlocker]?.name} to block.`
      : 'Drag your creatures onto the attackers they should block (or click a creature, then the attacker).';
    if (n) buttons.push({ label: 'Clear', run: () => setBlocks({}) });
    buttons.push({
      label: n ? `Confirm ${n} block${n > 1 ? 's' : ''}` : 'No blocks',
      primary: true,
      run: () => act({ type: 'decide', decisionId: myDecision.id, answer: { blocks: Object.entries(blocks).map(([blocker, attacker]) => ({ blocker, attacker })) } }),
    });
  } else if (view.canPass) {
    const myTurn = view.activePlayer === view.you;
    if (view.stack.length) prompt = `${view.stack[view.stack.length - 1].name} is on the stack. Respond or let it resolve.`;
    else if (myTurn && view.step === 'main1') {
      prompt = clickToPlay ? 'Your main phase. Click cards to play them.' : 'Your main phase. Double-click a card or drag it onto the battlefield to play it.';
    }
    else if (myTurn && view.step === 'main2') prompt = 'Second main phase.';
    else prompt = `${STEP_LABELS[view.step]} — you may cast instants.`;
    const label = view.stack.length ? 'Resolve' : myTurn && view.step === 'main1' ? 'To combat' : myTurn && view.step === 'main2' ? 'End turn' : 'Pass';
    buttons.push({ label: 'Pass turn', run: () => act({ type: 'passUntilEndOfTurn' }) });
    buttons.push({ label, primary: true, run: () => act({ type: 'pass' }) });
  } else if (view.phase !== 'over') {
    const waiting = view.waitingOn.filter((id) => id !== view.you).map((id) => nameOfPlayer(view, id));
    prompt = waiting.length ? `Waiting for ${waiting.join(', ')}…` : '…';
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


  const [handRef, handSize] = useSize<HTMLDivElement>();
  const modalDecision = myDecision && ['chooseCards', 'chooseOption', 'mulligan'].includes(myDecision.kind) ? myDecision : null;
  const meView = me;
  const myTurn = view.activePlayer === view.you;

  // ---------- Seats ----------
  const colorOf = (pid: PlayerId) => SEAT_COLORS[Math.max(0, view.players.findIndex((p) => p.id === pid)) % SEAT_COLORS.length];
  const defaultMat = (pid: PlayerId) => ['forest', 'nebula', 'gilded', 'ember'][Math.max(0, view.players.findIndex((p) => p.id === pid)) % 4];
  const matOf = (pid: PlayerId) => mats[pid] ?? defaultMat(pid);
  const liveOpps = opponents.filter((p) => !p.lost);
  // The active player sits in the top seat; on your turn it's the next opponent. You can pin someone else there.
  useEffect(() => setTopPin(null), [view.activePlayer]);
  const autoTop = myTurn ? (liveOpps[0] ?? opponents[0])?.id : view.activePlayer;
  const topId = topPin && view.players.some((p) => p.id === topPin && p.id !== view.you) ? topPin : autoTop;
  const topP = view.players.find((p) => p.id === topId);
  const sideSeats = opponents.filter((p) => p.id !== topId);

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

  const playerSelectable = (pid: PlayerId) =>
    (!!targeting && isTargetable({ type: 'player', id: pid })) ||
    (!!drag && canDrop({ type: 'player', id: pid })) ||
    (myDecision?.kind === 'declareAttackers' && !!myDecision.defenders?.includes(pid) && liveOpps.length > 1);

  const noGroup = (id: CardId) =>
    !!view.combat?.attackers.some((a) => a.id === id || a.blockedBy.includes(id)) ||
    (myDecision?.kind === 'declareAttackers' && !!myDecision.attackers?.includes(id)) ||
    (myDecision?.kind === 'declareBlockers' && (!!myDecision.blockers?.includes(id) || !!myDecision.attacking?.includes(id))) ||
    (!!targeting && isTargetable({ type: 'card', id }));

  const boardFor = (pid: PlayerId, mode: 'full' | 'tile', mini = false) => (
    <Battlefield
      view={view}
      owner={pid}
      mode={mode}
      mini={mini}
      cardProps={cardProps}
      onCardClick={onCardClick}
      onHover={setHover}
      seatColor={colorOf(pid)}
      noGroup={noGroup}
      preview={previewMarks}
    />
  );

  const medallion = (p: typeof me, size: 'sm' | 'md' | 'lg') => (
    <LifeMedallion
      p={p}
      color={colorOf(p.id)}
      size={size}
      after={lifeAfter(p.id)}
      selectable={playerSelectable(p.id)}
      extra={dropProps({ type: 'player', id: p.id })}
      onClick={() => onPlayerClick(p.id)}
    />
  );

  const commanderThumbs = (p: typeof me) => (
    <div className="seat-cmd">
      {p.commanders.map((id) => view.cards[id] && <Card key={id} card={view.cards[id]} size="tiny" showTapped={false} dim={view.cards[id].zone !== 'command'} onHover={setHover} />)}
    </div>
  );

  const topActive = topP?.id === view.activePlayer;
  const fullP = fullBoard ? view.players.find((p) => p.id === fullBoard) : null;
  const phaseBanner = myTurn ? 'Your turn' : `${nameOfPlayer(view, view.activePlayer)}'s turn`;

  return (
    <div className={`table-root ${myTurn ? 'my-turn' : 'their-turn'} ${calm ? 'calm' : ''} ${drag ? 'dragging' : ''}`} onClick={() => setMenu(null)}>
      <aside className="col-left">
        <Piles p={me} view={view} onZone={setZone} />
        <StackPanel view={view} selectable={isTargetable} onClick={onStackClick} onHover={setHover} />
        <CommandZone view={view} p={me} cardProps={cardProps} onCardClick={onCardClick} onHover={setHover} />
      </aside>

      <main className="col-main">
        {topP ? (
          <section
            className={`seat seat-top mat mat-${matOf(topP.id)} ${topActive ? 'active' : ''} ${drag && canDrop({ type: 'area', owner: topP.id }) ? 'drop-zone' : ''}`}
            style={{ ['--c' as string]: colorOf(topP.id) }}
            {...dropProps({ type: 'area', owner: topP.id })}
          >
            <div className="rim" />
            {boardFor(topP.id, topActive ? 'full' : 'tile')}
            <div className="top-info">
              <SeatHeader p={topP} view={view} color={colorOf(topP.id)} mat={matOf(topP.id)} onMat={(m) => setMat(topP.id, m)} life={medallion(topP, 'md')}>
                <button className="chip-btn" onClick={(e) => { e.stopPropagation(); setFullBoard(topP.id); }}>
                  ⤢ Full board
                </button>
              </SeatHeader>
              <div className="top-extra">
                {commanderThumbs(topP)}
                <Piles p={topP} view={view} onZone={setZone} small />
              </div>
            </div>
          </section>
        ) : (
          <section className="seat seat-top empty" />
        )}

        <div className="centerbar">
          <PhaseTracker view={view} />
          <div className="prompt-pill">
            <div className="turn-banner">✦ {phaseBanner} · {STEP_LABELS[view.step]} ✦</div>
            <div className="prompt-text">{prompt}</div>
          </div>
          <div className="buttons">
            <button className="small gear" title="Settings" onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}>
              ⚙
            </button>
            {buttons.map((b) => (
              <button key={b.label} className={b.primary ? 'primary big-btn' : ''} disabled={b.disabled} onClick={(e) => { e.stopPropagation(); b.run(); }}>
                {b.label}
              </button>
            ))}
          </div>
          {showSettings && (
            <div className="settings open" onClick={(e) => e.stopPropagation()}>
              <label title="When the game should stop and give you priority">
                Stops:{' '}
                <select value={meView.autoPass} onChange={(e) => act({ type: 'setAutoPass', mode: e.target.value as AutoPassMode })}>
                  <option value="smart">Smart (skip when I can't respond)</option>
                  <option value="stack">Every spell & ability opponents use</option>
                  <option value="none">Full control (every step)</option>
                </select>
              </label>
              <label title="After you cast a spell or activate an ability, keep priority so you can respond to it yourself">
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
                    forceRender((n) => n + 1);
                  }}
                />{' '}
                Card images
              </label>
              <label title="Off: double-click or drag cards from your hand to play them. On: a single click plays them.">
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
              <label title="Turn off the moving keyword effects (flying, runes, smoke…)">
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
              <button className="small" onClick={() => confirm('Concede this game?') && act({ type: 'concede' })}>
                Concede
              </button>
            </div>
          )}
        </div>

        <section
          className={`seat seat-me mat mat-${matOf(view.you)} ${myTurn ? 'active' : ''} ${drag && canDrop({ type: 'area', owner: view.you }) ? 'drop-zone' : ''}`}
          style={{ ['--c' as string]: colorOf(view.you) }}
          {...dropProps({ type: 'area', owner: view.you })}
        >
          <div className="rim" />
          {drag?.kind === 'hand' && <div className="drop-hint">Drop here to play {view.cards[drag.id]?.name}</div>}
          {boardFor(view.you, myTurn ? 'full' : 'tile')}
          <div className="me-mat">
            <MatPicker value={matOf(view.you)} onChange={(m) => setMat(view.you, m)} />
          </div>
        </section>

        <div className="bottombar">
          <div className="me-info">
            {medallion(me, 'lg')}
            <div>
              <div className="nm">{me.name}</div>
              <div className="sub">✋ {me.handCount} in hand</div>
            </div>
          </div>
          <div className="hand" ref={handRef}>
            {view.hand.map((id, i) => {
              const props = cardProps(id);
              const n = view.hand.length;
              const off = i - (n - 1) / 2;
              return (
                props.card && (
                  <div
                    key={id}
                    className="hand-slot"
                    style={{
                      ['--r' as string]: `${off * Math.min(3, 18 / n)}deg`,
                      ['--y' as string]: `${Math.abs(off) * Math.min(4, 24 / n)}px`,
                      marginLeft: i === 0 ? 0 : -Math.max(30, Math.min(110, HAND_W - (handSize.w - 24 - HAND_W) / Math.max(1, n - 1))),
                    }}
                  >
                    <Card {...props} size="large" onClick={() => onCardClick(id)} onHover={setHover} />
                  </div>
                )
              );
            })}
          </div>
          <ManaAvailable p={me} />
        </div>
      </main>

      <aside className="col-right">
        {sideSeats.map((p) => (
          <section
            key={p.id}
            className={`side-seat mat mat-${matOf(p.id)} ${view.activePlayer === p.id ? 'active' : ''} ${p.lost ? 'lost' : ''} ${drag && canDrop({ type: 'area', owner: p.id }) ? 'drop-zone' : ''}`}
            style={{ ['--c' as string]: colorOf(p.id) }}
            {...dropProps({ type: 'area', owner: p.id })}
          >
            <div className="rim" />
            <SeatHeader p={p} view={view} color={colorOf(p.id)} mat={matOf(p.id)} onMat={(m) => setMat(p.id, m)} life={medallion(p, 'sm')}>
              <button className="chip-btn" title="Move to the top seat" onClick={(e) => { e.stopPropagation(); setTopPin(p.id); }}>
                ⇅ Top seat
              </button>
              <button className="chip-btn" title="See their whole board" onClick={(e) => { e.stopPropagation(); setFullBoard(p.id); }}>
                ⤢ Full
              </button>
            </SeatHeader>
            <div className="side-body">
              {commanderThumbs(p)}
              <div className="side-board">{boardFor(p.id, 'tile', true)}</div>
            </div>
            <Piles p={p} view={view} onZone={setZone} small />
          </section>
        ))}
        {preview && preview.lines.length > 0 && (
          <div className="combat-preview">
            <h4>Combat preview</h4>
            <div className="sub">What happens if combat resolves as it stands</div>
            {preview.lines.map((l, i) => (
              <div key={i} className="pv-row">
                <b>{l.title}</b>
                <span className={l.tone}>{l.result}</span>
                <div className="res">{l.detail}</div>
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
            <div className="sub note">Spells and abilities used before damage can change this.</div>
          </div>
        )}
        <LogPanel log={view.log} chat={net.chat} onChat={(text) => send({ t: 'chat', text })} view={view} onHover={setHover} />
      </aside>

      {fullP && (
        <div className="modal-backdrop full-board" onClick={() => setFullBoard(null)}>
          <section className={`seat full-seat mat mat-${matOf(fullP.id)}`} style={{ ['--c' as string]: colorOf(fullP.id) }} onClick={(e) => e.stopPropagation()}>
            <div className="rim" />
            <div className="full-head">
              <SeatHeader p={fullP} view={view} color={colorOf(fullP.id)} mat={matOf(fullP.id)} onMat={(m) => setMat(fullP.id, m)} life={medallion(fullP, 'md')}>
                <button className="chip-btn" onClick={() => setFullBoard(null)}>
                  ✕ Close
                </button>
              </SeatHeader>
            </div>
            <div className="full-body">{boardFor(fullP.id, 'full')}</div>
          </section>
        </div>
      )}

      <ArrowLayer arrows={arrows} />

      {hover && !drag && (
        <div className="preview-wrap">
          <CardPreview card={hover} />
        </div>
      )}

      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(null)}>
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            <div className="menu-title">{view.cards[menu.cardId]?.name}</div>
            {menu.items.map((it, i) => (
              <button key={i} onClick={() => { setMenu(null); it.run(); }}>
                <ManaText text={it.label} />
              </button>
            ))}
          </div>
        </div>
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

      {zone && <ZoneModal zone={zone} view={view} onClose={() => setZone(null)} onHover={setHover} />}

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


// ---------- Arrows ----------

interface Arrow {
  from: string;
  to: string;
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
}

/** Draws curved arrows between on-screen elements (re-measured as the layout changes). */
function ArrowLayer({ arrows }: { arrows: Arrow[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const key = JSON.stringify(arrows);
  const last = useRef('');
  const measure = useCallback(() => {
    const center = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const next = (JSON.parse(key) as Arrow[])
      .map((a) => {
        const p = center(a.from);
        const q = center(a.to);
        return p && q ? { x1: p.x, y1: p.y, x2: q.x, y2: q.y, kind: a.kind, pending: a.pending, label: a.label } : null;
      })
      .filter(Boolean) as Line[];
    const sig = JSON.stringify(next.map((l) => [Math.round(l.x1), Math.round(l.y1), Math.round(l.x2), Math.round(l.y2), l.kind, l.label]));
    if (sig !== last.current) {
      last.current = sig;
      setLines(next);
    }
  }, [key]);
  useLayoutEffect(measure);
  useEffect(() => {
    const t = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(t);
      window.removeEventListener('resize', measure);
    };
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
        const shorten = Math.min(26, len / 3);
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
