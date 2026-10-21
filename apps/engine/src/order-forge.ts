import { CAPTAIN_TIER, FORGE_TIERS, OT_PARTS, SKIN_PARTS, TABLE, tierInfo } from "./forge.js";

/**
 * The three IMD orders behind the Forge (launch.open, evm_contracts on Ethereum). The art and the forge
 * are separate contracts so each spec fits IMD's 8000 characters: NightWatchRenderer draws the card from
 * OT_PARTS, NightWatchSkin the identity layer over it from SKIN_PARTS (the same strings forge.ts fills in,
 * so the site and the chain agree), and the forge holds the rules and joins the two. The dev wallet wires
 * them once with setRenderer. forge.test.ts pins the art test vectors below to rendererSvg and skinSvg.
 */
export const FORGE_FEE_IMD = 2;
/** IMD's burn sink (the IMD team asked NIGHTSHIFT to burn here, not at 0x…dEaD); half of each forge fee. */
export const BURN_EXECUTOR = "0xe29386719C155B6847aD5a4E97C6674f10ffc750";
export const FORGE_VECTORS = [
  { n: 1, ids: [184, 185, 186, 189, 190, 78, 80, 81, 82, 86], name: "", tier: 1, points: 10, traits: [4, 2, 4, 3, 1, 5, 5], keccak: "0x6c9b4ba9e1d970ae878562252ecde4ba26c461fec4cc1af9d983049fcccbb448" },
  { n: 9, ids: [112, 120, 146, 170, 205, 232, 276, 281, 310, 370], name: "", tier: 2, points: 20, traits: [1, 4, 3, 5, 6, 3, 1], keccak: "0x6599cac260892032e955386e9d89eadb3155873df88c7d0eb9811d0516a71e9f" },
  { n: 7, ids: [26, 30, 50, 2, 5, 96, 97, 93, 94, 87], name: "", tier: 3, points: 50, traits: [5, 4, 3, 5, 3, 3, 4], keccak: "0x77a2bd2785100118716ecfd64d45fac8dc442da9985103657651e4cdfd3cff34" },
  { n: 50, ids: [10, 45, 103, 12, 19, 22, 69, 188, 204, 267], name: "KODES", tier: 5, points: 128, traits: [5, 5, 7, 5, 7, 6, 4], keccak: "0x7615dc42aa811e30e90ea4b235d71d4fdf31c0fa8e07440ee34715e47fd00609" },
  { n: 0, ids: [1, 45, 103, 12, 19, 22, 69, 188, 204, 267], name: "", tier: 6, points: 128, traits: [5, 5, 7, 0, 1, 3, 0], keccak: "0x57f3c7b814f1a4b3cd83136106e2345984b5e5316489aaa06a9d2d1d6ea5dcde" },
];
/** One per branch of the identity layer: tiers 1 (no beam or orbit), 3 (code columns), 5 (two orbits, the edge), the Captain (three). */
export const SKIN_VECTORS = [
  { n: 1, tier: 1, inputs: [184, 185, 186, 189, 190, 78, 80, 81, 82, 86], keccak: "0x2a93428c834d0f406f41844fbd93691276402298a395e0462c27cf41a6634e4c" },
  { n: 7, tier: 3, inputs: [26, 30, 50, 2, 5, 96, 97, 93, 94, 87], keccak: "0xaaf9e3a1dd4ce02bdfe8a864f16037c4c574974d1fe5e852b78ac8c6ba0477e0" },
  { n: 50, tier: 5, inputs: [10, 45, 103, 12, 19, 22, 69, 188, 204, 267], keccak: "0xb2e57d5de55080f34fe0d6818af8d64f27b6850b3c2bd9fe18ad19682b55fb8f" },
  { n: 0, tier: 6, inputs: [1, 45, 103, 12, 19, 22, 69, 188, 204, 267], keccak: "0xeecaf052aaad318dfead6dc6ca66725156009b16cd331563b85b5cc64b060b53" },
];
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const P = OT_PARTS;
const colours = [...FORGE_TIERS, CAPTAIN_TIER].map((t) => `${t.tier} ${t.color}`).join(", ");
export const vectorLabel = (v: (typeof FORGE_VECTORS)[number]) => v.name || tierInfo(v.tier).name.toUpperCase();
const vectors = FORGE_VECTORS.map((v) => `svg(${v.n}, ${v.tier}, [${v.traits.join(",")}], "${vectorLabel(v)}", [${v.ids.join(",")}], ${v.points}) = ${v.keccak}`).join("; ");

