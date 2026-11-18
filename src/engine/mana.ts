import type { Color, ManaSym } from './types';
import { COLORS } from './types';

export interface ManaCost {
  generic: number;
  W: number; U: number; B: number; R: number; G: number; C: number;
  x: number;
  /** Hybrid pips, each a list of alternatives: a color symbol or '2' (two generic). */
  hybrid?: string[][];
}

export function emptyCost(): ManaCost {
  return { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, x: 0 };
}

export function parseCost(cost: string | undefined): ManaCost {
  const c = emptyCost();
  if (!cost) return c;
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cost))) {
    const s = m[1].toUpperCase();
    if (/^\d+$/.test(s)) c.generic += parseInt(s, 10);
    else if (s === 'X') c.x += 1;
    else if (s in c) (c as any)[s] += 1;
    else if (/^[WUBRG2]\/[WUBRGP]$/.test(s)) {
      // Hybrid ({W/U}, {2/G}). Phyrexian ({G/P}) is treated as its color only.
      const [a, b] = s.split('/');
      c.hybrid = [...(c.hybrid ?? []), b === 'P' ? [a] : [a, b]];
    } else c.generic += 1; // unknown symbols (snow etc.) count as generic for mana value; such cards aren't castable
  }
  return c;
}

/** All concrete costs a hybrid cost can be paid as (cheapest-looking first). */
export function costVariants(cost: ManaCost): ManaCost[] {
  const hy = cost.hybrid ?? [];
  let out: ManaCost[] = [{ ...cost, hybrid: undefined }];
  for (const alts of hy) {
    const next: ManaCost[] = [];
    for (const base of out) {
      for (const a of alts) {
        const v = { ...base };
        if (a === '2') v.generic += 2;
        else (v as any)[a] += 1;
        next.push(v);
      }
    }
    out = next.slice(0, 64);
  }
  return out;
}


export function manaValue(cost: string | undefined): number {
  const c = parseCost(cost);
  const hybrid = (c.hybrid ?? []).reduce((n, alts) => n + (alts.includes('2') ? 2 : 1), 0);
  return c.generic + c.W + c.U + c.B + c.R + c.G + c.C + hybrid;
}

export function costColors(cost: string | undefined): Color[] {
  const c = parseCost(cost);
  const hy = new Set((c.hybrid ?? []).flat());
  return COLORS.filter((col) => c[col] > 0 || hy.has(col));
}

export function addGeneric(cost: ManaCost, n: number): ManaCost {
  return { ...cost, generic: cost.generic + n };
}

export function formatCost(c: ManaCost): string {
  let s = '';
  for (let i = 0; i < c.x; i++) s += '{X}';
  if (c.generic > 0) s += `{${c.generic}}`;
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C'] as const) for (let i = 0; i < c[k]; i++) s += `{${k}}`;
  return s || '{0}';
}

export type Pool = Record<ManaSym, number>;

export function emptyPool(): Pool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(p: Pool): number {
  return p.W + p.U + p.B + p.R + p.G + p.C;
}

export interface ManaSource {
  id: string;
  ability: number;
  produces: ManaSym[];
  amount: number;
  /** Sources that sacrifice themselves (Treasure) or hurt (painlands) are used last. */
  costly: boolean;
  /** Produces all of these symbols at once. */
  fixed?: ManaSym[];
}

export interface PaymentPlan {
  /** Sources to tap and the color each should produce. */
  taps: { id: string; ability: number; color: ManaSym }[];
}

/**
 * Find a way to pay `cost` using the floating pool first, then untapped mana sources.
 * Prefers inflexible sources (basic lands) so flexible ones stay available, like Arena's auto-tapper.
 */
export function solvePayment(cost: ManaCost, pool: Pool, sources: ManaSource[]): PaymentPlan | null {
  const fixed = sources.filter((s) => s.fixed);
  const normal = sources.filter((s) => !s.fixed);
  const direct = solveSimple(cost, pool, normal);
  if (direct || fixed.length === 0) return direct;
  // Try adding multi-mana sources (eg. {R}{W} lands), fewest first.
  const k = Math.min(fixed.length, 8);
  for (let size = 1; size <= k; size++) {
    for (const combo of combinations(fixed.slice(0, k), size)) {
      const p = { ...pool };
      for (const s of combo) for (const sym of s.fixed!) p[sym]++;
      const plan = solveSimple(cost, p, normal);
      if (plan) return { taps: [...combo.map((s) => ({ id: s.id, ability: s.ability, color: s.fixed![0] })), ...plan.taps] };
    }
  }
  return null;
}

