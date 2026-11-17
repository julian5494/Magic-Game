import { legalActions } from './game';
import { getDef } from './registry';
import {
  attachmentsOf, colorIdentity, defColors, defOf, getKeywords, getPlayer, getPT, hasType, typeLine,
} from './state';
import type {
  CardId, CardInstance, Color, Decision, GameState, Keyword, LogEntry, ManaSym, PlayableAction, PlayerId, Step, Target,
} from './types';

export interface CardView {
  id: CardId;
  name: string;
  cost?: string;
  typeLine: string;
  types: string[];
  text: string;
  colors: Color[];
  owner: PlayerId;
  controller: PlayerId;
  zone: string;
  tapped: boolean;
  sick: boolean;
  damage: number;
  counters: Record<string, number>;
  power?: number;
  toughness?: number;
  basePower?: number;
  baseToughness?: number;
  keywords: Keyword[];
  attachedTo: CardId | null;
  attachments: CardId[];
  token: boolean;
  commander: boolean;
  /** Extra mana a commander costs from the command zone. */
  commanderTax?: number;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  life: number;
  poison: number;
  handCount: number;
  libraryCount: number;
  graveyard: CardId[];
  exile: CardId[];
  command: CardId[];
  commanderDamage: { commander: CardId; name: string; amount: number }[];
  manaPool: Record<ManaSym, number>;
  lost: boolean;
  lossReason?: string;
  isBot: boolean;
  autoPass: 'smart' | 'none';
  passUntilEndOfTurn: boolean;
  colorIdentity: Color[];
}

export interface StackView {
  id: string;
  kind: string;
  controller: PlayerId;
  cardId: CardId;
  name: string;
  text: string;
  targets: (Target | null)[];
}

export interface GameView {
  you: PlayerId;
  phase: GameState['phase'];
  turn: number;
  activePlayer: PlayerId;
  step: Step;
  priority: PlayerId | null;
  players: PlayerView[];
  hand: CardId[];
  battlefield: CardId[];
  stack: StackView[];
  cards: Record<CardId, CardView>;
  combat: GameState['combat'];
  decision: Decision | null;
  waitingOn: PlayerId[];
  legal: PlayableAction[];
  canPass: boolean;
  log: LogEntry[];
  winner: PlayerId | null;
}

export function cardView(state: GameState, c: CardInstance): CardView {
  const def = defOf(c);
  const onBf = c.zone === 'battlefield';
  const pt = hasType(c, 'Creature') ? (onBf ? getPT(state, c) : { power: def.power ?? 0, toughness: def.toughness ?? 0 }) : null;
  return {
    id: c.id,
    name: def.name,
    cost: def.cost,
    typeLine: typeLine(def),
    types: def.types,
    text: def.text ?? '',
    colors: defColors(def),
    owner: c.owner,
    controller: c.controller,
    zone: c.zone,
    tapped: c.tapped,
    sick: c.sick,
    damage: c.damage,
    counters: c.counters,
    power: pt?.power,
    toughness: pt?.toughness,
    basePower: def.power,
    baseToughness: def.toughness,
    keywords: onBf ? getKeywords(state, c) : def.keywords ?? [],
    attachedTo: c.attachedTo,
    attachments: onBf ? attachmentsOf(state, c.id).map((a) => a.id) : [],
    token: c.token,
    commander: c.commander,
    commanderTax: c.commander ? 2 * (getPlayer(state, c.owner).commanderCasts[c.id] ?? 0) : undefined,
  };
}

export function buildView(state: GameState, you: PlayerId): GameView {
  const cards: Record<CardId, CardView> = {};
  const add = (id: CardId) => {
    const c = state.cards[id];
    if (c) cards[id] = cardView(state, c);
  };
  const me = state.players.find((p) => p.id === you);
  for (const id of state.battlefield) add(id);
  for (const s of state.stack) add(s.cardId);
  for (const p of state.players) {
    for (const id of [...p.graveyard, ...p.exile, ...p.command]) add(id);
  }
  if (me) for (const id of me.hand) add(id);

  const decision = state.decisions.find((d) => d.player === you && (state.phase === 'mulligan' || d === state.decisions[0])) ?? null;
  if (decision?.cards) for (const id of decision.cards) add(id);

  const players: PlayerView[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    life: p.life,
    poison: p.poison,
    handCount: p.hand.length,
    libraryCount: p.library.length,
    graveyard: [...p.graveyard],
    exile: [...p.exile],
    command: [...p.command],
    commanderDamage: Object.entries(p.commanderDamage).map(([commander, amount]) => ({
      commander,
      name: state.cards[commander]?.def ?? 'Commander',
      amount,
    })),
    manaPool: { ...p.manaPool },
    lost: p.lost,
    lossReason: p.lossReason,
    isBot: p.isBot,
    autoPass: p.autoPass,
    passUntilEndOfTurn: p.passUntilTurn === state.turn,
    colorIdentity: p.commanders.flatMap((id) => (state.cards[id] ? colorIdentity(getDef(state.cards[id].def)) : [])),
  }));

  const waitingOn =
    state.phase === 'mulligan'
      ? [...new Set(state.decisions.map((d) => d.player))]
      : state.decisions.length
        ? [state.decisions[0].player]
        : state.priority
          ? [state.priority]
          : [];

  return {
    you,
    phase: state.phase,
    turn: state.turn,
    activePlayer: state.activePlayer,
    step: state.step,
    priority: state.priority,
    players,
    hand: me ? [...me.hand] : [],
    battlefield: [...state.battlefield],
    stack: state.stack.map((s) => ({
      id: s.id,
      kind: s.kind,
      controller: s.controller,
      cardId: s.cardId,
      name: s.def,
      text: s.text,
      targets: s.targets,
    })),
    cards,
    combat: state.combat,
    decision: decision ? redactDecision(decision) : null,
    waitingOn,
    legal: me ? legalActions(state, you) : [],
    canPass: state.phase === 'playing' && state.priority === you && state.decisions.length === 0,
    log: state.log.slice(-150),
    winner: state.winner,
  };
}

function redactDecision(d: Decision): Decision {
  // Handler data can contain server-only details; the client doesn't need it.
  const { data: _data, ...rest } = d;
  return rest as Decision;
}
