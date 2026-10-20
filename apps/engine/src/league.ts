import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { IMD_TOKEN, type Market, type Quote } from "./imdmarket.js";

/**
 * THE NIGHT LEAGUE: AI agents (and their owners' strategies) trade the IMD ecosystem with paper
 * money at real prices. Adapted from Projects/agents (risk engine, forced exits, wash-excluded
 * PnL), made for markets this thin: every fill pays the pool fee and its own price impact against
 * the pool's real liquidity, and portfolios are marked at what they would actually get if they
 * sold now, so nobody climbs the board by "owning" a token nobody can sell into.
 *
 * Paper money only. No funds move; prices come from DexScreener and are labelled with their age.
 */
export const START_USD = 10_000;
export const RULES = {
  minTradeUsd: 10,
  /** One trade may use at most this share of the portfolio. */
  maxTradePct: 25,
  /** No single token may be more than this share of the portfolio after a buy (IMD excepted). */
  maxPositionPct: 40,
  maxPositions: 8,
  /** A trade that would move the pool more than this is refused, with the largest size that fits. */
  maxImpactBps: 300,
  cooldownMs: 30_000,
  tradesPerDay: 100,
  /** Prices older than this stop trading until the next read. */
  maxQuoteAgeMs: 15 * 60_000,
} as const;

export type Style = "momentum" | "contrarian" | "index" | "imd" | "agent";
/** entryUsd: what the holding was worth at the exit price right after it was bought, so exits measure the market's move, not the fees already paid. */
type Position = { qty: number; costUsd: number; openedAt: number; peakUsd: number; entryUsd?: number };
export type Trade = { at: number; token: string; symbol: string; side: "buy" | "sell"; usd: number; qty: number; priceUsd: number; impactBps: number; feeUsd: number; reason: string };
type Note = { at: number; kind: "trade" | "refused" | "exit" | "season"; text: string };
export type Entry = {
  id: string; name: string; owner: string | null; model: string; house: boolean; style: Style;
  cash: number; pos: Record<string, Position>; trades: Trade[]; notes: Note[];
  joinedAt: number; lastTradeAt: number; day: string; dayTrades: number; seasonsPlayed: number;
  /** House agents: when they last left each token, so they never churn in and out of one pool. */
  exits?: Record<string, number>;
};
export type Standing = { id: string; name: string; model: string; house: boolean; style: Style; equity: number; returnPct: number; trades: number; positions: number; feesUsd: number };
type Archive = { season: number; startedAt: number; endedAt: number; top: Standing[] };
type State = { season: number; seasonStart: number; entries: Record<string, Entry>; archive: Archive[] };

export class LeagueError extends Error { constructor(public status: number, message: string, public code: string) { super(message); } }

const half = (q: Quote) => q.liquidityUsd / 2;
/** A buy of `usd`: the fee comes off first, then the rest moves along a constant-product curve whose USD side is half the pool. */
export function buyFill(q: Quote, usd: number): { qty: number; feeUsd: number; impactBps: number; avgPrice: number } {
  const feeUsd = (usd * q.feeBps) / 10_000, net = usd - feeUsd, d = half(q);
  const qty = (net * d) / (d + net) / q.priceUsd;
  return { qty, feeUsd, impactBps: Math.round((net / (d + net)) * 10_000), avgPrice: qty > 0 ? usd / qty : 0 };
}
/** What selling `qty` brings now, after its impact and the fee. */
export function sellFill(q: Quote, qty: number): { usd: number; feeUsd: number; impactBps: number } {
  const v = qty * q.priceUsd, d = half(q);
  const gross = (v * d) / (d + v), feeUsd = (gross * q.feeBps) / 10_000;
  return { usd: gross - feeUsd, feeUsd, impactBps: Math.round((v / (d + v)) * 10_000) };
}
/** The largest buy whose impact stays at or under `bps`. */
export const maxBuyUsd = (q: Quote, bps: number) => ((bps / 10_000) * half(q)) / (1 - bps / 10_000) / (1 - q.feeBps / 10_000);

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Seasons run Monday 00:00 UTC to the next Monday. */
export function seasonStartOf(t: number): number {
  const d = new Date(t);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000;
  return monday;
}

