import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, api } from "../api/client";
import type { Desk, DeskCompany, Waiting } from "../api/types";
import { cached, remember } from "../api/useData";
import { useSession } from "./session";

/**
 * The owner desk, shared by every tab: the companies, what waits for the owner, and which company the
 * Live, Books and More tabs are looking at. Refreshed every 20 seconds while the app is open, at once
 * after any action, and kept on the phone for offline.
 */
interface DeskState {
  desk: Desk | null;
  error: string | null;
  offline: boolean;
  at: number | null;
  refresh: () => Promise<void>;
  focus: DeskCompany | null;
  setFocus: (id: string) => void;
  /** every held spend across the companies, newest first */
  waiting: (Waiting & { company: DeskCompany })[];
}

const Ctx = createContext<DeskState | null>(null);
export const useDesk = () => { const d = useContext(Ctx); if (!d) throw new Error("useDesk outside DeskProvider"); return d; };
const FOCUS = "ns.focus";

export function DeskProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = await api.desk();
      setDesk(d); setError(null); setOffline(false); setAt(Date.now());
      remember("desk", d);
    } catch (e) {
      if ((e as ApiError).offline) {
        const c = await cached<Desk>("desk");
        if (c) { setDesk((x) => x ?? c.data); setAt((a) => a ?? c.at); }
        setOffline(true);
      } else setError((e as Error).message);
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    if (status !== "in") { setDesk(null); return; }
    void cached<Desk>("desk").then((c) => { if (c) { setDesk((d) => d ?? c.data); setAt((a) => a ?? c.at); } });
    void AsyncStorage.getItem(FOCUS).then((f) => f && setFocusId(f));
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 20_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [status, refresh]);

  const setFocus = useCallback((id: string) => { setFocusId(id); void AsyncStorage.setItem(FOCUS, id).catch(() => {}); }, []);
  const focus = useMemo(() => desk?.companies.find((c) => c.id === focusId) ?? desk?.companies[0] ?? null, [desk, focusId]);
  const waiting = useMemo(() => (desk?.companies ?? []).flatMap((c) => c.waiting.map((w) => ({ ...w, company: c }))).sort((a, b) => b.at - a.at), [desk]);

  const value = useMemo(() => ({ desk, error, offline, at, refresh, focus, setFocus, waiting }), [desk, error, offline, at, refresh, focus, setFocus, waiting]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
