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
  /** Damage dealt by another permanent (bite effects). */
  damageFrom(source: CardId, to: Target | CardId | PlayerId | null, amount: number): void;
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
  /** The player chooses N of their permanents matching filter and returns them to hand (not targeted). */
  chooseAndBounce(player: PlayerId, filter: CardFilter, n: number): void;
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
  surveil(player: PlayerId, n: number, then?: string): void;
  proliferate(): void;
  /** Turn a transforming double-faced permanent to its other face. */
  transform(card: CardId): void;
  /** Ask `player` to pay `cost`; if they don't (or can't), run def.handlers[failKey]. */
  unlessPays(player: PlayerId, cost: string, failKey: string, data?: any): void;
  /** Copy a spell on the stack (same targets). */
  copySpell(stackId: string | null, newController?: PlayerId): void;
  /** Add N mana of one color the player chooses (from `colors`). */
  addManaChoice(player: PlayerId, n: number, colors: ManaSym[] | 'any' | 'identity'): void;
  becomeMonarch(player: PlayerId): void;
  /** Look at the top N cards and choose up to `max` matching `filter` to put in hand; rest on bottom. */
  lookAndTake(player: PlayerId, n: number, max: number, filter: CardFilter | null, label: string, opts?: { exact?: boolean; rest?: 'bottom' | 'graveyard' }): void;
  /** Look at the top N cards and put them back in any order (the player orders them; optionally may shuffle after). */
  arrangeTop(player: PlayerId, n: number, mayShuffle?: boolean): void;
  /** Reveal the top card and put it into your hand; returns its mana value (0 if the library is empty). */
  revealTopToHand(player: PlayerId): number;
  /** The creature explores: reveal the top card; a land goes to hand, otherwise a +1/+1 counter and you may mill it. */
  explore(creature: CardId): void;
  /** The player puts N cards from their hand on top of their library, in the order they pick (first pick on top). */
  putFromHandOnTop(player: PlayerId, n: number): void;
  /** Ask a yes/no or multiple-choice question, continue in def.handlers[key]. */
  chooseOption(player: PlayerId, prompt: string, options: { id: string; label: string }[], key: string, data?: any): void;
  chooseCards(player: PlayerId, prompt: string, cards: CardId[], min: number, max: number, key: string, data?: any, privateCards?: boolean): void;
  /** Continue in def.handlers[key] once every pending choice has been made. */
  defer(key: string): void;
}

export type Effect = (ctx: Ctx) => void;

export interface ManaAbilityDef {
  colors: ManaSym[] | 'any' | 'identity';
  amount?: number;
  /** Produces exactly these symbols together (eg. bounce lands: {R}{W}). Overrides colors/amount. */
  fixed?: ManaSym[];
  /** Life lost when this ability is used (painlands). */
  pain?: number;
}

