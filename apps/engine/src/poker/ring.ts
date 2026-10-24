import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../atomic.js";
import { LoungeError } from "../chess.js";
import { config } from "../config.js";
import type { Look } from "../pool.js";
import { ACTION_MS, EMOTE_GAP_MS, EMOTE_SHOW_MS, HAND_GAP_MS, RUNOUT_MS, SHOWDOWN_MS, cleanName, sidePots } from "../poker.js";
import { botAction, thinkMs } from "./bot.js";
import type { Card } from "./cards.js";
import { cleanSeed, commitOf, deckOrder, newServerSeed } from "./deck.js";
import { type Action, Hand, type LogLine, type Pot, PokerError, type Result } from "./hand.js";

/**
 * NIGHT POKER's free tables: ring games of two to six seats with play chips, which have no cash
 * value. Sit in any empty seat with a buy-in from your play chips (a signed-in wallet gets 10,000 a
 * day, topped up at 00:00 UTC; a guest sits with a fresh buy-in each time), sit out, top up, stand up
 * between hands. The button moves to the next seat dealt in each hand; with two left the heads-up
 * rules apply (poker/hand.ts). House frogs fill empty seats so a table is always playable: they are
 * labelled HOUSE, play only what their seat sees (poker/bot.ts), and stand up when people arrive,
 * leaving a seat free. The first table always plays, with frogs alone if nobody is there, so there is
 * always a table to watch.
 *
 * Free tables are never rated, never staked and never bet on: nothing here reaches GameEscrow,
 * BetPool, the ratings, the profiles or the weekly prizes. Each hand's deck is provably fair as in a
 * heads-up match; a hand's server seed is shown once every person dealt into it has left the table
 * (or an hour later), so nobody at the table learns what their rivals folded.
 */
export const RING_SEATS = 6;
export const RING_BLINDS: readonly [number, number] = [10, 20];
export const BUY_IN = { min: 800, max: 2_000 } as const;
/** A signed-in wallet's play chips are topped up to this each UTC day. */
export const DAILY_CHIPS = 10_000;
/** A seat's time bank at the table. */
export const RING_BANK_MS = 30_000;
/** A seated player with no open stream this long between hands, or sitting out this long, stands up (chips back). */
export const AWAY_STAND_MS = 90_000, SIT_OUT_MS = 5 * 60_000;
/** People and frogs a table plays with when someone is there: frogs fill up to this, never the last free seat. */
export const TARGET_PLAYERS = 4;
export const TABLES = [{ name: "LILY PAD" }, { name: "MOON DOCK" }, { name: "THE CRATER" }] as const;
const FROGS = ["Frog #7", "Frog #1", "Frog #2", "Frog #13", "Frog #42", "Frog #77", "Frog #99", "Frog #256", "Frog #314", "Frog #404"];
const PLAIN: Look = { cue: "cue-crew", cloth: "cloth-night", table: "table-shift", balls: "balls-classic", frame: "frame-none", banner: "banner-shift", title: "title-rookie", effect: "effect-sparks", emotes: ["emote-gg", "emote-nice", "emote-oops"] };
const STREET_CARDS = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;

type RingSeat = {
  id: string; name: string; wallet: string | null; stack: number; bot: boolean; look: Look;
  streams: number; offlineAt: number | null; sittingOut: boolean; sitOutAt: number | null; leaving: boolean; joinedAt: number;
  bank: number; seeds: Map<number, string>; timeouts: number;
};
type RingRecord = {
  n: number; button: number; blinds: [number, number]; commit: string; serverSeed: string; clientSeeds: string[];
  stacks: number[]; names: (string | null)[]; board: Card[]; hole: (Card[] | null)[]; shown: number[]; log: LogLine[];
  pots: Pot[]; won: { [seat: number]: number }; uncalled: Result["uncalled"]; hands: Result["hands"]; showdown: boolean; at: number;
  /** The people dealt into the hand (their seat tokens): the seed is shown once none of them is at the table. */
  people: string[];
};
type Table = {
  id: string; name: string; index: number; seats: (RingSeat | null)[]; button: number | null; version: number; stamp: string;
  hand: Hand | null;
  cur: { n: number; serverSeed: string; commit: string; seeds: string[]; dealt: number[]; at: number; stacks: number[]; people: string[] } | null;
  next: { n: number; serverSeed: string; commit: string; dealAt: number };
  turnAt: number; reveal: { from: number; at: number; resultAt: number; nextAt: number } | null;
  history: RingRecord[]; plan: { key: string; at: number; action: Action } | null; emotes: { seat: number; id: string; at: number }[];
};
type Ledger = { [wallet: string]: { chips: number; day: number; held: number } };
const dayOf = (t: number) => Math.floor(t / 86_400_000);

