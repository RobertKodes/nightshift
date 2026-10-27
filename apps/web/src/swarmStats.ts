import { finite, record } from "./publicRead";

export type SwarmStats = {
  swarm: { agentsOnline: number | null };
  desk: { enabled: boolean; delivered: number; kinds: { kind: string; priceUsd: number | null; whatYouGet: string }[] };
};
export const isSwarmStats = (v: unknown): v is SwarmStats => record(v) && record(v.swarm) && (v.swarm.agentsOnline === null || finite(v.swarm.agentsOnline)) && record(v.desk) && typeof v.desk.enabled === "boolean" && finite(v.desk.delivered) && Array.isArray(v.desk.kinds) && v.desk.kinds.every((k) => record(k) && typeof k.kind === "string" && (k.priceUsd === null || finite(k.priceUsd)) && typeof k.whatYouGet === "string");
