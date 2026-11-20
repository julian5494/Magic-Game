import { useEffect, useState } from 'react';
import type { CardId, Keyword, PlayerId } from '../../engine/types';
import { DEFAULT_STOPS } from '../../engine/types';
import type { CardView, GameView, PlayerView } from '../../engine/view';
import type { NetState } from '../net';
import { FxGallery } from './FxGallery';
import { GameBoard } from './GameBoard';
import { Foil, imageUrl } from './Card';
import { trackFoilPointer } from '../foil';
import { sound, SOUND_NAMES, type SoundName, type SoundOpts } from '../sound';

/**
 * A static table for checking the board visuals without playing a game:
 * open /?showcase=effects, /?showcase=combat, /?showcase=blocks or /?showcase=foils.
 */
export function Showcase({ scene }: { scene: string }) {
  if (scene === 'gallery') return <FoilGallery />;
  if (scene === 'sounds') return <SoundBoard />;
  if (scene === 'fx') return <FxGallery />;
  return <ShowcaseTable scene={scene} />;
}

const GALLERY: [string, string, string][] = [
  ['foil', 'Foil', 'Serra Angel'],
  ['etched', 'Etched foil', 'Swords to Plowshares'],
  ['galaxy', 'Galaxy foil', 'Sakura-Tribe Elder'],
  ['surge', 'Surge foil', 'Lightning Bolt'],
  ['halo', 'Halo foil', 'Birds of Paradise'],
  ['confetti', 'Confetti foil', 'Eternal Witness'],
  ['textured', 'Textured foil', 'Thragtusk'],
  ['oilslick', 'Oil slick foil', 'Sheoldred, the Apocalypse'],
  ['gilded', 'Gilded foil', 'Sol Ring'],
  ['rainbow', 'Double rainbow foil', 'Arcane Signet'],
  ['fracture', 'Fracture foil', 'Lightning Greaves'],
  ['ripple', 'Ripple foil', 'Swiftfoot Boots'],
  ['raised', 'Raised foil', 'Glorious Anthem'],
  ['neon', 'Neon ink', 'Rhystic Study'],
];

const SOUND_LABELS: Partial<Record<SoundName, string>> = {
  draw: 'Draw a card', shuffle: 'Shuffle / mulligan', land: 'Play a land', cast: 'Cast a spell', commander: 'Cast your commander',
  ability: 'Ability or trigger', resolve: 'Instant or sorcery resolves', creature: 'Creature enters', permanent: 'Artifact or enchantment enters',
  token: 'Token created', tap: 'Tap', counter: 'Counter added (die)', attack: 'Attack', block: 'Block', damage: 'Combat damage',
  dies: 'Creature dies', destroy: 'Permanent destroyed', exile: 'Exiled', bounce: 'Returned to hand', countered: 'Spell countered',
  lifeGain: 'Gain life', lifeLoss: 'Lose life', monarch: 'Become the monarch', yourTurn: 'Your turn', theirTurn: "Opponent's turn",
  prompt: 'A choice for you', pickup: 'Pick up a card', cancel: 'Put it back', click: 'Button', win: 'You win', lose: 'You lose',
};

