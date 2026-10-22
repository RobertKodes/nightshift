import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAbi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { ART, forgeOn, forgedAll } from "./forge.js";
import { owners } from "./forge-routes.js";
import { stakingOf, stakingSeats } from "./frogs.js";
import { liveMissions } from "./missions.js";
import { currentBook, watchStatus } from "./nightwatch.js";
import { type ShipSnapshot, crewOf, shipSnapshot, shipStatic } from "./ship.js";

/**
 * THE SHIP's reads: /api/ship/art (what never changes: the onchain art records, the table and every frog's
 * home station), /api/ship (the live snapshot: holders, rates, missions, forged frogs, the Night Watch and its
 * radar) and /api/ship/crew?wallet= (one wallet's crew and its best forge).
 */
type Context = {
  json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL;
  /** The companies on NIGHTSHIFT and who owns each (live, not simulated ones). */
  companies(): { owner: string | null }[];
};

const STATIC = shipStatic(ART);
const STATIC_BODY = JSON.stringify(STATIC);
export const SHIP_ART_VERSION = createHash("sha256").update(STATIC_BODY).digest("hex").slice(0, 12);

const OWNER_OF = parseAbi(["function ownerOf(uint256) view returns (address)"]);
let snap: { at: number; v: ShipSnapshot } | null = null;
let pending: Promise<ShipSnapshot> | null = null;

async function read(): Promise<ShipSnapshot> {
  const [frogs, forged, status] = await Promise.all([owners(), forgeOn() ? forgedAll() : Promise.resolve([]), watchStatus().catch(() => null)]);
  const held = forged.length ? await eth.multicall({ allowFailure: true, contracts: forged.map((f) => ({ address: config.forge.address as `0x${string}`, abi: OWNER_OF, functionName: "ownerOf" as const, args: [BigInt(f.n)] })) }) : [];
  const st = stakingSeats();
  return shipSnapshot({
    owners: frogs,
    forged: forged.map((f, i) => ({ ...f, owner: held[i]?.status === "success" ? String(held[i]!.result).toLowerCase() : "" })),
    seat: st.seat, stakingAt: st.at,
    missions: liveMissions().out(),
    watch: (status?.seats ?? []).map((s) => ({ watcher: s.watcher, online: s.online })),
    book: currentBook(),
  });
}

/** The snapshot, read at most every 20 seconds however many pages poll it. */
export async function shipNow(): Promise<ShipSnapshot> {
  if (snap && Date.now() - snap.at < 20_000) return snap.v;
  pending ??= read().then((v) => { snap = { at: Date.now(), v }; return v; }).finally(() => { pending = null; });
  return pending;
}

export async function shipRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if ((p !== "/api/ship" && !p.startsWith("/api/ship/")) || req.method !== "GET") return false;
  const { json } = ctx;
  if (ctx.limited(req, "ship", 240, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
  try {
    if (p === "/api/ship/art") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=86400", etag: `"${SHIP_ART_VERSION}"` });
      res.end(STATIC_BODY);
      return true;
    }
    if (p === "/api/ship") { json(res, 200, { ...(await shipNow()), artVersion: SHIP_ART_VERSION }, { "cache-control": "public, max-age=10" }); return true; }
    if (p === "/api/ship/crew") {
      const a = (ctx.url.searchParams.get("wallet") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(a)) { json(res, 400, { error: "That is not a wallet address." }); return true; }
      const s = await shipNow();
      const st = stakingOf(a);
      const companies = ctx.companies().filter((c) => c.owner?.toLowerCase() === a).length;
      json(res, 200, crewOf(s, a, { hours: st.hours, rank: st.rank, companies, baseSlots: config.maxCompaniesPerOwner, frogSlots: config.nft.extraSlots }));
      return true;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("ship", (e as Error).message);
    json(res, 502, { error: "The chain did not answer; try again in a minute." });
  }
  return true;
}
