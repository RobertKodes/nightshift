/**
 * LASTSPAWN game data: classes, abilities, mobs, NPCs, quests and items. The server runs the rules from
 * these tables; the client shows them. Numbers are for Chapter One (levels 1-10).
 */
export type ClassId = "reedguard" | "dartsinger" | "lampwright";
export const CLASSES: Record<ClassId, { name: string; role: string; hp: number; hpPerLevel: number; weapon: string; abilities: string[]; blurb: string }> = {
  reedguard: {
    name: "Reedguard", role: "Tank · melee", hp: 120, hpPerLevel: 18, weapon: "glaive",
    abilities: ["thrust", "sweep", "shell_wall", "challenge_croak", "leap_slam"],
    blurb: "A reed glaive and a shield cut from an old turtle shell. Stands where the water is deepest.",
  },
  dartsinger: {
    name: "Dartsinger", role: "Ranged damage", hp: 90, hpPerLevel: 13, weapon: "blowgun",
    abilities: ["dart", "venom_dart", "pinning_dart", "reedfade", "toxic_bloom"],
    blurb: "Sweats poison from bright skin and sings it down a blowgun. Never where you look for them.",
  },
  lampwright: {
    name: "Lampwright", role: "Caster · healer", hp: 95, hpPerLevel: 14, weapon: "lantern",
    abilities: ["kindle", "mending_glow", "spark_swarm", "lantern_ward"],
    blurb: "Keeps a lantern of fireflies that burns, mends and shields. The town's oldest trade.",
  },
};
/** Every frog has these two, whatever the class. */
export const COMMON_ABILITIES = ["tongue", "leap"] as const;

export type TargetRule = "enemy" | "friend" | "self" | "ground";
export interface Ability {
  id: string; name: string; desc: string;
  target: TargetRule;
  /** world units; 0 for self */
  range: number;
  castMs: number; cooldownMs: number;
  /** triggers the global cooldown */
  gcd: boolean;
  /** direct damage or healing at level 1, and per level after */
  amount?: [number, number]; perLevel?: number;
  /** an area around the target (or self) */
  radius?: number;
  /** an aura it puts on: damage or healing per second, absorb, damage taken, speed, root, taunt, stealth */
  aura?: { id: string; ms: number; dps?: number; absorb?: number; taken?: number; speed?: number; root?: boolean; taunt?: boolean; stealth?: boolean };
  /** threat multiplier for tanking */
  threat?: number;
  /** the animation the frog plays */
  anim: string;
}
export const GCD_MS = 1000;

