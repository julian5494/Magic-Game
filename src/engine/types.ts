// Core types for the Commander rules engine.
// GameState is plain JSON so it can be cloned, persisted and sent over the wire.

export type PlayerId = string;
export type AutoPassMode = 'smart' | 'stack' | 'none';

/** Foil finishes Magic has printed (shown as a shimmer over the card). */
export type FoilKind =
  | 'foil' | 'etched' | 'galaxy' | 'surge' | 'halo' | 'confetti' | 'textured' | 'oilslick'
  | 'gilded' | 'rainbow' | 'fracture' | 'ripple' | 'raised' | 'neon';

/** How one physical copy looks: its printing's image, foil finish and frame treatments. */
export interface CardLook {
  image?: string;
  foil?: FoilKind;
  /** e.g. Showcase, Borderless, Extended art, Full art, Retro frame, Serialized. */
  treatments?: string[];
}
export type CardId = string;

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];
export type ManaSym = Color | 'C';
export const MANA_SYMS: ManaSym[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export type CardType = 'Creature' | 'Artifact' | 'Enchantment' | 'Land' | 'Instant' | 'Sorcery' | 'Planeswalker';
export type Supertype = 'Legendary' | 'Basic';

export type Keyword =
  | 'Flying' | 'Reach' | 'Trample' | 'Haste' | 'Vigilance' | 'Deathtouch' | 'Lifelink'
  | 'First strike' | 'Double strike' | 'Menace' | 'Defender' | 'Hexproof' | 'Shroud'
  | 'Indestructible' | 'Flash' | 'Prowess' | 'Exalted' | 'Unblockable' | 'CantBlock' | 'CantAttack';

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';

export type Step =
  | 'untap' | 'upkeep' | 'draw' | 'main1' | 'beginCombat' | 'declareAttackers' | 'declareBlockers'
  | 'firstStrikeDamage' | 'combatDamage' | 'endCombat' | 'main2' | 'end' | 'cleanup';

export const STEP_ORDER: Step[] = [
  'untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers',
  'firstStrikeDamage', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup',
];

export type Target =
  | { type: 'player'; id: PlayerId }
  | { type: 'card'; id: CardId; inc?: number }
  | { type: 'stack'; id: string };

export interface CardInstance {
  id: CardId;
  def: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: ZoneName;
  /** Incremented on each zone change: a card that changes zones becomes a new object (rule 400.7). */
  inc: number;
  tapped: boolean;
  /** True if the controller hasn't controlled it continuously since their most recent turn began. */
  sick: boolean;
  damage: number;
  deathtouched: boolean;
  counters: Record<string, number>;
  /** Until-end-of-turn modifications. */
  temp: { power: number; toughness: number; keywords: Keyword[]; cantBlock?: boolean };
  attachedTo: CardId | null;
  token: boolean;
  commander: boolean;
  /** Number of upcoming untap steps this permanent skips. */
  skipUntap: number;
  /** Cards exiled "until this leaves the battlefield" (Oblivion Ring style). */
  linked: CardId[];
  /** Original controller when control was changed until end of turn. */
  eotControlOf?: PlayerId | null;
  /** X value paid while on the stack. */
  x?: number;
  /** Image of the chosen printing. */
  art?: string;
  /** Foil finish and frame treatments of this physical copy (from the imported list). */
  look?: CardLook;
  /** Front-face definition while this card is showing its back face or copying something. */
  frontDef?: string;
  /** May be played from exile by this player until the end of this turn number (impulse draw). */
  playableBy?: { player: PlayerId; untilTurn: number };
  /** Turn on which each once-per-turn ability (key) was last used. */
  usedOnTurn?: Record<string, number>;
}

export interface Player {
  id: PlayerId;
  name: string;
  life: number;
  poison: number;
  library: CardId[];
  hand: CardId[];
  graveyard: CardId[];
  exile: CardId[];
  command: CardId[];
  manaPool: Record<ManaSym, number>;
  landsPlayed: number;
  /** Commander damage received, keyed by commander card id. */
  commanderDamage: Record<CardId, number>;
  /** Times each commander has been cast from the command zone. */
  commanderCasts: Record<CardId, number>;
  commanders: CardId[];
  lost: boolean;
  lossReason?: string;
  drewFromEmpty: boolean;
  mulligans: number;
  kept: boolean;
  isBot: boolean;
  /**
   * When to stop for priority automatically:
   * - smart: like Arena; skip when you have nothing you could do.
   * - stack: like smart, but always stop when an opponent puts something on the stack (hides what you hold).
   * - none: full control, stop every time you receive priority.
   */
  autoPass: AutoPassMode;
  /** Keep priority after casting/activating (to respond to your own spell). */
  holding?: boolean;
  passUntilTurn: number | null;
  lifeGainedThisTurn: number;
  /** Extra land drops granted this turn ("You may play an additional land this turn"). */
  extraLandsThisTurn?: number;
}

export interface StackItem {
  id: string;
  kind: 'spell' | 'ability' | 'trigger';
  controller: PlayerId;
  /** For spells: the card itself. For abilities: the source card. */
  cardId: CardId;
  /** Zone-change counter of the source when the ability was put on the stack. */
  sourceInc?: number;
  def: string;
  /** Index of the activated ability / triggered ability on the definition. */
  index?: number;
  targets: (Target | null)[];
  text: string;
  /** Event that caused a trigger, kept for effects that reference it. */
  event?: GameEvent;
  /** Snapshot of the source for abilities whose source has left. */
  sourceSnapshot?: Snapshot;
  x?: number;
  sacrificed?: Snapshot;
  modes?: number[];
  /** Index into def.castVariants (kicker, flashback, overload, ...). */
  variant?: number;
  /** Copies of spells (storm, "copy target spell") aren't cards. */
  isCopy?: boolean;
}

export interface Snapshot {
  id: CardId;
  def: string;
  owner: PlayerId;
  controller: PlayerId;
  power: number;
  toughness: number;
  types: CardType[];
  token: boolean;
  commander: boolean;
  zone: ZoneName;
  attachedTo?: CardId | null;
  linked?: CardId[];
}

export type GameEvent =
  | { t: 'etb'; card: CardId; controller: PlayerId }
  | { t: 'leaves'; card: CardId; snap: Snapshot; to: ZoneName }
  | { t: 'attacks'; card: CardId; defender: PlayerId; alone: boolean }
  | { t: 'cast'; card: CardId; controller: PlayerId; def: string }
  | { t: 'gainLife'; player: PlayerId; amount: number }
  | { t: 'combatDamagePlayer'; source: CardId; player: PlayerId; amount: number }
  | { t: 'step'; step: Step; active: PlayerId }
  | { t: 'tapped'; card: CardId }
  | { t: 'draw'; player: PlayerId }
  | { t: 'discard'; player: PlayerId; card: CardId }
  | { t: 'attackDeclared'; player: PlayerId; count: number };

export interface PendingTrigger {
  source: CardId;
  def: string;
  index: number;
  controller: PlayerId;
  event: GameEvent;
  snapshot?: Snapshot;
  /** Set once the controller chose this trigger as the next to go on the stack. */
  chosen?: boolean;
}

export interface AttackerInfo {
  id: CardId;
  defender: PlayerId;
  /** Set when attacking one of the defending player's planeswalkers. */
  planeswalker?: CardId;
  blockedBy: CardId[];
  blocked: boolean;
}

export interface Combat {
  attackers: AttackerInfo[];
  blockersDeclared: boolean;
  firstStrikeDone: boolean;
  /** creature ids that dealt first-strike damage */
  dealtFirstStrike: CardId[];
}

export type DecisionKind =
  | 'mulligan' | 'chooseCards' | 'chooseOption' | 'declareAttackers' | 'declareBlockers' | 'chooseTargets' | 'chooseNumber';

export interface Decision {
  id: string;
  player: PlayerId;
  kind: DecisionKind;
  prompt: string;
  /** Selectable cards (chooseCards). */
  cards?: CardId[];
  /** Options (chooseOption). */
  options?: { id: string; label: string }[];
  min?: number;
  max?: number;
  /** Target specs for chooseTargets. */
  targetSpecs?: TargetSpecView[];
  /** For declareAttackers */
  attackers?: CardId[];
  defenders?: PlayerId[];
  /** Opponents' planeswalkers that can be attacked. */
  planeswalkers?: CardId[];
  /** For declareBlockers */
  blockers?: CardId[];
  attacking?: CardId[];
  handler: string;
  data?: any;
  /** Cards that are revealed only to the deciding player (eg. library search). */
  privateCards?: boolean;
}

export interface TargetSpecView {
  label: string;
  optional: boolean;
  options: Target[];
}

export interface DecisionAnswer {
  cards?: CardId[];
  option?: string;
  attackers?: { id: CardId; defender: PlayerId; planeswalker?: CardId }[];
  blocks?: { blocker: CardId; attacker: CardId }[];
  targets?: (Target | null)[];
  number?: number;
}

export interface LogEntry {
  turn: number;
  text: string;
}

export interface GameState {
  id: string;
  phase: 'mulligan' | 'playing' | 'over';
  players: Player[];
  cards: Record<CardId, CardInstance>;
  battlefield: CardId[];
  stack: StackItem[];
  turn: number;
  activePlayer: PlayerId;
  step: Step;
  priority: PlayerId | null;
  passes: PlayerId[];
  combat: Combat | null;
  pendingTriggers: PendingTrigger[];
  events: GameEvent[];
  decisions: Decision[];
  log: LogEntry[];
  seed: number;
  nextId: number;
  winner: PlayerId | null;
  /** Number of turns the starting player has taken (for the 2-player draw skip). */
  startingPlayer: PlayerId;
  /** Snapshots of permanents that left the battlefield during the current event batch. */
  recentlyLeft: Snapshot[];
  startingLife: number;
  /** Spells cast this turn (for storm). */
  spellsThisTurn?: number;
  /** Spells cast during the previous turn (werewolves). */
  spellsLastTurn?: number;
  /** The monarch draws an extra card at their end step; dealing combat damage to them steals it. */
  monarch?: PlayerId | null;
}

export type Action =
  | { type: 'pass' }
  | { type: 'playLand'; cardId: CardId; back?: boolean }
  | { type: 'cast'; cardId: CardId; targets?: (Target | null)[]; x?: number; sacrifice?: CardId; modes?: number[]; hold?: boolean; variant?: number }
  | { type: 'activate'; cardId: CardId; ability: number; targets?: (Target | null)[]; x?: number; sacrifice?: CardId; color?: ManaSym; hold?: boolean }
  | { type: 'manaTap'; cardId: CardId; ability: number; color?: ManaSym }
  | { type: 'decide'; decisionId: string; answer: DecisionAnswer }
  | { type: 'setAutoPass'; mode: AutoPassMode }
  | { type: 'passUntilEndOfTurn' }
  | { type: 'concede' };

/** What a player may do right now, used by the UI to highlight playable cards. */
export interface PlayableAction {
  type: 'playLand' | 'cast' | 'activate' | 'manaTap';
  cardId: CardId;
  ability?: number;
  label: string;
  targets: TargetSpecView[];
  /** Maximum affordable X, when the cost has X. */
  xMax?: number;
  /** Creature/permanent ids that may be sacrificed as a cost. */
  sacrificeOptions?: CardId[];
  sacrificeLabel?: string;
  manaColors?: ManaSym[];
  /** Modes chosen for this playable variant of a modal spell. */
  modes?: number[];
  /** Mana ability with an extra cost (resolves immediately, no stack). */
  isMana?: boolean;
  /** Cast variant (kicker, flashback, ...). */
  variant?: number;
  /** Play the back face (modal double-faced lands). */
  back?: boolean;
}
