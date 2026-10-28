import { finite, record, usePublicRead, type ReadState } from "../publicRead";
import { isSwarmStats } from "../swarmStats";

type Tables = { games: { id: string }[] };
type Overview = { staked: number | null; frogs?: { minted: number | null } | null };
type Products = { count: number; mode: string };
const isProducts = (v: unknown): v is Products => record(v) && finite(v.count) && typeof v.mode === "string";
type Tools = { offers: { id: string }[] };
const isTables = (v: unknown): v is Tables => record(v) && Array.isArray(v.games) && v.games.every((g) => record(g) && typeof g.id === "string");
const isOverview = (v: unknown): v is Overview => record(v) && (v.staked === null || finite(v.staked)) && (v.frogs == null || (record(v.frogs) && (v.frogs.minted === null || finite(v.frogs.minted))));
const isTools = (v: unknown): v is Tools => record(v) && Array.isArray(v.offers) && v.offers.every((o) => record(o) && typeof o.id === "string");

export type Reading = { value: string; label: string; state: "loading" | "unavailable" | "ready" };
function reading<T>(read: ReadState<T>, get: (data: T) => number | null | undefined, label: string): Reading {
  const n = read.state === "ready" ? get(read.data) : null;
  const state = read.state === "ready" && n == null ? "unavailable" : read.state;
  return { label, state, value: state === "loading" ? "Loading…" : state === "unavailable" ? "Unavailable" : n!.toLocaleString("en-US", { maximumFractionDigits: 0 }) };
}

/** Only public counters, with failed reads kept separate from zero. */
export function useStationReadings() {
  const swarm = usePublicRead("/api/v1/swarm/stats", isSwarmStats);
  const tables = usePublicRead("/api/games/live", isTables);
  const overview = usePublicRead("/api/token/overview", isOverview);
  const products = usePublicRead("/api/market/search", isProducts);
  const tools = usePublicRead("/api/v1/services", isTools);
  return {
    products: reading(products, (d) => d.mode === "sim" ? null : d.count, "products for sale"),
    agents: reading(swarm, (d) => d.swarm.agentsOnline, "agents online"),
    tools: reading(tools, (d) => new Set(d.offers.map((o) => o.id)).size, "tools & reports listed"),
    tables: reading(tables, (d) => d.games.length, "live games"),
    staked: reading(overview, (d) => d.staked, "$SHIFT staked"),
    frogs: reading(overview, (d) => d.frogs?.minted, "NIGHT FROGS minted"),
  };
}
