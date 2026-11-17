import { loadCards } from './cards';

loadCards();

export { cardPool, loadCards } from './cards';
export { act, applyAction, createGame, legalActions, run, RulesError } from './game';
export type { PlayerConfig } from './game';
export { buildView } from './view';
export type { CardView, GameView, PlayerView, StackView } from './view';
export { parseDeckList, validateDeck, deckToText } from './deck';
export type { DeckList } from './deck';
export { PRECONS, buildPrecon, preconText } from './precons';
export { chooseBotAction } from './ai';
export * from './types';
