import { randomBytes } from "node:crypto";
import { type ChessGames, CONTROLS, LoungeError, type TimeControl, chess as liveChess } from "./chess.js";
import * as pinball from "./pinball.js";
import { type GameKind, type Profile, type Profiles, type Recent, START_ELO, type StartTarget, playKey } from "./tg.js";

/**
 * Games played from the Mini App, attributed to Telegram profiles. Seats are taken through the same
 * game engines as the website (queue, lounge, staked lobby): this only remembers which seat belongs
 * to which profile, follows each game the profile is in, and books the result once, on the profile.
 * It also keeps chess challenges (invites) made in Telegram, and tells the bot who to notify.
 */
type PinballSrc = Pick<typeof pinball, "queue" | "joinOpen" | "cancel" | "get" | "lounge" | "getWatch">;
export type PlaySources = { chess: ChessGames; pinball: PinballSrc };
const defaults = (): PlaySources => ({ chess: liveChess, pinball });

export type Role = "host" | "guest" | "invite" | "attached";
export type Seat = { game: GameKind; id: string; player: string; pid: string; role: Role; at: number; started: boolean; rating0: number | null };
/** A chess challenge made in Telegram: one rival may accept it, once, within INVITE_MS. */
export type Invite = { id: string; host: string; tc: TimeControl; createdAt: number; until: number; match?: string; guest?: string };
/** What the bot may tell a player in a DM (only players who pressed Start get one). */
export type Note =
  | { kind: "joined"; game: GameKind; id: string; rival: string }
  | { kind: "accepted"; game: "chess"; id: string; rival: string; tc: TimeControl }
  | { kind: "result"; game: GameKind; id: string; rival: string; result: Recent["result"]; elo: number; change: number; reason: string | null };

/** A seat the player can pick up again: the game, its state and the rival's public name. */
export type ActiveSeat = { game: GameKind; id: string; player: string; status: string; tc: TimeControl | null; rival: string | null };

export const INVITE_MS = 30 * 60_000;
/** Seats one profile follows at once, and open invites one profile holds. */
const MAX_SEATS = 8, MAX_INVITES = 3;
const INVITE_ID = /^[a-f0-9]{16}$/;
const AVATARS = [0, 1, 2, 3, 4].map((i) => `/games/pinball/frog-${i}.webp`);
/** A pinball face for a Telegram player: one of the crew's frogs, the same one every time. */
const avatarOf = (p: Profile) => AVATARS[parseInt(p.pid.slice(0, 2), 16) % AVATARS.length]!;

export class TgPlay {
  readonly seats: Seat[] = [];
  readonly invites = new Map<string, Invite>();
  #notes: ((p: Profile, n: Note) => void)[] = [];
  constructor(readonly profiles: Profiles, private src: PlaySources = defaults(), private now = () => Date.now()) {}
  onNote(f: (p: Profile, n: Note) => void): void { this.#notes.push(f); }
  #tell(p: Profile | undefined, n: Note) { if (p) for (const f of this.#notes) try { f(p, n); } catch (e) { console.error("tg note", e); } }

  #track(p: Profile, s: Omit<Seat, "pid" | "at" | "started" | "rating0"> & { rating0?: number | null; started?: boolean }): Seat {
    const live = this.seats.filter((x) => x.pid === p.pid);
    if (live.length >= MAX_SEATS) this.seats.splice(this.seats.indexOf(live[0]!), 1);
    const seat: Seat = { ...s, pid: p.pid, at: this.now(), started: s.started ?? false, rating0: s.rating0 ?? null };
    this.seats.push(seat);
    return seat;
  }
  #mine(p: Profile, game: GameKind, id: string) { return this.seats.find((s) => s.pid === p.pid && s.game === game && s.id === id); }