const HOUSE: { id: string; name: string; style: Style; about: string }[] = [
  { id: "house-imd", name: "IMD Holder", style: "imd", about: "Benchmark: 90% IMD from the first minute, never trades again." },
  { id: "house-index", name: "Night Index", style: "index", about: "Equal weight in the five deepest pools, rebalanced once a day." },
  { id: "house-momentum", name: "Momentum Frog", style: "momentum", about: "Buys the strongest hour, takes profit at +10%, stops at -6%." },
  { id: "house-contrarian", name: "Contrarian Frog", style: "contrarian", about: "Buys deep 24h dips in pools over $10k, exits at +15% or -12%." },
];
export const houseAbout = Object.fromEntries(HOUSE.map((h) => [h.id, h.about]));

export class League {
  private s: State;
  private saveTimer: NodeJS.Timeout | null = null;
  constructor(private file: string | null, private now: () => number = Date.now) {
    const fresh: State = { season: 1, seasonStart: seasonStartOf(now()), entries: {}, archive: [] };
    let s = fresh;
    try { if (file && existsSync(file)) s = { ...fresh, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { s = fresh; }
    this.s = s;
    for (const h of HOUSE) if (!this.s.entries[h.id]) this.s.entries[h.id] = this.blank(h.id, h.name, null, "rules", true, h.style);
  }

  private blank(id: string, name: string, owner: string | null, model: string, house: boolean, style: Style): Entry {
    return { id, name, owner, model, house, style, cash: START_USD, pos: {}, trades: [], notes: [], joinedAt: this.now(), lastTradeAt: 0, day: "", dayTrades: 0, seasonsPlayed: 0 };
  }
  private save(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 2_000);
    this.saveTimer.unref?.();
  }
  flush(): void { if (this.file) writeAtomic(this.file, JSON.stringify(this.s)); }
  get season() { return { n: this.s.season, startedAt: this.s.seasonStart, endsAt: this.s.seasonStart + 7 * 86_400_000 }; }

  /** A new week archives the top ten and resets every portfolio to $10,000. */
  rollSeason(m: Market | null): boolean {
    const start = seasonStartOf(this.now());
    if (start <= this.s.seasonStart) return false;
    const top = this.standings(m).slice(0, 10);
    this.s.archive.unshift({ season: this.s.season, startedAt: this.s.seasonStart, endedAt: start, top });
    this.s.archive = this.s.archive.slice(0, 52);
    for (const e of Object.values(this.s.entries)) {
      const keep = { id: e.id, name: e.name, owner: e.owner, model: e.model, house: e.house, style: e.style, seasonsPlayed: e.seasonsPlayed + 1 };
      this.s.entries[e.id] = { ...this.blank(e.id, e.name, e.owner, e.model, e.house, e.style), ...keep, notes: [{ at: this.now(), kind: "season", text: `Season ${this.s.season + 1} started: $${START_USD.toLocaleString("en-US")} paper, no positions.` }] };
    }
    this.s.season++;
    this.s.seasonStart = start;
    this.save();
    return true;
  }

  /** An arena agent enters (or comes back): same identity, same key, its own portfolio. */
  join(a: { id: string; name: string; owner: string; model: string }): Entry {
    const e = this.s.entries[a.id];
    if (e) { e.name = a.name; e.model = a.model || e.model; this.save(); return e; }
    const n = this.blank(a.id, a.name, a.owner, a.model || "undisclosed", false, "agent");
    n.notes.push({ at: this.now(), kind: "season", text: `Joined season ${this.s.season} with $${START_USD.toLocaleString("en-US")} paper.` });
    this.s.entries[a.id] = n;
    this.save();
    return n;
  }
  entry(id: string): Entry | null { return this.s.entries[id] ?? null; }

  equity(e: Entry, m: Market | null): number {
    let v = e.cash;
    for (const [addr, p] of Object.entries(e.pos)) {
      const q = m?.tokens.find((t) => t.address === addr);
      // a token that left the tradable list is marked at zero: it cannot be sold into
      if (q) v += sellFill(q, p.qty).usd;
    }
    return v;
  }

  standings(m: Market | null): Standing[] {
    return Object.values(this.s.entries).map((e) => {
      const equity = this.equity(e, m);
      return { id: e.id, name: e.name, model: e.model, house: e.house, style: e.style, equity: Math.round(equity * 100) / 100, returnPct: Math.round(((equity - START_USD) / START_USD) * 10_000) / 100, trades: e.trades.length, positions: Object.keys(e.pos).length, feesUsd: Math.round(e.trades.reduce((a, t) => a + t.feeUsd, 0) * 100) / 100 };
    }).sort((a, b) => b.equity - a.equity || a.trades - b.trades);
  }
  /** Average return per declared model, agents only (house rules excluded). */
  byModel(m: Market | null): { model: string; agents: number; avgReturnPct: number; best: number }[] {
    const g = new Map<string, number[]>();
    for (const s of this.standings(m)) if (!s.house) g.set(s.model, [...(g.get(s.model) ?? []), s.returnPct]);
    return [...g].map(([model, r]) => ({ model, agents: r.length, avgReturnPct: Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100) / 100, best: Math.max(...r) })).sort((a, b) => b.avgReturnPct - a.avgReturnPct);
  }
  archive() { return this.s.archive; }
  feed(limit = 40): (Trade & { agent: string; name: string; house: boolean })[] {
    return Object.values(this.s.entries).flatMap((e) => e.trades.slice(-limit).map((t) => ({ ...t, agent: e.id, name: e.name, house: e.house }))).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  view(e: Entry, m: Market | null) {
    const positions = Object.entries(e.pos).map(([address, p]) => {
      const q = m?.tokens.find((t) => t.address === address);
      const value = q ? sellFill(q, p.qty).usd : 0;
      return { address, symbol: q?.symbol ?? "delisted", qty: p.qty, costUsd: round(p.costUsd), valueUsd: round(value), pnlPct: p.costUsd ? round(((value - p.costUsd) / p.costUsd) * 100) : 0, openedAt: p.openedAt };
    });
    const equity = this.equity(e, m);
    return {
      id: e.id, name: e.name, model: e.model, house: e.house, style: e.style, about: houseAbout[e.id] ?? null, season: this.season,
      cashUsd: round(e.cash), equityUsd: round(equity), returnPct: round(((equity - START_USD) / START_USD) * 100), positions,
      trades: e.trades.slice(-50).reverse(), notes: e.notes.slice(-30).reverse(), tradesToday: e.day === dayOf(this.now()) ? e.dayTrades : 0,
    };
  }

  /** One trade, checked against the rules. `usd` sizes a buy; `fraction` (0–1] of the holding sizes a sell. */
  trade(id: string, m: Market | null, t: { token: string; side: "buy" | "sell"; usd?: number; fraction?: number; reason?: string }, house = false): Trade {
    const e = this.s.entries[id];
    if (!e) throw new LeagueError(404, "Join the league first: POST /api/league/join.", "not_joined");
    const now = this.now();
    if (!m || now - m.at > RULES.maxQuoteAgeMs) throw new LeagueError(503, "Prices are stale; trading resumes at the next market read.", "stale_prices");
    const q = m.tokens.find((x) => x.address === String(t.token).toLowerCase() || x.symbol.toLowerCase() === String(t.token).toLowerCase());
    if (!q) throw new LeagueError(400, "That token is not tradable here: only IMD and IMD launches with at least $2,000 of liquidity (GET /api/league/market).", "not_tradable");
    if (!house && now - e.lastTradeAt < RULES.cooldownMs) throw new LeagueError(429, `One trade every ${RULES.cooldownMs / 1000} seconds.`, "cooldown");
    if (e.day !== dayOf(now)) { e.day = dayOf(now); e.dayTrades = 0; }
    if (e.dayTrades >= RULES.tradesPerDay) throw new LeagueError(429, `${RULES.tradesPerDay} trades a day at most.`, "day_limit");
    const reason = String(t.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
    const equity = this.equity(e, m);
    let trade: Trade;
    if (t.side === "buy") {
      const usd = Number(t.usd);
      if (!(usd >= RULES.minTradeUsd)) throw new LeagueError(400, `usd: at least $${RULES.minTradeUsd}.`, "bad_size");
      if (usd > e.cash + 1e-9) throw new LeagueError(400, `Only $${round(e.cash)} in cash.`, "no_cash");
      if (usd > (equity * RULES.maxTradePct) / 100) throw new LeagueError(400, `One trade may use at most ${RULES.maxTradePct}% of the portfolio ($${round((equity * RULES.maxTradePct) / 100)}).`, "too_big");
      const held = e.pos[q.address];
      if (!held && Object.keys(e.pos).length >= RULES.maxPositions) throw new LeagueError(400, `${RULES.maxPositions} positions at most: sell one first.`, "max_positions");
      const f = buyFill(q, usd);
      if (f.impactBps > RULES.maxImpactBps) throw new LeagueError(400, `That moves the ${q.symbol} pool ${(f.impactBps / 100).toFixed(1)}%; the limit is ${RULES.maxImpactBps / 100}%. Largest buy now: $${Math.floor(maxBuyUsd(q, RULES.maxImpactBps))}.`, "impact");
      const after = (held ? sellFill(q, held.qty + f.qty).usd : sellFill(q, f.qty).usd);
      if (q.address !== IMD_TOKEN && after > (equity * RULES.maxPositionPct) / 100) throw new LeagueError(400, `${q.symbol} would be over ${RULES.maxPositionPct}% of the portfolio.`, "concentration");
      e.cash -= usd;
      const p = held ?? { qty: 0, costUsd: 0, openedAt: now, peakUsd: 0, entryUsd: 0 };
      p.entryUsd = (p.entryUsd ?? (held ? sellFill(q, held.qty).usd : 0)) + (after - (held ? sellFill(q, held.qty).usd : 0));
      p.qty += f.qty; p.costUsd += usd; p.peakUsd = Math.max(p.peakUsd, after);
      e.pos[q.address] = p;
      trade = { at: now, token: q.address, symbol: q.symbol, side: "buy", usd: round(usd), qty: f.qty, priceUsd: f.avgPrice, impactBps: f.impactBps, feeUsd: round(f.feeUsd), reason };
    } else {
      const held = e.pos[q.address];
      if (!held) throw new LeagueError(400, `No ${q.symbol} to sell.`, "no_position");
      const fraction = t.fraction === undefined ? 1 : Number(t.fraction);
      if (!(fraction > 0 && fraction <= 1)) throw new LeagueError(400, "fraction: more than 0, at most 1 (the share of the holding to sell).", "bad_size");
      const qty = fraction === 1 ? held.qty : held.qty * fraction;
      const f = sellFill(q, qty);
      e.cash += f.usd;
      const costOut = held.costUsd * (qty / held.qty);
      if (held.entryUsd !== undefined) held.entryUsd -= held.entryUsd * (qty / held.qty);
      held.qty -= qty; held.costUsd -= costOut;
      if (fraction === 1 || held.qty <= 0) { delete e.pos[q.address]; (e.exits ??= {})[q.address] = now; }
      trade = { at: now, token: q.address, symbol: q.symbol, side: "sell", usd: round(f.usd), qty, priceUsd: qty ? f.usd / qty : 0, impactBps: f.impactBps, feeUsd: round(f.feeUsd), reason };
    }
    e.trades.push(trade);
    e.trades = e.trades.slice(-500);
    e.notes.push({ at: now, kind: "trade", text: `${trade.side === "buy" ? "Bought" : "Sold"} ${trade.symbol} for $${trade.usd} (impact ${(trade.impactBps / 100).toFixed(2)}%)${reason ? `: ${reason}` : ""}` });
    e.notes = e.notes.slice(-200);
    e.lastTradeAt = now; e.dayTrades++;
    this.save();
    return trade;
  }

  private refuse(e: Entry, text: string) { e.notes.push({ at: this.now(), kind: "refused", text }); e.notes = e.notes.slice(-200); }

  /** The house agents' rules, once per market read. Deterministic: anyone can recompute them from the trades. */
  runHouse(m: Market | null): void {
    if (!m || this.now() - m.at > RULES.maxQuoteAgeMs) return;
    const go = (id: string, t: Parameters<League["trade"]>[2]) => { try { this.trade(id, m, t, true); } catch (err) { this.refuse(this.s.entries[id]!, (err as Error).message); } };
    const imd = m.tokens.find((t) => t.address === IMD_TOKEN);
    const others = m.tokens.filter((t) => t.address !== IMD_TOKEN);

    const holder = this.s.entries["house-imd"]!;
    if (imd && !holder.pos[IMD_TOKEN] && holder.trades.length === 0) {
      // in tranches the impact rule allows, until 90% is in IMD
      for (let i = 0; i < 4 && holder.cash > START_USD * 0.1; i++) go("house-imd", { token: IMD_TOKEN, side: "buy", usd: Math.min(holder.cash - START_USD * 0.1, Math.floor(maxBuyUsd(imd, RULES.maxImpactBps)), Math.floor(this.equity(holder, m) * RULES.maxTradePct / 100)), reason: "benchmark: hold IMD" });
    }

    const index = this.s.entries["house-index"]!;
    if (index.day !== dayOf(this.now()) || index.trades.length === 0) {
      const five = [...m.tokens].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 5);
      for (const addr of Object.keys(index.pos)) if (!five.some((t) => t.address === addr)) go("house-index", { token: addr, side: "sell", reason: "left the five deepest pools" });
      const target = this.equity(index, m) / 5;
      for (const t of five) {
        const have = index.pos[t.address] ? sellFill(t, index.pos[t.address]!.qty).usd : 0;
        const gap = Math.min(target - have, index.cash, Math.floor(maxBuyUsd(t, RULES.maxImpactBps)));
        if (gap >= 50) go("house-index", { token: t.address, side: "buy", usd: Math.floor(gap), reason: "daily rebalance to equal weight" });
      }
      index.day = dayOf(this.now());
    }

    const exits = (id: string, tp: number, sl: number) => {
      const e = this.s.entries[id]!;
      for (const [addr, p] of Object.entries(e.pos)) {
        const q = m.tokens.find((t) => t.address === addr);
        if (!q) continue;
        // the market's move since entry (fees and impact were paid already and are in the score, not in the signal)
        const base = p.entryUsd ?? p.costUsd;
        const pnl = ((sellFill(q, p.qty).usd - base) / base) * 100;
        if (pnl >= tp) go(id, { token: addr, side: "sell", reason: `take profit ${pnl.toFixed(1)}%` });
        else if (pnl <= -sl) go(id, { token: addr, side: "sell", reason: `stop loss ${pnl.toFixed(1)}%` });
      }
    };
    exits("house-momentum", 10, 6);
    exits("house-contrarian", 15, 12);
    const rested = (e: Entry, a: string) => this.now() - (e.exits?.[a] ?? 0) > 6 * 3_600_000;
    const mo = this.s.entries["house-momentum"]!;
    const hot = others.filter((t) => t.change1h > 2 && t.volume24 > 500 && !mo.pos[t.address] && rested(mo, t.address)).sort((a, b) => b.change1h - a.change1h)[0];
    if (hot && mo.cash > 100) go("house-momentum", { token: hot.address, side: "buy", usd: Math.min(Math.floor(this.equity(mo, m) * 0.12), Math.floor(mo.cash), Math.floor(maxBuyUsd(hot, RULES.maxImpactBps))), reason: `strongest hour: +${hot.change1h.toFixed(1)}%` });
    const co = this.s.entries["house-contrarian"]!;
    const dip = others.filter((t) => t.change24h < -15 && t.liquidityUsd > 10_000 && !co.pos[t.address] && rested(co, t.address)).sort((a, b) => a.change24h - b.change24h)[0];
    if (dip && co.cash > 100) go("house-contrarian", { token: dip.address, side: "buy", usd: Math.min(Math.floor(this.equity(co, m) * 0.15), Math.floor(co.cash), Math.floor(maxBuyUsd(dip, RULES.maxImpactBps))), reason: `24h dip ${dip.change24h.toFixed(1)}%` });
    this.save();
  }
}

const round = (x: number) => Math.round(x * 100) / 100;

let theLeague: League | null = null;
export const liveLeague = () => (theLeague ??= new League(join(config.dataDir, "league.json")));
