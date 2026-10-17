/**
 * Links that come from data (the API, the swarm, a company) are rendered only when they are plain
 * https URLs or site paths, so a "javascript:" or "data:" value can never run in this origin.
 */
export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  const v = u.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try { return new URL(v).protocol === "https:" ? v : undefined; } catch { return undefined; }
}
