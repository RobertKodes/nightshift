import { formatUnits } from "viem";
import { config } from "./config.js";
import { ESCROW, type Challenge, type DuelEvent } from "./escrow.js";
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
const who = (name: string | undefined, addr?: string) => {
  const n = name?.trim() ? `<b>${esc(name.trim())}</b>` : "";
  const a = addr ? `<a href="https://etherscan.io/address/${addr}">${short(addr)}</a>` : "";
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
  const escrowLink = (tx?: string, label = "On chain") => tx ? [{ text: `🔎 ${label}`, url: `https://etherscan.io/tx/${tx}` }] : [{ text: "🔎 GameEscrow", url: `https://etherscan.io/address/${ESCROW}` }];
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
