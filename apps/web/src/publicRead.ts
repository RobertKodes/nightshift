import { useEffect, useState } from "react";

export type ReadState<T> = { state: "loading" } | { state: "unavailable" } | { state: "ready"; data: T };

/** Public reads stay distinct from failed reads. */
export function usePublicRead<T>(url: string | null, valid: (value: unknown) => value is T): ReadState<T> {
  const [read, setRead] = useState<{ url: string | null; value: ReadState<T> }>({ url: null, value: { state: "loading" } });
  useEffect(() => {
    if (!url) return;
    let active = true;
    let pending: AbortController | undefined;
    const load = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error("Unavailable");
        const data: unknown = await response.json();
        if (!valid(data)) throw new Error("Unavailable");
        if (active) setRead({ url, value: { state: "ready", data } });
      } catch {
        if (active) setRead({ url, value: { state: "unavailable" } });
      } finally { window.clearTimeout(timeout); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); };
  }, [url, valid]);
  return read.url === url && url ? read.value : { state: "loading" };
}

export const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
