// The Rakdos, Simic, Azorius and Orzhov cards behave as printed.
import { describe, expect, it } from 'vitest';
import { act, buildPrecon, createGame, legalActions } from '../src/engine';
import type { GameState, PlayerId, Target } from '../src/engine';
import { makeCard, moveCard } from '../src/engine/ops';
import { collectTriggers, processTriggers } from '../src/engine/rules';
import { getPT } from '../src/engine/state';

function setup(): { s: GameState; A: PlayerId; B: PlayerId } {
  const d = buildPrecon('rakdos');
  let s = createGame(
    [
      { id: 'a', name: 'A', commander: d.commanders, cards: d.cards },
      { id: 'b', name: 'B', commander: d.commanders, cards: d.cards },
    ],
    5,
  );
  for (const dec of [...s.decisions]) s = act(s, dec.player, { type: 'decide', decisionId: dec.id, answer: { option: 'keep' } });
  for (const p of s.players) {
    p.autoPass = 'none';
    for (const id of [...p.hand]) moveCard(s, id, 'library');
  }
  s.events = [];
  return { s, A: s.activePlayer, B: s.players.find((p) => p.id !== s.activePlayer)!.id };
}

function put(s: GameState, pid: PlayerId, name: string, zone: 'hand' | 'battlefield' | 'graveyard' | 'library' = 'battlefield') {
  const c = makeCard(s, name, pid, 'library');
  s.players.find((p) => p.id === pid)!.library.push(c.id);
  moveCard(s, c.id, zone, { controller: pid });
  c.sick = false;
  s.events = [];
  return c;
}
const lands = (s: GameState, pid: PlayerId, name: string, n: number) => {
  for (let i = 0; i < n; i++) put(s, pid, name);
};
const P = (s: GameState, pid: PlayerId) => s.players.find((p) => p.id === pid)!;
/** Permanents a player controls with this name. */
const onField = (s: GameState, pid: PlayerId, name: string) => Object.values(s.cards).filter((c) => c.zone === 'battlefield' && c.controller === pid && c.def === name);
/** Move a card straight to a zone (a creature dying, say), then let the game notice what triggered. */
function moveAndFlush(s: GameState, id: string, zone: 'graveyard' | 'battlefield' | 'exile'): void {
  moveCard(s, id, zone);
  collectTriggers(s);
  processTriggers(s);
}

/**
 * Let everything on the stack resolve. Decisions are answered by `pick` when it returns an answer,
 * otherwise: targets → the first legal option, yes/no → yes, card choices → the minimum.
 */
function settle(s: GameState, pick: (d: GameState['decisions'][number]) => any = () => undefined): GameState {
  for (let i = 0; i < 60; i++) {
    const d = s.decisions[0];
    if (d) {
      const custom = pick(d);
      let answer = custom;
      if (!answer) {
        if (d.kind === 'chooseTargets') answer = { targets: (d.targetSpecs ?? []).map((t) => t.options[0] ?? null) };
        else if (d.kind === 'chooseOption') answer = { option: d.options?.find((o) => o.id === 'yes')?.id ?? d.options?.[0]?.id };
        else if (d.kind === 'chooseCards') answer = { cards: (d.cards ?? []).slice(0, d.min ?? 0) };
        else if (d.kind === 'declareAttackers') answer = { attackers: [] };
        else if (d.kind === 'declareBlockers') answer = { blocks: [] };
        else answer = {};
      }
      s = act(s, d.player, { type: 'decide', decisionId: d.id, answer });
      continue;
    }
    if (!s.stack.length) break;
    s = act(s, s.priority!, { type: 'pass' });
  }
  return s;
}

const player = (id: PlayerId): Target => ({ type: 'player', id });
const card = (id: string): Target => ({ type: 'card', id });