export class RingTables {
  private tables: Table[] = [];
  private listeners = new Map<string, Set<() => void>>();
  private ledger: Ledger = {};
  constructor(private file: string | null = join(config.dataDir, "poker-chips.json"), private now = () => Date.now(), private random: () => number = Math.random,
    private looks: (key: string | null, staked: boolean) => Look = () => PLAIN, private house = true) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8")) as Ledger;
        // the tables are in memory: chips that were at a table when the server stopped go back to the wallet
        for (const [w, e] of Object.entries(d)) if (/^0x[0-9a-f]{40}$/.test(w) && Number.isInteger(e.chips)) this.ledger[w] = { chips: e.chips + Math.max(0, e.held | 0), day: e.day | 0, held: 0 };
      }
    } catch { /* an unreadable ledger starts everyone at the daily chips */ }
    TABLES.forEach((t, index) => {
      const seed = newServerSeed();
      this.tables.push({ id: randomBytes(10).toString("hex"), name: t.name, index, seats: Array.from({ length: RING_SEATS }, () => null), button: null, version: 0, stamp: "",
        hand: null, cur: null, next: { n: 1, serverSeed: seed, commit: commitOf(seed), dealAt: this.now() + 2_000 }, turnAt: this.now(), reveal: null, history: [], plan: null, emotes: [] });
    });
  }
  setLooks(f: (key: string | null, staked: boolean) => Look): void { this.looks = f; }
  private save() { if (this.file) try { writeAtomic(this.file, JSON.stringify(this.ledger)); } catch (e) { console.error("poker chips", (e as Error).message); } }
  private emit(t: Table) { t.version++; for (const f of this.listeners.get(t.id) ?? []) f(); }
  private table(id: string) { const t = this.tables.find((x) => x.id === id); if (!t) throw new LoungeError(404, "No such table"); return t; }
  private seatOf(t: Table, token: string) { const i = t.seats.findIndex((s) => s?.id === token); if (i < 0) throw new LoungeError(404, "No such seat"); return i; }
  has(id: string): boolean { return this.tables.some((t) => t.id === id); }

  // ---- play chips

  /** A wallet's play chips now (topped up to DAILY_CHIPS once a UTC day). */
  chips(wallet: string | null): number | null {
    if (!wallet) return null;
    return this.entry(wallet).chips;
  }
  private entry(wallet: string) {
    const w = wallet.toLowerCase(), today = dayOf(this.now());
    const e = this.ledger[w] ??= { chips: DAILY_CHIPS, day: today, held: 0 };
    if (e.day !== today) { e.day = today; if (e.chips < DAILY_CHIPS) e.chips = DAILY_CHIPS; this.save(); }
    return e;
  }
  /** What a seat's chips are worth to its wallet: held at the table, given back when it stands up. */
  private hold(s: RingSeat, stack: number) { if (s.wallet && !s.bot) { this.entry(s.wallet).held = stack; this.save(); } }
  private payBack(s: RingSeat) { if (s.wallet && !s.bot) { const e = this.entry(s.wallet); e.chips += s.stack; e.held = 0; this.save(); } }

  // ---- seats

  private live(t: Table) { return !!t.hand && t.hand.street !== "done"; }
  private inHand(t: Table, seat: number) { const p = t.hand?.player(seat); return this.live(t) && !!p && !p.folded; }
  /** Sit down in an empty seat with a buy-in (play chips): dealt in from the next hand. */
  sit(id: string, seat: unknown, name: string, wallet: string | null, buyIn: unknown) {
    const t = this.table(id), i = Number(seat), amount = Math.floor(Number(buyIn ?? BUY_IN.max));
    if (!Number.isInteger(i) || i < 0 || i >= RING_SEATS) throw new LoungeError(400, "Pick a seat from 1 to 6.");
    if (t.seats[i]) throw new LoungeError(409, "That seat is taken. Pick an empty one.");
    if (!(amount >= BUY_IN.min && amount <= BUY_IN.max)) throw new LoungeError(400, `Buy in with ${BUY_IN.min} to ${BUY_IN.max} chips.`);
    const w = wallet ? wallet.toLowerCase() : null;
    if (w && this.tables.some((x) => x.seats.some((s) => s && !s.bot && s.wallet === w))) throw new LoungeError(409, "You already have a seat at a free table: stand up there first.");
    if (w) {
      const e = this.entry(w);
      if (e.chips < amount) throw new LoungeError(409, e.chips >= BUY_IN.min ? `You have ${e.chips} play chips: buy in with that or less.` : "You are out of play chips for today. They are topped up to 10,000 at 00:00 UTC.");
      e.chips -= amount; e.held = amount; this.save();
    }
    const look = this.safeLook(w);
    if (!look.avatar) look.avatar = `/games/pinball/frog-${randomInt(5)}.webp`;
    const s: RingSeat = { id: randomUUID(), name: cleanName(name, w), wallet: w, stack: amount, bot: false, look, streams: 0, offlineAt: this.now(), sittingOut: false, sitOutAt: null,
      leaving: false, joinedAt: this.now(), bank: RING_BANK_MS, seeds: new Map(), timeouts: 0 };
    t.seats[i] = s;
    this.emit(t);
    return { table: this.view(t, s.id), player: s.id };
  }
  private safeLook(key: string | null): Look { try { return { ...this.looks(key, false) }; } catch { return { ...PLAIN }; } }
  /** Stand up: at once between hands, else folded (on your turn) and stood up when the hand ends. Chips back to the wallet. */
  leave(id: string, token: string) {
    const t = this.table(id), i = this.seatOf(t, token), s = t.seats[i]!;
    if (this.inHand(t, i)) {
      s.leaving = true;
      const turn = this.turn(t);
      if (turn === i) this.apply(t, i, { kind: "fold" }, true);
      this.emit(t);
      return { leaving: true };
    }
    this.stand(t, i);
    return { leaving: false };
  }
  private stand(t: Table, i: number) {
    const s = t.seats[i];
    if (!s) return;
    this.payBack(s);
    t.seats[i] = null;
    this.emit(t);
  }
  /** A new name at the table (a signed-in player's saved name wins, as when sitting down). */
  rename(id: string, token: string, name: unknown) {
    const t = this.table(id), s = t.seats[this.seatOf(t, token)]!;
    s.name = cleanName(String(name ?? ""), s.wallet);
    this.emit(t);
    return { table: this.view(t, s.id) };
  }
  /** Sit out (not dealt in) or come back. */
  sitOut(id: string, token: string, on: unknown) {
    const t = this.table(id), s = t.seats[this.seatOf(t, token)]!;
    s.sittingOut = on === true || on === "true" || on === 1; s.sitOutAt = s.sittingOut ? this.now() : null;
    this.emit(t);
    return this.view(t, token);
  }
  /** Top up a seat to at most the full buy-in, between hands, from the wallet's play chips (a guest's own seat: free). */
  topUp(id: string, token: string) {
    const t = this.table(id), i = this.seatOf(t, token), s = t.seats[i]!;
    if (this.inHand(t, i) || (this.live(t) && t.hand!.player(i))) throw new LoungeError(409, "Top up between hands.");
    const add = BUY_IN.max - s.stack;
    if (add <= 0) throw new LoungeError(409, "Your stack is already the full buy-in.");
    if (s.wallet) {
      const e = this.entry(s.wallet);
      const take = Math.min(add, e.chips);
      if (take <= 0) throw new LoungeError(409, "You are out of play chips for today. They are topped up to 10,000 at 00:00 UTC.");
      e.chips -= take; s.stack += take; e.held = s.stack; this.save();
    } else s.stack += add;
    if (s.sittingOut && s.stack > 0 && s.sitOutAt !== null) { s.sittingOut = false; s.sitOutAt = null; }
    this.emit(t);
    return this.view(t, token);
  }

  // ---- the hands

  private turn(t: Table): number | null { const h = t.hand; return h && h.street !== "done" && h.toAct !== null ? h.players[h.toAct]!.seat : null; }
  /** Who is dealt into the next hand: chips, not sitting out, not standing up. */
  private dealable(t: Table) { return t.seats.map((s, i) => [s, i] as const).filter(([s]) => s && s.stack > 0 && !s.sittingOut && !s.leaving).map(([, i]) => i); }
  /** Between hands: who stands up, the frogs that come and go, then the deal if two or more can play. */
  private betweenHands(t: Table) {
    const now = this.now();
    t.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving) return this.stand(t, i);
      // a frog rebuys when short, and racks back to a full buy-in when its winnings pile up
      if (s.bot) { if (s.stack < BUY_IN.max * 0.4 || s.stack > BUY_IN.max * 3) s.stack = BUY_IN.max; return; }
      // away too long, or sitting out too long: stood up, the chips go back
      if ((s.streams === 0 && s.offlineAt !== null && now - s.offlineAt > AWAY_STAND_MS) || (s.sittingOut && s.sitOutAt !== null && now - s.sitOutAt > SIT_OUT_MS)) return this.stand(t, i);
      if (s.stack === 0 && !s.sittingOut) { s.sittingOut = true; s.sitOutAt = now; }
    });
    this.frogs(t);
  }
  /**
   * The house frogs: with people at the table they fill up to TARGET_PLAYERS, never the last free
   * seat; the first table keeps them playing on its own when nobody is there. They stand up when
   * people arrive.
   */
  private frogs(t: Table) {
    if (!this.house) return;
    const people = t.seats.filter((s) => s && !s.bot).length, frogs = t.seats.map((s, i) => [s, i] as const).filter(([s]) => s?.bot);
    const want = people === 0 && t.index > 0 ? 0 : Math.max(0, Math.min(TARGET_PLAYERS - people, RING_SEATS - people - 1));
    for (const [, i] of frogs.slice(want).reverse()) t.seats[i] = null;
    let n = frogs.length;
    const used = new Set(t.seats.filter((s) => s?.bot).map((s) => s!.name));
    while (n < want) {
      const empty = t.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (!empty.length) break;
      const name = FROGS.find((f) => !used.has(f)) ?? `Frog #${100 + randomInt(400)}`;
      used.add(name);
      const num = /#(\d+)/.exec(name)![1];
      t.seats[empty[randomInt(empty.length)]!] = { id: randomUUID(), name, wallet: null, stack: BUY_IN.max, bot: true, look: { ...PLAIN, avatar: `/api/pinball/frog/${Number(num)}-128.png` }, streams: 1, offlineAt: null,
        sittingOut: false, sitOutAt: null, leaving: false, joinedAt: this.now(), bank: RING_BANK_MS, seeds: new Map(), timeouts: 0 };
      n++;
    }
  }
  private deal(t: Table) {
    const now = this.now();
    this.betweenHands(t);
    const dealt = this.dealable(t);
    if (dealt.length < 2) { t.next.dealAt = now + 2_000; t.hand = null; t.reveal = null; this.emit(t); return; }
    // the button moves to the next seat dealt in (the first hand: one by lot)
    const button = t.button === null ? dealt[randomInt(dealt.length)]! : dealt.find((i) => i > t.button!) ?? dealt[0]!;
    t.button = button;
    const nx = t.next, seeds = dealt.map((i) => (t.seats[i]!.bot ? "" : t.seats[i]!.seeds.get(nx.n) ?? ""));
    for (const s of t.seats) if (s) for (const k of s.seeds.keys()) if (k <= nx.n) s.seeds.delete(k);
    const [sb, bb] = RING_BLINDS;
    t.hand = new Hand({ n: nx.n, seats: dealt.map((i) => ({ seat: i, stack: t.seats[i]!.stack })), button, sb, bb, deck: deckOrder(nx.serverSeed, seeds, nx.n) });
    t.cur = { n: nx.n, serverSeed: nx.serverSeed, commit: nx.commit, seeds, dealt, at: now, stacks: t.seats.map((s, i) => (dealt.includes(i) ? s!.stack : 0)), people: dealt.filter((i) => !t.seats[i]!.bot).map((i) => t.seats[i]!.id) };
    t.reveal = null; t.turnAt = now; t.plan = null;
    if (t.hand.street === "done") this.handOver(t);
    this.emit(t);
  }
  private handOver(t: Table) {
    const h = t.hand!, r = h.result!, now = this.now(), c = t.cur!;
    for (const p of h.players) { const s = t.seats[p.seat]; if (s) { s.stack = p.stack; this.hold(s, p.stack); } }
    const from = h.runout === null ? h.board.length : STREET_CARDS[h.runout];
    const steps = h.runout === null ? 0 : [3, 4, 5].filter((k) => k > from).length;
    const resultAt = now + steps * RUNOUT_MS + (r.showdown ? 600 : 0);
    t.reveal = { from, at: now, resultAt, nextAt: resultAt + (r.showdown ? SHOWDOWN_MS : HAND_GAP_MS) };
    t.history.push({ n: c.n, button: h.button, blinds: [h.sb, h.bb], commit: c.commit, serverSeed: c.serverSeed, clientSeeds: c.seeds, stacks: c.stacks,
      names: t.seats.map((s, i) => (c.dealt.includes(i) ? s?.name ?? null : null)), board: [...h.board],
      hole: t.seats.map((_, i) => h.player(i)?.hole ?? null), shown: r.shown, log: [...h.log], pots: r.pots, won: r.won, uncalled: r.uncalled, hands: r.hands, showdown: r.showdown, at: now, people: c.people });
    if (t.history.length > 200) t.history.shift();
    if (t.history.length % 10 === 0) for (const s of t.seats) if (s) s.bank = Math.min(45_000, s.bank + 5_000);
    t.plan = null;
    const seed = newServerSeed();
    t.next = { n: c.n + 1, serverSeed: seed, commit: commitOf(seed), dealAt: t.reveal.nextAt };
  }
  private apply(t: Table, seat: number, a: Action, chosen: boolean) {
    const s = t.seats[seat]!, now = this.now(), took = now - t.turnAt;
    if (took > ACTION_MS) s.bank = Math.max(0, s.bank - (took - ACTION_MS));
    try { t.hand!.act(seat, a); } catch (e) { throw new LoungeError(e instanceof PokerError ? 409 : 400, (e as Error).message); }
    if (!chosen) { s.timeouts++; if (!s.bot) { s.sittingOut = true; s.sitOutAt = now; } }
    t.turnAt = now; t.plan = null;
    if (t.hand!.street === "done") this.handOver(t);
    this.emit(t);
  }
  act(id: string, token: string, input: { kind?: unknown; to?: unknown }) {
    const t = this.table(id), i = this.seatOf(t, token);
    this.check(t);
    if (!this.live(t)) throw new LoungeError(409, "The next hand is being dealt.");
    if (this.turn(t) !== i) throw new LoungeError(409, "It is not your turn.");
    const kind = String(input.kind ?? "");
    if (!["fold", "check", "call", "raise"].includes(kind)) throw new LoungeError(400, "Fold, check, call or raise.");
    const to = kind === "raise" ? Number(input.to) : undefined;
    if (kind === "raise" && !Number.isInteger(to)) throw new LoungeError(400, "Say how much to raise to, in chips.");
    this.apply(t, i, { kind: kind as Action["kind"], ...(to !== undefined ? { to } : {}) }, true);
    return this.view(t, token);
  }
  seed(id: string, token: string, hand: unknown, seed: unknown) {
    const t = this.table(id), s = t.seats[this.seatOf(t, token)]!, v = cleanSeed(seed);
    if (!v) throw new LoungeError(400, "A seed is 1 to 64 letters, digits, - or _.");
    if (t.next.n !== Number(hand) || this.live(t) && t.cur?.n === Number(hand)) throw new LoungeError(409, "That hand is already dealt (or not committed yet).");
    if (!s.seeds.has(t.next.n)) { s.seeds.set(t.next.n, v); this.emit(t); }
    return { hand: t.next.n, seed: s.seeds.get(t.next.n)! };
  }
  emote(id: string, token: string, emote: string) {
    const t = this.table(id), i = this.seatOf(t, token), s = t.seats[i]!;
    if (!s.look.emotes.includes(emote)) throw new LoungeError(403, "That emote is not in your set.");
    const lastAt = t.emotes.filter((e) => e.seat === i).at(-1)?.at ?? 0;
    if (this.now() - lastAt < EMOTE_GAP_MS) throw new LoungeError(429, "One emote at a time.");
    t.emotes.push({ seat: i, id: emote, at: this.now() });
    if (t.emotes.length > 12) t.emotes.shift();
    this.emit(t);
  }
  private check(t: Table) {
    const now = this.now();
    if (!this.live(t)) { if (now >= t.next.dealAt) this.deal(t); return; }
    const seat = this.turn(t)!, s = t.seats[seat];
    if (!s) return;
    // standing up or gone: folded at once on their turn
    if (s.leaving) return this.apply(t, seat, { kind: "fold" }, false);
    if (s.bot) { try { this.think(t, seat); } catch (e) { console.error("poker table frog", (e as Error).message); } return; }
    // away with no stream: the shot clock only, no time bank
    const deadline = t.turnAt + ACTION_MS + (s.streams > 0 ? s.bank : 0);
    if (now >= deadline) { const l = t.hand!.legal()!; this.apply(t, seat, l.check ? { kind: "check" } : { kind: "fold" }, false); }
  }
  private think(t: Table, seat: number) {
    const h = t.hand!, me = h.player(seat)!, key = `${h.n}:${h.log.length}`, now = this.now();
    if (!t.plan || t.plan.key !== key) {
      const legal = h.legal()!;
      const view = { hole: me.hole, board: [...h.board], street: h.street as Exclude<typeof h.street, "done">, pot: h.pot(), bet: me.bet, stack: me.stack, currentBet: h.currentBet, bb: h.bb, opponents: h.inHand().length - 1, legal };
      t.plan = { key, action: botAction(view, this.random), at: now + thinkMs(view, this.random) };
      return;
    }
    if (now < t.plan.at) return;
    try { this.apply(t, seat, t.plan.action, true); } catch { this.apply(t, seat, h.legal()!.check ? { kind: "check" } : { kind: "fold" }, true); }
  }

  // ---- what each reader sees

  /** A hand's seed is shown once every person dealt into it has left the table, or an hour after it. */
  private sealed(t: Table, r: RingRecord) { return this.now() - r.at < 3_600_000 && r.people.some((id) => t.seats.some((s) => s?.id === id)); }
  private view(t: Table, token: string) {
    const now = this.now(), you = token ? t.seats.findIndex((s) => s?.id === token) : -1, me = you >= 0 ? you : null;
    const h = t.hand, rv = t.reveal, over = !!h && h.street === "done", showResult = over && !!rv && now >= rv.resultAt;
    let boardShown = h?.board.length ?? 0;
    if (h && over && rv) { boardShown = rv.from; [3, 4, 5].filter((k) => k > rv.from).forEach((k, i) => { if (now >= rv.at + (i + 1) * RUNOUT_MS) boardShown = k; }); }
    const shown = over && h.result ? h.result.shown : [];
    const turn = this.turn(t), legal = turn !== null && turn === me ? h!.legal() : null, actor = turn !== null ? t.seats[turn] : null;
    return {
      id: t.id, kind: "table" as const, name: t.name, seatsMax: RING_SEATS, blinds: RING_BLINDS, buyIn: BUY_IN, version: t.version, now,
      hand: h ? {
        n: h.n, street: h.street, button: h.button, sb: h.sb, bb: h.bb, sbSeat: h.sbSeat, bbSeat: h.bbSeat, board: h.board.slice(0, boardShown), currentBet: h.currentBet, minRaise: h.minRaise,
        pot: over ? (showResult ? 0 : h.result!.pots.reduce((n, p) => n + p.amount, 0)) : h.pot(),
        pots: over ? (showResult ? h.result!.pots : []) : sidePots(h),
        seats: h.players.map((p) => ({ seat: p.seat, bet: over ? 0 : p.bet, folded: p.folded, allIn: p.allIn, stack: over && !showResult ? p.stack - (h.result!.won[p.seat] ?? 0) : p.stack, cards: p.seat === me || shown.includes(p.seat) ? p.hole : null })),
        toAct: turn, commit: t.cur?.commit ?? null,
        result: showResult ? { pots: h.result!.pots, won: h.result!.won, uncalled: h.result!.uncalled, showdown: h.result!.showdown, hands: Object.fromEntries(Object.entries(h.result!.hands).filter(([s]) => shown.includes(Number(s)))) } : null,
        log: h.log, runout: h.runout,
      } : null,
      you: me, legal,
      clock: turn === null || !actor ? null : { seat: turn, turnAt: t.turnAt, actionMs: ACTION_MS, deadline: t.turnAt + ACTION_MS + (actor.streams > 0 || actor.bot ? actor.bank : 0) },
      // the next hand once it is committed (between hands): what a seat sends its seed for
      next: this.live(t) ? null : { n: t.next.n, commit: t.next.commit, dealAt: t.next.dealAt, seedSent: me !== null && !!t.seats[me]?.seeds.has(t.next.n) },
      history: t.history.slice(-30).reverse().map((r) => ({ n: r.n, button: r.button, blinds: r.blinds, stacks: r.stacks, names: r.names, board: r.board, log: r.log, pots: r.pots, won: r.won, uncalled: r.uncalled, showdown: r.showdown, at: r.at, cut: false,
        hole: r.hole.map((c, s) => (c && ((s === me && r.people.includes(token)) || r.shown.includes(s)) ? c : null)), shown: r.shown,
        hands: Object.fromEntries(Object.entries(r.hands).filter(([s]) => r.shown.includes(Number(s)))), commit: r.commit, serverSeed: this.sealed(t, r) ? null : r.serverSeed, clientSeeds: r.clientSeeds })),
      emotes: t.emotes.filter((e) => now - e.at < EMOTE_SHOW_MS),
      players: t.seats.map((s, i) => s ? { seat: i, name: s.name, rating: null, you: i === me, connected: s.bot || s.streams > 0, bot: s.bot, house: s.bot, avatar: s.look.avatar ?? null, level: s.look.level ?? null,
        emotes: i === me ? s.look.emotes : [], bank: s.bank, awayUntil: null, grace: null, sittingOut: s.sittingOut, leaving: s.leaving, stack: s.stack } : null),
      chips: me !== null ? this.chips(t.seats[me]!.wallet) : null, guest: me !== null && !t.seats[me]!.wallet,
    };
  }
  get(id: string, token: string) { const t = this.table(id); this.seatOf(t, token); this.check(t); return this.view(t, token); }
  watchView(id: string) { const t = this.table(id); this.check(t); return this.view(t, ""); }
  /** The free tables for the lobby: names, seats taken (people and frogs), the blinds. No token, no wallet. */
  list() {
    return this.tables.map((t) => ({ id: t.id, name: t.name, seats: RING_SEATS, blinds: RING_BLINDS, buyIn: BUY_IN, people: t.seats.filter((s) => s && !s.bot).length, frogs: t.seats.filter((s) => s?.bot).length,
      players: t.seats.filter((s): s is RingSeat => !!s).map((s) => ({ name: s.name, house: s.bot })), hand: t.hand?.n ?? null, live: this.dealable(t).length >= 2 || this.live(t) }));
  }
  /** The tables being played, for the spectators' list (never staked, never a market). */
  liveTables() {
    return this.tables.filter((t) => this.live(t) || (t.hand && t.reveal)).map((t) => ({ id: t.id, name: t.name, seats: RING_SEATS, taken: t.seats.filter(Boolean).length, startedAt: t.history[0]?.at ?? t.cur?.at ?? this.now(),
      players: t.seats.filter((s): s is RingSeat => !!s).map((s) => ({ name: s.name, ...(s.bot ? { house: true } : {}) })), people: t.seats.filter((s) => s && !s.bot).length }));
  }
  /** Betting never opens on a free table. */
  betInfo(_id: string): never { throw new Error("No betting on a free table"); }
  listen(id: string, token: string, f: () => void): () => void {
    const t = this.table(id), i = this.seatOf(t, token), s = t.seats[i]!;
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    s.streams++; s.offlineAt = null;
    this.emit(t);
    let closed = false;
    return () => { if (closed) return; closed = true; set.delete(f); if (t.seats[i] === s) { s.streams = Math.max(0, s.streams - 1); if (!s.streams) s.offlineAt = this.now(); } this.emit(t); };
  }
  watch(id: string, f: () => void): () => void {
    this.table(id);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    return () => { set.delete(f); };
  }
  tick() {
    for (const t of this.tables) {
      const before = t.version;
      this.check(t);
      const v = t.hand && t.reveal ? `${t.hand.n}:${[1, 2, 3].filter((i) => this.now() >= t.reveal!.at + i * RUNOUT_MS).length}:${this.now() >= t.reveal.resultAt}` : "";
      if (v !== t.stamp) { t.stamp = v; if (t.version === before) this.emit(t); }
    }
  }
}
/** The live tables, with the house frogs unless HOUSE_GAMES=0. They tick once the server starts them (startTables), not on import. */
export const ring = new RingTables(undefined, undefined, undefined, undefined, config.houseGames);
let ticking: ReturnType<typeof setInterval> | null = null;
export function startTables(): RingTables { ticking ??= setInterval(() => ring.tick(), 250); ticking.unref?.(); return ring; }