export const RENDERER_OBJECTIVE = `Build and deploy NightWatchRenderer on Ethereum: one immutable, view-only contract that draws the art of NIGHT WATCHERS (an NFT ordered separately). No token, no owner or admin, no storage, no fees, not upgradeable or pausable. Who can call what: anyone calls svg(), there is nothing else; it holds and receives no funds. Outside services: none; it only reads 2 deployed contracts: the NIGHT FROGS renderer 0x4D9BfbafE31eC18E9D3066F1475e24906d155D67, traitSVG(uint8 layer, uint8 index) returns string (layers 0-6, 6 = Accessory), and ArtStore 0x2A0140BC2b117ffEe9b092af1a927b96328FB000, read(0) returns the shared <style>+<defs> string (call it BASE).

svg(uint256 n, uint8 t, uint8[7] traits, string label, uint16[10] inputs, uint16 points) view returns (string); reverts unless 1 <= t <= 6 (6 = The Captain). C = colour by t: ${colours}. ROMAN = I, II, III, IV, V, C. L(i) = traitSVG(i, traits[i]). The result is exactly this concatenation, no spaces or newlines added; numbers in plain decimal:
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" color="' C '"><title>NIGHT WATCHERS #' n '</title>' BASE DEFS L(0) LIGHT [t>=2: RAYS] [t>=3: RING] [t>=5: RING2] '<g filter="url(#otA)">' L(1) L(2) L(3) [t>=3: '<g filter="url(#otE)">' L(4) '</g>', else L(4)] L(5) L(6) '</g>' [traits[6]=1: BADGE] [t=6: ArtStore read(3)] [t>=3: EMBERS] [t>=4: HOLO] SHADE CARD [t>=2: INNER] [t>=4: PULSE] [t>=5: BOSS] TITLE PIP(0)..PIP(4) HEX SPINE PLATE '</svg>'
Each part below is a literal string; {X} is replaced by X.
DEFS = ${P.defs}
LIGHT = ${P.light} with O = .6, .7, .8, .9, 1, 1 for t = 1..6
SPIN(TO, D) = ${P.spin}
RAYS = ${P.rays} with O = .22 for t 2-3, else .34; SPIN = SPIN(360, 80) when t>=5, else empty
RING = ${P.ring} with SPIN = SPIN(360, 120) when t>=5, else empty
RING2 = ${P.ring2} with SPIN = SPIN(-360, 90)
EMBERS = '<g filter="url(#otE)">', then for k = 0 .. 4t-7 the string ${P.ember} with X = 890 - (37k mod 150) for odd k else 110 + (37k mod 150), Y = 560 + (83k mod 340), R = 4 + 2(k mod 3), D = 4 + (k mod 4), then '</g>'
HOLO = ${P.holo}
SHADE = ${P.shade}
CARD = ${P.card}
INNER = ${P.inner}
PULSE = ${P.pulse}
BOSS = ${P.boss}
TITLE = ${P.title}
PIP(k) = ${P.pip} with X = 66 + 34k, O = 1 if k < t else .2
HEX = ${P.hex} with FILL = currentColor and INK = #08070D if t >= 4, else FILL = #08070D and INK = currentColor; S = 34 if t = 3 else 40
SPINE = ${P.spine}
PLATE = ${P.plate} with N = n, X = 130 + 20 x (number of digits of n), LABEL = label as given, P = points, FROM = the 10 inputs, each as # and its number, one space between
BADGE = ${P.badge} with N = n

Test vectors (keccak256 of the bytes): ${vectors}.
Foundry tests: the 5 vectors; t 0 and 7 revert; svg() gas and the 5 images in the README. Verify on Etherscan + Sourcify.`;

