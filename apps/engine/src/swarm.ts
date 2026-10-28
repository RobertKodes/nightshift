import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import { config } from "./config.js";
import { DEALS_ORDER } from "./order-deals.js";
import { FORGE_ART_ORDER, FORGE_ORDER, FORGE_SKIN_ORDER } from "./order-forge.js";

/**
 * Work the operator orders from the IMD swarm from /setup: ready-made orders for Space Pinball
 * (the stakes escrow, an audit of the replay check). Each one gets IMD's free check here; the
 * dev wallet pays 0.5 IMD through IMD's Intake in the browser; the engine then follows the order.
 */
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const SPLITTER = "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44";

export type SwarmOrder = { key: string; title: string; what: string; action: "launch.open" | "job.open"; intake: string; body: Record<string, unknown> };

export const ORDERS: SwarmOrder[] = [
  {
    key: "pinball-escrow",
    title: "Space Pinball stakes escrow",
    what: "Builds, tests, audits (4 auditors + judge) and deploys on Ethereum the contract that holds both players' IMD or $SHIFT stakes and pays the winner. 5% of each pot goes to the NIGHTSHIFT fee splitter. Nobody, us included, can take a stake.",
    action: "launch.open",
    intake: "launch.open@launch-1",
    body: {
      objective: `Build and deploy PinballEscrow for Space Pinball, the NIGHTSHIFT player-versus-player skill game. Two players stake the same amount of the same token; the better player, as decided by the NIGHTSHIFT server's deterministic replay of both games, takes the pot minus a 5% fee.

Tokens: only IMD (${IMD}) and $SHIFT (${SHIFT}), both plain ERC-20 with 18 decimals and no transfer fee. Stakes allowed per token are fixed at deploy: IMD 1, 5, 10, 25; SHIFT 100000, 500000, 1000000, 5000000 (whole tokens).

Flow:
1. open(bytes32 matchId, address token, uint256 stake): player A deposits the stake (transferFrom, exact amount). Emits Opened(matchId, token, stake, playerA).
2. join(bytes32 matchId): player B deposits the same token and stake. Emits Joined(matchId, playerB). A match has exactly two players; A cannot join her own match.
3. settle(bytes32 matchId, address winner, bool draw, uint256 deadline, bytes signature): anyone may submit the result signed by the result signer (EIP-712 typed data: domain name "SpacePinball", version "1", chainId, this contract; struct Result(bytes32 matchId, address winner, bool draw, uint256 deadline)). The signature must be valid, not expired, and for a joined, unsettled match. Winner gets 95% of the pot; 5% goes to the fee splitter ${SPLITTER}. A draw refunds both players in full. Emits Settled(matchId, winner, draw, payout, fee).
4. refund(bytes32 matchId): if a match is not joined within 1 hour of open, A gets her stake back; if a joined match is not settled within 24 hours, both get their stake back. Emits Refunded(matchId).

Owner: ${DEV}. The owner can only change the result signer (setSigner, with an event) and pause new opens (pause/unpause; settle and refund keep working while paused). The owner can never move, take or redirect any stake, change the fee (fixed 5%), the fee recipient, the tokens or the stake list. No upgradeability, no delegatecall, no selfdestruct. Reentrancy-safe (checks-effects-interactions plus a guard), uses SafeERC20, every state change emits an event. Initial result signer: set by constructor argument, equal to $owner.

Tests (Foundry): full flows for both tokens, draw, both refunds, wrong signer, expired and replayed signatures, double settle, joining your own match, wrong stake, paused opens, fee exactly 5% to the splitter, fuzz on stakes and orders of calls.`,
      onchain: "evm_contracts",
      chainId: 1,
      owner: DEV,
    },
  },
  {
    key: "pinball-escrow-v2",
    title: "Game stakes escrow v2: any amount",
    what: "A new version of the stakes escrow where players choose their own bet, any amount of IMD or $SHIFT between a minimum and a maximum, for Space Pinball, NIGHT CHESS and the next games. Built, tested, audited by 4 specialists and a judge, and deployed on Ethereum by IMD. Nobody, us included, can take a stake.",
    action: "launch.open",
    intake: "launch.open@launch-1",
    body: {
      objective: `Build and deploy GameEscrow, version 2 of NIGHTSHIFT's PinballEscrow (live at 0x908da27d2caa584133dfb41fec9d6362dca6bcdd), for player-versus-player skill games (Space Pinball, NIGHT CHESS and later games). Two players stake the same amount of the same token; the winner, as decided by the NIGHTSHIFT server's verified result, takes the pot minus a 5% fee. The only change from v1: players choose the amount.

Tokens: only IMD (${IMD}) and $SHIFT (${SHIFT}), both plain ERC-20 with 18 decimals and no transfer fee. Any stake between a per-token minimum and maximum is allowed. Initial limits, set in the constructor: IMD min 0.5, max 1000; SHIFT min 10000, max 50000000 (whole tokens). The owner may change a token's min and max with setLimits(token, min, max) (event LimitsSet), but never above a hard cap fixed in the code (IMD 10000, SHIFT 1000000000) and never with min > max; changing limits never affects matches already opened.

Flow:
1. open(bytes32 matchId, address token, uint256 stake, bytes32 game): player A deposits the stake (transferFrom, exact amount, within the limits). game is a free label (e.g. "pinball", "chess"). Emits Opened(matchId, token, stake, game, playerA). matchId must be new.
2. join(bytes32 matchId): player B deposits the same token and exact stake. Emits Joined(matchId, playerB). Exactly two players; A cannot join her own match.
3. settle(bytes32 matchId, address winner, bool draw, uint256 deadline, bytes signature): anyone may submit the result signed by the result signer (EIP-712 typed data: domain name "NightshiftGames", version "2", chainId, this contract; struct Result(bytes32 matchId, address winner, bool draw, uint256 deadline)). The signature must be valid, not expired, for a joined, unsettled match, and winner must be one of the two players unless draw. Winner gets 95% of the pot; 5% goes to the fee splitter ${SPLITTER}. A draw refunds both players in full. Emits Settled(matchId, winner, draw, payout, fee).
4. refund(bytes32 matchId): if a match is not joined within 1 hour of open, A gets her stake back; if a joined match is not settled within 24 hours, both get their stake back. Emits Refunded(matchId).
5. cancel(bytes32 matchId): player A may cancel her own match before anyone joins and get her stake back at once. Emits Cancelled(matchId).
6. Views: matches(matchId) returning token, stake, game, playerA, playerB, openedAt, joinedAt, settled; limits(token) returning min and max.

Owner: ${DEV}. The owner can only change the result signer (setSigner, event), the limits within the hard caps (setLimits, event), and pause new opens and joins (pause/unpause; settle, refund and cancel keep working while paused). The owner can never move, take or redirect any stake, change the 5% fee, the fee recipient or the tokens. No upgradeability, no delegatecall, no selfdestruct. Reentrancy-safe (checks-effects-interactions plus a guard), SafeERC20, every state change emits an event. Initial result signer: a constructor argument equal to $owner.

Tests (Foundry): full flows for both tokens with amounts at and between the limits, below/above limits refused, draw, both refunds, cancel, wrong signer, expired and replayed signatures, signature for the wrong contract or chain refused, winner not a player refused, double settle, joining your own match, wrong stake, paused opens/joins, fee exactly 5% to the splitter (including odd amounts and rounding), setLimits bounds and hard caps, fuzz on stakes and call orders.`,
      onchain: "evm_contracts",
      chainId: 1,
      owner: DEV,
    },
  },
  {
    key: "arena-bets",
    title: "Live betting pool: bet on players and agents while you watch",
    what: "A live, in-play betting pool for every duel and the Agent Arena: spectators bet IMD or $SHIFT on a player while watching. Each bet is weighted by the game state at that moment (early and underdog bets count more, late bets on the leader very little), winners share the losing side minus 5%, and the result is the same server-verified result that settles the duel. Built, tested, audited by 4 specialists and a judge, and deployed on Ethereum by IMD. Nobody, us included, can take a bet.",
    action: "launch.open",
    intake: "launch.open@launch-1",
    body: {
      objective: `Build and deploy BetPool, a live (in-play) pari-mutuel betting pool for NIGHTSHIFT's skill games (NIGHT CHESS, Space Pinball and later games) and its Agent Arena, where AI agents and people play each other. Spectators watching a match live bet on side A or side B while it is played. Every bet carries a weight that the NIGHTSHIFT server sets from the live game state at that moment and signs into a short-lived ticket: early bets and bets on the side that is behind get a high weight, late bets on a side that is clearly winning get a low one, so nobody profits from betting on an obvious result at the last second. When the match ends, everyone who backed the winner gets their bet back plus a share of the losing side proportional to their weighted stake, minus a 5% fee taken only from the losing side. The result comes from the NIGHTSHIFT server's verified result signer, the same way NIGHTSHIFT's live GameEscrow (0xf460fd9ad76f18414f54a2431870e8a116193489) settles duels.

Tokens: only IMD (${IMD}) and $SHIFT (${SHIFT}), both plain ERC-20 with 18 decimals and no transfer fee. Each market uses one token. Per-bet limits, set in the constructor: IMD min 0.1, max 500; SHIFT min 1000, max 25000000 (whole tokens). The owner may change a token's limits with setLimits(token, min, max) (event LimitsSet), never above a hard cap fixed at deploy of 10000 IMD and 500000000 SHIFT, and never with min 0 or min above max.

All signatures are EIP-712 from the result signer, domain name "NightshiftBets", version "1", chainId, this contract.

Flow:
1. createMarket(bytes32 marketId, address token, uint64 closesAt, bytes32 game, bytes signature): opens a market for one match; signed struct Market(bytes32 marketId, address token, uint64 closesAt, bytes32 game), so only real matches get markets; anyone may submit it. marketId must be new; closesAt in the future and at most 7 days ahead (it is only the hard latest time for bets; the server normally stops issuing tickets earlier). Emits MarketCreated(marketId, token, closesAt, game).
2. bet(bytes32 marketId, uint8 side, uint256 amount, uint16 weightBps, uint64 expiry, bytes32 nonce, bytes signature): side 0 = A, 1 = B. Valid only with a ticket signed by the result signer, struct Ticket(bytes32 marketId, address bettor, uint8 side, uint256 amount, uint16 weightBps, uint64 expiry, bytes32 nonce), where bettor is msg.sender, the ticket is not expired and its expiry is at most 120 seconds after the block time, the nonce was never used, weightBps is between 500 and 10000 inclusive, the market exists and is not settled, and block.timestamp is before closesAt; amount within the token's limits (transferFrom, exact amount). Each bet records the amount and weighted shares = amount * weightBps / 10000 for that wallet and side; one wallet may bet many times and on both sides. Emits BetPlaced(marketId, bettor, side, amount, weightBps, shares).
3. settle(bytes32 marketId, uint8 outcome, uint256 deadline, bytes signature): anyone submits the signed struct Outcome(bytes32 marketId, uint8 outcome, uint256 deadline); outcome 0 = A won, 1 = B won, 2 = void (draw, abandoned or cancelled match). Valid only for an existing, unsettled market, a signature that is not expired, and outcome in 0..2. Settling also closes betting. If the outcome is void, or the winning side or the losing side has no bets, the market becomes refundable: everyone gets exactly what they bet and no fee is taken. Otherwise the fee is exactly 5% of the losing side's total amount (rounded down), sent at settlement to the NIGHTSHIFT fee splitter ${SPLITTER}, and the remaining 95% of the losing side is shared among winners pro rata to their weighted shares on the winning side. Emits Settled(marketId, outcome, fee).
4. claim(bytes32 marketId): pull payment for the caller: winners get all their winning-side amounts back plus their share; in a refundable market everyone gets all their amounts back. Each wallet claims once; losers get nothing. Rounding dust stays in the contract and can never exceed one wei per winner; no claim can ever pay more than the market holds. Emits Claimed(marketId, bettor, amount). Add claimMany(bytes32[] marketIds).
5. refund: if a market is not settled within 24 hours after closesAt, anyone may call expire(marketId) and it becomes refundable for everyone with no fee. Emits Expired(marketId).
6. Views: markets(marketId) returning token, closesAt, game, totalA, totalB, sharesA, sharesB, settled, outcome, refundable; betsOf(marketId, wallet) returning amountA, amountB, sharesA, sharesB, claimed; claimable(marketId, wallet); limits(token); usedNonce(bytes32).

Owner: ${DEV}. The owner can only change the result signer (setSigner, event SignerSet), the limits within the hard caps (setLimits), and pause new markets and new bets (pause/unpause; settle, expire and claim keep working while paused). The owner can never move, take or redirect any bet, change the 5% fee, the fee recipient or the tokens, or settle without the signer. No upgradeability, no delegatecall, no selfdestruct, no arbitrary token sweeping. Reentrancy-safe (checks-effects-interactions plus a guard), SafeERC20, Solidity 0.8.x, NatSpec on every external function, events for every state change.

Tests (Foundry): full flows for both tokens with several bettors on both sides at different weights and amounts at and between the limits; payouts summing to the pot minus the fee and following weighted shares; fee exactly 5% of the losing side to the splitter, including odd amounts and many bettors; void outcome and one-sided markets refunding everything with no fee; expiry after 24 hours; tickets with a wrong bettor, side, amount, weight outside 500..10000, expired, too-far expiry, reused nonce, wrong signer, wrong contract or wrong chain refused; bets after closesAt, on settled or unknown markets, below or above limits refused; market creation and settlement signature checks; double settle and double claim refused; a loser claiming gets nothing; pause behaviour; owner unable to move funds; fuzz and invariant tests that the contract always holds at least what it still owes and that total payouts never exceed total bets.`,
      onchain: "evm_contracts",
      chainId: 1,
      owner: DEV,
    },
  },
  {
    key: "pinball-audit",
    title: "Space Pinball fairness audit",
    what: "An audit panel (4 specialists + judge) reviews the open-source game server: the deterministic engine, the server replay that decides every duel and solo score, and the anti-cheat rules. You get a report with findings and fixes.",
    action: "job.open",
    intake: "job.open@job-1",
    body: {
      objective: "Audit the fairness and anti-cheat of Space Pinball in the open-source NIGHTSHIFT repository. The browser runs a deterministic pinball engine (apps/web/src/pinball/engine.ts, byte-identical to apps/engine/src/pinball/engine.ts); the server replays each player's recorded inputs with that engine (apps/engine/src/pinball.ts) and only the replayed score counts, for duels (both tables in lockstep, attacks delayed 720 ticks) and the solo board. Find every way a player could get a score they did not earn, forge or replay inputs, predict or choose a favourable seed, desync the duel, exhaust the server, or show harmful content to the other player; check determinism across JavaScript engines (floating point, sort order, Math functions). Rank findings by severity with concrete fixes. Stakes in IMD and $SHIFT will depend on this.",
      template: "audit",
      repoUrl: "https://github.com/RobertKodes/nightshift",
      paths: ["apps/engine/src/pinball.ts", "apps/engine/src/pinball", "apps/web/src/pinball"],
    },
  },
  {
    key: "project-audit",
    title: "Full NIGHTSHIFT security audit",
    what: "An audit panel (4 specialists + judge) reviews the whole open-source project on GitHub: the engine and its money paths (company wallets, x402 sales, withdrawals, the keeper), sign-in and admin, the bot, the web app's wallet transactions, and the deployment. You get a ranked report with fixes.",
    action: "job.open",
    intake: "job.open@job-1",
    body: {
      objective: "Security audit of the whole NIGHTSHIFT repository (an autonomous AI company platform built on the IMD swarm, live at getnightshift.tech with real funds). Review: apps/engine (node:http API in server.ts, wallet sign-in and HMAC sessions in auth.ts, the AES-GCM key vault in vault.ts, company wallets and withdrawals, x402 USDC sales and signed download links, the admin dashboard and its token, the keeper that runs the fee splitter and IMD burns in keeper.ts, the Telegram bot and moderation, the MCP server and its API keys, Space Pinball's server replay), packages (core spending policy and shift loop, imd client and payments, x402 seller), and apps/web (every transaction the browser builds with viem: swap through Uniswap v4, staking, NFT claims, funding; the pinned contract addresses in shift.ts; the service workers; the CSP). Find anything that could move or lose funds, bypass ownership or admin checks, leak secrets or private data, enable XSS, SSRF or path traversal, or let a client cheat a game. Rank findings by severity with file and line and a concrete fix.",
      template: "audit",
      repoUrl: "https://github.com/RobertKodes/nightshift",
      paths: ["apps/engine/src", "apps/web/src", "packages", "apps/web/public/sw.js", "deploy"],
    },
  },
  FORGE_ART_ORDER,
  FORGE_SKIN_ORDER,
  FORGE_ORDER,
  DEALS_ORDER,
];

