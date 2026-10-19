import { formatUnits } from "viem";
import { config } from "./config.js";
import { type BetEvent, payoutOf } from "./bets.js";
import { ESCROW, type Challenge, type DuelEvent } from "./escrow.js";
import { publicName } from "./names.js";
import { prices } from "./prices.js";
import { type Button, esc } from "./social.js";
import type { LiveGame } from "./spectate.js";

/**
 * Community cards for the game duels: a staked challenge going live, the duel starting, and the
 * payout. Free PvP and agent games get a lighter "duel on" card, at most one every few minutes.
 */
const GAME = { chess: "♟ NIGHT CHESS", pinball: "🎱 SPACE PINBALL" } as const;
const PAGE = { chess: "/games/chess", pinball: "/games/pinball" } as const;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
/** Only a real address or transaction hash goes into a link; a name passes the shared name rule (names.ts) and is escaped. */
const ADDR = /^0x[0-9a-fA-F]{40}$/, TX = /^0x[0-9a-fA-F]{64}$/;
const who = (name: string | undefined, addr?: string) => {
  const clean = publicName(name, { max: 40 });
  const n = clean ? `<b>${esc(clean)}</b>` : "";
  const a = addr && ADDR.test(addr) ? `<a href="https://etherscan.io/address/${addr}">${short(addr)}</a>` : "";
  return n && a ? `${n} (${a})` : n || a || "a player";
};
const amount = (wei: string) => {
  const n = Number(formatUnits(BigInt(wei || "0"), 18));
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n * 1000) / 1000);
};
async function usd(token: "IMD" | "SHIFT", wei: string): Promise<string> {
  const p = await prices().catch(() => null);
  const last = (token === "IMD" ? p?.imd : p?.shift)?.at(-1)?.close;
  const v = last ? Number(formatUnits(BigInt(wei || "0"), 18)) * last : 0;
  return v >= 1 ? ` (≈ $${v >= 100 ? v.toFixed(0) : v.toFixed(2)})` : "";
}
const sym = (t: "IMD" | "SHIFT") => (t === "SHIFT" ? "$SHIFT" : "IMD");
const mode = (c: Challenge) => (c.game === "chess" ? `⏱ Time control <b>${esc(c.tc ?? "")}</b>` : "🌌 Score attack: higher verified score wins");

/** The card for one escrow event, or null when there is nothing to tell. */
export async function duelCard(kind: DuelEvent, c: Challenge): Promise<{ text: string; buttons: Button[][] } | null> {
  const stake = `${amount(c.stake)} ${sym(c.token)}`;
  const pot = (BigInt(c.stake) * 2n).toString();
  const prize = ((BigInt(c.stake) * 2n * 95n) / 100n).toString();
  const page = `${config.publicUrl}${PAGE[c.game]}`;
  const escrowLink = (tx?: string, label = "On chain") => tx && TX.test(tx) ? [{ text: `🔎 ${label}`, url: `https://etherscan.io/tx/${tx}` }] : [{ text: "🔎 GameEscrow", url: `https://etherscan.io/address/${ESCROW}` }];
  if (kind === "listed") {
    return {
      text: [
        `⚔️ <b>NEW DUEL CHALLENGE · ${GAME[c.game]}</b>`, "",
        `👤 ${who(c.name, c.creator)} is waiting for a rival`,
        `💎 Stake <b>${stake}</b>${await usd(c.token, c.stake)} each`,
        `🏆 Pot <b>${amount(pot)} ${sym(c.token)}</b> · the winner takes <b>${amount(prize)} ${sym(c.token)}</b>`,
        mode(c),
        "⌛ Open for 1 hour, then the stake goes back", "",
        "Both stakes sit in the audited GameEscrow until the server-verified result. Match the exact stake to accept.",
      ].join("\n"),
      buttons: [[{ text: "⚔️ Accept the duel", url: page }, { text: "👀 Watch live", url: `${config.publicUrl}/games/live` }], escrowLink(c.openTx, "Deposit")],
    };
  }
  if (kind === "joined") {
    return {
      text: [
        `🔥 <b>DUEL ON · ${GAME[c.game]}</b>`, "",
        `${who(c.name, c.creator)}  🆚  ${who(c.nameB, c.playerB)}`,
        `💎 <b>${stake}</b> each · pot <b>${amount(pot)} ${sym(c.token)}</b>${await usd(c.token, pot)}`,
        `🏆 The winner takes <b>${amount(prize)} ${sym(c.token)}</b>`,
        mode(c), "",
        "Every move is checked by the server. Pull up a chair 👇",
      ].join("\n"),
      buttons: [[{ text: "👀 Watch live", url: `${config.publicUrl}/games/live` }], escrowLink(c.joinTx, "Join")],
    };
  }
  if (kind === "settled" && c.closed) {
    const draw = c.closed.draw, w = c.closed.winner;
    const winnerName = w === c.creator ? c.name : w === c.playerB ? c.nameB : undefined;
    return {
      text: draw
        ? [`🤝 <b>DRAW · ${GAME[c.game]}</b>`, "", `${who(c.name, c.creator)} and ${who(c.nameB, c.playerB)} could not be split: both get their <b>${stake}</b> back, no fee.`].join("\n")
        : [`🏆 <b>DUEL WON · ${GAME[c.game]}</b>`, "",
          `${who(winnerName, w)} beat ${w === c.creator ? who(c.nameB, c.playerB) : who(c.name, c.creator)}`,
          `💰 Paid <b>${c.closed.payout ? amount(c.closed.payout) : amount(prize)} ${sym(c.token)}</b>${await usd(c.token, c.closed.payout || prize)} straight from the escrow`,
          "🔥 5% of the pot went to stakers, NIGHT FROGS holders, the treasury and burns"].join("\n"),
      buttons: [[{ text: `${c.game === "chess" ? "♟" : "🎱"} Challenge the winner`, url: page }], escrowLink(c.closed.tx, "Payout")],
    };
  }
  return null; // refunds stay quiet
}

