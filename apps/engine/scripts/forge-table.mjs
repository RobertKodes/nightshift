// Builds the NIGHT FROGS OVERTIME forge table from the chain: every frog's traits (the renderer's own
// traits() with the collection's VRF word), its rarity tier and its forge points, plus the collection's
// onchain art records. The frogs are revealed and immutable, so anyone who reruns this gets the same file.
//   node scripts/forge-table.mjs            (ETH_RPC=<url> to pick a node)
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

const FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const RENDERER = "0x4D9BfbafE31eC18E9D3066F1475e24906d155D67";
const ART = [["0x2A0140BC2b117ffEe9b092af1a927b96328FB000", 19], ["0xf87aCd914aA12B344A33aD4fc8966F85db3bFAFd", 81]];
const LAYERS = ["Background", "Body", "Skin", "Mouth", "Eyes", "Headwear", "Accessory"];
const COUNTS = [6, 6, 8, 6, 8, 8, 6];
// rarity tiers by rank, and the forge points each brings. Genesis frogs bring at least an Epic's 8 (#2-25, 3x)
// or a Rare's 4 (#26-77, 2x), so 10 of them always reach the tier that pays what they earned together.
const TIERS = [["Legendary", 25, 16], ["Epic", 50, 8], ["Rare", 75, 4], ["Uncommon", 125, 2], ["Common", 225, 1]];
const floor = (id) => (id <= 25 ? 8 : id <= 77 ? 4 : 1);
const CODES = [1, 2, 4, 8, 16];

const eth = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com", { timeout: 30_000 }) });
const word = await eth.readContract({ address: FROGS, abi: parseAbi(["function randomWord() view returns (uint256)"]), functionName: "randomWord" });
if (!word) throw new Error("not revealed");
const traitsAbi = parseAbi(["function traits(uint256,uint256) pure returns (uint8[7])"]);
const res = await eth.multicall({ contracts: Array.from({ length: 500 }, (_, i) => ({ address: RENDERER, abi: traitsAbi, functionName: "traits", args: [BigInt(i + 1), word] })), allowFailure: false, batchSize: 4096 });
const traits = res.map((t) => t.map(Number));

const counts = COUNTS.map((n) => Array(n).fill(0));
for (const t of traits) t.forEach((v, l) => counts[l][v]++);
const score = (t) => t.reduce((s, v, l) => s + 500 / counts[l][v], 0);
// rank 1 = rarest; #1 (the 1 of 1) is pinned first, ties go to the lower id
const order = traits.map((t, i) => ({ id: i + 1, s: score(t) })).sort((a, b) => (a.id === 1 ? -1 : b.id === 1 ? 1 : b.s - a.s || a.id - b.id));
const tokens = Array(500);
let at = 0;
for (const [tier, n, pts] of TIERS) for (let k = 0; k < n; k++, at++) {
  const { id, s } = order[at];
  tokens[id - 1] = { id, rank: at + 1, tier, score: Math.round(s * 1000) / 1000, points: Math.max(pts, floor(id)), traits: traits[id - 1] };
}

// 3-bit codes into CODES, 85 frogs per word: the table the forge contract hardcodes
const packed = Array(6).fill(0n);
for (const t of tokens) packed[Math.floor((t.id - 1) / 85)] |= BigInt(CODES.indexOf(t.points)) << BigInt(((t.id - 1) % 85) * 3);

const art = [];
for (const [address, n] of ART) {
  const got = await eth.multicall({ contracts: Array.from({ length: n }, (_, i) => ({ address, abi: parseAbi(["function read(uint256) view returns (string)"]), functionName: "read", args: [BigInt(i)] })), allowFailure: false, batchSize: 1 << 20 });
  art.push(...got);
}

const names = LAYERS.map((_, l) => Array.from({ length: COUNTS[l] }, (_, i) => art[[4, 16, 28, 44, 56, 72, 88][l] + i * 2]));
const dir = new URL("../assets/forge/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("table.json", dir), JSON.stringify({
  source: { frogs: FROGS, renderer: RENDERER, word: word.toString() },
  layers: LAYERS, names, counts, codes: CODES,
  packed: packed.map((w) => "0x" + w.toString(16).padStart(64, "0")),
  tokens: tokens.map(({ id, rank, tier, points, traits }) => ({ id, rank, tier, points, traits })),
}));
writeFileSync(new URL("art.json", dir), JSON.stringify(art));
console.log("tiers", Object.fromEntries(TIERS.map(([t]) => [t, tokens.filter((x) => x.tier === t).length])), "points", Object.fromEntries(CODES.map((c) => [c, tokens.filter((x) => x.points === c).length])), "art records", art.length);