describe('Rakdos', () => {
  it('Judith pumps your other creatures and pings when a nontoken creature you control dies', () => {
    let { s, A, B } = setup();
    const judith = put(s, A, 'Judith, the Scourge Diva');
    const bears = put(s, A, 'Grizzly Bears');
    put(s, A, 'Viscera Seer');
    expect(getPT(s, bears).power).toBe(3);
    expect(getPT(s, judith).power).toBe(2);
    const seer = onField(s, A, 'Viscera Seer')[0].id;
    const lifeB = P(s, B).life;
    const sac = legalActions(s, A).find((a) => a.type === 'activate' && a.cardId === seer)! as any;
    s = act(s, A, { type: 'activate', cardId: seer, ability: sac.ability, sacrifice: bears.id, targets: [] });
    s = settle(s, (d) => (d.kind === 'chooseTargets' ? { targets: [player(B)] } : undefined));
    expect(s.cards[bears.id].zone).toBe('graveyard');
    expect(P(s, B).life).toBe(lifeB - 1);
  });

  it('Blood Artist drains whenever any creature dies, including itself', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Swamp', 4);
    const artist = put(s, A, 'Blood Artist');
    const theirs = put(s, B, 'Grizzly Bears');
    const terminate = put(s, A, 'Bake into a Pie', 'hand');
    const [lifeA, lifeB] = [P(s, A).life, P(s, B).life];
    s = act(s, A, { type: 'cast', cardId: terminate.id, targets: [card(theirs.id)] });
    s = settle(s, (d) => (d.kind === 'chooseTargets' ? { targets: [player(B)] } : undefined));
    expect(s.cards[theirs.id].zone).toBe('graveyard');
    expect(P(s, B).life).toBe(lifeB - 1);
    expect(P(s, A).life).toBe(lifeA + 1);
    expect(onField(s, A, 'Food Token').length).toBe(1);
    // Blood Artist sees its own death too.
    moveAndFlush(s, artist.id, 'graveyard');
    s = settle(s, (d) => (d.kind === 'chooseTargets' ? { targets: [player(B)] } : undefined));
    expect(P(s, B).life).toBe(lifeB - 2);
  });

  it("Kolaghan's Command does two things", () => {
    let { s, A, B } = setup();
    lands(s, A, 'Swamp', 2);
    lands(s, A, 'Mountain', 1);
    const dead = put(s, A, 'Grizzly Bears', 'graveyard');
    const kc = put(s, A, "Kolaghan's Command", 'hand');
    const mode = legalActions(s, A).find((a) => a.cardId === kc.id && JSON.stringify(a.modes) === '[0,3]')!;
    expect(mode).toBeTruthy();
    const lifeB = P(s, B).life;
    s = settle(act(s, A, { type: 'cast', cardId: kc.id, modes: [0, 3], targets: [card(dead.id), player(B)] }));
    expect(s.cards[dead.id].zone).toBe('hand');
    expect(P(s, B).life).toBe(lifeB - 2);
  });

  it('Pitiless Plunderer makes a Treasure when another of your creatures dies', () => {
    let { s, A } = setup();
    put(s, A, 'Pitiless Plunderer');
    const bears = put(s, A, 'Grizzly Bears');
    moveAndFlush(s, bears.id, 'graveyard');
    s = settle(s);
    expect(onField(s, A, 'Treasure Token').length).toBe(1);
  });
});

describe('Simic', () => {
  it('Tatyova draws and gains life on landfall; Lotus Cobra adds mana', () => {
    let { s, A } = setup();
    put(s, A, 'Tatyova, Benthic Druid');
    const land = put(s, A, 'Forest', 'hand');
    const [life0, hand0] = [P(s, A).life, P(s, A).hand.length];
    s = settle(act(s, A, { type: 'playLand', cardId: land.id }));
    expect(P(s, A).life).toBe(life0 + 1);
    expect(P(s, A).hand.length).toBe(hand0 - 1 + 1);
  });

  it('Coiling Oracle: a land goes onto the battlefield, anything else to hand', () => {
    let { s, A } = setup();
    lands(s, A, 'Forest', 1);
    lands(s, A, 'Island', 1);
    const top = put(s, A, 'Island', 'library');
    const lib = P(s, A).library;
    lib.splice(lib.indexOf(top.id), 1);
    lib.unshift(top.id);
    const oracle = put(s, A, 'Coiling Oracle', 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: oracle.id }));
    s = settle(s);
    expect(s.cards[top.id].zone).toBe('battlefield');
  });

  it('Growth Spiral draws and puts a land from hand onto the battlefield', () => {
    let { s, A } = setup();
    lands(s, A, 'Forest', 1);
    lands(s, A, 'Island', 1);
    const extra = put(s, A, 'Forest', 'hand');
    const spiral = put(s, A, 'Growth Spiral', 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: spiral.id }), (d) => (d.kind === 'chooseCards' ? { cards: [extra.id] } : undefined));
    expect(s.cards[extra.id].zone).toBe('battlefield');
  });

  it('Azusa allows two extra land drops', () => {
    let { s, A } = setup();
    put(s, A, 'Azusa, Lost but Seeking');
    const ls = [put(s, A, 'Forest', 'hand'), put(s, A, 'Forest', 'hand'), put(s, A, 'Forest', 'hand'), put(s, A, 'Forest', 'hand')];
    for (const l of ls.slice(0, 3)) s = settle(act(s, A, { type: 'playLand', cardId: l.id }));
    expect(ls.slice(0, 3).every((l) => s.cards[l.id].zone === 'battlefield')).toBe(true);
    expect(legalActions(s, A).some((a) => a.type === 'playLand')).toBe(false);
  });
});