type Placed = { tx: string; at: number; posted?: boolean; earlier?: string[]; job?: string; milestones?: string[] };
const file = () => join(config.dataDir, "swarm-orders.json");
const load = (): Record<string, Placed> => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };

/** The body as sent: a repository order is pinned to the latest commit on main, as IMD requires. */
async function bodyOf(o: SwarmOrder): Promise<Record<string, unknown>> {
  if (!o.body.repoUrl) return o.body;
  const c = await fetch("https://api.github.com/repos/RobertKodes/nightshift/commits/main", { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()) as { sha?: string };
  if (!c.sha) throw new Error("Could not read the latest commit from GitHub.");
  return { ...o.body, baseCommit: c.sha };
}

/** IMD's free check of one order: blockers, the plan the swarm would follow, and the exact body to pay for. */
export async function checkOrder(key: string): Promise<{ check: unknown; body: Record<string, unknown> }> {
  const o = ORDERS.find((x) => x.key === key);
  if (!o) throw new Error("unknown order");
  const body = await bodyOf(o);
  const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: o.action, input: body }), signal: AbortSignal.timeout(60_000) });
  return { check: await r.json(), body };
}

export function placeOrder(key: string, tx: string): Record<string, Placed> {
  if (!ORDERS.some((x) => x.key === key)) throw new Error("unknown order");
  const all = load();
  const was = all[key];
  // a job id (an order paid on IMD's own site) is followed as it is, keeping the payments made before it
  if (/^[0-9a-f-]{36}$/.test(tx)) { all[key] = { ...(was ?? { tx: "", at: Date.now() }), job: tx, at: Date.now() }; writeAtomic(file(), JSON.stringify(all, null, 2)); return all; }
  // paying again (e.g. while IMD's intake is stalled) keeps the earlier payments followed too
  all[key] = { tx, at: Date.now(), earlier: was ? [...(was.earlier ?? []), was.tx].filter(Boolean) : undefined };
  writeAtomic(file(), JSON.stringify(all, null, 2));
  return all;
}