/** A free PvP or agent game that just started. */
export function freeDuelCard(g: LiveGame): { text: string; buttons: Button[][] } {
  const [a, b] = g.players;
  const tag = (p?: { name: string; agent?: boolean }) => (p ? `<b>${esc(p.name)}</b>${p.agent ? " 🤖" : ""}` : "?");
  const agents = g.players.some((p) => p.agent);
  return {
    text: [
      `${agents ? "🤖" : "⚔️"} <b>${agents ? "AGENT DUEL" : "DUEL ON"} · ${GAME[g.game]}</b>`, "",
      `${tag(a)}  🆚  ${tag(b)}`,
      g.game === "chess" && g.tc ? `⏱ ${esc(g.tc)} · free game` : "🎮 Free game",
    ].join("\n"),
    buttons: [[{ text: "👀 Watch live", url: `${config.publicUrl}${g.watch}` }, { text: "🎮 Play too", url: `${config.publicUrl}${PAGE[g.game]}` }]],
  };
}

const BET_GAME = { chess: "♟ NIGHT CHESS", pinball: "🎱 SPACE PINBALL", arena: "🤖 AGENT ARENA" } as const;
const watchUrl = (board: keyof typeof BET_GAME, id: string) => `${config.publicUrl}${board === "arena" ? "/arena" : PAGE[board]}?watch=${id}`;

/** Live betting: a big bet as it lands, and a settled pool (only when both sides had bets). */
export async function betCard(e: BetEvent): Promise<{ text: string; buttons: Button[][] } | null> {
  const m = e.market, [a, b] = m.names;
  const watch = [{ text: "👀 Watch and bet", url: watchUrl(m.board, m.id) }];
  if (e.kind === "big") {
    const side = e.bet.side === 0 ? a : b;
    return {
      text: [
        `🎯 <b>BIG LIVE BET · ${BET_GAME[m.board]}</b>`, "",
        `${who(undefined, e.bet.bettor)} put <b>${amount(e.bet.amount)} ${sym(m.token)}</b>${await usd(m.token, e.bet.amount)} on <b>${esc(side)}</b>`,
        `⚖️ Counted at <b>${(e.bet.weightBps / 10_000).toFixed(2)}x</b> · ${esc(a)} 🆚 ${esc(b)}`,
        `💰 Pool now <b>${amount((BigInt(m.totals.a) + BigInt(m.totals.b)).toString())} ${sym(m.token)}</b>`, "",
        "Early and underdog bets count more. The pool pays out on the server-verified result.",
      ].join("\n"),
      buttons: [watch, [{ text: "🔎 On chain", url: `https://etherscan.io/tx/${e.bet.tx}` }]],
    };
  }
  if (!m.closed || m.closed.kind !== "settled" || m.closed.outcome === undefined) return null;
  const p = payoutOf(m, m.closed.outcome);
  if (p.refundable || p.pool === 0n) return null; // a void or one-sided pool simply refunds
  const winner = m.closed.outcome === 0 ? a : b, loser = m.closed.outcome === 0 ? b : a;
  return {
    text: [
      `🏁 <b>LIVE BETS SETTLED · ${BET_GAME[m.board]}</b>`, "",
      `🏆 <b>${esc(winner)}</b> beat ${esc(loser)}`,
      `💰 Pool <b>${amount(p.pool.toString())} ${sym(m.token)}</b>${await usd(m.token, p.pool.toString())} · ${m.totals.bets} bet${m.totals.bets === 1 ? "" : "s"}`,
      `🎉 Winners share <b>${amount(p.winners.toString())} ${sym(m.token)}</b>: their stakes back plus 95% of the losing side`,
      `🔥 ${amount(p.fee.toString())} ${sym(m.token)} fee to stakers, NIGHT FROGS holders, the treasury and burns`,
    ].join("\n"),
    buttons: [[{ text: "🎮 Watch the next game", url: `${config.publicUrl}/games/live` }], [{ text: "🔎 Settlement", url: `https://etherscan.io/tx/${m.closed.tx}` }]],
  };
}
