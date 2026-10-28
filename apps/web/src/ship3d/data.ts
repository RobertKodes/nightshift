import { useEffect, useMemo, useState } from "react";
import { finite, record, type ReadState } from "../publicRead";
import type { Crew, Mission, ShipStatic, Snapshot } from "../ship/types";

export const BAYS = [
  { id: "missions", name: "Mission bay", line: "Active Frog missions and launch operations." },
  { id: "companies", name: "Company floor", line: "Company tasks and the crew on duty." },
  { id: "games", name: "Games room", line: "Live tables and the off-duty crew." },
  { id: "watch", name: "Watch room", line: "Night Watchers and station support." },
] as const;
export type Bay = 0 | 1 | 2 | 3;
export type Company = { id: string; slug: string; name: string; mine?: boolean; working: { title: string; status?: string; activity?: string } | null };
export type LiveGame = { id: string; game: string; watch: string; players: { name: string }[]; house?: boolean; viewers?: number; stake?: { currency: string; amount: number } };
export type Entry = {
  key: string; kind: "frog" | "watcher" | "company" | "game"; bay: Bay; title: string; activity: string; mine: boolean;
  art?: string; owner?: string; frog?: Snapshot["frogs"][number]; watcher?: Snapshot["watchers"][number];
  company?: Company; game?: LiveGame; rule?: string; traits?: { name: string; value: string; count: number | undefined }[];
  rank?: number; rarity?: string; points?: number;
};
const mission = (v: unknown): v is Mission => record(v) && typeof v.id === "string" && typeof v.title === "string" && finite(v.since) && typeof v.done === "boolean";
export const isSnapshot = (v: unknown): v is Snapshot => record(v) && finite(v.at) && Array.isArray(v.wallets) && v.wallets.every((w) => typeof w === "string")
  && Array.isArray(v.frogs) && v.frogs.every((f) => record(f) && finite(f.id) && Number.isInteger(f.id) && typeof f.o === "number" && typeof f.dead === "boolean" && finite(f.rate) && finite(f.base) && finite(f.boost) && (f.mission === null || mission(f.mission)))
  && Array.isArray(v.watchers) && v.watchers.every((w) => record(w) && finite(w.n) && finite(w.tier) && typeof w.name === "string" && typeof w.tierName === "string" && typeof w.o === "number" && finite(w.rate) && finite(w.base) && finite(w.crew) && finite(w.slots) && finite(w.points) && Array.isArray(w.inputs) && w.inputs.every(finite) && Array.isArray(w.traits) && w.traits.every(finite) && Array.isArray(w.missions) && w.missions.every(mission) && record(w.watch) && typeof w.watch.paired === "boolean" && typeof w.watch.online === "boolean");
export const isArt = (v: unknown): v is ShipStatic => record(v) && Array.isArray(v.frogs) && v.frogs.every((r) => Array.isArray(r) && r.every(finite))
  && Array.isArray(v.rules) && v.rules.every((r) => record(r) && typeof r.station === "string" && typeof r.why === "string")
  && Array.isArray(v.layers) && v.layers.every((n) => typeof n === "string") && Array.isArray(v.names) && v.names.every((r) => Array.isArray(r) && r.every((n) => typeof n === "string"))
  && Array.isArray(v.counts) && v.counts.every((r) => Array.isArray(r) && r.every(finite)) && Array.isArray(v.rarities) && v.rarities.every((r) => typeof r === "string");
export const isCompanies = (v: unknown): v is Company[] => Array.isArray(v) && v.every((c) => record(c) && typeof c.id === "string" && typeof c.slug === "string" && typeof c.name === "string" && (c.working == null || (record(c.working) && typeof c.working.title === "string" && (c.working.status == null || typeof c.working.status === "string"))));
export const isGames = (v: unknown): v is { games: LiveGame[] } => record(v) && Array.isArray(v.games) && v.games.every((g) => record(g) && typeof g.id === "string" && typeof g.game === "string" && typeof g.watch === "string" && /^\/(?:games\/|arena(?:[/?]|$))/.test(g.watch) && Array.isArray(g.players) && g.players.every((p) => record(p) && typeof p.name === "string"));
export const isCrew = (v: unknown): v is Crew => record(v) && typeof v.wallet === "string" && Array.isArray(v.frogs) && v.frogs.every(finite) && Array.isArray(v.watchers) && v.watchers.every(finite);

