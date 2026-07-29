/* Helheim — game data: blessings, foe definitions, flavor text */
'use strict';

/* Keep in sync with the ?v=N cache tags in index.html when shipping. */
const GAME_VERSION = 'v31';

const BLESSINGS = [
  {
    id: 'fortitude', name: "Thor's Fortitude",
    desc: '+1 maximum heart (up to 5×).',
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
    desc: 'Spear throw range +1 (up to 2×).',
    stackable: true,
    canTake: p => p.throwRange < 4,
    apply: p => { p.throwRange += 1; },
  },
  {
    id: 'swiftarm', name: 'Swift Arm',
    desc: 'Shield bash recovers one turn faster (up to 2×).',
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
    desc: 'Leap distance +1 (up to 2×).',
    stackable: true,
    canTake: p => p.leapBonus < 2,
    apply: p => { p.leapBonus += 1; },
  },
  {
    id: 'quickleap', name: "Sleipnir's Grace",
    desc: 'Your leap recovers a turn faster (cooldown 1).',
    stackable: false,
    canTake: p => p.leapMax > 1,
    apply: p => { p.leapMax = 1; },
  },
  {
    id: 'giantsarm', name: "Giant's Arm",
    desc: 'Your bash hurls foes one tile farther (up to 2×).',
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

/* ================= difficulty: a points budget spent on foes =================
   Each depth gets a pool of points; foes are "bought" from it by cost:
     draugr 1, archer 2, surtling 3, völva 4  (an Ancient/elite adds +2).
   Pool grows +2 per depth from a base of 3, and stops growing after depth 100.
     depth 1 = 3, depth 2 = 5, depth 10 = 21, depth 25 = 51, depth 100 = 201. */

const FOE_OPTIONS = [
  { type: 'draugr',   elite: false, cost: 1 },
  { type: 'archer',   elite: false, cost: 2 },
  { type: 'surtling', elite: false, cost: 3 },
  { type: 'volva',    elite: false, cost: 4 },
  { type: 'draugr',   elite: true,  cost: 3 },
  { type: 'archer',   elite: true,  cost: 4 },
  { type: 'surtling', elite: true,  cost: 5 },
  { type: 'volva',    elite: true,  cost: 6 },
];

function pointPool(depth) {
  return 2 * (Math.min(depth, 100) - 1) + 3;
}

/* How many foes we'll allow on the board at a given depth (space permitting).
   Grows slowly and plateaus, so a big budget buys tougher foes, not just more. */
function foeCap(depth) {
  return Math.min(20, 5 + Math.floor(depth / 3));
}

/* Spend the depth's point pool on foes, capped at `capacity` bodies.
   Each pick is weighted toward the budget's "cost per remaining slot", so early
   floors buy cheap swarms and deep floors buy expensive Ancients — with variety. */
function rollFoeComposition(depth, capacity) {
  let budget = pointPool(depth);
  const foes = [];
  while (budget >= 1 && foes.length < capacity) {
    const target = budget / (capacity - foes.length); // ideal cost per remaining foe
    const affordable = FOE_OPTIONS.filter(o => o.cost <= budget);
    let total = 0;
    const weights = affordable.map(o => {
      const w = Math.exp(-Math.abs(o.cost - target) / 2); // bell curve around the target cost
      total += w;
      return w;
    });
    let r = Math.random() * total, idx = 0;
    for (; idx < affordable.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
    const pick = affordable[idx];
    foes.push({ type: pick.type, elite: pick.elite });
    budget -= pick.cost;
  }
  if (!foes.length) foes.push({ type: 'draugr', elite: false });
  return foes;
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