export const ABILITIES: Record<string, Ability> = {
  tongue: { id: "tongue", name: "Tongue", desc: "Snap your tongue out. A light enemy is pulled to you; a heavy one pulls you to it. Flips a snapper on its back.", target: "enemy", range: 9, castMs: 0, cooldownMs: 8000, gcd: true, amount: [3, 5], perLevel: 0.6, anim: "Throw" },
  leap: { id: "leap", name: "Leap", desc: "Jump six strides the way you face. Dodges what you jump out of.", target: "self", range: 0, castMs: 0, cooldownMs: 4000, gcd: false, anim: "Dodge_Forward" },

  thrust: { id: "thrust", name: "Thrust", desc: "A straight glaive thrust.", target: "enemy", range: 3.4, castMs: 0, cooldownMs: 0, gcd: true, amount: [8, 11], perLevel: 1.6, threat: 1.5, anim: "2H_Melee_Attack_Stab" },
  sweep: { id: "sweep", name: "Sweep", desc: "Swing the glaive through everything around you.", target: "self", range: 0, radius: 3.6, castMs: 0, cooldownMs: 8000, gcd: true, amount: [7, 9], perLevel: 1.2, threat: 1.8, anim: "2H_Melee_Attack_Spin" },
  shell_wall: { id: "shell_wall", name: "Shell Wall", desc: "Brace behind the shell: half the damage for six seconds.", target: "self", range: 0, castMs: 0, cooldownMs: 20000, gcd: false, aura: { id: "shell_wall", ms: 6000, taken: 0.5 }, anim: "Block" },
  challenge_croak: { id: "challenge_croak", name: "Challenge Croak", desc: "A croak no enemy can ignore: it attacks you for four seconds.", target: "enemy", range: 14, castMs: 0, cooldownMs: 10000, gcd: true, aura: { id: "taunt", ms: 4000, taunt: true }, threat: 3, anim: "Cheer" },
  leap_slam: { id: "leap_slam", name: "Leap Slam", desc: "Leap onto an enemy and slam the ground around it.", target: "enemy", range: 12, radius: 4, castMs: 0, cooldownMs: 15000, gcd: true, amount: [10, 14], perLevel: 1.8, threat: 2, anim: "Jump_Full_Short" },

  dart: { id: "dart", name: "Dart", desc: "A plain dart, quick and true.", target: "enemy", range: 24, castMs: 0, cooldownMs: 0, gcd: true, amount: [6, 9], perLevel: 1.3, anim: "1H_Ranged_Shoot" },
  venom_dart: { id: "venom_dart", name: "Venom Dart", desc: "Poison from your own skin: it burns for twelve seconds.", target: "enemy", range: 24, castMs: 0, cooldownMs: 6000, gcd: true, amount: [3, 4], perLevel: 0.5, aura: { id: "venom", ms: 12000, dps: 2.2 }, anim: "1H_Ranged_Shoot" },
  pinning_dart: { id: "pinning_dart", name: "Pinning Dart", desc: "Pins an enemy to the ground for four seconds.", target: "enemy", range: 24, castMs: 0, cooldownMs: 14000, gcd: true, amount: [4, 6], perLevel: 0.8, aura: { id: "pinned", ms: 4000, root: true }, anim: "1H_Ranged_Shoot" },
  reedfade: { id: "reedfade", name: "Reedfade", desc: "Fade into the reeds for ten seconds. Attacking, or a midge cloud, shows you.", target: "self", range: 0, castMs: 0, cooldownMs: 30000, gcd: false, aura: { id: "reedfade", ms: 10000, stealth: true, speed: 0.8 }, anim: "Sit_Floor_Down" },
  toxic_bloom: { id: "toxic_bloom", name: "Toxic Bloom", desc: "A cloud of poison around your target that slows what it touches.", target: "enemy", range: 24, radius: 5, castMs: 600, cooldownMs: 18000, gcd: true, amount: [12, 16], perLevel: 1.6, aura: { id: "bloom_slow", ms: 5000, speed: 0.6 }, anim: "Throw" },

  kindle: { id: "kindle", name: "Kindle", desc: "Loose a firefly that bursts into flame.", target: "enemy", range: 26, castMs: 1500, cooldownMs: 0, gcd: true, amount: [10, 14], perLevel: 2, anim: "Spellcast_Shoot" },
  mending_glow: { id: "mending_glow", name: "Mending Glow", desc: "Warm light that closes wounds.", target: "friend", range: 26, castMs: 1800, cooldownMs: 0, gcd: true, amount: [18, 24], perLevel: 2.6, anim: "Spellcast_Long" },
  spark_swarm: { id: "spark_swarm", name: "Spark Swarm", desc: "A swarm of sparks around the target that keeps burning.", target: "enemy", range: 26, radius: 5, castMs: 1000, cooldownMs: 12000, gcd: true, amount: [8, 11], perLevel: 1.4, aura: { id: "burn", ms: 6000, dps: 1.5 }, anim: "Spellcast_Raise" },
  lantern_ward: { id: "lantern_ward", name: "Lantern Ward", desc: "A shell of light that soaks up damage for ten seconds.", target: "friend", range: 26, castMs: 0, cooldownMs: 18000, gcd: true, aura: { id: "ward", ms: 10000, absorb: 25 }, anim: "Spellcasting" },
};

export interface MobDef {
  id: string; name: string; level: [number, number]; hp: number; hpPerLevel: number;
  /** melee: damage per swing, seconds between swings, reach */
  dmg: [number, number]; swingMs: number; reach: number;
  speed: number; aggro: number; leash: number; respawnMs: number; xp: number;
  /** light: the tongue pulls it; heavy: it anchors you; immune: not a body */
  weight: "light" | "heavy" | "immune";
  /** what it does that others don't */
  trait?: "latch" | "swarm" | "pack_flee" | "armored_front";
  loot: { item: string; chance: number; n?: [number, number] }[];
}
export const MOBS: Record<string, MobDef> = {
  bog_leech: { id: "bog_leech", name: "Bog Leech", level: [1, 2], hp: 32, hpPerLevel: 8, dmg: [2, 4], swingMs: 2200, reach: 2.2, speed: 2.2, aggro: 5.5, leash: 30, respawnMs: 25000, xp: 22, weight: "light", trait: "latch", loot: [{ item: "leech_tooth", chance: 0.6 }, { item: "egg_jelly", chance: 0.35 }, { item: "leech_hide_wraps", chance: 0.1 }] },
  midge_swarm: { id: "midge_swarm", name: "Midge Swarm", level: [2, 3], hp: 26, hpPerLevel: 6, dmg: [2, 3], swingMs: 1000, reach: 3, speed: 4, aggro: 7, leash: 26, respawnMs: 30000, xp: 18, weight: "immune", trait: "swarm", loot: [] },
  reed_rat: { id: "reed_rat", name: "Reed Rat", level: [2, 3], hp: 46, hpPerLevel: 10, dmg: [4, 6], swingMs: 1600, reach: 2.4, speed: 5.2, aggro: 11, leash: 34, respawnMs: 35000, xp: 28, weight: "light", trait: "pack_flee", loot: [{ item: "rat_tail", chance: 0.5 }, { item: "glow_moss", chance: 0.2 }] },
  snapper: { id: "snapper", name: "Snapper", level: [3, 4], hp: 120, hpPerLevel: 22, dmg: [8, 12], swingMs: 2600, reach: 2.8, speed: 2, aggro: 8, leash: 28, respawnMs: 60000, xp: 60, weight: "heavy", trait: "armored_front", loot: [{ item: "shell_shard", chance: 0.7, n: [1, 2] }] },
};

