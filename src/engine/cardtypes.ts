import type {
  CardId, CardInstance, CardType, Color, DecisionAnswer, GameEvent, GameState, Keyword, ManaSym,
  PlayerId, Snapshot, Supertype, Target, ZoneName,
} from './types';

/** Filter for permanents or cards, evaluated relative to the controller of the effect. */
export interface CardFilter {
  types?: CardType[]; // matches if the card has ANY of these types
  notTypes?: CardType[];
  subtypes?: string[];
  supertypes?: Supertype[];
  controller?: 'you' | 'opponent';
  nonland?: boolean;
  colors?: Color[];
  notColors?: Color[];
  maxCmc?: number;
  minPower?: number;
  nonlegendary?: boolean;
  nontoken?: boolean;
  token?: boolean;
  attacking?: boolean;
  attackingOrBlocking?: boolean;
  /** Exclude the source of the effect. */
  other?: boolean;
  basicLand?: boolean;
  custom?: (state: GameState, card: CardInstance, controller: PlayerId, source: CardId) => boolean;
}

export interface TargetSpec {
  kind: 'creature' | 'permanent' | 'player' | 'opponent' | 'any' | 'spell' | 'graveyardCard';
  filter?: CardFilter;
  /** For 'spell' targets. */
  spellTypes?: CardType[];
  spellNotTypes?: CardType[];
  /** For graveyard targets. */
  graveyard?: 'yours' | 'any';
  optional?: boolean;
  label?: string;
  /** Hint for the AI: whom this target usually hurts or helps. */
  bias?: 'opponent' | 'self';
}

export interface Ctx {
  state: GameState;
  controller: PlayerId;
  source: CardId;
  /** The source permanent if it is still the same object on the battlefield. */
  self: CardInstance | null;
  snapshot?: Snapshot;
  targets: (Target | null)[];
  event?: GameEvent;
  x: number;
  sacrificed?: Snapshot;

  card(i: number): CardInstance | null;
  player(i: number): PlayerId | null;
  opponents(): PlayerId[];
  players(): PlayerId[];
  permanents(filter?: CardFilter): CardInstance[];
  creatures(filter?: CardFilter): CardInstance[];
  power(c: CardInstance | CardId): number;
  toughness(c: CardInstance | CardId): number;
  controllerOf(target: Target | null): PlayerId | null;

  damage(to: Target | CardId | PlayerId | null, amount: number): void;
  draw(player: PlayerId, n: number): void;
  gainLife(player: PlayerId, n: number): void;
  loseLife(player: PlayerId, n: number): void;
  destroy(card: CardInstance | CardId | null): void;
  exile(card: CardInstance | CardId | null): void;
  bounce(card: CardInstance | CardId | null): void;
  tap(card: CardInstance | CardId | null): void;
  untap(card: CardInstance | CardId | null): void;
  counterSpell(stackId: string | null): void;
  pump(card: CardInstance | CardId | null, power: number, toughness: number, keywords?: Keyword[]): void;
  addCounters(card: CardInstance | CardId | null, kind: string, n: number): void;
  createToken(player: PlayerId, tokenName: string, n?: number): CardInstance[];
  mill(player: PlayerId, n: number): void;
  moveCard(card: CardId, to: ZoneName, opts?: { tapped?: boolean; controller?: PlayerId; bottom?: boolean }): void;
  addMana(player: PlayerId, sym: ManaSym, n: number): void;
  gainControlUntilEndOfTurn(card: CardInstance | null): void;
  fight(a: CardInstance | null, b: CardInstance | null): void;
  log(text: string): void;

  /** Queue a choice: each listed player sacrifices N permanents matching filter. */
  eachSacrifices(players: PlayerId[], filter: CardFilter, n: number): void;
  discard(player: PlayerId, n: number): void;
  discardRandom(player: PlayerId, n: number): void;
  search(opts: {
    player?: PlayerId;
    filter: CardFilter;
    max: number;
    dest: 'battlefield' | 'hand' | 'top';
    tapped?: boolean;
    label: string;
    /** Cultivate-style split: first chosen to battlefield tapped, rest to hand. */
    split?: boolean;
  }): void;
  /** Scry N; if `then` is given, continue in def.handlers[then] after the scry. */
  scry(player: PlayerId, n: number, then?: string): void;
  /** Look at the top N cards and choose up to `max` matching `filter` to put in hand; rest on bottom. */
  lookAndTake(player: PlayerId, n: number, max: number, filter: CardFilter | null, label: string): void;
  /** Ask a yes/no or multiple-choice question, continue in def.handlers[key]. */
  chooseOption(player: PlayerId, prompt: string, options: { id: string; label: string }[], key: string, data?: any): void;
  chooseCards(player: PlayerId, prompt: string, cards: CardId[], min: number, max: number, key: string, data?: any, privateCards?: boolean): void;
}