  /** Close one's own open game in the lounge. */
  cancel(p: Profile, game: GameKind, id: string): void {
    const seat = this.#mine(p, game, id), key = playKey(p);
    if (game === "chess") this.src.chess.cancel(id, seat?.player ?? null, key); else this.src.pinball.cancel(id, seat?.player ?? null, key);
    if (seat) this.seats.splice(this.seats.indexOf(seat), 1);
  }
  /**
   * Take a seat for a profile: queue (opens a game in the lounge if nobody waits), "any" (whoever
   * waits, any clock), or join one open game by id. Same rules as the website's queue and lounge,
   * with the profile's name and play key.
   */
  async play(p: Profile, o: { game: GameKind; action: "queue" | "any" | "join"; tc?: unknown; id?: unknown }) {
    const key = playKey(p), id = String(o.id ?? "");
    if (o.game === "chess") {
      const tc = String(o.tc ?? "3+2");
      if (o.action === "queue" && !Object.hasOwn(CONTROLS, tc)) throw new LoungeError(400, "Choose 3+2, 5+0 or 10+0");
      const r = o.action === "join" ? this.src.chess.join(id, p.name, key) : this.src.chess.queue(p.name, key, o.action === "any" ? "any" : tc as TimeControl);
      const started = r.match.status !== "waiting";
      this.#track(p, { game: "chess", id: r.match.id, player: r.player, role: started ? "guest" : "host", started, rating0: r.match.players.find((x) => x.you)?.rating ?? null });
      return { game: "chess" as const, ...r };
    }
    const r = o.action === "join" ? await this.src.pinball.joinOpen(id, p.name, key, avatarOf(p)) : await this.src.pinball.queue(p.name, key, "FREE", 0, avatarOf(p));
    const started = r.match.startedAt !== null && r.match.players.length === 2;
    this.#track(p, { game: "pinball", id: r.match.id, player: r.player, role: started ? "guest" : "host", started });
    return { game: "pinball" as const, ...r };
  }

  /** A seat got elsewhere (the staked lobby, the website): followed for this profile once it proves to be real. */
  attach(p: Profile, game: GameKind, id: string, player: string): Seat {
    const known = this.seats.find((s) => s.game === game && s.id === id && s.player === player);
    if (known) { if (known.pid !== p.pid) throw new LoungeError(409, "This seat belongs to another player."); return known; }
    let rating0: number | null = null, started = false;
    if (game === "chess") { const v = this.src.chess.get(id, player, true); rating0 = v.players.find((x) => x.you)?.rating ?? null; started = !!v.startedAt; }
    else { const v = this.src.pinball.get(id, player); if (!v || !v.players.some((x) => x.you)) throw new LoungeError(404, "No such seat."); started = v.startedAt !== null; }
    return this.#track(p, { game, id, player, role: "attached", started, rating0 });
  }

  /** The profile's seats in games that are still on, newest first: how a player picks up a game on any device. */
  active(p: Profile): ActiveSeat[] {
    return this.seats.filter((s) => s.pid === p.pid).reverse().flatMap((s): ActiveSeat[] => {
      try {
        if (s.game === "chess") { const v = this.src.chess.get(s.id, s.player, true); return v.done ? [] : [{ game: s.game, id: s.id, player: s.player, status: v.status, tc: v.tc, rival: v.players.find((x) => !x.you)?.name ?? null }]; }
        const v = this.src.pinball.get(s.id, s.player);
        return !v || v.done ? [] : [{ game: s.game, id: s.id, player: s.player, status: v.startedAt ? "playing" : "waiting", tc: null, rival: v.players.find((x) => !x.you)?.name ?? null }];
      } catch { return []; }
    });
  }

  // ---- chess challenges

  /** A challenge card's invite: the profile's open one for this clock (reused, so a shared card never multiplies), else a new one. */
  invite(p: Profile, tc: TimeControl = "3+2"): Invite {
    if (!Object.hasOwn(CONTROLS, tc)) throw new LoungeError(400, "Choose 3+2, 5+0 or 10+0");
    this.#sweep();
    const now = this.now(), mine = [...this.invites.values()].filter((i) => i.host === p.pid && !i.match);
    const same = mine.find((i) => i.tc === tc);
    if (same) { same.until = now + INVITE_MS; return same; }
    if (mine.length >= MAX_INVITES) { const old = mine.sort((a, b) => a.createdAt - b.createdAt)[0]!; this.invites.delete(old.id); }
    const inv: Invite = { id: randomBytes(8).toString("hex"), host: p.pid, tc, createdAt: now, until: now + INVITE_MS };
    this.invites.set(inv.id, inv);
    return inv;
  }
  inviteView(i: Invite) { const host = this.profiles.byPid(i.host); return { id: i.id, tc: i.tc, host: host ? { pid: host.pid, name: host.name, elo: host.games.chess.elo } : null, until: i.until, taken: !!i.match }; }
  #sweep() { const now = this.now(); for (const [k, i] of this.invites) if (i.until < now && !i.match) this.invites.delete(k); else if (i.match && now - i.createdAt > 3 * 3600_000) this.invites.delete(k); }