/** Match the original ship's cadence, with aborts, timeouts and no polling in a hidden tab. */
function useDeckRead<T>(url: string | null, valid: (v: unknown) => v is T, interval: number, scope = ""): ReadState<T> {
  const [read, setRead] = useState<{ url: string; scope: string; result: ReadState<T> } | null>(null);
  useEffect(() => {
    if (!url) return;
    let disposed = false, pending: AbortController | undefined;
    const load = async () => {
      if (document.hidden || pending) return;
      const controller = new AbortController(); pending = controller;
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error("Unavailable");
        const data: unknown = await response.json(); if (!valid(data)) throw new Error("Invalid data");
        if (!disposed) setRead({ url, scope, result: { state: "ready", data } });
      } catch { if (!disposed) setRead({ url, scope, result: { state: "unavailable" } }); }
      finally { clearTimeout(timeout); pending = undefined; }
    };
    const visible = () => { if (!document.hidden) void load(); };
    void load(); const timer = setInterval(() => void load(), interval); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; pending?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [url, valid, interval, scope]);
  return read?.url === url && read.scope === scope ? read.result : { state: "loading" };
}
export function useDeckData(wallet: string | null) {
  const ship = useDeckRead("/api/ship", isSnapshot, 15_000), art = useDeckRead("/api/ship/art", isArt, 3_600_000);
  const companies = useDeckRead("/api/companies", isCompanies, 60_000, wallet ?? ""), games = useDeckRead("/api/games/live", isGames, 30_000);
  const crew = useDeckRead(wallet ? `/api/ship/crew?wallet=${encodeURIComponent(wallet)}` : null, isCrew, 60_000);
  const entries = useMemo(() => buildEntries(ship.state === "ready" ? ship.data : null, art.state === "ready" ? art.data : null, companies.state === "ready" ? companies.data : [], games.state === "ready" ? games.data.games : [], crew.state === "ready" && crew.data.wallet.toLowerCase() === wallet?.toLowerCase() ? crew.data : null, wallet), [ship, art, companies, games, crew, wallet]);
  return { ship, art, companies, games, crew, entries };
}

/** Console operators are representations of work, never an invented NFT/company ownership link. */
export function buildEntries(ship: Snapshot | null, art: ShipStatic | null, companies: Company[], games: LiveGame[], crew: Crew | null, wallet: string | null): Entry[] {
  const entries: Entry[] = [], ownedFrogs = new Set(crew?.frogs), ownedWatchers = new Set(crew?.watchers);
  const owner = (index: number) => index >= 0 ? ship?.wallets[index] : undefined;
  const mine = (address?: string) => !!wallet && address?.toLowerCase() === wallet.toLowerCase();
  const traits = (values: number[]) => values.map((v, i) => ({ name: art?.layers[i] ?? `Trait ${i + 1}`, value: art?.names[i]?.[v] ?? String(v), count: art?.counts[i]?.[v] }));
  for (const frog of ship?.frogs ?? []) {
    if (frog.dead) continue;
    const row = art?.frogs[frog.id - 1], rule = row ? art?.rules[row[10]!] : undefined;
    const active = frog.mission && !frog.mission.done;
    const bay: Bay = active || rule?.station === "missions" ? 0 : rule?.station === "offices" ? 1 : rule?.station === "breakroom" ? 2 : 3;
    entries.push({ key: `frog:${frog.id}`, kind: "frog", bay, frog, title: `NIGHT FROG #${frog.id}`, activity: frog.mission ? `${frog.mission.title}${frog.mission.done ? " (complete)" : ""}` : rule?.why ?? "Station duty", mine: ownedFrogs.has(frog.id) || mine(owner(frog.o)), owner: owner(frog.o), art: `/api/forge/nf/${frog.id}.svg`, rule: rule?.why, traits: row ? traits(row.slice(3, 10)) : [], rank: row?.[0], rarity: row ? art?.rarities[row[1]!] : undefined, points: row?.[2] });
  }
  for (const watcher of ship?.watchers ?? []) entries.push({ key: `watcher:${watcher.n}`, kind: "watcher", bay: 3, watcher, title: watcher.n === 0 ? "The Captain" : `Night Watcher #${watcher.n}`, activity: watcher.watch.paired ? watcher.watch.online ? "Paired / online on watch" : "Paired / offline" : "Watch seat not paired", mine: ownedWatchers.has(watcher.n) || mine(owner(watcher.o)), owner: owner(watcher.o), art: `/api/forge/frog/${watcher.n}.svg`, traits: traits(watcher.traits), points: watcher.points });
  for (const company of companies) if (company.working) entries.push({ key: `company:${company.id}`, kind: "company", bay: 1, company, title: company.name, activity: company.working.title, mine: !!wallet && company.mine === true });
  for (const game of games) entries.push({ key: `game:${game.game}:${game.id}`, kind: "game", bay: 2, game, title: `${game.game}${game.house ? " / house exhibition" : ""}`, activity: game.players.map((p) => p.name).join(" vs ") || "Live table", mine: false });
  return entries;
}

/** A room's crew in slot order. A focused record always replaces a slot instead of exceeding the room. */
export function actorsForBay(entries: Entry[], bay: Bay, selected: string | null, slots: number) {
  const candidates = entries.filter((e) => e.bay === bay).sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.kind === "company" || b.kind === "game" || b.kind === "watcher") - Number(a.kind === "company" || a.kind === "game" || a.kind === "watcher") || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const actors = candidates.slice(0, slots), focus = candidates.find((e) => e.key === selected);
  if (focus && !actors.includes(focus)) actors[Math.min(slots - 1, actors.length)] = focus;
  return actors;
}
