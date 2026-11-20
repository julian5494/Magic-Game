// Which sounds a game update should make: compare the previous view with the new one.
import { useEffect, useRef } from 'react';
import type { GameView } from '../engine/view';
import { sound, type SoundName, type SoundOpts } from './sound';

type Cue = [SoundName, SoundOpts];

/** Log lines added since the previous view (the view carries a sliding window of the log). */
function newLines(prev: GameView['log'], next: GameView['log']): string[] {
  if (!prev.length) return [];
  const tail = prev.slice(-3).map((l) => `${l.turn}|${l.text}`).join('\n');
  for (let end = next.length; end >= 3; end--) {
    const win = next.slice(end - 3, end).map((l) => `${l.turn}|${l.text}`).join('\n');
    if (win === tail) return next.slice(end).map((l) => l.text);
  }
  return next.length > prev.length ? next.slice(prev.length).map((l) => l.text) : [];
}

const counterTotal = (c: { counters: Record<string, number> }) => Object.values(c.counters).reduce((a, b) => a + Math.max(0, b), 0);

export function soundsFor(prev: GameView | null, next: GameView): Cue[] {
  if (!prev || prev.you !== next.you) return [];
  // A different game (the log started over): nothing to animate.
  if (next.log.length < prev.log.length && prev.log.length < 400) return [];
  const out: Cue[] = [];
  const you = next.you;
  const seats = next.players.map((p) => p.id);
  const panOf = (pid: string) => (pid === you ? 0 : seats.indexOf(pid) % 2 ? 0.35 : -0.35);

  if (next.winner && !prev.winner) return [[next.winner === you ? 'win' : 'lose', {}]];
  if (next.turn !== prev.turn) out.push([next.activePlayer === you ? 'yourTurn' : 'theirTurn', {}]);

  const lines = newLines(prev.log, next.log);
  const countered = lines.some((l) => /was countered|is countered/.test(l));
  if (countered) out.push(['countered', {}]);
  if (lines.some((l) => / mulligans\.|shuffles/.test(l))) out.push(['shuffle', {}]);

  // Spells and abilities going on the stack.
  const before = new Set(prev.stack.map((s) => s.id));
  for (const it of next.stack) {
    if (before.has(it.id)) continue;
    const c = next.cards[it.cardId];
    if (it.kind === 'spell') out.push([c?.commander ? 'commander' : 'cast', { colors: c?.colors, pan: panOf(it.controller) }]);
    else out.push(['ability', { pan: panOf(it.controller) }]);
  }

  // Cards moving between zones, getting tapped or counters.
  const n: Partial<Record<SoundName, number>> = {};
  const push = (name: SoundName, o: SoundOpts) => {
    const k = (n[name] = (n[name] ?? 0) + 1);
    if (k > 4) return; // a board wipe is a few crunches, not forty
    out.push([name, { ...o, delay: (k - 1) * 0.07, gain: k > 1 ? 0.8 : 1 }]);
  };
  let taps = 0;
  const ids = new Set([...Object.keys(prev.cards), ...Object.keys(next.cards)]);
  for (const id of ids) {
    const a = prev.cards[id];
    const b = next.cards[id];
    if (b && b.zone === 'battlefield' && a?.zone !== 'battlefield') {
      const pan = panOf(b.controller);
      if (b.types.includes('Land')) push('land', { pan });
      else if (b.token && !a) push('token', { pan });
      else if (b.types.includes('Creature')) push('creature', { pan, colors: b.colors, size: Math.min(1, (b.power ?? 2) / 8) });
      else push('permanent', { pan, colors: b.colors });
    } else if (a && a.zone === 'battlefield' && b?.zone !== 'battlefield') {
      const pan = panOf(a.controller);
      const creature = a.types.includes('Creature');
      if (!b) push(creature ? 'dies' : 'destroy', { pan }); // a token stops existing
      else if (b.zone === 'graveyard' || b.zone === 'command') push(creature ? 'dies' : 'destroy', { pan });
      else if (b.zone === 'exile') push('exile', { pan });
      else push('bounce', { pan });
    } else if (a?.zone === 'stack' && b && b.zone !== 'battlefield' && b.zone !== 'stack' && !countered) {
      push('resolve', { colors: b.colors, pan: panOf(b.controller) });
    }
    if (b && b.zone === 'hand' && b.owner === you && a?.zone !== 'hand' && (!a || a.zone === 'library')) push('draw', {});
    if (a && b && a.zone === 'battlefield' && b.zone === 'battlefield') {
      if (!a.tapped && b.tapped) taps++;
      if (counterTotal(b) > counterTotal(a)) push('counter', { pan: panOf(b.controller) });
    }
  }
  if (taps) out.push(['tap', { gain: Math.min(1.4, 0.7 + taps * 0.15) }]);

  // Life totals: one gain and one loss sound per update, louder when it's yours.
  const combat = next.step === 'combatDamage' || next.step === 'firstStrikeDamage';
  let gained = false;
  let lost = false;
  for (const p of next.players) {
    const q = prev.players.find((x) => x.id === p.id);
    if (!q) continue;
    const d = p.life - q.life;
    if (d > 0 && !gained) {
      gained = true;
      out.push(['lifeGain', { pan: panOf(p.id), gain: p.id === you ? 1 : 0.6 }]);
    } else if (d < 0 && !lost) {
      lost = true;
      out.push([combat ? 'damage' : 'lifeLoss', { pan: panOf(p.id), gain: p.id === you ? 1 : 0.75 }]);
    }
  }

  // Combat.
  const atk = next.combat?.attackers ?? [];
  if (atk.length && !(prev.combat?.attackers.length ?? 0)) {
    const by = next.cards[atk[0].id]?.controller ?? next.activePlayer;
    out.push(['attack', { pan: panOf(by) }]);
  }
  if (next.combat?.blockersDeclared && !prev.combat?.blockersDeclared && atk.some((x) => x.blockedBy.length)) out.push(['block', {}]);

  if (next.monarch && next.monarch !== prev.monarch) out.push(['monarch', {}]);

  // A choice only you can make has appeared.
  const d = next.decision;
  if (d && d.player === you && d.id !== prev.decision?.id && ['chooseOption', 'chooseCards', 'chooseNumber'].includes(d.kind)) out.push(['prompt', {}]);
  return out;
}

/** Play the sounds for each new game view. */
export function useGameSounds(view: GameView | null): void {
  const prev = useRef<GameView | null>(null);
  useEffect(() => {
    if (!view) return;
    for (const [name, opts] of soundsFor(prev.current, view)) sound.play(name, opts);
    prev.current = view;
  }, [view]);
}