/** Where a piece of gear is worn. */
export const SLOTS = ["main", "off", "head", "shoulders", "chest", "hands", "waist", "feet"] as const;
export type Slot = (typeof SLOTS)[number];
export type Equip = Partial<Record<Slot, string>>;
export interface ItemDef {
  id: string; name: string; kind: "quest" | "junk" | "consumable" | "gear"; desc: string; sell?: number; heal?: number;
  /** gear: where it goes, what it gives (armour cuts damage taken, power adds to damage and healing), who may wear it */
  slot?: Slot; armor?: number; power?: number; cls?: ClassId[]; level?: number;
  /** the piece the client draws on the frog */
  model?: string;
}
export const ITEMS: Record<string, ItemDef> = {
  egg_jelly: { id: "egg_jelly", name: "Egg Jelly", kind: "quest", desc: "Spent jelly from your own clutch. The leeches have been following it." },
  leech_tooth: { id: "leech_tooth", name: "Leech Tooth", kind: "junk", desc: "Three-sided and still sharp.", sell: 2 },
  rat_tail: { id: "rat_tail", name: "Rat Tail", kind: "junk", desc: "The mill buys them for string.", sell: 3 },
  shell_shard: { id: "shell_shard", name: "Shell Shard", kind: "junk", desc: "A piece of snapper shell. Reedguards cut shields from these.", sell: 6 },
  glow_moss: { id: "glow_moss", name: "Glow Moss", kind: "consumable", desc: "Eat it: it mends 30 health over a few breaths.", heal: 30 },

  // ---------- gear: what each class comes up out of the water with ----------
  reed_glaive: { id: "reed_glaive", name: "Reed Glaive", kind: "gear", slot: "main", power: 4, cls: ["reedguard"], model: "glaive", desc: "A fen reed as long as two frogs, a bone blade bound on with red cord." },
  shell_shield: { id: "shell_shield", name: "Shell Shield", kind: "gear", slot: "off", armor: 12, cls: ["reedguard"], model: "shield", desc: "The back of a turtle that died before the Long Night. Wend kept it oiled." },
  shell_vest: { id: "shell_vest", name: "Shell Vest", kind: "gear", slot: "chest", armor: 10, cls: ["reedguard"], model: "shell_vest", desc: "Plates of shell laced over the chest and belly." },
  reed_bracers: { id: "reed_bracers", name: "Reed Bracers", kind: "gear", slot: "hands", armor: 3, model: "reed_bracers", desc: "Split reed, woven tight round the forearms." },
  reed_blowgun: { id: "reed_blowgun", name: "Reed Blowgun", kind: "gear", slot: "main", power: 5, cls: ["dartsinger"], model: "blowgun", desc: "A hollow reed, carved at the mouth, wrapped where the hands go." },
  leaf_hood: { id: "leaf_hood", name: "Leaf Hood", kind: "gear", slot: "head", armor: 3, cls: ["dartsinger"], model: "leaf_hood", desc: "Dried water-leaf stitched into a cowl. It smells of the Cut." },
  dart_harness: { id: "dart_harness", name: "Dart Harness", kind: "gear", slot: "chest", armor: 5, cls: ["dartsinger"], model: "dart_harness", desc: "Leather straps across the chest, a row of darts in each." },
  wrap_boots: { id: "wrap_boots", name: "Wrapped Feet", kind: "gear", slot: "feet", armor: 2, model: "wrap_boots", desc: "Strips of cloth wound round the feet. Quiet on boards." },
  firefly_lantern: { id: "firefly_lantern", name: "Firefly Lantern", kind: "gear", slot: "off", power: 6, cls: ["lampwright"], model: "lantern", desc: "An iron cage, a glass, and the fireflies that agreed to stay." },
  tallow_hood: { id: "tallow_hood", name: "Lamplighter's Hood", kind: "gear", slot: "head", armor: 2, cls: ["lampwright"], model: "tallow_hood", desc: "Waxed against the drip of the stair. The old guild's cut." },
  moth_mantle: { id: "moth_mantle", name: "Moth Mantle", kind: "gear", slot: "shoulders", armor: 4, cls: ["lampwright"], model: "moth_mantle", desc: "A short cape of grey moth-silk, warm in the cold of the night." },
  keeper_sash: { id: "keeper_sash", name: "Keeper's Sash", kind: "gear", slot: "waist", armor: 2, model: "keeper_sash", desc: "A cord sash with a brass ring for keys nobody uses any more." },
  // found and earned in Chapter One
  leech_hide_wraps: { id: "leech_hide_wraps", name: "Leech-Hide Wraps", kind: "gear", slot: "hands", armor: 4, level: 1, model: "leech_wraps", desc: "Tough, rubbery, and better not thought about.", sell: 4 },
  wend_cloak: { id: "wend_cloak", name: "Wend's Old Cloak", kind: "gear", slot: "shoulders", armor: 5, power: 2, level: 1, model: "wend_cloak", desc: "He wore it up the stair for forty-one years. It still smells of lamp oil." },
};

