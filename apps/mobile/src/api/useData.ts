import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError } from "./client";

/**
 * Reads that survive a tunnel: the last good answer for each screen is kept on the phone and shown
 * with an offline banner when the engine cannot be reached, then replaced as soon as it can.
 * Only reads are kept: no approval or money action is ever queued offline.
 */

const KEY = (k: string) => `ns.cache.${k}`;
const memory = new Map<string, { at: number; data: unknown }>();

export async function cached<T>(key: string): Promise<{ at: number; data: T } | null> {
  const m = memory.get(key);
  if (m) return m as { at: number; data: T };
  try { const raw = await AsyncStorage.getItem(KEY(key)); if (!raw) return null; const v = JSON.parse(raw) as { at: number; data: T }; memory.set(key, v); return v; } catch { return null; }
}
export function remember(key: string, data: unknown): void {
  const v = { at: Date.now(), data };
  memory.set(key, v);
  void AsyncStorage.setItem(KEY(key), JSON.stringify(v)).catch(() => {});
}
/** Forgets every cached screen: on sign-out, nothing of the last wallet stays on the phone. */
export async function forgetAll(): Promise<void> {
  memory.clear();
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith("ns.cache."));
  if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => {});
}

export interface Data<T> {
  data: T | null;
  error: string | null;
  /** showing the copy kept on the phone, because the engine could not be reached */
  offline: boolean;
  loading: boolean;
  at: number | null;
  refresh: () => Promise<void>;
  /** replace the shown data at once (after an action), without a round trip */
  set: (f: (d: T | null) => T | null) => void;
}

/** One screen's read: cached on the phone, refetched when the screen comes into view and when the app comes back. */
export function useData<T>(key: string | null, load: () => Promise<T>, opts: { every?: number } = {}): Data<T> {
  const [data, setData] = useState<T | null>(() => (key ? ((memory.get(key)?.data as T) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(key ? memory.get(key)?.at ?? null : null);
  const loader = useRef(load);
  loader.current = load;
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const d = await loader.current();
      if (!live.current) return;
      setData(d); setError(null); setOffline(false); setAt(Date.now());
      remember(key, d);
    } catch (e) {
      if (!live.current) return;
      const err = e as ApiError;
      if (err.offline) {
        const c = await cached<T>(key);
        if (c) { setData(c.data); setAt(c.at); }
        setOffline(true);
        setError(c ? null : err.message);
      } else setError(err.message);
    } finally { if (live.current) setLoading(false); }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    void cached<T>(key).then((c) => { if (c && live.current) { setData((d) => d ?? c.data); setAt((a) => a ?? c.at); } });
  }, [key]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void refresh(); });
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    if (!opts.every) return;
    const t = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, opts.every);
    return () => clearInterval(t);
  }, [refresh, opts.every]);

  const set = useCallback((f: (d: T | null) => T | null) => setData((d) => { const n = f(d); if (key && n) remember(key, n); return n; }), [key]);
  return { data, error, offline, loading, at, refresh, set };
}