  /**
   * A rival accepts a challenge: one chess game for exactly these two players is made, the clock
   * starts once both sit down. The host hears it (a DM if they pressed Start).
   */
  accept(p: Profile, inviteId: string) {
    this.#sweep();
    const inv = INVITE_ID.test(inviteId) ? this.invites.get(inviteId) : undefined;
    if (!inv) throw new LoungeError(404, "This challenge has expired. Open the lounge to find a rival.");
    const host = this.profiles.byPid(inv.host);
    if (!host) throw new LoungeError(404, "This challenge has expired.");
    if (host.pid === p.pid) {
      const seat = inv.match ? this.seats.find((s) => s.pid === p.pid && s.id === inv.match) : undefined;
      if (seat) return { game: "chess" as const, own: true, match: this.src.chess.get(seat.id, seat.player), player: seat.player };
      throw new LoungeError(409, "This is your own challenge: share it, and you hear it here when someone accepts.");
    }
    if (inv.match) {
      const seat = this.seats.find((s) => s.pid === p.pid && s.id === inv.match);
      if (seat) return { game: "chess" as const, own: false, match: this.src.chess.get(seat.id, seat.player), player: seat.player };
      throw new LoungeError(409, "Someone else accepted this challenge first. Find a rival in the lounge.");
    }
    if (playKey(host) === playKey(p)) throw new LoungeError(409, "This is your own challenge.");
    const g = this.src.chess.invite(inv.tc, { name: host.name, wallet: playKey(host) }, { name: p.name, wallet: playKey(p) });
    inv.match = g.id; inv.guest = p.pid;
    const hv = this.src.chess.get(g.id, g.seats[0], true), gv = this.src.chess.get(g.id, g.seats[1]);
    this.#track(host, { game: "chess", id: g.id, player: g.seats[0], role: "invite", rating0: hv.players.find((x) => x.you)?.rating ?? null });
    this.#track(p, { game: "chess", id: g.id, player: g.seats[1], role: "invite", rating0: gv.players.find((x) => x.you)?.rating ?? null });
    this.#tell(host, { kind: "accepted", game: "chess", id: g.id, rival: p.name, tc: inv.tc });
    return { game: "chess" as const, own: false, match: gv, player: g.seats[1] };
  }
  /** The host's seat at their accepted challenge (they come back to the Mini App from the DM). */
  seatAt(p: Profile, game: GameKind, id: string) { const s = this.#mine(p, game, id); return s ? { game, id, player: s.player } : null; }

  /**
   * What a deep link opens for this profile: its own seat (resume), a challenge (to accept), an
   * open lounge game (to join), a game being played (to watch), or nothing (the lounge).
   */
  resolve(p: Profile, t: StartTarget | null) {
    if (!t || t.kind === "lounge" || t.kind === "live" || t.kind === "me") return { kind: t?.kind ?? "lounge" } as const;
    if (t.kind === "chess" && INVITE_ID.test(t.id)) {
      const inv = this.invites.get(t.id);
      if (inv && (inv.until >= this.now() || inv.match)) {
        const own = inv.host === p.pid, mine = inv.match ? this.#mine(p, "chess", inv.match) : undefined;
        if (mine) return { kind: "seat", game: "chess", id: mine.id, player: mine.player } as const;
        return { kind: "invite", invite: this.inviteView(inv), own } as const;
      }
      return { kind: "gone", game: "chess" } as const;
    }
    const game: GameKind | null = t.kind === "watch" ? t.game : t.kind;
    for (const g of game ? [game] : (["chess", "pinball"] as const)) {
      const seat = this.#mine(p, g, t.id);
      if (seat) return { kind: "seat", game: g, id: seat.id, player: seat.player } as const;
      if (t.kind !== "watch") {
        const open = g === "chess" ? this.src.chess.lounge().open.find((x) => x.id === t.id) : this.src.pinball.lounge().open.find((x) => x.id === t.id);
        if (open) return { kind: "join", game: g, id: t.id, host: open.host.name, tc: "tc" in open ? open.tc : null } as const;
      }
      const exists = g === "chess" ? (() => { try { this.src.chess.watchView(t.id, true); return true; } catch { return false; } })() : !!this.src.pinball.getWatch(t.id);
      if (exists) return { kind: "watch", game: g, id: t.id } as const;
    }
    return { kind: "gone", game } as const;
  }

  // ---- following the games

  /**
   * Every tracked seat, once: a rival sitting down at a host's game (told once), a game that moved
   * (lounge fold, rematch), and a finished game booked on each Telegram player in it, once.
   */
  tick(): void {
    const groups = new Map<string, Seat[]>();
    for (const s of this.seats) { const k = `${s.game}:${s.id}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
    const drop = new Set<Seat>();
    for (const group of groups.values()) {
      try { if (group[0]!.game === "chess") this.#chess(group, drop); else this.#pinball(group, drop); }
      catch { for (const s of group) drop.add(s); }
    }
    for (let i = this.seats.length - 1; i >= 0; i--) if (drop.has(this.seats[i]!)) this.seats.splice(i, 1);
  }
  #chess(group: Seat[], drop: Set<Seat>) {
    const views = group.map((s) => [s, this.src.chess.get(s.id, s.player, true)] as const);
    const results: [Seat, Profile, Parameters<Profiles["record"]>[1]][] = [];
    for (const [s, v] of views) {
      const p = this.profiles.byPid(s.pid);
      if (!p) { drop.add(s); continue; }
      if (v.movedTo) { s.id = v.movedTo; continue; }
      const rival = v.players.find((x) => !x.you);
      if (!s.started && v.startedAt && rival) {
        s.started = true;
        if (s.role === "host") this.#tell(p, { kind: "joined", game: "chess", id: s.id, rival: rival.name });
      }
      if (!v.done) continue;
      drop.add(s);
      if (!v.startedAt || !rival || v.ply < 4) continue; // closed unplayed, or not rated (two moves each)
      const me = v.players.find((x) => x.you)!;
      const result: Recent["result"] = v.winner === null ? "draw" : v.winner === v.you ? "win" : "loss";
      results.push([s, p, { game: "chess", id: s.id, result, vs: rival.name, rival: rival.rating, elo: me.rating, tc: v.tc, reason: v.reason ?? undefined }]);
      if (v.rematchId) this.#track(p, { game: "chess", id: v.rematchId, player: s.player, role: "guest", rating0: me.rating });
    }
    for (const [s, p, r] of results) this.#book(p, r, s);
  }
  #pinball(group: Seat[], drop: Set<Seat>) {
    const views = group.map((s) => [s, this.src.pinball.get(s.id, s.player)] as const);
    // both players' Elo before either is booked
    const before = new Map(group.map((s) => [s, this.profiles.byPid(s.pid)?.games.pinball.elo ?? START_ELO]));
    const results: [Seat, Profile, Parameters<Profiles["record"]>[1]][] = [];
    for (const [s, v] of views) {
      const p = this.profiles.byPid(s.pid);
      if (!p || !v) { drop.add(s); continue; }
      if (v.movedTo) { s.id = v.movedTo; continue; }
      const rival = v.players.find((x) => !x.you), me = v.players.find((x) => x.you);
      if (!s.started && v.startedAt !== null && rival) {
        s.started = true;
        if (s.role === "host") this.#tell(p, { kind: "joined", game: "pinball", id: s.id, rival: rival.name });
      }
      if (!v.done) continue;
      drop.add(s);
      if (v.void || !rival || !me || !me.finished || !rival.finished) continue; // a duel needs both tables played
      const other = group.find((x) => x !== s);
      const result: Recent["result"] = v.draw ? "draw" : v.winnerIsYou ? "win" : "loss";
      results.push([s, p, { game: "pinball", id: s.id, result, vs: rival.name, rival: other ? before.get(other)! : START_ELO, reason: `${(me.score ?? 0).toLocaleString("en-US")} to ${(rival.score ?? 0).toLocaleString("en-US")}` }]);
    }
    for (const [s, p, r] of results) this.#book(p, r, s);
  }
  #book(p: Profile, r: Parameters<Profiles["record"]>[1], s: Seat) {
    const item = this.profiles.record(p, r);
    this.#tell(p, { kind: "result", game: r.game, id: s.id, rival: r.vs, result: r.result, elo: item.elo, change: item.change, reason: r.reason ?? null });
  }
}

let shared: TgPlay | null = null;
/** The live coordinator: its games are followed every second and a half (plenty for a DM and a profile). */
export function tgPlay(profiles: Profiles): TgPlay {
  if (!shared) {
    shared = new TgPlay(profiles);
    setInterval(() => shared!.tick(), 1_500).unref();
  }
  return shared;
}
