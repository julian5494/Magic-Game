// Which animations a game update should play: compare the previous view with the new one.
// Effects point at things on screen through anchors (a card, a player's life die, a stack entry); the effects layer
// turns those into positions, using where a card was last seen if it has just left the table.
import type { GameView } from '../engine/view';

export type Anchor = { card: string } | { player: string } | { stack: string };

export type Fx =
  | { kind: 'bolt'; from: Anchor; to: Anchor; color: string }
  | { kind: 'shatter'; at: Anchor; color: string; image?: string }
  | { kind: 'crumble'; at: Anchor; image?: string }
  | { kind: 'exile'; at: Anchor; image?: string }
  | { kind: 'wipe'; color: string }
  | { kind: 'counter'; at: Anchor }
  | { kind: 'drain'; from: Anchor[]; to: Anchor; color: string }
  | { kind: 'sparkle'; at: Anchor; color: string }
  | { kind: 'pillar'; at: Anchor; color: string }
  | { kind: 'slam'; at: Anchor; size: number }
  | { kind: 'puff'; at: Anchor; color: string }
  | { kind: 'lunge'; card: string; toward: Anchor; clash: boolean };

const COLOR: Record<string, string> = { W: '#fff1b8', U: '#5ec8ff', B: '#b07bff', R: '#ff6a2a', G: '#7be36a' };
export const fxColor = (colors?: string[]) => (colors?.length ? COLOR[colors[0]] ?? '#e6e6f0' : '#e6e6f0');

function newLines(prev: GameView['log'], next: GameView['log']): string[] {
  if (!prev.length) return [];
  const tail = prev.slice(-3).map((l) => `${l.turn}|${l.text}`).join('\n');
  for (let end = next.length; end >= 3; end--) {
    if (next.slice(end - 3, end).map((l) => `${l.turn}|${l.text}`).join('\n') === tail) return next.slice(end).map((l) => l.text);
  }
  return next.length > prev.length ? next.slice(prev.length).map((l) => l.text) : [];
}

const DAMAGE_STEPS = new Set(['firstStrikeDamage', 'combatDamage']);

export function fxFor(prev: GameView | null, next: GameView): Fx[] {
  if (!prev || prev.you !== next.you || next.winner) return [];
  // A different game (the log started over): nothing to animate.
  if (next.log.length < prev.log.length && prev.log.length < 400) return [];
  const out: Fx[] = [];
  const lines = newLines(prev.log, next.log);
  const image = (id: string) => prev.cards[id]?.image;

  // What resolved, and what was countered.
  const still = new Set(next.stack.map((s) => s.id));
  const gone = prev.stack.filter((s) => !still.has(s.id));
  const destroyedByTarget = new Set<string>();
  for (const s of gone) {
    const countered = lines.some((l) => l.startsWith(`${s.name} was countered`) || l.startsWith(`${s.name} is countered`));
    if (countered) {
      out.push({ kind: 'counter', at: { stack: s.id } });
      continue;
    }
    const text = s.text.toLowerCase();
    const color = fxColor(prev.cards[s.cardId]?.colors);
    if (/damage/.test(text))
      for (const t of s.targets) {
        if (!t) continue;
        const to: Anchor | null = t.type === 'player' ? { player: t.id } : t.type === 'card' ? { card: t.id } : null;
        if (to) out.push({ kind: 'bolt', from: { stack: s.id }, to, color });
      }
    if (/destroy/.test(text)) for (const t of s.targets) if (t?.type === 'card') destroyedByTarget.add(t.id);
  }

  // Creatures and other permanents leaving or arriving.
  const dead: string[] = [];
  for (const [id, a] of Object.entries(prev.cards)) {
    if (a.zone !== 'battlefield') continue;
    const b = next.cards[id];
    if (b?.zone === 'battlefield') continue;
    if (!b || b.zone === 'graveyard' || b.zone === 'command') {
      if (a.types.includes('Creature')) dead.push(id);
      else if (destroyedByTarget.has(id)) out.push({ kind: 'shatter', at: { card: id }, color: '#b07bff', image: image(id) });
    } else if (b.zone === 'exile') out.push({ kind: 'exile', at: { card: id }, image: image(id) });
  }
  if (dead.length >= 3) {
    // A board wipe: one shockwave, then everything crumbles.
    const wiper = gone.find((s) => s.kind === 'spell');
    out.push({ kind: 'wipe', color: fxColor(wiper ? prev.cards[wiper.cardId]?.colors : undefined) });
  }
  for (const id of dead.slice(0, 10)) {
    if (destroyedByTarget.has(id)) out.push({ kind: 'shatter', at: { card: id }, color: '#b07bff', image: image(id) });
    else out.push({ kind: 'crumble', at: { card: id }, image: image(id) });
  }
  for (const [id, b] of Object.entries(next.cards)) {
    if (b.zone !== 'battlefield' || prev.cards[id]?.zone === 'battlefield') continue;
    if (b.commander) out.push({ kind: 'pillar', at: { card: id }, color: fxColor(b.colors) });
    else if (b.types.includes('Creature') && (b.power ?? 0) >= 6) out.push({ kind: 'slam', at: { card: id }, size: Math.min(1, (b.power! - 5) / 6) });
    else if (b.token && !prev.cards[id]) out.push({ kind: 'puff', at: { card: id }, color: fxColor(b.colors) });
  }

  // Life: a drain when some lose while someone gains; otherwise sparkles for a gain.
  const delta = next.players.map((p) => ({ id: p.id, d: p.life - (prev.players.find((q) => q.id === p.id)?.life ?? p.life) }));
  const gainers = delta.filter((x) => x.d > 0);
  const losers = delta.filter((x) => x.d < 0);
  if (gainers.length && losers.length && !DAMAGE_STEPS.has(next.step)) {
    for (const g of gainers) out.push({ kind: 'drain', from: losers.map((l) => ({ player: l.id })), to: { player: g.id }, color: '#ff4a5a' });
  } else for (const g of gainers) out.push({ kind: 'sparkle', at: { player: g.id }, color: '#ffd76a' });

  // Combat damage: attackers lunge at what they're fighting.
  if (DAMAGE_STEPS.has(next.step) && next.step !== prev.step) {
    for (const a of prev.combat?.attackers ?? next.combat?.attackers ?? []) {
      const blocker = a.blockedBy[0];
      const toward: Anchor = blocker ? { card: blocker } : a.planeswalker ? { card: a.planeswalker } : { player: a.defender };
      out.push({ kind: 'lunge', card: a.id, toward, clash: !!blocker });
    }
  }
  return out;
}
