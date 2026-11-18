import type { CardId, PlayerId } from '../engine/types';
import type { CardView, GameView } from '../engine/view';

/** One attacker and who it's attacking / who blocks it. */
export interface PlannedAttack {
  id: CardId;
  defender: PlayerId;
  planeswalker?: CardId;
  blockers: CardId[];
}

export interface CombatPreview {
  /** Damage each creature or planeswalker would take. */
  damage: Record<CardId, number>;
  dies: Set<CardId>;
  /** Life change per player (negative = loses life). */
  life: Record<PlayerId, number>;
  /** Damage that tramples past the blockers, per attacker. */
  trample: Record<CardId, number>;
  lines: { title: string; result: string; tone: 'bad' | 'good' | 'even'; detail: string }[];
}

const has = (c: CardView, k: string) => c.keywords.includes(k as never);

/**
 * Work out what happens if combat damage resolves right now, mirroring the engine's
 * combat damage rules (first/double strike, deathtouch, trample, lifelink, indestructible).
 * Spells and triggered abilities are not predicted.
 */
export function previewCombat(view: GameView, attacks: PlannedAttack[], you: PlayerId): CombatPreview {
  const damage: Record<CardId, number> = {};
  const dt = new Set<CardId>(); // took deathtouch damage
  const life: Record<PlayerId, number> = {};
  const trample: Record<CardId, number> = {};
  const card = (id: CardId) => view.cards[id];
  const alive = (id: CardId) => {
    const c = card(id);
    if (!c) return false;
    if (has(c, 'Indestructible')) return true;
    const hurt = (damage[id] ?? 0) + c.damage;
    if (c.types.includes('Planeswalker') && !c.types.includes('Creature')) return (c.counters.loyalty ?? 0) - (damage[id] ?? 0) > 0;
    return hurt < (c.toughness ?? 0) && !dt.has(id);
  };
  const hit = (src: CardView, target: { card?: CardId; player?: PlayerId }, amount: number) => {
    if (amount <= 0) return;
    if (target.player) life[target.player] = (life[target.player] ?? 0) - amount;
    if (target.card) {
      damage[target.card] = (damage[target.card] ?? 0) + amount;
      if (has(src, 'Deathtouch')) dt.add(target.card);
    }
    if (has(src, 'Lifelink')) life[src.controller] = (life[src.controller] ?? 0) + amount;
  };

  const anyFirst = attacks.some((a) => [a.id, ...a.blockers].some((id) => card(id) && (has(card(id), 'First strike') || has(card(id), 'Double strike'))));
  const steps: ('first' | 'regular')[] = anyFirst ? ['first', 'regular'] : ['regular'];
  for (const step of steps) {
    const strikes = (c: CardView) => {
      const fs = has(c, 'First strike') || has(c, 'Double strike');
      if (step === 'first') return fs;
      return !anyFirst || !fs || has(c, 'Double strike');
    };
    const batch: (() => void)[] = [];
    for (const a of attacks) {
      const A = card(a.id);
      if (!A || !alive(a.id) || !strikes(A)) continue;
      const power = A.power ?? 0;
      if (power <= 0) continue;
      const target = a.planeswalker ? { card: a.planeswalker } : { player: a.defender };
      const blockers = a.blockers.filter((b) => alive(b));
      if (a.blockers.length === 0) {
        batch.push(() => hit(A, target, power));
        continue;
      }
      if (blockers.length === 0) {
        if (has(A, 'Trample')) batch.push(() => { hit(A, target, power); trample[a.id] = (trample[a.id] ?? 0) + power; });
        continue;
      }
      let remaining = power;
      blockers.forEach((bid, i) => {
        const B = card(bid);
        const lethal = has(A, 'Deathtouch') ? 1 : Math.max(0, (B.toughness ?? 0) - B.damage - (damage[bid] ?? 0));
        const last = i === blockers.length - 1;
        const amt = last && !has(A, 'Trample') ? remaining : Math.min(remaining, lethal);
        remaining -= amt;
        batch.push(() => hit(A, { card: bid }, amt));
      });
      if (has(A, 'Trample') && remaining > 0) {
        const r = remaining;
        batch.push(() => { hit(A, target, r); trample[a.id] = (trample[a.id] ?? 0) + r; });
      }
    }
    for (const a of attacks) {
      if (!card(a.id) || !alive(a.id)) continue;
      for (const bid of a.blockers) {
        const B = card(bid);
        if (!B || !alive(bid) || !strikes(B)) continue;
        batch.push(() => hit(B, { card: a.id }, B.power ?? 0));
      }
    }
    // Damage in a step is dealt simultaneously.
    for (const f of batch) f();
  }

  const dies = new Set<CardId>();
  for (const id of Object.keys(damage)) if (!alive(id)) dies.add(id);

  const name = (id: CardId) => card(id)?.name ?? '?';
  const pname = (id: PlayerId) => (id === you ? 'you' : view.players.find((p) => p.id === id)?.name ?? '?');
  const lines: CombatPreview['lines'] = [];
  for (const a of attacks) {
    const A = card(a.id);
    if (!A) continue;
    const mine = A.controller === you;
    if (a.blockers.length === 0) {
      const amt = Math.max(0, A.power ?? 0) * (has(A, 'Double strike') ? 2 : 1);
      const at = a.planeswalker ? name(a.planeswalker) : pname(a.defender);
      lines.push({ title: `${A.name} → ${at}`, result: amt ? `${amt} damage` : 'no damage', tone: mine ? 'good' : 'bad', detail: 'Unblocked.' });
      continue;
    }
    const blockerNames = a.blockers.map(name).join(' + ');
    const aDies = dies.has(a.id);
    const deadBlockers = a.blockers.filter((b) => dies.has(b));
    let result: string;
    if (aDies && deadBlockers.length === a.blockers.length) result = 'both die';
    else if (aDies) result = `${A.name.split(',')[0]} dies`;
    else if (deadBlockers.length) result = `${deadBlockers.map((b) => name(b).split(',')[0]).join(', ')} ${deadBlockers.length > 1 ? 'die' : 'dies'}`;
    else result = 'no deaths';
    const parts: string[] = [];
    for (const b of a.blockers) {
      const d = damage[b] ?? 0;
      parts.push(`${name(b).split(',')[0]} takes ${d}${dies.has(b) ? '' : ' and survives'}`);
    }
    parts.push(`${A.name.split(',')[0]} takes ${damage[a.id] ?? 0}${aDies ? '' : ' and survives'}`);
    if (trample[a.id]) parts.push(`${trample[a.id]} tramples over to ${pname(a.defender)}`);
    // Good for you if the other side loses more.
    const mineLost = (aDies ? (mine ? 1 : 0) : 0) + deadBlockers.filter((b) => card(b)?.controller === you).length;
    const theirsLost = (aDies ? (mine ? 0 : 1) : 0) + deadBlockers.filter((b) => card(b)?.controller !== you).length;
    lines.push({
      title: `${A.name.split(',')[0]} × ${blockerNames}`,
      result,
      tone: mineLost > theirsLost ? 'bad' : mineLost < theirsLost ? 'good' : 'even',
      detail: parts.join('. ') + '.',
    });
  }
  return { damage, dies, life, trample, lines };
}