type Job = { state?: string; launch?: { status?: string | null; id?: string | null } };
const DONE = new Set(["done", "completed", "complete", "delivered", "succeeded", "success"]);

/** The steps of a contracts job the community hears about, each once, in order (IMD's node keys). */
export const MILESTONES = [
  { key: "built", says: "contracts", node: (k: string) => k.startsWith("build_") },
  { key: "tested", says: "tests", node: (k: string) => k.includes("test") },
  { key: "audited", says: "audit", node: (k: string) => k.includes("judge") },
] as const;
export type JobNode = { key: string; state: string };
type Launch = { status?: string | null; id?: string | null } | null | undefined;
const LIVE = new Set(["live", "deployed", "complete", "completed"]);
/** The milestones a job has reached: a step counts once every node of it is accepted; deployed once its launch is live. */
export function reached(nodes: JobNode[], launch?: Launch): string[] {
  const out: string[] = [];
  for (const m of MILESTONES) { const ns = nodes.filter((n) => m.node(n.key)); if (ns.length && ns.every((n) => n.state === "accepted")) out.push(m.key); }
  if (launch?.status && LIVE.has(launch.status.toLowerCase())) out.push("deployed");
  return out;
}
/** One line per job: done ✅, being worked on 🔨, waiting ⏳, for each step and the deploy. */
export function marks(nodes: JobNode[], launch?: Launch): string {
  const got = new Set(reached(nodes, launch));
  const step = MILESTONES.map((m) => `${got.has(m.key) ? "✅" : nodes.some((n) => m.node(n.key) && n.state === "working") ? "🔨" : "⏳"} ${m.says}`);
  const deploy = got.has("deployed") ? "✅ deployed" : got.has("audited") ? "🔨 deploying" : "⏳ deploy";
  return [...step, deploy].join(" · ");
}
const SAYS: Record<string, string> = { built: "its contracts are written and compile", tested: "a second agent's Foundry tests pass", audited: "the audit panel (4 specialists and a judge) signed off", deployed: "it is deployed on Ethereum" };