export interface Cost {
  mana?: string;
  tap?: boolean;
  sacrificeSelf?: boolean;
  /** Sacrifice another permanent matching this filter (chosen when activating). */
  sacrifice?: CardFilter;
  life?: number;
  /** Planeswalker loyalty cost (+1, -2, 0). */
  loyalty?: number;
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
  /** "Activate only if ..." */
  condition?: (state: GameState, self: CardInstance) => boolean;
  /** "Activate only once each turn." */
  onceEachTurn?: boolean;
  /** "Activate only during your turn." */
  yourTurnOnly?: boolean;
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
  | 'equippedCreatureDies'
  | 'equippedCreatureAttacks'
  | 'eachUpkeep'
  | 'eachEndStep'
  | 'opponentEndStep'
  | 'yourDrawStep'
  | 'eachDrawStep'
  | 'yourBeginCombat'
  | 'eachBeginCombat'
  | 'youDraw'
  | 'opponentDraws'
  | 'opponentCasts'
  | 'anyPlayerCasts'
  | 'youAttack'
  | 'castSelf'
  | 'youDiscard'
  | 'creatureYouControlDealsCombatDamageToPlayer'
  | 'equippedCreatureDealsCombatDamageToPlayer'
  | 'enchantedCreatureAttacks'
  | 'anyEtb' // any permanent enters (use `condition` to narrow)
  | 'anyDies'; // any creature dies (use `condition` to narrow)

export interface TriggeredAbility {
  on: TriggerOn;
  text: string;
  spellTypes?: CardType[];
  spellNotTypes?: CardType[];
  condition?: (state: GameState, event: GameEvent, self: CardInstance | Snapshot) => boolean;
  targets?: TargetSpec[];
  optional?: boolean;
  effect: Effect;
  /** "This ability triggers only once each turn." */
  onceEachTurn?: boolean;
}

export type StaticAbility =
  | { kind: 'anthem'; filter: CardFilter; power: number; toughness: number; keywords?: Keyword[] }
  | { kind: 'attached'; power?: number; toughness?: number; keywords?: Keyword[]; cantAttackOrBlock?: boolean }
  | { kind: 'noMaxHandSize' }
  | { kind: 'extraLand'; n: number }
  | { kind: 'preventNoncombatDamageToOtherCreatures' }
  | { kind: 'cantBeCountered' }
  | { kind: 'oppsCantMakeYouSacrifice' }
  /** "You may look at the top card of your library any time." */
  | { kind: 'lookTop' }
  /** "Play with the top card of your library revealed." */
  | { kind: 'revealTop' }
  /** "You may play lands / cast (creature, artifact...) spells from the top of your library." */
  | { kind: 'playFromTop'; lands?: boolean; spells?: CardFilter | 'any' }
  /** "You may play lands from your graveyard." */
  | { kind: 'landsFromGraveyard' }
  /** "You may cast (creature/noncreature...) spells as though they had flash." */
  | { kind: 'flash'; filter?: CardFilter }
  /**
   * Spells cost more or less: "Artifact spells you cast cost {1} less to cast" (delta -1, whose 'you'),
   * "Noncreature spells your opponents cast cost {1} more" (delta +1, whose 'opponents'). Only generic mana changes.
   */
  | { kind: 'costMod'; filter: CardFilter; delta: number; whose: 'you' | 'opponents' | 'all' };

export interface CastVariant {
  label: string;
  /** Also pay this much life (Force of Will: "pay 1 life and exile a blue card"). */
  life?: number;
  /** Also exile a card from your hand matching this (Force of Will's blue card). */
  exileFromHand?: CardFilter;
  /** Evoke: when it enters, it's sacrificed. */
  evoke?: boolean;
  /** Dash: it has haste and returns to its owner's hand at the beginning of the next end step. */
  dash?: boolean;
  /** Replaces the mana cost ('{0}' = free). Undefined keeps the normal cost. */
  cost?: string;
  /** Added to the cost (kicker). */
  extraCost?: string;
  zone: 'hand' | 'graveyard';
  /** Exile the card instead of putting it into the graveyard (flashback). */
  exileAfter?: boolean;
  /** Replacement targets/effect; undefined uses the card's normal ones. */
  targets?: TargetSpec[];
  effect?: Effect;
  /** Only castable when this holds (eg. "if you control a commander"). */
  condition?: (state: GameState, controller: PlayerId) => boolean;
}

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
  /** Modal spells ("Choose one —"). Each mode has its own targets and effect. */
  modes?: { text: string; targets: TargetSpec[]; effect: Effect }[];
  /** How many modes are chosen (default 1). */
  modeCount?: number;
  /** Starting loyalty for planeswalkers. */
  loyalty?: number;
  /** Double-faced card: the other face, by name (modal: playable land face; transform: what it turns into). */
  backFace?: string;
  /** This definition is the back face of a transforming card (can't be cast or put in a deck by itself). */
  isBackFace?: boolean;
  /** "You may have this enter as a copy of any <kind> on the battlefield." */
  cloneOf?: 'creature' | 'artifact' | 'permanent';
  /** "enters with N counters on it" (n 'X' = the X paid). */
  etbCounters?: { kind: string; n: number | 'X' };
  /** Unparsed text includes a drawback, so the card can't be played (rather than played without it). */
  cannotCast?: boolean;
  /** Other ways to cast: kicker, flashback, overload, "free if you control a commander", ... */
  castVariants?: CastVariant[];
  /** This spell costs this much less generic mana ("for each artifact you control", affinity, ...). */
  costReduction?: (state: GameState, controller: PlayerId) => number;
  /** Other ways to help pay: convoke (tap creatures), improvise (tap artifacts), delve (exile cards from your graveyard). */
  costHelp?: ('convoke' | 'improvise' | 'delve')[];
  /** Additional cost: pay this much life (or X life, for "pay X life"). */
  castLife?: number | 'X';
  /** Abilities usable while the card is in your hand (cycling); paying includes discarding it. */
  handAbilities?: ActivatedAbility[];
  /** "As an additional cost to cast this spell, discard a card." */
  castDiscard?: number;
  /** Ward {N}: spells/abilities opponents target this with are countered unless they pay. */
  ward?: string;
  /** Storm: copy this spell for each spell cast before it this turn. */
  storm?: boolean;
  /** "As an additional cost to cast this spell, sacrifice a ..." */
  castSacrifice?: CardFilter;
  abilities?: ActivatedAbility[];
  triggers?: TriggeredAbility[];
  statics?: StaticAbility[];
  entersTapped?: boolean;
  /** Conditional "enters tapped unless ..." checked as the permanent enters. */
  entersTappedIf?: (state: GameState, controller: PlayerId) => boolean;
  /** Shock lands: "you may pay 2 life. If you don't, it enters tapped." */
  shockLand?: boolean;
  /** Commander eligibility beyond "legendary creature", and partner-style pairing. */
  canBeCommander?: boolean;
  partner?: 'partner' | 'friends' | 'chooseBackground' | 'background' | { with: string };
  /** Oracle text the engine doesn't automate (shown on the card, never done manually). */
  unsupported?: string[];
  /** Default card image (from Scryfall). */
  image?: string;
  /** Banned in Commander according to Scryfall. */
  banned?: boolean;
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
