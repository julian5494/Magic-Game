import { allDefs, registerCards } from '../registry';
import { BLACK } from './black';
import { BLUE } from './blue';
import { COLORLESS } from './colorless';
import { GOLD } from './gold';
import { GREEN } from './green';
import { GUILDS } from './guilds';
import { LANDS } from './lands';
import { RED } from './red';
import { TOKENS } from './tokens';
import { WHITE } from './white';

let loaded = false;

/** Register every implemented card. Safe to call more than once. */
export function loadCards(): void {
  if (loaded) return;
  loaded = true;
  registerCards([...TOKENS, ...LANDS, ...COLORLESS, ...WHITE, ...BLUE, ...BLACK, ...RED, ...GREEN, ...GOLD, ...GUILDS]);
}

/** Names of all non-token cards players can put in decks. */
export function cardPool(): string[] {
  loadCards();
  return allDefs()
    .filter((d) => !d.token)
    .map((d) => d.name)
    .sort();
}
