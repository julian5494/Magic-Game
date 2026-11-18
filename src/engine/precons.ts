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