/**
 * Every 10 minutes: an order the swarm has finished is announced to the community once, with its
 * public job page (and the audit report). Failures are told to the admins only.
 */
/** An order's job as IMD runs it now: a job continued by its payer goes on as a newer version of the same project. */
async function admittedJob(p: Placed): Promise<string | undefined> {
  const first = await firstJob(p);
  if (!first) return first;
  const j = await fetch(`https://api.imd.fun/jobs/${first}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { job?: { project?: Project }; project?: Project } | null;
  const pr = (j?.job ?? j)?.project;
  return pr?.running ?? pr?.versions?.at(-1)?.jobId ?? first;
}
type Project = { running?: string | null; versions?: { jobId?: string }[] };

/** The job of the first admitted payment for an order: the latest one, then any earlier ones. */
async function firstJob(p: Placed): Promise<string | undefined> {
  if (p.job) return p.job; // ordered on explorer.imd.fun: the job is known, there is no Intake payment to read
  for (const tx of [p.tx, ...(p.earlier ?? [])]) {
    const intake = await fetch(`https://api.imd.fun/intake/1/${tx}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { entries?: { admission?: { result?: { jobId?: string } } }[] } | null;
    const jobId = intake?.entries?.[0]?.admission?.result?.jobId;
    if (jobId) return jobId;
  }
  return undefined;
}