/** Every sound, to audition (/?showcase=sounds). */
function SoundBoard() {
  const [, bump] = useState(0);
  useEffect(() => sound.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => {
    (window as unknown as { __sound: typeof sound }).__sound = sound;
  }, []);
  const extra: [string, SoundName, SoundOpts][] = [
    ['Cast: white', 'cast', { colors: ['W'] }],
    ['Cast: blue', 'cast', { colors: ['U'] }],
    ['Cast: black', 'cast', { colors: ['B'] }],
    ['Cast: red', 'cast', { colors: ['R'] }],
    ['Cast: green', 'cast', { colors: ['G'] }],
    ['Cast: gold (W/B)', 'cast', { colors: ['W', 'B'] }],
    ['Creature enters: 1-drop', 'creature', { size: 0.1, colors: ['G'] }],
    ['Creature enters: huge', 'creature', { size: 1, colors: ['G'] }],
  ];
  return (
    <div className="sound-board">
      <h1>Sound board</h1>
      <p>
        Every sound in the game is made in your browser. Volume{' '}
        <input type="range" min={0} max={100} value={Math.round(sound.volume * 100)} onChange={(e) => sound.setVolume(Number(e.target.value) / 100)} />{' '}
        <label>
          <input type="checkbox" checked={sound.ambience} onChange={(e) => sound.setAmbience(e.target.checked)} /> Tavern sounds
        </label>{' '}
        Music <input type="range" min={0} max={100} value={Math.round(sound.musicVolume * 100)} onChange={(e) => sound.setMusicVolume(Number(e.target.value) / 100)} />{' '}
        <button className="tbtn quiet tiny" onClick={() => sound.wantHearth(true)}>
          Play the tavern
        </button>
      </p>
      <div className="sound-grid">
        {SOUND_NAMES.map((n) => (
          <button key={n} className="tbtn" onClick={() => sound.play(n, n === 'cast' || n === 'resolve' || n === 'creature' || n === 'commander' ? { colors: ['W', 'U'] } : {})}>
            {SOUND_LABELS[n] ?? n}
          </button>
        ))}
      </div>
      <h2>Variations</h2>
      <div className="sound-grid">
        {extra.map(([label, n, o]) => (
          <button key={label} className="tbtn" onClick={() => sound.play(n, o)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Every foil finish, large, side by side (move the pointer over a card to tilt it into the light). */
function FoilGallery() {
  useEffect(() => trackFoilPointer(), []);
  return (
    <div className="foil-gallery">
      {GALLERY.map(([kind, label, name]) => (
        <figure key={kind}>
          <div className="gallery-card" data-card-id={`g-${kind}`}>
            <img src={imageUrl(name)} alt={name} />
            <Foil kind={kind} id={`g-${kind}`} art={imageUrl(name)} />
          </div>
          <figcaption>
            {label}
            <small>{name}</small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function ShowcaseTable({ scene }: { scene: string }) {
  const [view] = useState(() => (scene === 'combat' ? combatScene() : scene === 'blocks' ? combatScene(true) : scene === 'foils' ? foilScene() : effectsScene()));
  const net: NetState = {
    connected: true,
    playerId: 'me',
    name: 'You',
    precons: [],
    cardPool: [],
    rooms: [],
    room: null,
    view,
    errors: [],
    chat: [],
    deckCheck: null,
  };
  return <GameBoard view={view} net={net} send={() => undefined} />;
}

let n = 0;
function card(
  name: string,
  controller: PlayerId,
  types: string[],
  opts: Partial<CardView> & { kw?: Keyword[]; pt?: [number, number] } = {},
): CardView {
  const id = `c${++n}`;
  return {
    id,
    name,
    typeLine: types.join(' '),
    types,
    text: '',
    colors: opts.colors ?? [],
    owner: controller,
    controller,
    zone: 'battlefield',
    tapped: false,
    sick: false,
    damage: 0,
    counters: {},
    power: opts.pt?.[0],
    toughness: opts.pt?.[1],
    basePower: opts.pt?.[0],
    baseToughness: opts.pt?.[1],
    keywords: opts.kw ?? [],
    attachedTo: null,
    attachments: [],
    token: false,
    commander: false,
    ...opts,
  };
}

function player(id: PlayerId, name: string, life: number, commanders: CardId[], extra: Partial<PlayerView> = {}): PlayerView {
  return {
    id,
    name,
    life,
    poison: 0,
    handCount: 5,
    libraryCount: 80,
    graveyard: [],
    exile: [],
    command: [],
    commanderDamage: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    lost: false,
    isBot: id !== 'me',
    autoPass: 'smart',
    holding: false,
    passUntilEndOfTurn: false,
    colorIdentity: [],
    mana: { total: 0, groups: [] },
    commanders,
    stops: DEFAULT_STOPS,
    ...extra,
  };
}

function base(cards: CardView[], players: PlayerView[], over: Partial<GameView>): GameView {
  const all: Record<CardId, CardView> = {};
  for (const c of cards) all[c.id] = c;
  return {
    you: 'me',
    phase: 'playing',
    turn: 9,
    activePlayer: 'me',
    step: 'main1',
    priority: 'me',
    players,
    hand: cards.filter((c) => c.zone === 'hand').map((c) => c.id),
    battlefield: cards.filter((c) => c.zone === 'battlefield').map((c) => c.id),
    stack: [],
    cards: all,
    combat: null,
    decision: null,
    waitingOn: ['me'],
    legal: [],
    canPass: true,
    passes: [],
    log: [],
    winner: null,
    monarch: null,
    ...over,
  };
}

function lands(owner: PlayerId, name: string, count: number, tapped = 0): CardView[] {
  return Array.from({ length: count }, (_, i) => card(name, owner, ['Basic', 'Land'], { tapped: i < tapped }));
}

function effectsScene(): GameView {
  const cmd = card('Trostani, Selesnya\'s Voice', 'me', ['Legendary', 'Creature'], { zone: 'command', commander: true, cost: '{3}{G}{W}', colors: ['G', 'W'], pt: [2, 5], commanderTax: 2 });
  const mine = [
    card('Serra Angel', 'me', ['Creature'], { kw: ['Flying', 'Vigilance'], pt: [4, 4], colors: ['W'] }),
    card('Sigarda, Host of Herons', 'me', ['Legendary', 'Creature'], { kw: ['Flying', 'Hexproof'], pt: [5, 5], colors: ['G', 'W'] }),
    card('Vampire Nighthawk', 'me', ['Creature'], { kw: ['Flying', 'Deathtouch', 'Lifelink'], pt: [2, 3], colors: ['B'] }),
    card('Baneslayer Angel', 'me', ['Creature'], { kw: ['Flying', 'First strike', 'Lifelink'], pt: [5, 5], colors: ['W'] }),
    card('Darksteel Colossus', 'me', ['Artifact', 'Creature'], { kw: ['Trample', 'Indestructible'], pt: [11, 11] }),
    card('Sphinx of Jwar Isle', 'me', ['Creature'], { kw: ['Flying', 'Shroud'], pt: [5, 5], colors: ['U'] }),
    card('Adeline, Resplendent Cathar', 'me', ['Legendary', 'Creature'], { kw: ['Vigilance'], pt: [4, 4], ward: '{2}', colors: ['W'] }),
    card('Grizzly Bears', 'me', ['Creature'], { pt: [5, 5], basePower: 2, baseToughness: 2, colors: ['G'], counters: { '+1/+1': 3 } }),
    card('Grizzly Bears', 'me', ['Creature'], { pt: [1, 1], basePower: 2, baseToughness: 2, colors: ['G'], counters: { '-1/-1': 1 } }),
    card('Sol Ring', 'me', ['Artifact']),
    card('Arcane Signet', 'me', ['Artifact'], { counters: { charge: 2 } }),
    card('Glorious Anthem', 'me', ['Enchantment'], { colors: ['W'] }),
    ...lands('me', 'Forest', 5, 2),
    ...lands('me', 'Plains', 3),
    card('Treasure', 'me', ['Token', 'Artifact'], { token: true }),
    card('Treasure', 'me', ['Token', 'Artifact'], { token: true }),
    card('Clue', 'me', ['Token', 'Artifact'], { token: true }),
    cmd,
  ];
  const opp = [
    card('Craw Wurm', 'p2', ['Creature'], { pt: [6, 4], kw: ['Trample'], colors: ['G'] }),
    card('Llanowar Elves', 'p2', ['Creature'], { pt: [1, 1], colors: ['G'] }),
    card('Swords to Plowshares', 'p2', ['Instant'], { zone: 'graveyard' }),
    card('Talrand, Sky Summoner', 'p2', ['Legendary', 'Creature'], { pt: [2, 2], commander: true, colors: ['U'] }),
    ...lands('p2', 'Island', 6, 6),
  ];
  const hand = ['Swords to Plowshares', 'Thragtusk', 'Lightning Greaves', 'Forest'].map((nm) => card(nm, 'me', ['Card'], { zone: 'hand' }));
  // Courser of Kruphix-style: your top card is revealed on the library pile.
  const top = card('Cultivate', 'me', ['Sorcery'], { zone: 'library' });
  const others = [card('Krenko, Mob Boss', 'p3', ['Legendary', 'Creature'], { pt: [3, 3], commander: true }), ...lands('p3', 'Mountain', 4), card('Talrand, Sky Summoner', 'p4', ['Legendary', 'Creature'], { pt: [2, 2], commander: true }), ...lands('p4', 'Island', 5, 2)];
  const players = [
    player('me', 'You', 38, [cmd.id], {
      top: top.id,
      topRevealed: true,
      mana: { total: 12, groups: [{ produces: ['G'], amount: 3, costly: 0 }, { produces: ['W'], amount: 3, costly: 0 }, { produces: ['W', 'U', 'B', 'R', 'G'], amount: 4, costly: 2 }, { produces: ['C'], amount: 2, costly: 0 }] },
    }),
    player('p2', 'Morgan', 31, [opp[3].id], { graveyard: [opp[2].id] }),
    player('p3', 'Riley', 17, [others[0].id], { commanderDamage: [] }),
    player('p4', 'Alex', 40, [others[5].id]),
  ];
  return base([...mine, ...opp, ...hand, ...others, top], players, {});
}

function combatScene(declaring = false): GameView {
  const cmd = card('Trostani, Selesnya\'s Voice', 'me', ['Legendary', 'Creature'], { zone: 'command', commander: true, cost: '{3}{G}{W}', colors: ['G', 'W'], pt: [2, 5], commanderTax: 0 });
  const wurm = card('Craw Wurm', 'p2', ['Creature'], { pt: [6, 4], kw: ['Trample'], colors: ['G'], tapped: true });
  const elf1 = card('Llanowar Elves', 'p2', ['Creature'], { pt: [1, 1], colors: ['G'], tapped: true });
  const elf2 = card('Llanowar Elves', 'p2', ['Creature'], { pt: [1, 1], colors: ['G'], tapped: true });
  const knight = card('Vampire Nighthawk', 'p2', ['Creature'], { pt: [2, 3], kw: ['Flying', 'Deathtouch', 'Lifelink'], colors: ['B'] });
  const serra = card('Serra Angel', 'me', ['Creature'], { kw: ['Flying', 'Vigilance'], pt: [4, 4], colors: ['W'] });
  const sigarda = card('Sigarda, Host of Herons', 'me', ['Legendary', 'Creature'], { kw: ['Flying', 'Hexproof'], pt: [5, 5], colors: ['G', 'W'] });
  const bears = card('Grizzly Bears', 'me', ['Creature'], { pt: [2, 2], colors: ['G'] });
  const mine = [serra, sigarda, bears, card('Sol Ring', 'me', ['Artifact']), card('Glorious Anthem', 'me', ['Enchantment']), ...lands('me', 'Forest', 5), ...lands('me', 'Plains', 2), cmd];
  const opp = [wurm, elf1, elf2, knight, card('Talrand, Sky Summoner', 'p2', ['Legendary', 'Creature'], { pt: [2, 2], commander: true }), ...lands('p2', 'Forest', 6, 4), card('Treasure', 'p2', ['Token', 'Artifact'], { token: true })];
  const players = [
    player('me', 'You', 38, [cmd.id], { mana: { total: 7, groups: [{ produces: ['G'], amount: 5, costly: 0 }, { produces: ['W'], amount: 2, costly: 0 }] } }),
    player('p2', 'Morgan', 31, [opp[4].id]),
    player('p3', 'Riley', 17, []),
  ];
  return base([...mine, ...opp], players, {
    activePlayer: 'p2',
    step: 'declareBlockers',
    priority: 'me',
    decision: declaring
      ? { id: 'd1', player: 'me', kind: 'declareBlockers', prompt: 'Declare blockers', blockers: [serra.id, sigarda.id, bears.id], attacking: [wurm.id, elf1.id, elf2.id, knight.id], handler: 'core:blocks' }
      : null,
    canPass: !declaring,
    combat: {
      attackers: [
        { id: wurm.id, defender: 'me', blockedBy: declaring ? [] : [serra.id], blocked: !declaring },
        { id: elf1.id, defender: 'me', blockedBy: declaring ? [] : [sigarda.id], blocked: !declaring },
        { id: elf2.id, defender: 'me', blockedBy: [], blocked: false },
        { id: knight.id, defender: 'me', blockedBy: [], blocked: false },
      ],
      blockersDeclared: !declaring,
      firstStrikeDone: false,
      dealtFirstStrike: [],
    },
  });
}

/** Every foil finish and a few frame treatments, laid out on one table. */
function foilScene(): GameView {
  const cmd = card('Atraxa, Praetors\' Voice', 'me', ['Legendary', 'Creature'], { zone: 'command', commander: true, cost: '{G}{W}{U}{B}', colors: ['G', 'W', 'U', 'B'], pt: [4, 4], foil: 'surge', treatments: ['Borderless'] });
  const looks: [string, string[], Parameters<typeof card>[3]][] = [
    ['Serra Angel', ['Creature'], { foil: 'foil', pt: [4, 4], kw: ['Flying'] }],
    ['Llanowar Elves', ['Creature'], { foil: 'etched', pt: [1, 1] }],
    ['Sakura-Tribe Elder', ['Creature'], { foil: 'galaxy', pt: [1, 1] }],
    ['Birds of Paradise', ['Creature'], { foil: 'halo', pt: [0, 1], kw: ['Flying'] }],
    ['Eternal Witness', ['Creature'], { foil: 'confetti', pt: [2, 1] }],
    ['Grizzly Bears', ['Creature'], { foil: 'textured', pt: [2, 2] }],
    ['Thragtusk', ['Creature'], { foil: 'oilslick', pt: [5, 3] }],
    ['Sol Ring', ['Artifact'], { foil: 'gilded' }],
    ['Arcane Signet', ['Artifact'], { foil: 'rainbow' }],
    ['Lightning Greaves', ['Artifact'], { foil: 'fracture' }],
    ['Swiftfoot Boots', ['Artifact'], { foil: 'ripple' }],
    ['Glorious Anthem', ['Enchantment'], { foil: 'raised' }],
    ['Rhystic Study', ['Enchantment'], { foil: 'neon' }],
  ];
  const mine = [...looks.map(([nm, types, o]) => card(nm, 'me', types, o)), ...lands('me', 'Forest', 4), ...lands('me', 'Plains', 3, 1), cmd];
  const opp = [card('Craw Wurm', 'p2', ['Creature'], { pt: [6, 4], foil: 'foil', treatments: ['Retro frame'] }), ...lands('p2', 'Island', 5)];
  const hand = [
    card('Swords to Plowshares', 'me', ['Card'], { zone: 'hand', foil: 'foil', treatments: ['Showcase'] }),
    card('Cultivate', 'me', ['Card'], { zone: 'hand', foil: 'etched' }),
    card('Path to Exile', 'me', ['Card'], { zone: 'hand', treatments: ['Extended art'] }),
    card('Forest', 'me', ['Card'], { zone: 'hand', foil: 'galaxy', treatments: ['Full art'] }),
  ];
  const players = [player('me', 'You', 40, [cmd.id]), player('p2', 'Morgan', 40, [])];
  return base([...mine, ...opp, ...hand], players, {});
}
