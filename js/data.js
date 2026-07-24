/* Helheim — game data: blessings, foe definitions, flavor text */
'use strict';

/* Keep in sync with the ?v=N cache tags in index.html when shipping. */
const GAME_VERSION = 'v22';

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
    desc: '+50 maximum vigor.',
    stackable: false,
    apply: p => { p.maxEnergy += 50; p.energy = Math.min(p.energy + 50, p.maxEnergy); },
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

/* Spawn pool weights by depth (v16 — gentler type ramp).
   Draugr is a flat anchor and archer freezes at weight 8 by depth 6, so the
   easy pair stays a constant 18: only the hard types' share grows, and only
   after their later intro depths (surtling 6, volva 9). This keeps the hard-
   type fraction monotonic with no dips, and the early floors pure melee/archer. */
function foePool(depth) {
  const pool = [
    ['draugr', 10],
    ['archer', 2 + Math.min(depth, 6)],
  ];
  if (depth >= 6) pool.push(['surtling', 1 + Math.min(Math.floor((depth - 6) / 2), 5)]);
  if (depth >= 9) pool.push(['volva', 1 + Math.min(Math.floor((depth - 9) / 2), 5)]);
  return pool;
}

/* Fixed depth names for depths 1–100 (a steady descent from the barrow-door
   toward the abyss). Past depth 100 the game just shows "Depth N". */
const DEPTH_NAMES = [
  'The Barrow Door', 'Roots of the World-Tree', 'The Whispering Halls',
  'The Mossgrown Stair', 'The Sunless Vestibule', 'The Ember Warrens',
  'Hall of the Fallen Oath', 'The Drowned Vaults', 'The Weeping Galleries',
  'The Ashen Deep',
  'Bridge of the Dead', 'The Frost-Bitten Gallery', 'Nidhogg’s Larder',
  'The Serpent’s Coil', 'Halls of the Nine Chains', 'The Black Mere',
  'The Sunken Longhouse', 'The Bone Orchard', 'The Rime-Locked Crypt',
  'The Hall of Broken Shields',
  'The Gnawing Dark', 'The Cinder Vaults', 'Grave of the Sea-Kings',
  'The Hollow Roots', 'The Screaming Passage', 'The River Gjöll',
  'The Echoing Deep', 'Garm’s Kennels', 'The Shrouded Steps',
  'The Marrow Halls',
  'The Frozen Wake', 'The Hall of Cold Iron', 'The Drowned Barrow',
  'The Wailing Vault', 'The Ember Bridge', 'The Serpent-Haunted Deep',
  'The Hall of Ash and Salt', 'The Sunless Forge', 'The Broken Longship',
  'The Cairn of Kings',
  'The Deepening Gloom', 'The Hall of Frost-Giants', 'The Charnel Steps',
  'The Whispering Roots', 'The Vault of Embers', 'The Muspel Threshold',
  'The Smouldering Halls', 'The Forge of Sindri', 'The Cinderways',
  'The Molten Vaults',
  'The Hall of Sparks', 'The Ash-Choked Deep', 'The Serpent’s Maw',
  'Jörmungandr’s Shadow', 'The Venom Galleries', 'The Coiled Dark',
  'The Hall of Slithering', 'The Fanged Passage', 'The Scaled Deep',
  'The Drowned Serpent-Hall',
  'The Ninth Descent', 'The Chained Vault', 'Fenrir’s Pit',
  'The Hall of Broken Fetters', 'The Howling Deep', 'The Marrow Throne',
  'The Bone Cathedral', 'The Grinning Halls', 'The Ossuary Deep',
  'The Hall of Ten Thousand Dead',
  'The Silent Barrows', 'The Hollow King’s Seat', 'The Grave-Cold Vault',
  'The Shade-Wreathed Halls', 'The Deep Without Stars', 'Hel’s Antechamber',
  'The Threshold of Éljúðnir', 'The Hall of Hunger', 'The Table of the Dead',
  'The Grey Sovereign’s Court',
  'The Fading Light', 'The Abyssal Stair', 'The Sunless Sea',
  'The Drowned Firmament', 'The Weight of the World', 'The Roots of Nothing',
  'The Last Ember', 'The Frost at the Bottom', 'The Hall Beyond Halls',
  'The Unlit Deep',
  'The Breathless Dark', 'The Hollow Beneath Hel', 'The Forgotten Descent',
  'The End of All Stairs', 'The Nameless Vault', 'The Deep That Answers Not',
  'The Final Barrow', 'The Mouth of the Void', 'The Threshold of Nothing',
  'The Bottom That Is Not',
];

/* Returns the fixed name for depths 1–100, or '' past that (shown as "Depth N"). */
function depthName(depth) {
  return (depth >= 1 && depth <= DEPTH_NAMES.length) ? DEPTH_NAMES[depth - 1] : '';
}

const KILL_WORDS = ['falls', 'crumbles', 'is cut down', 'is felled', 'shatters', 'is slain'];
