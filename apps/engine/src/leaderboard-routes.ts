import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { type Hex, parseAbiItem } from "viem";
import { decodeBetLog } from "./bets.js";
import { eth } from "./chain.js";
import { marketSnapshot } from "./community.js";
import { config } from "./config.js";
import { INTERNAL_WALLETS } from "./crews/contracts.js";
import { DEPLOY_BLOCK, ESCROW, ESCROW_ABI, TOKENS } from "./escrow.js";
import { frogsOn, stakingBoard, stakingOf } from "./frogs.js";
import { EARNER_SOURCES, type FrogWallet, Leaderboards, PayoutIndex, STAKER_SOURCES, type Sym, boardView, eventRow } from "./leaderboards.js";
import { keeperEarnings } from "./nightwatch.js";
import { liveStakeHistory } from "./stake-history.js";
import { launchState } from "./token.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
  limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean;
  url: URL;
  boards?: Pick<Leaderboards, "boards">;
};

const ESCROW_EVENTS = ESCROW_ABI.filter((x) => x.type === "event");
const FROGS_CLAIMED = parseAbiItem("event FrogsClaimed(uint256 indexed epoch, address indexed account, address indexed token, uint256 amount)");
const ETH = "0x0000000000000000000000000000000000000000";
type Logged = { eventName?: string; args?: unknown; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };

/** Every soft-staking wallet: its shift hours, and for a holder its NIGHT FROGS, Night Watchers and hourly rate (as the Frogs page shows them). */
function frogWallets(): FrogWallet[] | null {
  if (!frogsOn()) return null;
  return stakingBoard(1_000_000).map((r) => {
    if (!r.frogs) return { wallet: r.wallet, hours: r.hours, frogs: 0, watchers: 0, perHour: 0, imdSeat: false };
    const s = stakingOf(r.wallet), watchers = s.frogs.filter((f) => f.forged).length;
    return { wallet: r.wallet, hours: r.hours, frogs: s.frogs.length - watchers, watchers, perHour: s.perHour, imdSeat: s.imdSeat };
  });
}

let index: PayoutIndex | null = null;
/** The chain index of the escrow's, the bet pool's and the frog pot's events, in DATA_DIR/leaderboards.json. */
export function livePayoutIndex(): PayoutIndex {
  return (index ??= new PayoutIndex({
    file: join(config.dataDir, "leaderboards.json"),
    head: () => eth.getBlockNumber(),
    specs: () => {
      const l = launchState(), rewards = l?.open ? l.contracts?.rewards : undefined;
      return [
        { key: "games" as const, contract: ESCROW, from: Number(DEPLOY_BLOCK) },
        ...(config.betPool.address ? [{ key: "bets" as const, contract: config.betPool.address, from: config.betPool.block }] : []),
        ...(rewards && l?.scanFrom ? [{ key: "frogpot" as const, contract: rewards, from: Math.max(0, l.scanFrom - 100) }] : []),
      ];
    },
    read: {
      games: async (address, fromBlock, toBlock) => ((await eth.getLogs({ address, events: ESCROW_EVENTS, fromBlock, toBlock })) as Logged[])
        .filter((l) => l.eventName === "Opened" || l.eventName === "Joined" || l.eventName === "Settled").map((l) => eventRow(l.eventName!, l.args as Record<string, unknown>, l)),
      bets: async (address, fromBlock, toBlock) => (await eth.getLogs({ address, fromBlock, toBlock })).flatMap((l) => {
        const d = decodeBetLog(l);
        return d && ["MarketCreated", "BetPlaced", "Settled", "Claimed"].includes(d.eventName) ? [eventRow(d.eventName, d.args, l)] : [];
      }),
      frogpot: async (address, fromBlock, toBlock) => (await eth.getLogs({ address, event: FROGS_CLAIMED, fromBlock, toBlock })).map((l) => eventRow("FrogsClaimed", l.args as Record<string, unknown>, l)),
    },
  }));
}

let boards: Leaderboards | null = null;
/** The live boards: the stake history, soft staking, the Night Watch's book, the chain index and today's prices. */
export function liveLeaderboards(): Leaderboards {
  return (boards ??= new Leaderboards({
    stakes: () => liveStakeHistory().all(),
    frogs: frogWallets,
    keepers: keeperEarnings,
    index: livePayoutIndex(),
    prices: async () => {
      const m = await marketSnapshot().catch(() => null);
      // IMD's dollar price only once it was read from the market (or pinned by IMD_USD), never the built-in fallback
      return { ETH: m?.ethUsd || null, SHIFT: m?.priceUsd || null, IMD: config.imdUsdPinned || config.imdUsdAt ? config.imdUsd || null : null };
    },
    tokens: () => {
      const t: Record<string, Sym> = { [ETH]: "ETH", [TOKENS.IMD]: "IMD", [TOKENS.SHIFT]: "SHIFT" };
      const shift = (launchState()?.contracts?.token ?? config.token.address ?? "").toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(shift)) t[shift] = "SHIFT";
      return t;
    },
    exclude: () => INTERNAL_WALLETS,
  }));
}

const KINDS = { stakers: ["all", ...STAKER_SOURCES], earners: ["all", ...EARNER_SOURCES] } as const;

/**
 * GET /api/leaderboards: the top 10 of both boards. GET /api/leaderboards/stakers and /api/leaderboards/earners:
 * one board, `?source=` one of its lists (all by default), `?limit=` 1–200 (100), `?wallet=0x…` to get that
 * wallet's own row back as `me`, wherever it ranks. Public reads, cached a few minutes.
 */
export async function leaderboardRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (p !== "/api/leaderboards" && !p.startsWith("/api/leaderboards/")) return false;
  const { json, limited, url } = ctx;
  if (req.method !== "GET" && req.method !== "HEAD") { json(res, 405, { error: "GET only" }); return true; }
  const kind = p.split("/")[3] ?? "";
  if (kind !== "" && kind !== "stakers" && kind !== "earners") { json(res, 404, { error: "GET /api/leaderboards, /api/leaderboards/stakers or /api/leaderboards/earners" }); return true; }
  if (limited(req, "leaderboards", 120, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
  const source = url.searchParams.get("source") ?? "all";
  if (kind && !(KINDS[kind] as readonly string[]).includes(source)) { json(res, 400, { error: `source: one of ${KINDS[kind].join(", ")}` }); return true; }
  const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get("limit") ?? 100)) || 100));
  const w = url.searchParams.get("wallet") ?? "";
  const wallet = /^0x[0-9a-fA-F]{40}$/.test(w) ? w : null;
  let b;
  try { b = await (ctx.boards ?? liveLeaderboards()).boards(); } catch (e) { console.error("leaderboards", (e as Error).message); json(res, 503, { error: "The leaderboards could not be built just now." }); return true; }
  const cache = { "Cache-Control": wallet ? "private, max-age=60" : "public, max-age=60" };
  if (!kind) { json(res, 200, { at: b.at, stakers: boardView(b, "stakers", "all", 10, wallet), earners: boardView(b, "earners", "all", 10, wallet) }, cache); return true; }
  json(res, 200, boardView(b, kind, source, limit, wallet), cache);
  return true;
}

