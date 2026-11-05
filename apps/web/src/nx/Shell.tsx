import { useEffect } from "react";
// the station kit (nx-btn, drawers, desk cards): loaded first, as main.tsx did through nx/Gate, so the protocol styles below win
import "./nx.css";
import { ROOMS, type RoomId } from "./map";
import ClickSpark from "../rb/ClickSpark";
import { SxFooter, SxHeader, SxSectionBar, SxTabs } from "../saas/chrome";
import "../saas/protocol.css";
import "../saas/protocol-type.css";

const KEY = "nx_way";
export function rememberRoom(id: RoomId) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } }
export function lastRoom(): RoomId | null { try { const v = localStorage.getItem(KEY); return v && v in ROOMS ? (v as RoomId) : null; } catch { return null; } }

/** Kept for pages that draw their own header. */
export function StationBar({ room, title, path = "/" }: { room: RoomId | null; title?: string; path?: string }) {
  void room;
  return <SxHeader path={path} title={title} />;
}

/** Kept for pages that draw their own footer. */
export function Footer({ room }: { room: RoomId | null }) {
  void room;
  return <SxFooter />;
}

/** Kept for pages that draw their own phone bar. */
export function NxTabs({ room }: { room: RoomId | null }) {
  return <SxTabs room={room} />;
}

/** A page of the protocol: header, its section tabs, the page, the full footer. */
export function RoomShell({ room, path, lean = false, title, children }: { room: RoomId | null; path: string; lean?: boolean; title?: string; children: React.ReactNode }) {
  const r = room ? ROOMS[room] : null;
  useEffect(() => { if (room) rememberRoom(room); }, [room]);
  return (
    <ClickSpark sparkColor={["#b8ff3d", "#57d97b"]} sparkSize={6} sparkRadius={16} sparkCount={7} shape="line" duration={380}>
    <div className="px ns ns-app nx-shell" data-room={room ?? "station"} style={{ "--acc": r?.accent ?? "#b8ff3d", "--acc2": r?.accent2 ?? "#d8ffa0" } as React.CSSProperties}>
      <SxHeader path={path} title={title} />
      {room && !lean && <SxSectionBar room={room} path={path} />}
      <main className={["/services", "/games", "/token", "/how-it-works", "/breakroom", "/geek", "/info"].includes(path) ? "clarity-main" : undefined}>{children}</main>
      <SxFooter />
      <SxTabs room={room} />
    </div>
    </ClickSpark>
  );
}