export const FORGE_OBJECTIVE = `Build and deploy NIGHT WATCHERS, symbol WATCH, the NIGHT FROGS Gen 2: a holder forges exactly 10 NIGHT FROGS into 1 Night Watcher; a forge that burns NIGHT FROG #1 also makes The Captain, token 0. Fully onchain ERC-721 (no fungible token) on Ethereum, OpenZeppelin v5, ERC-2981 5% to ${DEV}. Total supply: at most 51 NFTs (50 Night Watchers and The Captain), minted only by forge(), none pre-minted. Transfers: plain ERC-721, no fee or limit. Outside services: none; it only reads the contracts below. Not upgradeable or pausable. The owner (${DEV}) has one power only: setRenderer, once.

SOURCE (read only): NIGHT FROGS 0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c (500 frogs, revealed, randomWord() is its VRF word, no burn). Its renderer 0x4D9BfbafE31eC18E9D3066F1475e24906d155D67: traits(id, word) returns uint8[7] (Background, Body, Skin, Mouth, Eyes, Headwear, Accessory), traitName(layer, i) returns string.

FORGE: forge(uint256[10] ids, uint8 minTier) returns (uint256 tokenId). Reverts while no renderer is set.
1. 10 different ids in 1-500, each with ownerOf(id) == msg.sender (owned, not just approved); the caller has setApprovalForAll(this, true).
2. Each moves with transferFrom(msg.sender, 0x000000000000000000000000000000000000dEaD, id), forever; this contract never holds a frog.
3. Fee: FEE = ${FORGE_FEE_IMD}e18 IMD (0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7), an immutable constructor argument; fee() returns it. FEE/2 moves from msg.sender to IMD's BurnExecutor ${BURN_EXECUTOR} and FEE - FEE/2 to ${DEV}, both by IMD transferFrom. This contract never holds IMD.
4. points = sum of pointsOf(id). pointsOf(i) = CODES[(WORDS[(i-1)/85] >> (((i-1)%85)*3)) & 7], CODES = [${TABLE.codes.join(",")}], WORDS = [${TABLE.packed.join(", ")}] (each frog's rarity tier: Legendary 16, Epic 8, Rare 4, Uncommon 2, Common 1; at least 8 for #2-25 and 4 for #26-77). Constants.
5. tier = 5 if points >= 128, 4 if >= 80, 3 if >= 40, 2 if >= 20, else 1 (${FORGE_TIERS.map((t) => `${t.tier} ${t.roman} ${t.name}`).join(", ")}). Revert if tier < minTier.
6. traits: per layer, among the 10 frogs' renderer.traits(id, randomWord()), the index with the lowest COUNT[layer][index], ties to the lower index. COUNT = ${JSON.stringify(TABLE.counts)}.
7. _mint tokenId = nextId (1, 2, 3 ..., at most 50) to msg.sender; store tier, uint16 points, uint16[10] inputs, uint8[7] traits, uint64 forgedAt; emit Forged(address indexed owner, uint256 indexed tokenId, uint8 tier, uint16 points, uint16[10] inputs). nonReentrant, CEI.
8. If the 10 include #1: also _mint token 0, The Captain, to msg.sender, stored the same way with tier 6, the same points and inputs, and traits = renderer.traits(1, randomWord()); captainForged becomes true; emit Forged for it too. It can happen once (#1 burns).
Views: nextId(); captainForged(); forgeOf(tokenId) returns (uint8 tier, uint16 points, uint16[10] inputs, uint8[7] traits, uint64 forgedAt); pointsOf(frogId); tierFor(points); preview(uint256[10]) returns (tier, points, traits) with every check but ownership; totalSupply().
setName(tokenId, name): token owner, tier 5 or 6, once; 1-16 chars of A-Z 0-9 space . - without leading/trailing space. nameOf(tokenId) ("" if unset). Emits Named.

ART: setRenderer(address r, address skin): owner only, exactly once, both must have code; emits RendererSet(r, skin); renderer() and skin() return them. Both are ordered from IMD separately: NightWatchRenderer svg(uint256 n, uint8 tier, uint8[7] traits, string label, uint16[10] inputs, uint16 points) view returns (string), which always ends with '</svg>', and NightWatchSkin layer(uint256 n, uint8 tier, uint16[10] inputs) view returns (string). IMAGE = the renderer's svg without its last 6 bytes ('</svg>'), then skin.layer(n, tier, inputs), then '</svg>'. tokenURI(n) = 'data:application/json;base64,' + base64 of JSON: name "Night Watcher #<n>" ("The Captain" for 0), description "NIGHT FROGS Gen 2, forged from 10 NIGHT FROGS, a seat in the Night Watch. Tier <roman> <name>." (for 0: "The one Night Watcher forged from NIGHT FROG #1, the Zero-Sleep Captain. Tier C Captain."), image 'data:image/svg+xml;base64,' + base64(IMAGE) for renderer.svg(n, tier, traits, LABEL, inputs, points) with LABEL = nameOf(n) if set, else the tier name in capitals (CAPTAIN for tier 6); attributes Tier ("<roman> <name>"), Forge Points (number), Forged From (the 10 ids as "#a #b ..."), the 7 inherited traitNames by layer, Name if set.

Foundry mainnet-fork tests: every tier with an impersonated holder; a forge with #1 mints token 0 (tier 6, #1's traits) and its usual token; reverts (duplicate, id 0 or > 500, someone else's frog even approved, minTier, no approval or allowance, no renderer yet); frogs end at dEaD; each forge sends exactly 1 IMD to the BurnExecutor and 1 IMD to ${DEV}; setRenderer once and owner only; tokenURI is valid JSON with mock renderer and skin, and its image is the renderer's svg minus '</svg>' + the layer + '</svg>'; setName; fuzz preview == forge. Verify on Etherscan + Sourcify.`;