function combinations<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  arr.forEach((x, i) => {
    for (const rest of combinations(arr.slice(i + 1), size - 1)) out.push([x, ...rest]);
  });
  return out;
}

function solveSimple(cost: ManaCost, pool: Pool, sources: ManaSource[]): PaymentPlan | null {
  const p: Pool = { ...pool };
  const pips: ManaSym[] = [];
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
    for (let i = 0; i < cost[k]; i++) {
      if (p[k] > 0) p[k]--;
      else pips.push(k);
    }
  }
  const sorted = [...sources].sort(
    (a, b) => Number(a.costly) - Number(b.costly) || a.produces.length - b.produces.length || a.amount - b.amount,
  );
  // Most constrained pips first.
  pips.sort((a, b) => sorted.filter((s) => s.produces.includes(a)).length - sorted.filter((s) => s.produces.includes(b)).length);

  const used = new Map<number, { color: ManaSym; left: number }>();
  const assign = (i: number): boolean => {
    if (i >= pips.length) return true;
    const pip = pips[i];
    // Reuse leftover mana from a multi-mana source of the same color.
    for (const [idx, u] of used) {
      if (u.color === pip && u.left > 0) {
        u.left--;
        if (assign(i + 1)) return true;
        u.left++;
      }
    }
    for (let s = 0; s < sorted.length; s++) {
      if (used.has(s) || !sorted[s].produces.includes(pip)) continue;
      used.set(s, { color: pip, left: sorted[s].amount - 1 });
      if (assign(i + 1)) return true;
      used.delete(s);
    }
    return false;
  };
  if (!assign(0)) return null;

  let generic = cost.generic;
  const poolLeft = poolTotal(p);
  generic -= Math.min(generic, poolLeft);
  for (const u of used.values()) {
    const take = Math.min(generic, u.left);
    generic -= take;
  }
  if (generic > 0) {
    // For generic mana prefer big colorless sources, then inflexible ones.
    const rest = sorted
      .map((s, idx) => ({ s, idx }))
      .filter(({ idx }) => !used.has(idx))
      .sort((a, b) => Number(a.s.costly) - Number(b.s.costly) || b.s.amount - a.s.amount || a.s.produces.length - b.s.produces.length);
    for (const { s, idx } of rest) {
      if (generic <= 0) break;
      // Avoid overpaying with a 2-mana source when 1 is needed if a 1-mana source exists.
      if (s.amount > generic && rest.some((r) => !used.has(r.idx) && r.idx !== idx && r.s.amount <= generic && !r.s.costly)) continue;
      used.set(idx, { color: s.produces.includes('C') ? 'C' : s.produces[0], left: 0 });
      generic -= s.amount;
    }
    if (generic > 0) {
      for (const { s, idx } of rest) {
        if (generic <= 0) break;
        if (used.has(idx)) continue;
        used.set(idx, { color: s.produces.includes('C') ? 'C' : s.produces[0], left: 0 });
        generic -= s.amount;
      }
    }
    if (generic > 0) return null;
  }
  return {
    taps: [...used.entries()].map(([idx, u]) => ({ id: sorted[idx].id, ability: sorted[idx].ability, color: u.color })),
  };
}

/** Remove a cost from a pool that is known to be sufficient. Returns false if it isn't. */
export function payFromPool(pool: Pool, cost: ManaCost): boolean {
  const p = { ...pool };
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
    if (p[k] < cost[k]) return false;
    p[k] -= cost[k];
  }
  let generic = cost.generic;
  for (const k of ['C', 'W', 'U', 'B', 'R', 'G'] as const) {
    const take = Math.min(generic, p[k]);
    p[k] -= take;
    generic -= take;
  }
  if (generic > 0) return false;
  Object.assign(pool, p);
  return true;
}
