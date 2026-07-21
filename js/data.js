/* Helheim — game data: blessings, foe definitions, flavor text */
'use strict';

/* Keep in sync with the ?v=N cache tags in index.html when shipping. */
const GAME_VERSION = 'v15';

const BLESSINGS = [
  {
    id: 'fortitude', name: "Thor's Fortitude",
    desc: '+1 maximum heart.',
    stackable: true,
    canTake: p => p.maxHp < 8,
    apply: p => { p.maxHp += 1; p.hp += 1; },
  },
  {
    id: 'vigor', name: "Odin's Breath",
    desc: '+25 maximum vigor.',
    stackable: true,
    canTake: p => p.maxEnergy < 200,
    apply: p => { p.maxEnergy += 25; p.energy = Math.min(p.energy + 25, p.maxEnergy); },
  },
  {
    id: 'bloodlust', name: 'Bloodlust of Fenrir',
    desc: 'Kills restore 30 vigor (up from 15).',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'gungnir', name: "Gungnir's Reach",
    desc: 'Spear throw range +1.',
    stackable: true,
    canTake: p => p.throwRange < 4,
    apply: p => { p.throwRange += 1; },
  },
  {
    id: 'swiftarm', name: 'Swift Arm',
    desc: 'Shield bash recovers one turn faster.',
    stackable: true,
    canTake: p => p.bashMax > 2,
    apply: p => { p.bashMax -= 1; },
  },
  {
    id: 'sweeping', name: 'Sweeping Bash',
    desc: 'Your bash strikes every adjacent tile at once.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'boots', name: "Loki's Stride",
    desc: 'Leap distance +1.',
    stackable: true,
    canTake: p => p.leapBonus < 3,
    apply: p => { p.leapBonus += 1; },
  },
  {
    id: 'giantsarm', name: "Giant's Arm",
    desc: 'Your bash hurls foes one tile farther.',
    stackable: true,
    canTake: p => p.bashPush < 3,
    apply: p => { p.bashPush += 1; },
  },
  {
    id: 'follow', name: 'Bifrost Step',
    desc: 'New action: vanish and reappear where your spear lies.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'thunderfall', name: 'Thunderfall',
    desc: 'Your thrown spear stuns every foe adjacent to where it lands.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'shieldwall', name: 'Shield Wall',
    desc: 'Bashing raises your shield: the first wound that turn is blocked.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'valkyrie', name: "Valkyrie's Wind",
    desc: 'After a leap you may act once more — but never leap twice.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'battletrance', name: 'Battle Trance',
    desc: 'Kill on 3 consecutive turns to act twice (once per depth).',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'thorsdescent', name: "Thor's Descent",
    desc: 'Leap onto a foe to crush it outright — even Ancients.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'echostep', name: 'Echo Step',
    desc: 'Bashing springs you one tile back, away from your target.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'stagger', name: 'Thunderous Landing',
    desc: 'Leaping stuns all foes adjacent to where you land.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'deeplunge', name: 'Deep Lunge',
    desc: 'Your lunge pierces through to a second foe behind the first.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'swordlunge', name: 'Sword Lunge',
    desc: 'You can lunge with your sword even while your spear is thrown.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'recall', name: 'Runic Recall',
    desc: 'New action: call your thrown spear back to your hand.',
    stackable: false,
    apply: () => {},
  },
  {
    id: 'berserk', name: "Berserker's Reward",
    desc: 'Kill on 3 consecutive turns to restore 1 heart (once per depth).',
    stackable: false,
    apply: () => {},
  },
];

const MEND_OPTION = {
  id: 'mend', name: 'Mead of Idunn',
  desc: 'Restore all hearts.',
  apply: p => { p.hp = p.maxHp; },
};

const FALLBACK_OPTION = {
  id: 'surge', name: 'Battle Surge',
  desc: 'Refill vigor and ready your bash.',
  apply: p => { p.energy = p.maxEnergy; p.bashCd = 0; },
};

const FOES = {
  draugr: {
    name: 'Draugr', kind: 'melee',
    desc: 'Restless dead. Strikes any adjacent tile.',
    color: '#7da06b', dark: '#42583a',
  },
  archer: {
    name: 'Bone Archer', kind: 'archer',
    desc: 'Shoots along straight lines, 2–5 tiles. Cannot fire at adjacent foes.',
    minRange: 2, maxRange: 5,
    color: '#cfc6a8', dark: '#6e6852',
  },
  surtling: {
    name: 'Surtling', kind: 'bomber',
    desc: 'Fire-imp of Muspelheim. Lobs embers up to 3 tiles; they burst one turn later.',
    range: 3, chargesNeeded: 2,
    color: '#e8823a', dark: '#7a3a12',
  },
  volva: {
    name: 'Völva', kind: 'caster',
    desc: 'Death-seer. Sears a straight line up to 5 tiles whenever her staff glows; rests one turn after each blast.',
    minRange: 1, maxRange: 5,
    color: '#a67ad4', dark: '#4c3268',
  },
};

/* Spawn pool weights by depth. */
function foePool(depth) {
  const pool = [
    ['draugr', 10],
    ['archer', 2 + Math.min(depth, 8)],
  ];
  if (depth >= 3) pool.push(['surtling', 1 + Math.min(depth - 2, 6)]);
  if (depth >= 5) pool.push(['volva', 1 + Math.min(depth - 4, 6)]);
  return pool;
}

/* Depth names are rolled fresh each floor from viking word sets —
   occasionally grand, frequently a little silly. */
const DEPTH_ADJ = [
  'Frost-Bitten', 'Mead-Soaked', 'Wolf-Haunted', 'Ever-Burning', 'Thrice-Cursed',
  'Moss-Bearded', 'Skull-Paved', 'Whale-Boned', 'Rune-Scarred', 'Troll-Gnawed',
  'Ash-Choked', 'Salt-Crusted', 'Snoring', 'Half-Sunken', 'Elk-Trampled',
];
const DEPTH_PLACE = [
  'Halls', 'Warrens', 'Barrows', 'Mead-Hall', 'Kennels', 'Forge', 'Larder',
  'Bathhouse', 'Boneyard', 'Root-Cellar', 'Docks', 'Throne-Room', 'Crypt',
  'Sauna', 'Armory', 'Brewery',
];
const DEPTH_OWNER = [
  'of the Drowned King', 'of Broken Oaths', 'of the Angry Skald',
  'of a Thousand Sorrows', 'of the Sleeping Serpent', 'of Odin’s Lost Eye',
  'of the Grumpy Jarl', 'of Unwashed Berserkers', 'of the Pale Völva',
  'of Loki’s Debts', 'of Forgotten Mead', 'of the Last Longship',
  'of the Weeping Troll', 'of Nine Regrets', 'of the Bottomless Horn',
];

function rollDepthName() {
  const pickFrom = arr => arr[Math.floor(Math.random() * arr.length)];
  return `The ${pickFrom(DEPTH_ADJ)} ${pickFrom(DEPTH_PLACE)} ${pickFrom(DEPTH_OWNER)}`;
}

const KILL_WORDS = ['falls', 'crumbles', 'is cut down', 'is felled', 'shatters', 'is slain'];
