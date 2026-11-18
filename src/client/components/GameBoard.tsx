import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import type { Action, AutoPassMode, CardId, ManaSym, PlayableAction, PlayerId, Target, TargetSpecView } from '../../engine/types';
import type { CardView, GameView, StackView } from '../../engine/view';
import type { ClientMessage } from '../../shared/protocol';
import type { NetState } from '../net';
import { Card, CardPreview, IMAGES_KEY, imagesEnabled, ManaText } from './Card';
import { DecisionModal, LogPanel, nameOfPlayer, PhaseTracker, PlayerPanel, StackPanel, STEP_LABELS, XModal, ZoneModal, type ZoneOpen } from './parts';

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

const sameTarget = (a: Target, b: Target) => a.type === b.type && a.id === b.id;

const CLICK_KEY = 'commander-arena-click-to-play';
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
  const [focus, setFocus] = useState<'auto' | PlayerId>('auto');
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
  const attackerIndex = new Map<CardId, number>();
  combat?.attackers.forEach((a, i) => attackerIndex.set(a.id, i + 1));
  const blockerOf = new Map<CardId, CardId>();
  combat?.attackers.forEach((a) => a.blockedBy.forEach((b) => blockerOf.set(b, a.id)));

  const cardProps = (id: CardId) => {
    const c = view.cards[id];
    const legal = !targeting && !sacrificing && !decision && actionsFor(id).some((a) => a.type !== 'manaTap' && !a.isMana);
    let selectable = legal;
    let selected = false;
    let badge: string | undefined;
    let attacking = !!combat?.attackers.some((a) => a.id === id);
    let blocking = blockerOf.has(id);
    if (attacking) badge = `⚔${attackerIndex.get(id)}`;
    if (blocking) badge = `🛡${attackerIndex.get(blockerOf.get(id)!)}`;
    if (targeting) selectable = isTargetable({ type: 'card', id });
    if (sacrificing) selectable = sacrificing.includes(id);
    if (decision?.kind === 'declareAttackers' && decision.player === view.you) {
      selectable = decision.attackers!.includes(id) || !!decision.planeswalkers?.includes(id);
      if (attackTarget === id) selected = true;
      attacking = !!attacks[id];
      if (attacks[id] && (opponents.length > 1 || view.cards[attacks[id]])) {
        badge = `→${(view.cards[attacks[id]]?.name ?? nameOfPlayer(view, attacks[id])).slice(0, 8)}`;
      }
    }
    if (decision?.kind === 'declareBlockers' && decision.player === view.you) {
      selectable = decision.blockers!.includes(id) || (!!selBlocker && decision.attacking!.includes(id));
      selected = selBlocker === id;
      if (blocks[id]) {
        blocking = true;
        badge = `🛡${attackerIndex.get(blocks[id])}`;
      }
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

  const modalDecision = myDecision && ['chooseCards', 'chooseOption', 'mulligan'].includes(myDecision.kind) ? myDecision : null;
  const meView = view.players.find((p) => p.id === view.you)!;

  // Arrows: attacks, blocks and what spells/abilities on the stack target.
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
    arrows.push({ from: `[data-card-id="${a.id}"]`, to: toSel(a.planeswalker ?? a.defender), kind: 'attack' });
    for (const b of a.blockedBy) arrows.push({ from: `[data-card-id="${b}"]`, to: `[data-card-id="${a.id}"]`, kind: 'block' });
  }
  if (myDecision?.kind === 'declareBlockers') {
    for (const [b, a] of Object.entries(blocks)) arrows.push({ from: `[data-card-id="${b}"]`, to: `[data-card-id="${a}"]`, kind: 'block', pending: true });
  }
  for (const s of view.stack) {
    for (const t of s.targets) if (t) arrows.push({ from: `[data-stack-id="${s.id}"]`, to: toSel(t), kind: 'target' });
  }

  // Which board is shown big: the active player's by default, or one the player pinned.
  const focusId = focus === 'auto' || view.players.find((p) => p.id === focus)?.lost ? view.activePlayer : focus;
  const focusOnMe = focusId === view.you;
  const toggleFocus = (pid: PlayerId) => setFocus(focus === pid ? 'auto' : pid);

  return (
    <div className={`game ${focusOnMe ? 'focus-me' : 'focus-opp'} ${drag ? 'dragging' : ''}`} onClick={() => setMenu(null)}>
      <div className="opponents">
        {opponents.map((p) => {
          const big = !focusOnMe && focusId === p.id;
          const areaDrop = dropProps({ type: 'area', owner: p.id });
          return (
            <div
              key={p.id}
              className={`opp-area ${big ? 'focused' : ''} ${drag && canDrop({ type: 'area', owner: p.id }) ? 'drop-zone' : ''}`}
              {...areaDrop}
            >
              <PlayerPanel
                p={p}
                view={view}
                selectable={(!!targeting && isTargetable({ type: 'player', id: p.id })) || (!!drag && canDrop({ type: 'player', id: p.id }))}
                attackTarget={myDecision?.kind === 'declareAttackers' && attackTarget === p.id}
                onClick={() => onPlayerClick(p.id)}
                onZone={setZone}
                onHover={setHover}
                extra={dropProps({ type: 'player', id: p.id })}
                focused={focusId === p.id}
                onFocus={() => toggleFocus(p.id)}
              />
              <Battlefield view={view} owner={p.id} cardProps={cardProps} onCardClick={onCardClick} onHover={setHover} compact={!big && (opponents.length > 1 || focusOnMe)} />
            </div>
          );
        })}
      </div>

      <div className="middle">
        <PhaseTracker view={view} />
        <label className="focus-select" title="Which player's board is shown big">
          Big board:{' '}
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="auto">Follow the turn</option>
            {view.players
              .filter((p) => !p.lost)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === view.you ? 'Mine' : p.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <StackPanel view={view} selectable={isTargetable} onClick={onStackClick} onHover={setHover} />

      <div className={`me-area ${drag && canDrop({ type: 'area', owner: view.you }) ? 'drop-zone' : ''}`} {...dropProps({ type: 'area', owner: view.you })}>
        {drag?.kind === 'hand' && <div className="drop-hint">Drop here to play {view.cards[drag.id]?.name}</div>}
        <Battlefield view={view} owner={view.you} cardProps={cardProps} onCardClick={onCardClick} onHover={setHover} compact={!focusOnMe} />
      </div>

      <div className="bottom">
        <div className="bottom-left">
          <PlayerPanel
            p={meView}
            view={view}
            isMe
            selectable={(!!targeting && isTargetable({ type: 'player', id: view.you })) || (!!drag && canDrop({ type: 'player', id: view.you }))}
            attackTarget={false}
            onClick={() => onPlayerClick(view.you)}
            onZone={setZone}
            onHover={setHover}
            extra={dropProps({ type: 'player', id: view.you })}
            focused={focusOnMe}
            onFocus={() => toggleFocus(view.you)}
          />
          <div className="command-zone">
            {me.command.map((id) => {
              const props = cardProps(id);
              return view.cards[id] && <Card key={id} {...props} size="small" onClick={() => onCardClick(id)} onHover={setHover} />;
            })}
          </div>
        </div>
        <div className="hand">
          {view.hand.map((id) => {
            const props = cardProps(id);
            return props.card && <Card key={id} {...props} size="medium" onClick={(() => onCardClick(id))} onHover={setHover} />;
          })}
        </div>
        <div className="bottom-right">
          <div className="prompt">{prompt}</div>
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
          <div className={`settings ${showSettings ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
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
                  try {
                    localStorage.setItem(CLICK_KEY, e.target.checked ? 'on' : 'off');
                  } catch {
                    /* ignore */
                  }
                }}
              />{' '}
              Single-click plays cards
            </label>
            <button className="small" onClick={() => confirm('Concede this game?') && act({ type: 'concede' })}>
              Concede
            </button>
          </div>
          <LogPanel log={view.log} chat={net.chat} onChat={(text) => send({ t: 'chat', text })} view={view} onHover={setHover} />
        </div>
      </div>

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
  kind: 'attack' | 'block' | 'target';
  pending?: boolean;
}

/** Draws arrows between on-screen elements (re-measured as the layout changes). */
function ArrowLayer({ arrows }: { arrows: Arrow[] }) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; kind: string; pending?: boolean }[]>([]);
  const key = JSON.stringify(arrows);
  const last = useRef('');
  const measure = useCallback(() => {
    const center = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const next = (JSON.parse(key) as Arrow[])
      .map((a) => {
        const p = center(a.from);
        const q = center(a.to);
        return p && q ? { x1: p.x, y1: p.y, x2: q.x, y2: q.y, kind: a.kind, pending: a.pending } : null;
      })
      .filter(Boolean) as typeof lines;
    const sig = JSON.stringify(next.map((l) => [Math.round(l.x1), Math.round(l.y1), Math.round(l.x2), Math.round(l.y2), l.kind]));
    if (sig !== last.current) {
      last.current = sig;
      setLines(next);
    }
  }, [key]);
  useLayoutEffect(measure);
  useEffect(() => {
    const t = setInterval(measure, 400);
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
        {['attack', 'block', 'target'].map((k) => (
          <marker key={k} id={`head-${k}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className={`head-${k}`} />
          </marker>
        ))}
      </defs>
      {lines.map((l, i) => {
        // Stop short of the target's centre so the arrowhead stays visible.
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) || 1;
        const shorten = Math.min(30, len / 3);
        return (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2 - (dx / len) * shorten}
            y2={l.y2 - (dy / len) * shorten}
            className={`arrow arrow-${l.kind} ${l.pending ? 'pending' : ''}`}
            markerEnd={`url(#head-${l.kind})`}
          />
        );
      })}
    </svg>
  );
}