export type Effect = (ctx: Ctx) => void;

export interface ManaAbilityDef {
  colors: ManaSym[] | 'any' | 'identity';
  amount?: number;
}

export interface Cost {
  mana?: string;
  tap?: boolean;
  sacrificeSelf?: boolean;
  /** Sacrifice another permanent matching this filter (chosen when activating). */
  sacrifice?: CardFilter;
  life?: number;
}

export interface ActivatedAbility {
  text: string;
  cost: Cost;
  mana?: ManaAbilityDef;
  targets?: TargetSpec[];
  effect?: Effect;
  sorcerySpeed?: boolean;
  /** Equip abilities attach to target creature you control. */
  equip?: boolean;
  /** AI hint: how desirable this activation is (0 = never by itself). */
  aiValue?: number;
}

export type TriggerOn =
  | 'etb' // this enters
  | 'dies' // this creature dies
  | 'leaves' // this leaves the battlefield
  | 'toGraveyardFromBattlefield' // this goes to graveyard from battlefield
  | 'attacks' // this attacks
  | 'yourUpkeep'
  | 'yourEndStep'
  | 'youCast' // you cast a spell (filter via `spellTypes`)
  | 'otherCreatureEtbYours'
  | 'anyOtherCreatureEtb'
  | 'landfall'
  | 'youGainLife'
  | 'dealsCombatDamageToPlayer'
  | 'creatureYouControlDies' // includes itself
  | 'otherCreatureYouControlDies'
  | 'creatureYouControlAttacks'
  | 'becomesTapped'
  | 'equippedCreatureDies';

export interface TriggeredAbility {
  on: TriggerOn;
  text: string;
  spellTypes?: CardType[];
  spellNotTypes?: CardType[];
  condition?: (state: GameState, event: GameEvent, self: CardInstance | Snapshot) => boolean;
  targets?: TargetSpec[];
  optional?: boolean;
  effect: Effect;
}

export type StaticAbility =
  | { kind: 'anthem'; filter: CardFilter; power: number; toughness: number; keywords?: Keyword[] }
  | { kind: 'attached'; power?: number; toughness?: number; keywords?: Keyword[]; cantAttackOrBlock?: boolean }
  | { kind: 'noMaxHandSize' }
  | { kind: 'preventNoncombatDamageToOtherCreatures' }
  | { kind: 'cantBeCountered' }
  | { kind: 'oppsCantMakeYouSacrifice' };

export interface CardDef {
  name: string;
  cost?: string;
  types: CardType[];
  supertypes?: Supertype[];
  subtypes?: string[];
  power?: number;
  toughness?: number;
  text?: string;
  keywords?: Keyword[];
  /** Explicit color(s), for tokens and colorless-cost cards with color. */
  colors?: Color[];
  /** Extra color identity beyond the mana cost (eg. lands with mana symbols in text). */
  identity?: Color[];
  /** Instant/sorcery targets, or Aura target. */
  targets?: TargetSpec[];
  /** Instant/sorcery resolution. */
  effect?: Effect;
  abilities?: ActivatedAbility[];
  triggers?: TriggeredAbility[];
  statics?: StaticAbility[];
  entersTapped?: boolean;
  /** Equip cost; creates an equip activated ability automatically. */
  equip?: string;
  token?: boolean;
  /** Characteristic-defining or conditional P/T bonus. */
  dynamicPT?: (state: GameState, self: CardInstance) => { power: number; toughness: number };
  /** Continuations for chooseOption / chooseCards. */
  handlers?: Record<string, (ctx: Ctx, answer: DecisionAnswer, data: any) => void>;
  /** AI hint: card is beneficial to cast on own permanents (pump) vs. harmful (removal). */
  ai?: { value?: number; holdForInstant?: boolean };
}
