import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAbi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { CAPTAIN_TIER, DEAD, FORGE_ABI, FORGE_SIZE, FORGE_TIERS, ForgeError, RARITIES, SHOWCASE, TABLE, captainSvg, forgeOn, forgedAll, forgedSvg, frogOf, nightFrogSvg, plan, preview, tierInfo } from "./forge.js";
import { svgPng } from "./frogpng.js";
import { multiplier } from "./frogs.js";
import { forgeBuild } from "./swarm.js";
import { roomCode, roomMembers, roomOn } from "./watch-room.js";

/** The forge's pages: what a wallet can forge, the exact result of 10 frogs, and the art before anyone signs. */
type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL;
  /** The signed-in wallet (session), for the Watch Room code. */
  owner?: string | null;
};

const FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const OWNER_OF = parseAbi(["function ownerOf(uint256) view returns (address)"]);
/** Who holds each NIGHT FROG, read in one multicall and kept a minute, so a frog bought just now shows up. */
let holders: { at: number; owners: string[] } | null = null;
export async function owners(): Promise<string[]> {
  if (holders && Date.now() - holders.at < 60_000) return holders.owners;
  const nft = (config.nft.address || FROGS) as `0x${string}`;
  const res = await eth.multicall({ contracts: Array.from({ length: 500 }, (_, i) => ({ address: nft, abi: OWNER_OF, functionName: "ownerOf" as const, args: [BigInt(i + 1)] })), allowFailure: true });
  holders = { at: Date.now(), owners: res.map((r) => (r.status === "success" ? String(r.result).toLowerCase() : "")) };
  return holders.owners;
}

let fee: { at: number; wei: string | null } | null = null;
async function forgeFee(): Promise<string | null> {
  if (!forgeOn()) return null;
  if (fee && Date.now() - fee.at < 10 * 60_000) return fee.wei;
  const wei = await eth.readContract({ address: config.forge.address as `0x${string}`, abi: FORGE_ABI, functionName: "fee" }).then(String).catch(() => fee?.wei ?? null);
  fee = { at: Date.now(), wei };
  return wei;
}

const frogView = (id: number) => {
  const f = frogOf(id)!;
  return { id, rank: f.rank, rarity: f.tier, points: f.points, rate: multiplier(id), traits: f.traits.map((v, l) => TABLE.names[l]![v]!) };
};
const idsOf = (url: URL) => (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, FORGE_SIZE);
const svg = (res: ServerResponse, body: string, immutable: boolean) => {
  // served as its own document (inline SVGs would share one stylesheet and repaint each other's skins)
  res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
  res.end(body);
};

export async function forgeRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/forge") || (req.method !== "GET" && !(req.method === "POST" && p === "/api/forge/room"))) return false;
  const { json, url } = ctx;
  if (ctx.limited(req, "forge", 240, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
  try {
    if (p === "/api/forge") {
      const all = await forgedAll();
      const byTier = Object.fromEntries(FORGE_TIERS.map((t) => [t.tier, all.filter((f) => f.tier === t.tier).length]));
      json(res, 200, {
        on: forgeOn(), size: FORGE_SIZE, address: config.forge.address || null, fee: await forgeFee(), showcase: SHOWCASE,
        // until the forge is live: where the IMD swarm is with its three contracts
        build: forgeOn() ? null : await forgeBuild().catch(() => null),
        tiers: FORGE_TIERS, captain: CAPTAIN_TIER, rarities: RARITIES.map((r) => ({ rarity: r, frogs: TABLE.tokens.filter((t) => t.tier === r).length, points: Math.min(...TABLE.tokens.filter((t) => t.tier === r).map((t) => t.points)) })),
        forged: { count: all.length, burned: all.length * FORGE_SIZE, byTier, latest: all.slice(-12).reverse().map((f) => ({ n: f.n, tier: f.tier, name: f.name, points: f.points, inputs: f.inputs })) },
      });
      return true;
    }
    if (p === "/api/forge/room") {
      // GET: is the room open and how full; POST (signed in): a one-time code for the bot
      if (req.method === "GET") { json(res, 200, { on: roomOn(), members: roomMembers() }); return true; }
      if (!ctx.owner) { json(res, 401, { error: "Sign in with the wallet that holds your Night Watcher." }); return true; }
      if (ctx.limited(req, `forge-room:${ctx.owner}`, 6, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
      const r = await roomCode(ctx.owner.toLowerCase());
      json(res, "error" in r ? 403 : 200, r);
      return true;
    }
    if (p === "/api/forge/wallet") {
      const a = (url.searchParams.get("address") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(a)) { json(res, 400, { error: "address" }); return true; }
      const mine = (await owners()).flatMap((o, i) => (o === a ? [i + 1] : []));
      json(res, 200, { frogs: mine.map(frogView), plan: plan(mine), dead: (await owners()).filter((o) => o === DEAD).length });
      return true;
    }
    if (p === "/api/forge/frogs") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 500).slice(0, 50);
      json(res, 200, { frogs: ids.map(frogView) });
      return true;
    }
    if (p === "/api/forge/preview") {
      const r = preview(idsOf(url));
      json(res, 200, { ...r, before: r.ids.reduce((s, id) => s + multiplier(id), 0), tierInfo: tierInfo(r.tier) });
      return true;
    }
    if (p === "/api/forge/captain.svg") {
      // The Captain these 10 would make, or the one any set with #1 makes (a showcase)
      const ids = idsOf(url).length === FORGE_SIZE ? idsOf(url) : [1, ...SHOWCASE[4]!.slice(1)];
      const r = preview(ids);
      if (!r.captain) { json(res, 400, { error: "Only a forge with #1 makes The Captain." }); return true; }
      svg(res, captainSvg(r.ids, r.points), true);
      return true;
    }
    if (p === "/api/forge/art.svg") {
      const r = preview(idsOf(url));
      svg(res, forgedSvg(null, r.tier, r.traits.map((t) => t.index), "", r.ids, r.points), true);
      return true;
    }
    const nf = /^\/api\/forge\/nf\/(\d{1,3})\.svg$/.exec(p);
    if (nf && Number(nf[1]) >= 1 && Number(nf[1]) <= 500) { svg(res, nightFrogSvg(Number(nf[1])), true); return true; }
    // a Night Watcher as a PNG, for its Telegram announcement and link previews
    const mp = /^\/api\/forge\/frog\/(\d{1,3})\.png$/.exec(p);
    if (mp) {
      const f = (await forgedAll()).find((x) => x.n === Number(mp[1]));
      if (!f) { json(res, 404, { error: "No Night Watcher with that number yet." }); return true; }
      res.writeHead(200, { "content-type": "image/png", "cache-control": f.tier < 5 || f.name ? "public, max-age=31536000, immutable" : "public, max-age=300" });
      res.end(svgPng(forgedSvg(f.n, f.tier, f.traits, f.name, f.inputs, f.points)));
      return true;
    }
    const m = /^\/api\/forge\/frog\/(\d{1,3})\.svg$/.exec(p);
    if (m) {
      const f = (await forgedAll()).find((x) => x.n === Number(m[1]));
      if (!f) { json(res, 404, { error: "No Night Watcher with that number yet." }); return true; }
      svg(res, forgedSvg(f.n, f.tier, f.traits, f.name, f.inputs, f.points), f.tier < 5 || Boolean(f.name));
      return true;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, e instanceof ForgeError ? 400 : 502, { error: e instanceof ForgeError ? e.message : "The chain did not answer; try again in a minute." });
  }
  return true;
}
