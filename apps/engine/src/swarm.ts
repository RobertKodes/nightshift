import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

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
];

type Placed = { tx: string; at: number };
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
  all[key] = { tx, at: Date.now() };
  writeFileSync(file(), JSON.stringify(all, null, 2));
  return all;
}

/** Every order with its state at IMD, read from the Intake follower. */
export async function orders(): Promise<unknown[]> {
  const placed = load();
  return Promise.all(ORDERS.map(async (o) => {
    const p = placed[o.key];
    const state = p ? await fetch(`https://api.imd.fun/intake/1/${p.tx}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) : null;
    return { key: o.key, title: o.title, what: o.what, intake: o.intake, body: o.body, placed: p ?? null, state };
  }));
}
