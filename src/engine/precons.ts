import { loadCards } from './cards';
import { deckToText, type DeckList } from './deck';
import { getDef } from './registry';
import { colorIdentity } from './state';
import type { Color } from './types';

export interface Precon {
  id: string;
  name: string;
  description: string;
  commander: string;
  nonbasics: string[];
}

const RAMP = ['Sol Ring', 'Arcane Signet', 'Mind Stone', "Commander's Sphere", "Wayfarer's Bauble"];

export const PRECONS: Precon[] = [
  {
    id: 'selesnya',
    name: "Trostani's Choir (GW tokens & life)",
    description: 'Go wide with tokens, gain life, and overrun the table.',
    commander: "Trostani, Selesnya's Voice",
    nonbasics: [
      'Command Tower', 'Selesnya Guildgate', 'Temple of Plenty', 'Evolving Wilds', 'Terramorphic Expanse', "Rogue's Passage",
      ...RAMP, 'Burnished Hart', 'Solemn Simulacrum', 'Lightning Greaves', 'Swiftfoot Boots', 'Skullclamp', 'Bonesplitter', "Pilgrim's Eye", 'Wurmcoil Engine',
      'Qasali Pridemage', 'Emmara, Soul of the Accord', 'Sigarda, Host of Herons', 'Armada Wurm',
      'Swords to Plowshares', 'Path to Exile', 'Disenchant', 'Raise the Alarm', 'Serra Angel', 'Soul Warden', 'Glorious Anthem',
      'Inspired Charge', 'Baneslayer Angel', 'Attended Knight', 'Midnight Haunting', 'Kor Skyfisher', "Ajani's Pridemate",
      'Seraph of Dawn', 'Oblivion Ring', 'Archangel of Thune', 'Pacifism', 'Thraben Inspector', 'Emeria Angel',
      'Captain of the Watch', 'Lone Missionary', 'Inspiring Overseer', 'Intangible Virtue', 'Selfless Spirit',
      'Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Rampant Growth', 'Cultivate', "Kodama's Reach", 'Harmonize',
      'Beast Within', 'Craterhoof Behemoth', 'Eternal Witness', 'Wood Elves', 'Elvish Visionary', "Garruk's Packleader",
      'Beast Whisperer', 'Thragtusk', 'Overrun', 'Avenger of Zendikar', 'Sakura-Tribe Elder', 'Pelakka Wurm', 'Llanowar Visionary',
    ],
  },
  {
    id: 'izzet',
    name: "Adeliz's Spellstorm (UR spells)",
    description: 'Chain instants and sorceries to pump your Wizards and burn opponents out.',
    commander: 'Adeliz, the Cinder Wind',
    nonbasics: [
      'Command Tower', 'Izzet Guildgate', 'Temple of Epiphany', 'Evolving Wilds', 'Terramorphic Expanse', 'Reliquary Tower',
      ...RAMP, 'Thought Vessel', 'Lightning Greaves', 'Swiftfoot Boots', 'Hedron Archive', 'Solemn Simulacrum', 'Darksteel Ingot',
      "Pilgrim's Eye", 'Burnished Hart',
      'Sage of the Inward Eye', 'Crackling Drake', 'Wee Dragonauts', 'Enigma Drake',
      'Counterspell', 'Negate', 'Essence Scatter', 'Dissolve', 'Brainstorm', 'Preordain', 'Opt', 'Divination', 'Concentrate',
      'Unsummon', 'Repulse', 'Air Elemental', "Man-o'-War", 'Mulldrifter', 'Cloudkin Seer', 'Talrand, Sky Summoner',
      'Merfolk Looter', 'Frost Breath', 'Archaeomancer', 'Augur of Bolas', 'Spectral Sailor', 'Impulse', 'Exclude',
      'Ghostly Flicker', 'Tidings', 'Phantom Warrior', 'Sphinx of Jwar Isle',
      'Lightning Bolt', 'Shock', 'Lightning Strike', 'Blaze', 'Pyroclasm', 'Monastery Swiftspear', 'Young Pyromancer',
      'Guttersnipe', 'Searing Spear', 'Magma Jet', 'Flametongue Kavu', 'Fire Imp', 'Furnace Whelp', 'Act of Treason',
      'Thundermaw Hellkite', 'Shatter', 'Wheel of Fortune', 'Shivan Dragon', 'Ember Hauler',
    ],
  },
  {
    id: 'golgari',
    name: "Izoni's Brood (BG graveyard)",
    description: 'Fill your graveyard, recur threats, and grind opponents down.',
    commander: 'Izoni, Thousand-Eyed',
    nonbasics: [
      'Command Tower', 'Golgari Guildgate', 'Temple of Malady', 'Evolving Wilds', 'Terramorphic Expanse',
      ...RAMP, 'Burnished Hart', 'Solemn Simulacrum', 'Skullclamp', 'Lightning Greaves', 'Wurmcoil Engine', 'Meteor Golem',
      'Putrefy', "Assassin's Trophy", 'Abrupt Decay', 'Golgari Findbroker', 'Maelstrom Pulse',
      'Murder', 'Doom Blade', 'Go for the Throat', "Night's Whisper", 'Sign in Blood', 'Read the Bones', 'Demonic Tutor',
      'Raise Dead', 'Reanimate', 'Gravedigger', 'Vampire Nighthawk', 'Zulaport Cutthroat', 'Viscera Seer', 'Diregraf Ghoul',
      'Gray Merchant of Asphodel', 'Phyrexian Arena', 'Fleshbag Marauder', 'Ravenous Chupacabra', 'Grave Titan',
      'Vampiric Tutor', 'Bitterblossom', 'Cast Down', 'Hypnotic Specter', 'Skinrender', 'Nantuko Husk', 'Butcher of Malakir',
      'Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Rampant Growth', 'Cultivate', "Kodama's Reach", 'Harmonize',
      'Beast Within', 'Eternal Witness', 'Wood Elves', 'Sakura-Tribe Elder', 'Acidic Slime', 'Thragtusk', 'Prey Upon',
      "Nature's Lore", 'Three Visits', 'Leatherback Baloth', 'Pelakka Wurm', 'Elvish Visionary',
    ],
  },
  {
    id: 'boros',
    name: "Tajic's Legion (RW aggro)",
    description: 'Flood the board with Soldiers and Goblins and swing every turn.',
    commander: "Tajic, Legion's Edge",
    nonbasics: [
      'Command Tower', 'Boros Guildgate', 'Temple of Triumph', 'Evolving Wilds', 'Terramorphic Expanse', "Rogue's Passage",
      ...RAMP, 'Lightning Greaves', 'Swiftfoot Boots', 'Skullclamp', 'Bonesplitter', 'Darksteel Ingot', "Pilgrim's Eye", 'Burnished Hart',
      'Lightning Helix', 'Assemble the Legion', 'Swiftblade Vindicator', 'Boros Swiftblade',
      'Swords to Plowshares', 'Path to Exile', 'Disenchant', 'Raise the Alarm', 'Serra Angel', 'Savannah Lions', 'Elite Vanguard',
      'Glorious Anthem', 'Inspired Charge', 'Baneslayer Angel', 'Attended Knight', 'Midnight Haunting', 'Kor Skyfisher',
      'Seraph of Dawn', 'Smite the Monstrous', 'Oblivion Ring', 'Divine Verdict', 'Condemn', 'Thraben Inspector',
      'Captain of the Watch', 'Intangible Virtue', 'Selfless Spirit', 'Sunblast Angel',
      'Lightning Bolt', 'Shock', 'Lightning Strike', 'Searing Spear', 'Monastery Swiftspear', 'Goblin Bombardment', 'Hellrider',
      'Goblin Instigator', "Krenko's Command", 'Hordeling Outburst', 'Thundermaw Hellkite', 'Raging Goblin', 'Ember Hauler',
      'Act of Treason', 'Flametongue Kavu', 'Goblin Chieftain', 'Goblin Matron', 'Shivan Dragon', 'Furnace Whelp', 'Magma Jet',
      'Shatter', 'Fire Imp',
    ],
  },
  {
    id: 'rakdos',
    name: "Judith's Carnival (BR sacrifice)",
    description: 'Sacrifice your own creatures for value: every death pings, drains and fuels the show.',
    commander: 'Judith, the Scourge Diva',
    nonbasics: [
      'Command Tower', 'Rakdos Guildgate', 'Temple of Malice', 'Evolving Wilds', 'Terramorphic Expanse', "Rogue's Passage",
      ...RAMP, 'Skullclamp', 'Lightning Greaves', 'Swiftfoot Boots', 'Burnished Hart', 'Solemn Simulacrum', 'Wurmcoil Engine',
      'Blood Artist', 'Falkenrath Noble', 'Mogg Fanatic', 'Goblin Arsonist', 'Terminate', 'Blightning', 'Bastion of Remembrance',
      'Pitiless Plunderer', 'Dictate of Erebos', 'Vindictive Vampire', 'Bloodthrone Vampire', "Kolaghan's Command", 'Bake into a Pie',
      'Murder', 'Doom Blade', 'Go for the Throat', 'Cast Down', "Night's Whisper", 'Sign in Blood', 'Read the Bones', 'Demonic Tutor',
      'Raise Dead', 'Reanimate', 'Gravedigger', 'Zulaport Cutthroat', 'Viscera Seer', 'Gray Merchant of Asphodel', 'Phyrexian Arena',
      'Bitterblossom', 'Fleshbag Marauder', 'Ravenous Chupacabra', 'Grave Titan', 'Butcher of Malakir', 'Nantuko Husk',
      'Lightning Bolt', 'Shock', 'Goblin Bombardment', "Krenko's Command", 'Hordeling Outburst', 'Young Pyromancer', 'Goblin Instigator',
      'Act of Treason', 'Flametongue Kavu', 'Fire Imp', 'Thundermaw Hellkite', 'Ember Hauler', 'Hellrider', 'Goblin Chieftain',
      'Shivan Dragon', 'Raging Goblin',
    ],
  },
  {
    id: 'simic',
    name: "Tatyova's Tide (GU lands)",
    description: 'Play extra lands, draw a card for every one, and drop huge threats.',
    commander: 'Tatyova, Benthic Druid',
    nonbasics: [
      'Command Tower', 'Simic Guildgate', 'Temple of Mystery', 'Evolving Wilds', 'Terramorphic Expanse', 'Reliquary Tower',
      ...RAMP, 'Lightning Greaves', 'Swiftfoot Boots', 'Burnished Hart', 'Solemn Simulacrum', "Pilgrim's Eye",
      'Growth Spiral', 'Lotus Cobra', 'Rampaging Baloths', 'Grazing Gladehart', 'Azusa, Lost but Seeking', 'Coiling Oracle',
      "Kiora's Follower", 'Prime Speaker Zegana', 'Mystic Snake', 'Skyshroud Claim',
      'Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Rampant Growth', 'Cultivate', "Kodama's Reach", 'Explosive Vegetation',
      "Nature's Lore", 'Three Visits', 'Harmonize', 'Beast Within', 'Eternal Witness', 'Wood Elves', 'Sakura-Tribe Elder',
      'Avenger of Zendikar', 'Thragtusk', 'Leatherback Baloth', 'Pelakka Wurm', 'Acidic Slime', "Garruk's Packleader", 'Beast Whisperer',
      'Llanowar Visionary', 'Craw Wurm', 'Elvish Visionary',
      'Counterspell', 'Negate', 'Essence Scatter', 'Brainstorm', 'Preordain', 'Opt', 'Divination', 'Mulldrifter', "Man-o'-War",
      'Cloudkin Seer', 'Air Elemental', 'Sphinx of Jwar Isle', 'Repulse', 'Unsummon', 'Frost Breath', 'Augur of Bolas', 'Merfolk Looter',
    ],
  },
  {
    id: 'azorius',
    name: "Brago's Court (WU blink)",
    description: 'Flicker your creatures to reuse what they do when they enter, and control the table.',
    commander: 'Brago, King Eternal',
    nonbasics: [
      'Command Tower', 'Azorius Guildgate', 'Temple of Enlightenment', 'Evolving Wilds', 'Terramorphic Expanse', "Rogue's Passage",
      ...RAMP, 'Lightning Greaves', 'Swiftfoot Boots', 'Burnished Hart', 'Solemn Simulacrum', "Pilgrim's Eye", 'Wurmcoil Engine', "Conjurer's Closet",
      'Cloudblazer', 'Absorb', 'Fiend Hunter', 'Banisher Priest', 'Wall of Omens', 'Cloudshift', 'Momentary Blink', 'Restoration Angel',
      'Swords to Plowshares', 'Path to Exile', 'Wrath of God', 'Oblivion Ring', 'Pacifism', 'Disenchant', 'Serra Angel', 'Baneslayer Angel',
      'Seraph of Dawn', 'Kor Skyfisher', 'Thraben Inspector', 'Inspiring Overseer', 'Lone Missionary', 'Attended Knight', 'Captain of the Watch',
      'Sunblast Angel', 'Selfless Spirit', 'Archangel of Thune', 'Condemn', 'Raise the Alarm',
      'Counterspell', 'Negate', 'Essence Scatter', 'Dissolve', 'Brainstorm', 'Preordain', 'Opt', 'Mulldrifter', "Man-o'-War", 'Cloudkin Seer',
      'Archaeomancer', 'Augur of Bolas', 'Spectral Sailor', 'Air Elemental', 'Sphinx of Jwar Isle', 'Ghostly Flicker', 'Repulse',
      'Phantom Warrior', 'Frost Breath', 'Concentrate', 'Divination',
    ],
  },
  {
    id: 'orzhov',
    name: "Elenda's Crypt (WB drain)",
    description: 'Drain the table a point at a time while Elenda grows with every death.',
    commander: 'Elenda, the Dusk Rose',
    nonbasics: [
      'Command Tower', 'Orzhov Guildgate', 'Temple of Silence', 'Evolving Wilds', 'Terramorphic Expanse', "Rogue's Passage",
      ...RAMP, 'Skullclamp', 'Lightning Greaves', 'Swiftfoot Boots', 'Burnished Hart', 'Solemn Simulacrum', 'Wurmcoil Engine',
      'Vindicate', 'Anguished Unmaking', 'Mortify', 'Sanguine Bond', 'Debt to the Deathless', 'Lingering Souls', "Sorin's Thirst",
      'Blood Artist', 'Falkenrath Noble', 'Bastion of Remembrance', 'Vindictive Vampire', 'Fiend Hunter', 'Banisher Priest',
      'Swords to Plowshares', 'Path to Exile', 'Wrath of God', 'Day of Judgment', 'Oblivion Ring', 'Soul Warden', "Ajani's Pridemate",
      'Lone Missionary', 'Serra Angel', 'Seraph of Dawn', 'Baneslayer Angel', 'Archangel of Thune', 'Raise the Alarm', 'Midnight Haunting',
      'Intangible Virtue', 'Glorious Anthem', 'Captain of the Watch', 'Inspiring Overseer',
      'Murder', 'Doom Blade', 'Go for the Throat', "Night's Whisper", 'Sign in Blood', 'Read the Bones', 'Demonic Tutor', 'Gravedigger',
      'Raise Dead', 'Zulaport Cutthroat', 'Viscera Seer', 'Gray Merchant of Asphodel', 'Vampire Nighthawk', 'Exsanguinate',
      'Butcher of Malakir', 'Phyrexian Arena', 'Bitterblossom', 'Grave Titan', 'Ravenous Chupacabra',
    ],
  },
];

const BASIC_FOR: Record<Color, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/** Build a legal 100-card deck: the listed nonbasics plus basics split across the commander's colors. */
export function buildPrecon(id: string): DeckList {
  loadCards();
  const p = PRECONS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown precon ${id}`);
  const colors = colorIdentity(getDef(p.commander));
  const cards = [...p.nonbasics];
  const basics = 99 - cards.length;
  if (basics < 0) throw new Error(`${p.name} has too many cards`);
  for (let i = 0; i < basics; i++) cards.push(BASIC_FOR[colors[i % colors.length]]);
  return { commanders: [p.commander], cards };
}

export function preconText(id: string): string {
  return deckToText(buildPrecon(id));
}