// ---------- Battlefield ----------

type CardPropsFn = (id: CardId) => {
  card: CardView;
  selectable: boolean;
  selected: boolean;
  attacking: boolean;
  blocking: boolean;
  badge?: string;
  extra?: Extra;
  dropOk?: boolean;
};

function Battlefield({
  view,
  owner,
  cardProps,
  onCardClick,
  onHover,
  compact,
}: {
  view: GameView;
  owner: PlayerId;
  cardProps: CardPropsFn;
  onCardClick: (id: CardId) => void;
  onHover: (c: CardView | null) => void;
  compact?: boolean;
}) {
  const mine = view.battlefield.map((id) => view.cards[id]).filter((c) => c && c.controller === owner);
  const attachedIds = new Set(mine.filter((c) => c.attachedTo && view.cards[c.attachedTo]).map((c) => c.id));
  const allAttached = new Set(view.battlefield.filter((id) => view.cards[id]?.attachedTo && view.cards[view.cards[id].attachedTo!]));
  const creatures = mine.filter((c) => c.types.includes('Creature') && !attachedIds.has(c.id));
  const lands = mine.filter((c) => c.types.includes('Land') && !c.types.includes('Creature'));
  const others = mine.filter((c) => !c.types.includes('Creature') && !c.types.includes('Land') && !attachedIds.has(c.id));
  const size = compact ? 'small' : 'medium';

  // Group identical lands (same name & tapped state) like Arena does.
  const landGroups: { key: string; ids: CardId[] }[] = [];
  for (const l of lands) {
    const key = `${l.name}|${l.tapped}|${l.attachments.length}`;
    const g = landGroups.find((x) => x.key === key);
    if (g) g.ids.push(l.id);
    else landGroups.push({ key, ids: [l.id] });
  }

  const renderWithAttachments = (c: CardView) => {
    const atts = view.battlefield.filter((id) => allAttached.has(id) && view.cards[id].attachedTo === c.id);
    return (
      <div key={c.id} className="perm-wrap">
        {atts.map((aid, i) => (
          <div key={aid} className="attached" style={{ top: -14 * (i + 1) }}>
            <Card {...cardProps(aid)} size="tiny" onClick={() => onCardClick(aid)} onHover={onHover} />
          </div>
        ))}
        <Card {...cardProps(c.id)} size={size} onClick={() => onCardClick(c.id)} onHover={onHover} />
      </div>
    );
  };

  return (
    <div className={`battlefield ${compact ? 'compact' : ''}`}>
      <div className="bf-row creatures">{creatures.map(renderWithAttachments)}</div>
      <div className="bf-row noncreatures">
        {others.map(renderWithAttachments)}
        {landGroups.map((g) => {
          const pickable = g.ids.find((id) => cardProps(id).selectable) ?? g.ids.find((id) => !view.cards[id].tapped) ?? g.ids[0];
          const props = cardProps(pickable);
          return (
            <div key={g.key} className="perm-wrap land-group">
              <Card {...props} size={compact ? 'tiny' : 'small'} onClick={() => onCardClick(pickable)} onHover={onHover} badge={g.ids.length > 1 ? `×${g.ids.length}` : props.badge} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