export function followSwarm(say: (text: string, buttons: { text: string; url: string }[][]) => Promise<unknown>, admin: (text: string) => Promise<unknown>): void {
  const tick = async () => {
    const all = load();
    for (const o of ORDERS) {
      const p = all[o.key];
      if (!p || p.posted) continue;
      const jobId = await admittedJob(p);
      if (!jobId) continue;
      const job = await fetch(`https://api.imd.fun/jobs/${jobId}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as (Job & { job?: Job }) | null;
      const j = job?.job ?? job;
      const state = String(j?.state ?? "").toLowerCase();
      const page = `https://explorer.imd.fun/jobs/${jobId}`;
      if (DONE.has(state)) {
        p.posted = true; writeAtomic(file(), JSON.stringify(all, null, 2));
        const audit = o.action === "job.open";
        await say(audit
          ? `🛡✅ <b>AUDIT COMPLETE: ${o.title.toUpperCase()}</b>\n\nThe IMD swarm's audit panel (4 specialists and a judge) has finished. The full report is public: every finding, ranked, with the fixes.\n\nWe will go through it and ship the fixes in the open.`
          : `🔐✅ <b>DONE BY THE SWARM: ${o.title.toUpperCase()}</b>\n\nBuilt, tested, audited by 4 specialists and a judge, and handed to deployment on Ethereum by IMD. The contract address is posted here as soon as it is checked on chain.`,
          [[{ text: audit ? "📄 Read the report" : "🔎 See the job", url: audit ? `https://api.imd.fun/jobs/${jobId}/report.md` : page }], [{ text: "🐝 The job on IMD", url: page }]]);
      } else if (["failed", "cancelled", "canceled", "rejected"].includes(state)) {
        p.posted = true; writeAtomic(file(), JSON.stringify(all, null, 2));
        await admin(`⚠️ Swarm order "${o.title}" ended as ${state}: ${page}`);
      }
    }
  };
  // the Night Watchers' three contracts: every step each one passes is told to the community, once, in one message
  const forge = async () => {
    const all = load(), rows: { title: string; line: string; page: string; fresh: string[] }[] = [];
    for (const key of FORGE_KEYS) {
      const o = ORDERS.find((x) => x.key === key), p = all[key];
      if (!o || !p) continue;
      const jobId = await admittedJob(p).catch(() => undefined);
      if (!jobId) continue;
      const job = await fetch(`https://api.imd.fun/jobs/${jobId}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { job?: { nodes?: JobNode[]; launch?: Launch }; nodes?: JobNode[]; launch?: Launch } | null;
      const j = job?.job ?? job;
      if (!j?.nodes?.length) continue;
      const told = new Set(p.milestones ?? []), fresh = reached(j.nodes, j.launch).filter((m) => !told.has(m));
      if (fresh.length) p.milestones = [...told, ...fresh];
      rows.push({ title: o.title.replace(/^NIGHT WATCHERS\s*/i, ""), line: marks(j.nodes, j.launch), page: `https://explorer.imd.fun/jobs/${jobId}`, fresh });
    }
    const news = rows.filter((r) => r.fresh.length);
    if (!news.length) return;
    writeAtomic(file(), JSON.stringify(all, null, 2));
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    await say([
      "🐸 <b>NIGHT WATCHERS · BUILD UPDATE</b>",
      "The IMD swarm is building the Night Watchers' three contracts. Every step is public on IMD's explorer.", "",
      ...rows.map((r) => `<b>${cap(r.title)}</b>\n${r.line}`), "",
      ...news.map((r) => `Just now: <b>${cap(r.title)}</b>: ${r.fresh.map((m) => SAYS[m]).join(", ")}.`), "",
      "The Forge opens once all three are deployed and checked.",
    ].join("\n"), [[{ text: "🐸 The Forge", url: "https://getnightshift.tech/forge" }], ...rows.map((r) => [{ text: `🐝 ${cap(r.title)} on IMD`, url: r.page }])]);
  };
  setInterval(() => void tick().then(forge).catch((e) => console.error("swarm follow", e)), 10 * 60_000);
  void tick().then(forge).catch(() => {});
}

const FORGE_KEYS = ["frog-forge-art", "frog-forge-skin", "frog-forge"];
type Build = { key: string; title: string; stage: string; job: string | null };
let build: { at: number; rows: Build[] } | null = null;
/** Where the IMD swarm is with the three Night Watchers contracts, for the public pages (read at most every 5 minutes). */
export async function forgeBuild(): Promise<Build[]> {
  if (build && Date.now() - build.at < 5 * 60_000) return build.rows;
  const placed = load();
  const rows = await Promise.all(FORGE_KEYS.map(async (key): Promise<Build> => {
    const o = ORDERS.find((x) => x.key === key)!, p = placed[key];
    if (!p) return { key, title: o.title, stage: "not ordered yet", job: null };
    const job = await admittedJob(p).catch(() => undefined);
    if (!job) return { key, title: o.title, stage: "paid, waiting for IMD to start it", job: null };
    const j = await fetch(`https://api.imd.fun/jobs/${job}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as (Job & { job?: Job }) | null;
    const st = String((j?.job ?? j)?.state ?? "").toLowerCase(), live = LIVE.has(String((j?.job ?? j)?.launch?.status ?? "").toLowerCase());
    const stage = live ? "live on Ethereum" : DONE.has(st) ? "built and audited, deploying" : ["failed", "cancelled", "canceled", "rejected", "blocked"].includes(st) ? "paused: ordered again soon" : "the swarm is building it";
    return { key, title: o.title, stage, job };
  }));
  build = { at: Date.now(), rows };
  return rows;
}

/** Every order with its state at IMD, read from the Intake follower. */
export async function orders(): Promise<unknown[]> {
  const placed = load();
  return Promise.all(ORDERS.map(async (o) => {
    const p = placed[o.key];
    let state: { error?: string; jobId?: string; stage?: string } | null = null;
    if (p?.job) { const j = await fetch(`https://api.imd.fun/jobs/${p.job}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as (Job & { job?: Job }) | null; state = { jobId: p.job, stage: String((j?.job ?? j)?.state ?? "ordered") }; }
    for (const tx of p && !p.job ? [p.tx, ...(p.earlier ?? [])] : []) {
      const s = await fetch(`https://api.imd.fun/intake/1/${tx}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { error?: string } | null;
      if (!state) state = s;
      if (s && !s.error) { state = s; break; }
    }
    return { key: o.key, title: o.title, what: o.what, intake: o.intake, body: o.body, placed: p ?? null, state };
  }));
}
