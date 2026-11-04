import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";
import { BASE, currentToken } from "./client";
import type { EngineEvent } from "./types";

export type LiveState = "live" | "connecting" | "off";

/**
 * The company's live feed over SSE, only while the app is open (Android stops background sockets;
 * push covers the rest). A dropped line reconnects with the last event id and gets what it missed;
 * when the engine says too much was missed (or it restarted), `onReset` reloads the company.
 */
export function useLive(companyId: string | null, onEvent: (e: EngineEvent) => void, onReset: () => void): LiveState {
  const [state, setState] = useState<LiveState>("off");
  const handler = useRef(onEvent), reset = useRef(onReset);
  handler.current = onEvent;
  reset.current = onReset;

  useEffect(() => {
    if (!companyId) return;
    let es: EventSource<"reset"> | null = null;
    let last = "";
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const open = () => {
      if (stopped || AppState.currentState !== "active") return;
      setState("connecting");
      const url = `${BASE}/api/events?company=${encodeURIComponent(companyId)}${last ? `&since=${encodeURIComponent(last)}` : ""}`;
      const token = currentToken();
      es = new EventSource<"reset">(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, pollingInterval: 0, timeoutBeforeConnection: 0 });
      es.addEventListener("open", () => { tries = 0; setState("live"); });
      es.addEventListener("message", (m) => {
        if (m.lastEventId) last = m.lastEventId;
        if (!m.data) return;
        try { handler.current(JSON.parse(m.data) as EngineEvent); } catch { /* a ping or a line it cannot read */ }
      });
      es.addEventListener("reset", () => { last = ""; reset.current(); });
      es.addEventListener("error", () => again());
      es.addEventListener("close", () => again());
    };
    const close = () => { if (timer) clearTimeout(timer); timer = null; es?.removeAllEventListeners(); es?.close(); es = null; };
    const again = () => {
      close();
      if (stopped) return;
      setState("connecting");
      // 1 s, 2 s, 4 s … up to 30 s: a tunnel ends, a crashed engine is not hammered
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** tries++));
    };

    open();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { close(); open(); }
      else { close(); setState("off"); }
    });
    return () => { stopped = true; sub.remove(); close(); setState("off"); };
  }, [companyId]);

  return state;
}