const S = SKIN_PARTS;
const skinVectors = () => SKIN_VECTORS.map((v) => `layer(${v.n}, ${v.tier}, [${v.inputs.join(",")}]) = ${v.keccak}`).join("; ");
export const SKIN_OBJECTIVE = () => `Build and deploy NightWatchSkin on Ethereum: one immutable, view-only contract that draws the identity layer of NIGHT WATCHERS (an NFT collection ordered separately), drawn over each Night Watcher's card. No token, no owner or admin, no storage, no fees, not upgradeable or pausable. Who can call what: anyone calls layer(), there is nothing else; it holds and receives no funds. Outside services: none; it reads no other contract.

layer(uint256 n, uint8 t, uint16[10] inputs) view returns (string); reverts unless 1 <= t <= 6 and n <= 9999 (n 0 and t 6 are The Captain). C = colour by t: ${colours}. id(k) = inputs[k mod 10]. The result is exactly this concatenation, no spaces or newlines added; numbers in plain decimal:
DEFS SCAN [t>=2: BEAM] BAR(0)..BAR(15) ID [t>=2: ORBIT(-12, '0;1')] [t>=5: ORBIT(14, '1;0')] [t=6: ORBIT(38, '0;1') with D = 6] [t>=3: CODE(0)..CODE(5)] STAR(0)..STAR(7) [t>=4: EDGE]
Each part below is a literal string; {X} is replaced by X.
DEFS = ${S.defs}
SCAN = ${S.scan}
BEAM = ${S.beam} with D = 9 - t
BAR(k) = ${S.bar} with H = 8 + (id(k) * (k + 7)) mod 41, X = 588 + 14k, Y = 142 - H, D = 2 + (k mod 4), B = 125k
ID = ${S.id} with N = n as 4 digits with leading zeros, TAG = THE CAPTAIN for t = 6, else ON WATCH
ORBIT(R, K) = ${S.orbit} with D = 16 - 2t unless given
CODE(k) = ${S.code} with X = 40 and A = start for k < 3, else X = 930 and A = end; Y = 300 + 18 (k mod 3); D = 3 + k; ROW = id(3k), id(3k+1), id(3k+2), each as 3 lowercase hex digits with leading zeros, joined by ':'
STAR(k) = ${S.star} with X = 40 + (37n + 53k) mod 120 for even k, 836 + (37n + 53k) mod 120 for odd k; Y = 230 + (61n + 97k) mod 560; D = 2 + (n + k) mod 3
EDGE = ${S.edge} with D = 12 - t

Test vectors (keccak256 of the bytes): ${skinVectors()}.
Foundry tests: the 3 vectors; t 0 and 6 and n 0 revert; layer() gas in the README. Verify on Etherscan + Sourcify.`;

export const FORGE_SKIN_ORDER = {
  key: "frog-forge-skin",
  title: "NIGHT WATCHERS identity layer",
  what: "Builds, tests, audits and deploys on Ethereum the Night Watchers' identity layer: a view-only contract with no owner that draws the signal look over every Night Watcher's card (scanlines, a signal barcode from its 10 frogs, orbit rings with a travelling node, an ID line, code columns, pixel stars, a running signal edge), every part animated. Order it with frog-forge and frog-forge-art; the dev wallet then calls setRenderer once.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  get body() { return { objective: SKIN_OBJECTIVE(), onchain: "evm_contracts", chainId: 1, owner: DEV }; },
};

export const FORGE_ART_ORDER = {
  key: "frog-forge-art",
  title: "NIGHT WATCHERS art",
  what: "Builds, tests, audits and deploys on Ethereum the Night Watchers renderer: a view-only contract with no owner that draws every Night Watcher from the NIGHT FROGS' own onchain layers plus the tier art (neon glow, rays, embers, holo, card frame). Order it with frog-forge; the dev wallet then calls setRenderer once.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: RENDERER_OBJECTIVE, onchain: "evm_contracts", chainId: 1, owner: DEV },
};

export const FORGE_ORDER = {
  key: "frog-forge",
  title: "NIGHT WATCHERS forge (Gen 2)",
  what: `Builds, tests, audits and deploys on Ethereum the forge: a holder burns exactly 10 NIGHT FROGS (sent to 0x…dEaD) for 1 Night Watcher (50 at most) whose tier, from Shift Lead to Night Boss, is set by how many rare frogs are in the 10. ${FORGE_FEE_IMD} IMD per forge: half burned at IMD's BurnExecutor, half to the dev wallet. Its only owner power: setRenderer once (to the frog-forge-art and frog-forge-skin contracts).`,
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: FORGE_OBJECTIVE, onchain: "evm_contracts", chainId: 1, owner: DEV },
};