/** What each class wears when it first comes up out of the water. */
export const STARTER_GEAR: Record<ClassId, string[]> = {
  reedguard: ["reed_glaive", "shell_shield", "shell_vest", "reed_bracers"],
  dartsinger: ["reed_blowgun", "leaf_hood", "dart_harness", "wrap_boots"],
  lampwright: ["firefly_lantern", "tallow_hood", "moth_mantle", "keeper_sash"],
};
/** Armour cuts damage taken by armour / (armour + 60); power adds power % to damage and healing done. */
export const ARMOR_K = 60;

export interface NpcDef { id: string; name: string; title?: string; look: string; anim?: string; dialog: string }
export const NPCS: Record<string, NpcDef> = {
  keeper_wend: { id: "keeper_wend", name: "Keeper Wend", title: "Keeper of the Light", look: "", anim: "Sit_Chair_Idle", dialog: "wend" },
  brother_cress: { id: "brother_cress", name: "Brother Cress", title: "Keeper of the Register", look: "", dialog: "cress" },
};

export interface QuestDef {
  id: string; name: string; giver: string; turnIn: string; level: number;
  steps: { text: string; kind: "kill" | "collect" | "talk" | "reach"; target: string; n: number }[];
  offer: string; done: string; xp: number; reward?: { item: string; n: number }[];
  next?: string;
}
export const QUESTS: Record<string, QuestDef> = {
  first_breath: {
    id: "first_breath", name: "First Breath", giver: "keeper_wend", turnIn: "keeper_wend", level: 1,
    offer: "You're breathing. Good. Keep doing that. The leeches came down the drain the moment the water moved; they can smell you. Three of them, by the pump. I'd do it myself, but I'm a hundred and nine.",
    steps: [{ text: "Kill the bog leeches by the pump", kind: "kill", target: "bog_leech", n: 3 }],
    done: "Three. I counted. I count everything now; you will forgive an old frog that. Here: moss. Eat it when it hurts.",
    xp: 80, reward: [{ item: "glow_moss", n: 2 }], next: "the_jelly",
  },
  the_jelly: {
    id: "the_jelly", name: "What They Follow", giver: "keeper_wend", turnIn: "keeper_wend", level: 1,
    offer: "Your old jelly, the stuff you hatched out of. It's what they follow. Some went down the drain with the first water. Bring it back before something with longer legs finds it.",
    steps: [{ text: "Recover egg jelly from the leeches", kind: "collect", target: "egg_jelly", n: 3 }],
    done: "That's the last of it. Now there's nothing in the drains that says a child was born here. Except you.",
    xp: 110, reward: [{ item: "wend_cloak", n: 1 }], next: "up_the_stairs",
  },
  up_the_stairs: {
    id: "up_the_stairs", name: "Up the Stairs", giver: "keeper_wend", turnIn: "brother_cress", level: 2,
    offer: "Brother Cress keeps the register in the chapel on the Posts. Go up. Let him see you. Let him write it down. And if Tamsin asks who opened the cistern, you never saw me.",
    steps: [{ text: "Climb to the Posts and find Brother Cress", kind: "talk", target: "brother_cress", n: 1 }],
    done: "Sit. No, stand, so I can see you. Forty-one years. I'll need a new page.",
    xp: 140,
  },
};

/** Experience to go from a level to the next. */
export const xpNext = (level: number) => Math.round(100 * Math.pow(level, 1.6));
export const MAX_LEVEL = 10;
