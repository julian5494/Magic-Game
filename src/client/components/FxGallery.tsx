// /?showcase=fx: the real rules engine running in the page, playing out moments that have animations,
// so every effect can be watched (and checked) on the actual table.
import { useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId, Target } from '../../engine/types';
import type { GameView } from '../../engine/view';
import type { NetState } from '../net';
import { GameBoard } from './GameBoard';

type Engine = typeof import('../../engine') & typeof import('../../engine/ops') & typeof import('../../engine/registry');

const SCENES: [string, string][] = [
  ['bolt', 'Lightning Bolt'],
  ['murder', 'Murder (destroy)'],
  ['wipe', 'Damnation (board wipe)'],
  ['swords', 'Swords to Plowshares (exile)'],
  ['counter', 'Counterspell'],
  ['drain', 'Blood Artist drain'],
  ['commander', 'Cast your commander'],
  ['big', 'A huge creature'],
  ['combat', 'Combat'],
];

export function FxGallery() {
  const eng = useRef<Engine | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);

  // A fresh table for every scene.
  const fresh = (e: Engine): { s: GameState; A: PlayerId; B: PlayerId } => {
    const d = e.buildPrecon('golgari');
    const o = e.buildPrecon('izzet');
    let s = e.createGame(
      [
        { id: 'me', name: 'You', commander: d.commanders, cards: d.cards },
        { id: 'opp', name: 'Morgan', commander: o.commanders, cards: o.cards },
      ],
      7,
    );
    for (const dec of [...s.decisions]) s = e.act(s, dec.player, { type: 'decide', decisionId: dec.id, answer: { option: 'keep' } });
    for (const p of s.players) {
      p.autoPass = 'none';
      for (const id of [...p.hand]) e.moveCard(s, id, 'library');
    }
    s.activePlayer = 'me';
    s.priority = 'me';
    s.step = 'main1';
    const put = (pid: PlayerId, name: string, zone: 'hand' | 'battlefield' = 'battlefield') => {
      const c = e.makeCard(s, name, pid, 'library');
      s.players.find((p) => p.id === pid)!.library.push(c.id);
      e.moveCard(s, c.id, zone, { controller: pid, silent: true });
      c.sick = false;
      return c;
    };
    for (const n of ['Llanowar Elves', 'Grizzly Bears', 'Thragtusk']) put('me', n);
    for (const n of ['Craw Wurm', 'Air Elemental', 'Grizzly Bears', 'Merfolk Looter']) put('opp', n);
    for (let i = 0; i < 6; i++) put('me', 'Swamp');
    for (let i = 0; i < 3; i++) put('me', 'Forest');
    for (let i = 0; i < 3; i++) put('opp', 'Island');
    s.events = [];
    s.log = [];
    (fresh as unknown as { put: typeof put }).put = put;
    return { s, A: 'me', B: 'opp' };
  };

  useEffect(() => {
    void (async () => {
      const [a, b, c] = await Promise.all([import('../../engine'), import('../../engine/ops'), import('../../engine/registry')]);
      eng.current = { ...a, ...b, ...c } as Engine;
      const { s } = fresh(eng.current);
      setView(eng.current.buildView(s, 'me'));
    })();
  }, []);

  const play = async (scene: string) => {
    const e = eng.current;
    if (!e || busy) return;
    setBusy(true);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let { s, A, B } = fresh(e);
    const put = (fresh as unknown as { put: (pid: PlayerId, name: string, zone?: 'hand' | 'battlefield') => { id: string } }).put;
    const show = async (ms = 650) => {
      setView(e.buildView(s, A));
      await wait(ms);
    };
    const pass = () => {
      if (s.decisions.length) {
        const d = s.decisions[0];
        const answer = d.kind === 'chooseTargets' ? { targets: (d.targetSpecs ?? []).map((t) => t.options.find((o) => o.id === B) ?? t.options[0] ?? null) } : d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes', cards: (d.cards ?? []).slice(0, d.min ?? 0) };
        s = e.act(s, d.player, { type: 'decide', decisionId: d.id, answer });
      } else if (s.priority) s = e.act(s, s.priority, { type: 'pass' });
    };
    const resolve = async () => {
      for (let i = 0; i < 12 && (s.stack.length || s.decisions.length); i++) {
        pass();
        await show(380);
      }
    };
    const creature = (pid: PlayerId) => Object.values(s.cards).find((c) => c.zone === 'battlefield' && c.controller === pid && e.getDef(c.def).types.includes('Creature'))!;
    const target = (id: string): Target => ({ type: 'card', id });
    await show(400);
    try {
      if (scene === 'bolt') {
        put(A, 'Mountain');
        const c = put(A, 'Lightning Bolt', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id, targets: [{ type: 'player', id: B }] });
        await show();
        await resolve();
      } else if (scene === 'murder' || scene === 'swords') {
        if (scene === 'swords') put(A, 'Plains');
        const c = put(A, scene === 'murder' ? 'Murder' : 'Swords to Plowshares', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id, targets: [target(creature(B).id)] });
        await show();
        await resolve();
      } else if (scene === 'wipe') {
        const c = put(A, 'Damnation', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id });
        await show();
        await resolve();
      } else if (scene === 'counter') {
        const c = put(A, 'Grizzly Bears', 'hand');
        const cs = put(B, 'Counterspell', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id });
        await show();
        s = e.act(s, A, { type: 'pass' });
        s = e.act(s, B, { type: 'cast', cardId: cs.id, targets: [{ type: 'stack', id: s.stack[0].id }] });
        await show();
        await resolve();
      } else if (scene === 'drain') {
        put(A, 'Blood Artist');
        const c = put(A, 'Murder', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id, targets: [target(creature(B).id)] });
        await show();
        await resolve();
      } else if (scene === 'commander') {
        const cmd = s.players.find((p) => p.id === A)!.command[0];
        s = e.act(s, A, { type: 'cast', cardId: cmd });
        await show();
        await resolve();
      } else if (scene === 'big') {
        for (let i = 0; i < 3; i++) put(A, 'Forest');
        const c = put(A, 'Pelakka Wurm', 'hand');
        s = e.act(s, A, { type: 'cast', cardId: c.id });
        await show();
        await resolve();
      } else if (scene === 'combat') {
        s = e.act(s, A, { type: 'pass' });
        for (let i = 0; i < 10 && !s.decisions.some((d) => d.kind === 'declareAttackers'); i++) pass();
        const d = s.decisions[0];
        const attackers = (d.attackers ?? []).map((id) => ({ id, defender: B }));
        s = e.act(s, A, { type: 'decide', decisionId: d.id, answer: { attackers } });
        await show();
        for (let i = 0; i < 12 && s.step !== 'main2'; i++) {
          const dd = s.decisions[0];
          if (dd?.kind === 'declareBlockers') {
            const blockers = dd.blockers ?? [];
            const blocks = blockers.slice(0, 2).map((b, k) => ({ blocker: b, attacker: (dd.attacking ?? [])[k % (dd.attacking?.length || 1)] }));
            s = e.act(s, B, { type: 'decide', decisionId: dd.id, answer: { blocks } });
          } else pass();
          await show(420);
        }
      }
    } catch (err) {
      console.warn('scene failed', err);
    }
    await show(900);
    setBusy(false);
  };

  if (!view) return <div className="sound-board">Setting the table…</div>;
  const net: NetState = { connected: true, playerId: 'me', name: 'You', precons: [], cardPool: [], rooms: [], room: null, view, errors: [], chat: [], deckCheck: null };
  return (
    <>
      <GameBoard view={view} net={net} send={() => undefined} />
      <div className="fx-gallery-panel">
        <strong>Animations</strong>
        {SCENES.map(([id, label]) => (
          <button key={id} className="tbtn quiet tiny" disabled={busy} onClick={() => void play(id)} data-scene={id}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