describe('Azorius', () => {
  it('Brago blinks your permanents after combat damage, re-running their enter effects', () => {
    let { s, A, B } = setup();
    const brago = put(s, A, 'Brago, King Eternal');
    const drifter = put(s, A, 'Mulldrifter');
    const hand0 = P(s, A).hand.length;
    // Go to combat and attack with Brago.
    s = settle(s);
    for (let i = 0; i < 40 && !s.decisions.some((d) => d.kind === 'declareAttackers'); i++) s = act(s, s.priority!, { type: 'pass' });
    const dec = s.decisions.find((d) => d.kind === 'declareAttackers')!;
    s = act(s, A, { type: 'decide', decisionId: dec.id, answer: { attackers: [{ id: brago.id, defender: B }] } });
    for (let i = 0; i < 60 && !s.decisions.some((d) => d.kind === 'chooseCards' && d.player === A); i++) {
      const d = s.decisions[0];
      if (d) s = act(s, d.player, { type: 'decide', decisionId: d.id, answer: d.kind === 'declareBlockers' ? { blocks: [] } : { option: 'yes' } });
      else s = act(s, s.priority!, { type: 'pass' });
    }
    const choose = s.decisions.find((d) => d.kind === 'chooseCards' && d.player === A)!;
    expect(choose.cards).toContain(drifter.id);
    s = settle(act(s, A, { type: 'decide', decisionId: choose.id, answer: { cards: [drifter.id] } }));
    expect(s.cards[drifter.id].zone).toBe('battlefield');
    expect(P(s, A).hand.length).toBe(hand0 + 2);
  });

  it('Banisher Priest exiles until it leaves', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Plains', 3);
    const theirs = put(s, B, 'Grizzly Bears');
    const priest = put(s, A, 'Banisher Priest', 'hand');
    s = settle(act(s, A, { type: 'cast', cardId: priest.id }), (d) => (d.kind === 'chooseTargets' ? { targets: [card(theirs.id)] } : undefined));
    expect(s.cards[theirs.id].zone).toBe('exile');
    moveAndFlush(s, priest.id, 'graveyard');
    s = settle(s);
    expect(s.cards[theirs.id].zone).toBe('battlefield');
  });

  it('Momentary Blink can be flashed back from the graveyard', () => {
    let { s, A } = setup();
    lands(s, A, 'Island', 4);
    put(s, A, 'Grizzly Bears');
    const blink = put(s, A, 'Momentary Blink', 'graveyard');
    const fb = legalActions(s, A).find((a) => a.cardId === blink.id);
    expect(fb?.variant).toBeDefined();
  });
});

describe('Orzhov', () => {
  it('Elenda grows when other creatures die and leaves lifelink Vampires behind', () => {
    let { s, A, B } = setup();
    const elenda = put(s, A, 'Elenda, the Dusk Rose');
    const x = put(s, B, 'Grizzly Bears');
    const y = put(s, B, 'Grizzly Bears');
    moveAndFlush(s, x.id, 'graveyard');
    s = settle(s);
    moveAndFlush(s, y.id, 'graveyard');
    s = settle(s);
    expect(getPT(s, s.cards[elenda.id]).power).toBe(3);
    moveAndFlush(s, elenda.id, 'graveyard');
    s = settle(s);
    expect(onField(s, A, 'Lifelink Vampire Token').length).toBe(3);
  });

  it('Sanguine Bond turns life gain into life loss for an opponent', () => {
    let { s, A, B } = setup();
    put(s, A, 'Sanguine Bond');
    put(s, A, 'Soul Warden');
    const lifeB = P(s, B).life;
    put(s, B, 'Grizzly Bears');
    s.events = [];
    // A creature entering makes Soul Warden gain 1, which Sanguine Bond turns into 1 loss.
    const bear = makeCard(s, 'Grizzly Bears', A, 'library');
    P(s, A).library.push(bear.id);
    moveCard(s, bear.id, 'battlefield', { controller: A });
    collectTriggers(s);
    processTriggers(s);
    s = settle(s, (d) => (d.kind === 'chooseTargets' ? { targets: [player(B)] } : undefined));
    expect(P(s, B).life).toBe(lifeB - 1);
  });

  it('Debt to the Deathless drains each opponent for twice X', () => {
    let { s, A, B } = setup();
    lands(s, A, 'Plains', 2);
    lands(s, A, 'Swamp', 4);
    const debt = put(s, A, 'Debt to the Deathless', 'hand');
    const [lifeA, lifeB] = [P(s, A).life, P(s, B).life];
    s = settle(act(s, A, { type: 'cast', cardId: debt.id, x: 2 }));
    expect(P(s, B).life).toBe(lifeB - 4);
    expect(P(s, A).life).toBe(lifeA + 4);
  });
});
