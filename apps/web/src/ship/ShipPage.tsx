import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NxIcon } from "../nx/icons";
import { NxTabs, StationBar, rememberRoom } from "../nx/Shell";
import { Link } from "../router";
import { useSession } from "../session";
import { type Labels, ShipScene } from "./scene";
import { CW, CH } from "./sprites";
import { type Crew, FORGE, FORGED_ID, NIGHT_FROGS, type Pick, RARITY_TONE, type ShipStatic, type Snapshot, type SnapFrog, type SnapWatcher, type Station } from "./types";
import { type RoomKey, ROOMS, WATCH_SEATS } from "./world";
import "../nx/nx.css";
import "./ship.css";

/**
 * THE SHIP: every NIGHT FROG and Night Watcher on the NIGHTSHIFT ship, live. The scene (scene.ts) draws them at
 * their stations from their onchain art; this page feeds it the live snapshot and shows what each one is and
 * earns, the signed-in wallet's crew, search and filters, and the same crew as a plain list.
 */
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number, d = 1) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const ROOM_ORDER: RoomKey[] = ["bridge", "quarters", "offices", "breakroom", "missions", "engine", "forge"];
const ROOM_NAME: Record<RoomKey, string> = { bridge: "Bridge", quarters: "Captain's quarters", offices: "Company offices", breakroom: "Breakroom", missions: "Mission bay", engine: "Engine room", forge: "The Forge", drive: "Drive" };
const accent = (k: RoomKey) => ROOMS.find((r) => r.key === k)!.accent;

/** What a trait does on the ship (its effect), in a few words. */
const FX: Record<string, string> = {
  "Laser Eyes": "fires its lasers every few seconds", "Cyan VR Visor": "its visor scrolls a live readout", "Acid Glow": "its eyes pulse", "Neon Shades": "a glint crosses the shades", Monocle: "the monocle catches the light",
  "Headlamp Hard Hat": "its lamp lights the console", "Gold Crown": "the crown's points sparkle", "Moonlight Halo": "the halo glows", "Night Vision": "the lenses flicker green", "Dispatcher Headset": "the mic goes live, calling the missions",
  "Shipping Coffee": "the coffee steams", "IMD Swarm Earpiece": "the earpiece blinks with the swarm", "Overtime Energy": "the can's bolt charges", "SHIFT Chain": "the $SHIFT plate glints",
};
const BLINKS = new Set(["Heavy Lids", "Wired", "Deadpan Wink", "Acid Glow", "Monocle"]);

type Filter = { rarity: string; layer: number; value: number; station: string; special: "" | "watchers" | "missions" | "forged"; tier: number };
const NO_FILTER: Filter = { rarity: "", layer: -1, value: -1, station: "", special: "", tier: 0 };

export function ShipPage() {
  const { address, signIn, busy } = useSession();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ShipScene | null>(null);
  const [st, setSt] = useState<ShipStatic | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [hover, setHover] = useState<{ p: Pick; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<"none" | "crew" | "filters">("none");
  const [view, setView] = useState<"scene" | "list">(() => (new URLSearchParams(location.search).get("view") === "list" ? "list" : "scene"));
  const [walletQ] = useState(() => { const w = new URLSearchParams(location.search).get("wallet"); return w && /^0x[0-9a-fA-F]{40}$/.test(w) ? w.toLowerCase() : null; });
  const [paste, setPaste] = useState("");
  const [viewing, setViewing] = useState<string | null>(walletQ);
  const [crew, setCrew] = useState<Crew | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState<{ fps: number; ms: number } | null>(null);
  const still = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const canDraw = useMemo(() => { try { return Boolean(document.createElement("canvas").getContext("2d")); } catch { return false; } }, []);
  const wallet = viewing ?? address?.toLowerCase() ?? null;

  useEffect(() => { rememberRoom("command"); document.title = "The Ship · NIGHTSHIFT"; }, []);
  useEffect(() => { void fetch("/api/ship/art").then((r) => r.json()).then(setSt).catch(() => setErr("The ship's art did not load. Reload to try again.")); }, []);
  // the live snapshot, every 30 seconds; a new Night Watcher is announced
  useEffect(() => {
    let last: number | null = null;
    const load = () => fetch("/api/ship").then((r) => r.json()).then((s: Snapshot & { error?: string }) => {
      if (s.error) { setErr(s.error); return; }
      setErr(null);
      if (last !== null && s.watchers.length > last) { const w = [...s.watchers].sort((a, b) => b.forgedAt - a.forgedAt)[0]!; setToast(`Fresh from the forge: Night Watcher #${w.n}, Tier ${w.tierName}`); }
      last = s.watchers.length;
      setSnap(s);
    }).catch(() => setErr("The ship's live data did not load; retrying."));
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  // the scene
  useEffect(() => {
    if (!st || !canvas.current || view !== "scene" || !canDraw) return;
    const s = new ShipScene(canvas.current, st, still);
    scene.current = s;
    // ?debug: the scene on window, for the frame-rate checks
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __shipScene?: ShipScene }).__shipScene = s;
    s.onPick = (p) => { setPick(p && p.kind === "room" && pick?.kind !== "room" ? p : p); if (p && p.kind !== "room") setPanel((x) => (x === "filters" ? "none" : x)); };
    s.onHover = (p, x, y) => setHover(p ? { p, x, y } : null);
    const t = setInterval(() => { const x = s.getStats(); setStats({ fps: x.fps, ms: x.frameMs }); }, 1000);
    return () => { clearInterval(t); s.destroy(); scene.current = null; };
  }, [st, view]);
  useEffect(() => { if (snap) scene.current?.setSnapshot(snap); }, [snap, view, st]);

  // the wallet's crew (signed in, or ?wallet=)
  useEffect(() => {
    if (!wallet) { setCrew(null); return; }
    const load = () => fetch(`/api/ship/crew?wallet=${wallet}`).then((r) => r.json()).then((c: Crew & { error?: string }) => { if (!c.error) setCrew(c); }).catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [wallet]);
  const crewKeys = useMemo(() => (crew ? [...crew.frogs.map(String), ...crew.watchers.map((n) => `w${n}`)] : []), [crew]);
  useEffect(() => { if (scene.current) scene.current.crew = new Set(crewKeys); }, [crewKeys, view, st]);
  // first look at a wallet's crew: open the panel and fly there
  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!crew || !scene.current || flown.current === crew.wallet) return;
    flown.current = crew.wallet;
    if (crewKeys.length) { setPanel("crew"); setTimeout(() => scene.current?.focusKeys(crewKeys), 350); }
  }, [crew, crewKeys, snap]);

  // what the panels cover, so the camera frames its targets in the rest of the screen
  const sheet = Boolean(pick) || panel !== "none";
  const phone = typeof window !== "undefined" && window.innerWidth <= 820;
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.inset = phone ? { l: 0, r: 0, t: sheet ? 0 : 120, b: sheet ? Math.round(window.innerHeight * (panel === "crew" ? 0.56 : 0.66)) : 150 }
      : { l: panel === "crew" ? 420 : 0, r: pick ? 420 : 0, t: 90, b: 70 };
  }, [pick, panel, phone, view, st]);

  const selKey = pick?.kind === "frog" ? String(pick.id) : pick?.kind === "watcher" ? `w${pick.n}` : null;
  useEffect(() => { if (scene.current) scene.current.selected = selKey; }, [selKey]);

  // labels over the rooms: live counts and what they earn an hour
  const rooms = useMemo(() => roomStats(st, snap), [st, snap]);
  useEffect(() => {
    if (!scene.current || !rooms) return;
    const L: Labels = {};
    for (const k of ROOM_ORDER) L[k] = { title: ROOM_NAME[k].toUpperCase(), line: rooms[k].line };
    L.drive = { title: "DRIVE", line: "engines · no crew" };
    scene.current.labels = L;
  }, [rooms, view, st]);

  // filters and search dim everyone else
  const matches = useMemo(() => matcher(st, snap, filter), [st, snap, filter]);
  useEffect(() => { if (scene.current) scene.current.match = matches; }, [matches, view, st]);
  const matchCount = useMemo(() => (matches && st ? [...st.frogs.keys()].filter((i) => matches(String(i + 1))).length + (snap?.watchers.filter((w) => matches(`w${w.n}`)).length ?? 0) : null), [matches, st, snap]);

  const open = useCallback((p: Pick, fly = true) => {
    setPick(p);
    if (!fly || !scene.current) return;
    const key = p.kind === "frog" ? String(p.id) : p.kind === "watcher" ? `w${p.n}` : null;
    // after the card is laid out, so the camera knows what it covers
    setTimeout(() => { if (key && scene.current && !scene.current.focusKey(key) && p.kind === "frog") setToast(`#${p.id} is not at a seat on the ship right now: it is forged or out on a mission.`); }, 30);
  }, []);
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim().toLowerCase();
    const w = /^(?:nw|w|watcher)\s*#?(\d{1,2})$/.exec(s), f = /^#?(\d{1,3})$/.exec(s);
    if (s === "captain" || s === "the captain") { if (snap?.watchers.some((x) => x.n === 0)) open({ kind: "watcher", n: 0 }); else open({ kind: "frog", id: 1 }); return; }
    if (w) { const n = Number(w[1]); if (snap?.watchers.some((x) => x.n === n)) open({ kind: "watcher", n }); else setToast(`Night Watcher #${n} has not been forged yet.`); return; }
    if (f) { const id = Number(f[1]); if (id >= 1 && id <= 500) { open({ kind: "frog", id }); if (view === "list") setView("list"); } else setToast("NIGHT FROGS are #1 to #500."); return; }
    setToast("Type a frog number (1-500) or NW and a Night Watcher's number.");
  };
  const flyRoom = (k: RoomKey) => { setPick({ kind: "room", station: k }); scene.current?.focusRoom(k); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setPick(null); setPanel("none"); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);

  const totals = snap?.totals;
  const shiftName = (() => { const h = new Date(now).getUTCHours(); return h >= 22 || h < 6 ? "Night shift" : h < 14 ? "Day shift" : "Swing shift"; })();
  const clock = new Date(now).toISOString().slice(11, 16);

  return (
    <div className="ns ns-app nx-shell sh" data-room="command" style={{ "--acc": "#b8ff4a", "--acc2": "#d9ff9c" } as React.CSSProperties}>
      <header className="nx-head"><StationBar room="command" title="The Ship" /></header>
      <main className="sh-main">
        {view === "scene" && canDraw ? (
          <div className="sh-stage">
            <canvas ref={canvas} className="sh-canvas" tabIndex={0} role="img"
              aria-label={`The NIGHTSHIFT ship: ${totals ? `${totals.held} NIGHT FROGS aboard and ${totals.watchers} Night Watcher${totals.watchers === 1 ? "" : "s"}` : "loading the crew"}. Drag or use the arrow keys to move, scroll or + and - to zoom. The list view shows the same crew as text.`} />
            {!st && !err && <div className="sh-boot"><i /><span>Boarding the ship…</span></div>}
            {st && scene.current && scene.current.sprites.pending > 0 && <Loading scene={scene.current} />}
          </div>
        ) : (
          <ListView st={st} snap={snap} matches={matches} q={q} onOpen={(p) => open(p, false)} />
        )}

        <section className={`sh-hud sh-title${sheet ? " sh-under" : ""}`} aria-label="The ship, live">
          <span className="sh-kicker"><i className="sh-live" />LIVE · {shiftName} · {clock} UTC</span>
          <h1>THE SHIP</h1>
          {totals ? (
            <p className="sh-line">
              <b>{totals.held}</b> NIGHT FROGS aboard · <b>{totals.burned}</b> forged · <b>{totals.watchers}</b> Night Watcher{totals.watchers === 1 ? "" : "s"} · <b>{totals.holders}</b> holders
              <br /><b className="sh-acc">{fmt(totals.perHour, 1)}</b> shift hours an hour{totals.onMissions ? <> · <b>{totals.onMissions}</b> out on missions</> : null}
            </p>
          ) : <p className="sh-line">{err ?? "Reading the crew from Ethereum…"}</p>}
        </section>

        <section className="sh-hud sh-tools" aria-label="Find on the ship">
          <form className="sh-search" onSubmit={search} role="search">
            <NxIcon name="frogs" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Frog # or NW #" aria-label="Find a frog by number, or a Night Watcher (NW 1)" inputMode="search" />
          </form>
          <button className={`sh-btn${panel === "filters" || matches ? " on" : ""}`} onClick={() => setPanel(panel === "filters" ? "none" : "filters")} aria-expanded={panel === "filters"}><NxIcon name="setup" size={16} /><span>Filter{matchCount !== null ? ` · ${matchCount}` : ""}</span></button>
          <button className={`sh-btn sh-btn-crew${panel === "crew" ? " on" : ""}`} onClick={() => { setPanel(panel === "crew" ? "none" : "crew"); if (crewKeys.length) scene.current?.focusKeys(crewKeys); }} aria-expanded={panel === "crew"}><NxIcon name="crew" size={16} /><span>My crew{crew ? ` · ${crew.frogs.length + crew.watchers.length}` : ""}</span></button>
          <button className="sh-btn" onClick={() => setView(view === "scene" ? "list" : "scene")} aria-pressed={view === "list"}><NxIcon name={view === "scene" ? "menu" : "command"} size={16} /><span>{view === "scene" ? "List" : "Scene"}</span></button>
        </section>

        {view === "scene" && (
          <div className="sh-hud sh-zoom" role="group" aria-label="Zoom">
            <button onClick={() => scene.current?.zoomBy(1.35)} aria-label="Zoom in">+</button>
            <button onClick={() => scene.current?.zoomBy(1 / 1.35)} aria-label="Zoom out">−</button>
            <button onClick={() => { scene.current?.fit(); setPick(null); }} aria-label="See the whole ship"><NxIcon name="way" size={15} /></button>
          </div>
        )}

        {view === "scene" && (
          <nav className="sh-hud sh-rooms" aria-label="Rooms">
            {ROOM_ORDER.map((k) => (
              <button key={k} style={{ "--rc": accent(k) } as React.CSSProperties} className={pick?.kind === "room" && pick.station === k ? "on" : ""} onClick={() => flyRoom(k)}>
                <i /><span>{ROOM_NAME[k]}</span>{rooms && <small>{rooms[k].crew}</small>}
              </button>
            ))}
          </nav>
        )}

        {panel === "filters" && st && <Filters st={st} filter={filter} setFilter={setFilter} count={matchCount} onClose={() => setPanel("none")} />}
        {panel === "crew" && (
          <CrewPanel crew={crew} st={st} snap={snap} wallet={wallet} session={address} now={now} signIn={signIn} busy={busy} paste={paste} setPaste={setPaste}
            onView={(w) => { setViewing(w); flown.current = null; }} onOpen={(p) => open(p)} onFly={() => scene.current?.focusKeys(crewKeys)} onClose={() => setPanel("none")} />
        )}
        {pick && st && (
          <Card pick={pick} st={st} snap={snap} rooms={rooms} scene={scene.current} onOpen={(p) => open(p)} onClose={() => setPick(null)}
            onWallet={(w) => { setViewing(w); flown.current = null; setPanel("crew"); }} />
        )}
        {hover && hover.p.kind !== "room" && !pick && st && <Hover h={hover} st={st} snap={snap} scene={scene.current} />}
        {toast && <div className="sh-toast" role="status">{toast}</div>}
        {stats && new URLSearchParams(location.search).has("debug") && <div className="sh-debug">{stats.fps} fps · {stats.ms.toFixed(1)} ms</div>}
      </main>
      <NxTabs room="command" />
    </div>
  );
}

function Loading({ scene }: { scene: ShipScene }) {
  const [n, setN] = useState(scene.sprites.readyCount);
  useEffect(() => { const t = setInterval(() => setN(scene.sprites.readyCount), 250); return () => clearInterval(t); }, [scene]);
  if (n >= 500) return null;
  return <div className="sh-loading" aria-hidden="true"><i style={{ width: `${(n / 500) * 100}%` }} /><span>Drawing the crew from their onchain art · {n}/500</span></div>;
}

// ------------------------------------------------------------------ live numbers per room
type RoomStat = { crew: number; perHour: number; line: string };
function roomStats(st: ShipStatic | null, snap: Snapshot | null): Record<RoomKey, RoomStat> | null {
  if (!st) return null;
  const out = Object.fromEntries([...ROOM_ORDER, "drive"].map((k) => [k, { crew: 0, perHour: 0, line: "" }])) as Record<RoomKey, RoomStat>;
  st.frogs.forEach((row, i) => {
    const f = snap?.frogs[i], station: Station = st.rules[row[10]!]!.station;
    if (f?.dead) return;
    const at: RoomKey = f?.mission && !f.mission.done ? "missions" : station;
    out[at].crew++; out[at].perHour += f?.rate ?? 0;
  });
  for (const w of snap?.watchers ?? []) { const at: RoomKey = w.tier === 5 ? "quarters" : "bridge"; out[at].crew++; out[at].perHour += w.rate; }
  const h = (k: RoomKey) => (snap ? `${fmt(out[k].perHour, 1)} h/h` : "…");
  const onWatch = snap ? snap.watchers.filter((w) => w.watch.online).length + (snap.captain.watch.online ? 1 : 0) : 0;
  out.bridge.line = `${out.bridge.crew} aboard · ${snap ? `${snap.watchers.filter((w) => w.tier < 5 && w.n !== 0).length}/${WATCH_SEATS} watch seats` : ""} · ${h("bridge")}`;
  out.quarters.line = `${out.quarters.crew} officers · ${h("quarters")}`;
  out.offices.line = `${out.offices.crew} crew · ${h("offices")}`;
  out.breakroom.line = `${out.breakroom.crew} on break · ${h("breakroom")}`;
  out.missions.line = `${out.missions.crew} crew · ${snap?.totals.onMissions ?? 0} out · ${h("missions")}`;
  out.engine.line = `${out.engine.crew} on shift · ${h("engine")}`;
  out.forge.line = `${out.forge.crew} crew · ${snap?.totals.burned ?? 0} forged · ${h("forge")}`;
  void onWatch;
  return out;
}

// ------------------------------------------------------------------ filters
function matcher(st: ShipStatic | null, snap: Snapshot | null, f: Filter): ((key: string) => boolean) | null {
  if (!st || (f.rarity === "" && f.layer < 0 && f.station === "" && f.special === "" && !f.tier)) return null;
  return (key: string) => {
    if (key.startsWith("w")) {
      const w = snap?.watchers.find((x) => `w${x.n}` === key);
      if (!w) return false;
      if (f.tier) return w.tier === f.tier && (f.layer < 0 || f.value < 0 || w.traits[f.layer] === f.value);
      if (f.special === "watchers") return true;
      if (f.special || f.rarity || f.station) return false;
      return f.layer >= 0 && (f.value < 0 || w.traits[f.layer] === f.value);
    }
    const id = Number(key), row = st.frogs[id - 1];
    if (!row) return false;
    const sf = snap?.frogs[id - 1];
    if (f.special === "watchers" || f.tier) return false;
    if (f.special === "missions" && !(sf?.mission && !sf.mission.done)) return false;
    if (f.special === "forged" && !sf?.dead) return false;
    if (f.rarity && st.rarities[row[1]!] !== f.rarity) return false;
    if (f.station && st.rules[row[10]!]!.station !== f.station) return false;
    if (f.layer >= 0 && f.value >= 0 && row[3 + f.layer] !== f.value) return false;
    return true;
  };
}

function Filters({ st, filter, setFilter, count, onClose }: { st: ShipStatic; filter: Filter; setFilter: (f: Filter) => void; count: number | null; onClose: () => void }) {
  return (
    <aside className="sh-panel sh-filters" aria-label="Filter the crew">
      <div className="sh-panel-head"><b>Filter the crew</b><button className="sh-x" onClick={onClose} aria-label="Close"><NxIcon name="close" size={14} /></button></div>
      <label>Rarity<select value={filter.rarity} onChange={(e) => setFilter({ ...filter, rarity: e.target.value })}><option value="">Any</option>{st.rarities.map((r) => <option key={r}>{r}</option>)}</select></label>
      <label>Station<select value={filter.station} onChange={(e) => setFilter({ ...filter, station: e.target.value })}><option value="">Any</option>{ROOM_ORDER.map((k) => <option key={k} value={k}>{ROOM_NAME[k]}</option>)}</select></label>
      <label>Trait<select value={filter.layer} onChange={(e) => setFilter({ ...filter, layer: Number(e.target.value), value: -1 })}><option value={-1}>Any layer</option>{st.layers.map((l, i) => i > 0 && <option key={l} value={i}>{l}</option>)}</select></label>
      {filter.layer >= 0 && <label>{st.layers[filter.layer]}<select value={filter.value} onChange={(e) => setFilter({ ...filter, value: Number(e.target.value) })}><option value={-1}>Pick one</option>{st.names[filter.layer]!.map((n, i) => <option key={n} value={i}>{n} · {st.counts[filter.layer]![i]} frogs</option>)}</select></label>}
      <label>Show<select value={filter.special} onChange={(e) => setFilter({ ...filter, special: e.target.value as Filter["special"] })}><option value="">Everyone</option><option value="watchers">Night Watchers</option><option value="missions">Out on missions</option><option value="forged">Forged frogs</option></select></label>
      <label>Night Watcher tier<select value={filter.tier} onChange={(e) => setFilter({ ...filter, tier: Number(e.target.value) })}><option value={0}>Any</option>{st.tiers.map((t) => <option key={t.tier} value={t.tier}>Tier {t.roman} · {t.name}</option>)}<option value={6}>The Captain</option></select></label>
      <div className="sh-panel-foot"><span>{count === null ? "Everyone shown" : `${count} match`}</span><button className="sh-btn" onClick={() => setFilter(NO_FILTER)}>Clear</button></div>
    </aside>
  );
}

// ------------------------------------------------------------------ the detail card
function Card({ pick, st, snap, rooms, scene, onOpen, onClose, onWallet }: { pick: Pick; st: ShipStatic; snap: Snapshot | null; rooms: Record<RoomKey, RoomStat> | null; scene: ShipScene | null; onOpen: (p: Pick) => void; onClose: () => void; onWallet: (w: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, [pick]);
  let body: React.ReactNode = null;
  if (pick.kind === "frog") body = <FrogCard id={pick.id} st={st} snap={snap} onOpen={onOpen} onWallet={onWallet} />;
  else if (pick.kind === "watcher") body = <WatcherCard n={pick.n} st={st} snap={snap} onOpen={onOpen} onWallet={onWallet} />;
  else if (pick.kind === "seat") body = <SeatCard seat={pick.seat} st={st} snap={snap} scene={scene} onOpen={onOpen} />;
  else body = <RoomCard k={pick.station} st={st} snap={snap} rooms={rooms} />;
  return (
    <aside ref={ref} tabIndex={-1} className="sh-panel sh-card" role="dialog" aria-label="Details">
      <button className="sh-x sh-card-x" onClick={onClose} aria-label="Close"><NxIcon name="close" size={14} /></button>
      {body}
    </aside>
  );
}

function rateLine(f: SnapFrog, snap: Snapshot) {
  const parts = [`${f.base}× base (${f.id === 1 ? "#1, the Zero-Sleep Captain" : f.id <= 25 ? "early Genesis #2–25" : f.id <= 77 ? "Genesis #26–77" : "#78–500"})`];
  if (f.boost) parts.push(`+${f.boost}% crew boost from the holder's ${f.boost === 150 ? (snap.captain.forged ? "The Captain" : "#1") : "Night Watcher"}`);
  if (f.seat) parts.push("×2 for the holder's IMD seat");
  return parts.join(" · ");
}

function FrogCard({ id, st, snap, onOpen, onWallet }: { id: number; st: ShipStatic; snap: Snapshot | null; onOpen: (p: Pick) => void; onWallet: (w: string) => void }) {
  const row = st.frogs[id - 1]!, [rank, ri, points] = row as [number, number, number], traits = row.slice(3, 10), rule = st.rules[row[10]!]!;
  const f = snap?.frogs[id - 1], owner = f && f.o >= 0 ? snap!.wallets[f.o]! : null;
  const rarity = st.rarities[ri]!;
  const station = f?.mission && !f.mission.done ? "missions" : rule.station;
  return (
    <>
      <div className="sh-card-top">
        <img className="sh-art" src={`/api/forge/nf/${id}.svg`} alt={`NIGHT FROG #${id}, its onchain art`} width={176} height={176} />
        <div>
          <span className="sh-kicker">NIGHT FROGS · GEN 1</span>
          <h2>#{id}{id === 1 ? " · Zero-Sleep Captain" : ""}</h2>
          <div className="sh-tags"><span className="sh-tag" style={{ "--tc": RARITY_TONE[rarity] } as React.CSSProperties}>{rarity}</span><span className="sh-tag">rank {rank} / 500</span><span className="sh-tag">{points} forge pts</span></div>
          <p className="sh-station" style={{ "--rc": accent(station) } as React.CSSProperties}><i />{f?.dead ? "The Forge's memorial wall" : ROOM_NAME[station]}</p>
        </div>
      </div>
      {f?.dead ? (
        <div className="sh-note sh-note-forge">Forged: this frog went to 0x…dEaD in {f.into === 0 ? <button className="sh-link" onClick={() => onOpen({ kind: "watcher", n: 0 })}>The Captain</button> : f.into !== null ? <button className="sh-link" onClick={() => onOpen({ kind: "watcher", n: f.into! })}>Night Watcher #{f.into}</button> : "a Night Watcher"} and earns nothing now; the Night Watcher it made earns instead.</div>
      ) : (
        <dl className="sh-nums">
          <div><dt>Shift hours / hour</dt><dd className="sh-acc">{f ? fmt(f.rate, 2) : "…"}</dd></div>
          <div><dt>Multiplier</dt><dd>{f ? `${f.base}×` : "…"}</dd></div>
          <div><dt>Soft-staked</dt><dd>{f ? (owner ? "Yes" : "Unknown") : "…"}</dd></div>
          <div><dt>Mission</dt><dd>{f?.mission ? (f.mission.done ? `${f.mission.title} · done` : f.mission.title) : "None this week"}</dd></div>
        </dl>
      )}
      {f && !f.dead && snap && <p className="sh-fine">{rateLine(f, snap)}. Soft staking: the frog stays in its holder's wallet and earns every hour it is held.</p>}
      <p className="sh-why"><b>Why here:</b> {rule.layer === null ? rule.why : `${st.layers[rule.layer]}: ${st.names[rule.layer]![traits[rule.layer]!]}, ${rule.why}`}.{f?.mission && !f.mission.done ? " Out on a mission this week, so it rides a launch pod in the mission bay." : ""}</p>
      <Traits st={st} traits={traits} decide={rule.layer} />
      <div className="sh-owner">
        <span>Holder</span>
        {owner ? <><a className="mono" href={`https://etherscan.io/address/${owner}`} target="_blank" rel="noreferrer">{short(owner)}</a><button className="sh-link" onClick={() => onWallet(owner)}>See this crew</button></> : <b>{f?.dead ? "0x…dEaD (forged)" : "…"}</b>}
      </div>
      <div className="sh-links">
        <Link to={owner ? `/forge?wallet=${owner}` : "/forge"} className="nx-btn nx-btn-acc"><NxIcon name="forge" size={16} /> Forge</Link>
        <a className="nx-btn" href={`https://etherscan.io/nft/${NIGHT_FROGS}/${id}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
        <a className="nx-btn" href={`https://opensea.io/assets/ethereum/${NIGHT_FROGS}/${id}`} target="_blank" rel="noreferrer">OpenSea ↗</a>
      </div>
    </>
  );
}

function Traits({ st, traits, decide }: { st: ShipStatic; traits: number[]; decide: number | null }) {
  return (
    <ul className="sh-traits">
      {traits.map((v, l) => {
        const name = st.names[l]![v]!, n = st.counts[l]![v]!;
        const does = FX[name] ?? (l === 4 && BLINKS.has(name) ? "blinks now and then" : null);
        return (
          <li key={l} className={decide === l ? "on" : ""}>
            <span>{st.layers[l]}</span><b>{name}</b><small>{n} of 500 · {((n / 500) * 100).toFixed(n < 25 ? 1 : 0)}%</small>
            {(does || decide === l) && <em>{decide === l ? "sets its station" : ""}{decide === l && does ? " · " : ""}{does ?? ""}</em>}
          </li>
        );
      })}
    </ul>
  );
}

function WatcherCard({ n, st, snap, onOpen, onWallet }: { n: number; st: ShipStatic; snap: Snapshot | null; onOpen: (p: Pick) => void; onWallet: (w: string) => void }) {
  const w = snap?.watchers.find((x) => x.n === n) as SnapWatcher | undefined;
  if (!w || !snap) return <p className="sh-fine">Reading Night Watcher #{n}…</p>;
  const owner = w.o >= 0 ? snap.wallets[w.o]! : null;
  const tier = n === 0 ? st.captain : st.tiers[w.tier - 1]!;
  return (
    <>
      <div className="sh-card-top">
        <img className="sh-art" src={`/api/forge/frog/${n}.svg`} alt={`Night Watcher #${n}, its onchain art`} width={176} height={176} />
        <div>
          <span className="sh-kicker">GEN 2 · NIGHT WATCHERS</span>
          <h2>{n === 0 ? "The Captain" : `Night Watcher #${n}`}{w.name ? ` · ${w.name}` : ""}</h2>
          <div className="sh-tags"><span className="sh-tag" style={{ "--tc": w.color } as React.CSSProperties}>Tier {tier.roman} · {w.tierName}</span><span className="sh-tag">{w.points} forge pts</span><span className="sh-tag">forged {new Date(w.forgedAt).toISOString().slice(0, 10)}</span></div>
          <p className="sh-station" style={{ "--rc": w.color } as React.CSSProperties}><i />{w.tier === 5 ? "Captain's quarters · a Night Boss plinth" : n === 0 ? "Bridge · the Captain's chair" : "Bridge · Night Watch seat"}</p>
        </div>
      </div>
      <dl className="sh-nums">
        <div><dt>Shift hours / hour</dt><dd className="sh-acc">{fmt(w.rate, 2)}</dd></div>
        <div><dt>Multiplier</dt><dd>{w.base}×</dd></div>
        <div><dt>Crew boost</dt><dd>+{w.crew}%</dd></div>
        <div><dt>Company slots</dt><dd>+{w.slots}</dd></div>
      </dl>
      <p className="sh-fine">Earns its tier's {w.x}× or what its 10 frogs earned together, whichever is more ({w.base}×){w.seat ? ", ×2 for the holder's IMD seat" : ""}. Every other NIGHT FROG in the holder's wallet earns {w.crew}% more while it is there. It crews all three Command Room missions at {w.base}×.</p>
      <div className="sh-note" style={{ "--rc": w.color } as React.CSSProperties}><b>Night Watch seat:</b> {w.watch.paired ? (w.watch.online ? "paired, its bot is online and on watch over imdUSD." : "paired, its bot is offline right now.") : "not paired yet: the holder runs the Night Watch bot to take it."} <Link to="/watch">The Night Watch</Link></div>
      {w.missions.length > 0 && <p className="sh-fine"><b>Missions this week:</b> {w.missions.map((m) => `${m.title}${m.done ? " (done)" : ""}`).join(", ")}</p>}
      <div className="sh-forged">
        <span>Forged from</span>
        <div>{(n === 0 ? [1, ...w.inputs.filter((i) => i !== 1)] : w.inputs).map((id) => <button key={id} onClick={() => onOpen({ kind: "frog", id })}>#{id}</button>)}</div>
      </div>
      <Traits st={st} traits={w.traits} decide={null} />
      <div className="sh-owner">
        <span>Holder</span>
        {owner ? <><a className="mono" href={`https://etherscan.io/address/${owner}`} target="_blank" rel="noreferrer">{short(owner)}</a><button className="sh-link" onClick={() => onWallet(owner)}>See this crew</button></> : <b>…</b>}
      </div>
      <div className="sh-links">
        <Link to="/forge" className="nx-btn nx-btn-acc"><NxIcon name="forge" size={16} /> Forge</Link>
        <a className="nx-btn" href={`https://etherscan.io/nft/${FORGE}/${n}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
        <a className="nx-btn" href={`https://opensea.io/assets/ethereum/${FORGE}/${n}`} target="_blank" rel="noreferrer">OpenSea ↗</a>
      </div>
    </>
  );
}

function SeatCard({ seat, st, snap, scene, onOpen }: { seat: number; st: ShipStatic; snap: Snapshot | null; scene: ShipScene | null; onOpen: (p: Pick) => void }) {
  const why = scene?.emptyWhy(seat) ?? null;
  const forged = snap?.watchers.filter((w) => w.n !== 0).length ?? 0, bosses = snap?.watchers.filter((w) => w.tier === 5).length ?? 0;
  void st;
  if (why) {
    const id = Number(/#(\d+)/.exec(why)?.[1] ?? 0);
    return (
      <>
        <span className="sh-kicker">An empty seat</span>
        <h2>Its frog is away</h2>
        <p className="sh-fine">The frog of this seat is {why}.</p>
        {why.includes("Night Watcher") && id ? <button className="nx-btn" onClick={() => onOpen({ kind: "watcher", n: id })}>See Night Watcher #{id}</button> : null}
      </>
    );
  }
  return (
    <>
      <span className="sh-kicker">The Night Watch</span>
      <h2>An open seat</h2>
      <p className="sh-fine">{forged} of 50 Night Watchers are forged ({bosses} of 4 possible Night Bosses), so {50 - forged} seats are still open. A Night Watcher takes a seat here the hour it is forged: burn 10 NIGHT FROGS, get 10× to 40× shift hours, a crew boost and a keeper seat over imdUSD.</p>
      <Link to="/forge" className="nx-btn nx-btn-acc"><NxIcon name="forge" size={16} /> Open the Forge</Link>
    </>
  );
}

function RoomCard({ k, st, snap, rooms }: { k: RoomKey; st: ShipStatic; snap: Snapshot | null; rooms: Record<RoomKey, RoomStat> | null }) {
  const r = rooms?.[k];
  const meta = k === "drive" ? { name: "Drive", deck: "Aft", about: "The drive cores feeding the three engines. Machinery only: no seats." } : st.stations[k];
  const radar = snap?.radar;
  return (
    <>
      <span className="sh-kicker" style={{ color: accent(k) }}>{meta.deck}</span>
      <h2>{meta.name}</h2>
      <p className="sh-fine">{meta.about}</p>
      {r && k !== "drive" && <dl className="sh-nums"><div><dt>Aboard here</dt><dd>{r.crew}</dd></div><div><dt>Shift hours / hour</dt><dd className="sh-acc">{fmt(r.perHour, 1)}</dd></div></dl>}
      {k === "bridge" && (
        <div className="sh-note"><b>The radar:</b> {radar ? `live from the imdUSD vault: ${radar.loans.length} open loans worth a liquidation, ${fmt(radar.totalDebt, 0)} imdUSD owed. A blip nearer the centre is closer to the ${radar.mat}% liquidation line (dashed red); its bearing is fixed by the borrower's address. Loans under ${radar.mat}% can be marked by a Night Watch seat, then liquidated after ${radar.lullHours} hours for a ${radar.bonusPct}% bonus.${radar.stale.length ? ` Stale feeds right now: ${radar.stale.join(", ")}.` : ""}` : "waiting for the first read of the imdUSD vault."}</div>
      )}
      {k === "forge" && <p className="sh-fine">{snap ? `${snap.totals.burned} frogs forged so far into ${snap.watchers.length} Night Watcher${snap.watchers.length === 1 ? "" : "s"}. The memorial wall shows each one with the 10 it burned.` : ""} <Link to="/forge">Open the Forge</Link></p>}
      {k === "missions" && <p className="sh-fine">{snap ? `${snap.totals.onMissions} frogs are out on this week's missions.` : ""} Holders send frogs from the <Link to="/command">Command Room</Link>; a frog out rides a launch pod until it is back.</p>}
      {k === "breakroom" && <p className="sh-fine">The games are one deck over: NIGHT CHESS, NIGHT POOL, NIGHT POKER and Space Pinball, against people or AI agents. <Link to="/games">The Game Room</Link></p>}
      {k === "offices" && <p className="sh-fine">A wallet with a frog runs up to 7 AI companies instead of 5; a Night Watcher adds 3 to 8 slots by tier. <Link to="/launch">Launch a company</Link></p>}
    </>
  );
}

function Hover({ h, st, snap, scene }: { h: { p: Pick; x: number; y: number }; st: ShipStatic; snap: Snapshot | null; scene: ShipScene | null }) {
  let t = "";
  if (h.p.kind === "frog") { const row = st.frogs[h.p.id - 1]!, f = snap?.frogs[h.p.id - 1]; t = `#${h.p.id} · ${st.rarities[row[1]!]} · ${f ? `${fmt(f.rate, 2)} h/h` : ""}`; }
  else if (h.p.kind === "watcher") { const n = h.p.n, w = snap?.watchers.find((x) => x.n === n); t = w ? `${n === 0 ? "The Captain" : `Night Watcher #${n}`} · ${w.tierName} · ${fmt(w.rate, 2)} h/h` : ""; }
  else if (h.p.kind === "seat") t = scene?.emptyWhy(h.p.seat) ? "An empty seat" : "An open Night Watch seat";
  if (!t || !h.x) return null;
  return <div className="sh-hover" style={{ left: h.x + 14, top: h.y + 12 }}>{t}</div>;
}

// ------------------------------------------------------------------ my crew
function CrewPanel({ crew, st, snap, wallet, session, now, signIn, busy, paste, setPaste, onView, onOpen, onFly, onClose }: {
  crew: Crew | null; st: ShipStatic | null; snap: Snapshot | null; wallet: string | null; session: string | null; now: number; signIn: () => Promise<void>; busy: boolean;
  paste: string; setPaste: (s: string) => void; onView: (w: string | null) => void; onOpen: (p: Pick) => void; onFly: () => void; onClose: () => void;
}) {
  const hours = crew ? crew.hours + (crew.perHour * Math.max(0, now - crew.stakingAt)) / 3_600_000 : 0;
  const mine = wallet && session && wallet === session.toLowerCase();
  return (
    <aside className="sh-panel sh-crew" aria-label="My crew">
      <div className="sh-panel-head"><b>{mine ? "My crew" : wallet ? "A crew" : "My crew"}</b>{wallet && <span className="mono">{short(wallet)}</span>}<button className="sh-x" onClick={onClose} aria-label="Close"><NxIcon name="close" size={14} /></button></div>
      {!wallet ? (
        <div className="sh-crew-in">
          <p className="sh-fine">Sign in with your wallet and the ship lights up your NIGHT FROGS and Night Watchers, flies to them and adds up what they earn.</p>
          <button className="nx-btn nx-btn-acc" onClick={() => void signIn()} disabled={busy}><NxIcon name="key" size={16} />{busy ? "Check your wallet…" : "Sign in"}</button>
          <form onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{40}$/.test(paste.trim())) onView(paste.trim().toLowerCase()); }}>
            <input className="sh-input mono" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="or look at any wallet: 0x…" aria-label="A wallet address" />
          </form>
        </div>
      ) : !crew ? <p className="sh-fine">Reading this wallet's crew…</p> : crew.frogs.length + crew.watchers.length === 0 ? (
        <div className="sh-crew-in">
          <p className="sh-fine">No NIGHT FROGS or Night Watchers in this wallet right now.</p>
          <a className="nx-btn nx-btn-acc" href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">Find a frog on OpenSea ↗</a>
          {!mine && session && <button className="sh-link" onClick={() => onView(null)}>Back to my wallet</button>}
        </div>
      ) : (
        <div className="sh-crew-in">
          <div className="sh-ticker" aria-live="off"><b>{fmt(hours, 1)}</b><span>shift hours, all time{crew.rank ? ` · #${crew.rank} in the crew` : ""}</span></div>
          <dl className="sh-nums">
            <div><dt>Earning now</dt><dd className="sh-acc">{fmt(crew.perHour, 2)} h/h</dd></div>
            <div><dt>On board</dt><dd>{crew.frogs.length} frog{crew.frogs.length === 1 ? "" : "s"}{crew.watchers.length ? ` · ${crew.watchers.length} NW` : ""}</dd></div>
            <div><dt>Crew boost</dt><dd>{crew.boost ? `+${crew.boost}%` : "none"}</dd></div>
            <div><dt>Company slots</dt><dd>{crew.slots}{crew.companies ? ` · ${crew.companies} used` : ""}</dd></div>
          </dl>
          <p className="sh-fine">Shift hours share the weekly frog pot (ETH, $SHIFT and IMD) every Monday; claim at <Link to="/frogs">NIGHT FROGS</Link>.{crew.seat ? " This wallet holds an IMD seat: its hours count double." : ""}</p>
          {crew.missions.length > 0 && <p className="sh-fine"><b>Missions this week:</b> {crew.missions.map((m) => `${m.frog >= FORGED_ID ? `NW #${m.frog - FORGED_ID}` : `#${m.frog}`} on ${m.title}${m.done ? " (done)" : ""}`).join(", ")}</p>}
          {crew.forge && (
            <div className="sh-forge" style={{ "--tc": st?.tiers[crew.forge.tier - 1]?.color } as React.CSSProperties}>
              <span className="sh-kicker">Best forge from this crew</span>
              <b>Tier {st?.tiers[crew.forge.tier - 1]?.roman} {crew.forge.name} · {crew.forge.points} pts</b>
              <p>The forge planner's pick: these 10 earn {crew.forge.before} h/h as frogs and would make a Night Watcher earning {crew.forge.rate} h/h, keeping your rarest frogs.</p>
              <div className="sh-ids">{crew.forge.ids.map((id) => <button key={id} onClick={() => onOpen({ kind: "frog", id })}>#{id}</button>)}</div>
              <Link to={`/forge?wallet=${crew.wallet}&ids=${crew.forge.ids.join(",")}`} className="nx-btn nx-btn-acc"><NxIcon name="forge" size={16} /> Preview it in the Forge</Link>
            </div>
          )}
          <div className="sh-crewlist">
            {crew.watchers.map((n) => { const w = snap?.watchers.find((x) => x.n === n); return <button key={`w${n}`} onClick={() => onOpen({ kind: "watcher", n })} style={{ "--tc": w?.color } as React.CSSProperties}><img src={`/api/forge/frog/${n}.svg`} alt="" loading="lazy" width={44} height={44} /><span>{n === 0 ? "Captain" : `NW #${n}`}</span></button>; })}
            {crew.frogs.map((id) => <button key={id} onClick={() => onOpen({ kind: "frog", id })} style={{ "--tc": st ? RARITY_TONE[st.rarities[st.frogs[id - 1]![1]!]!] : undefined } as React.CSSProperties}><img src={`/api/forge/nf/${id}.svg`} alt="" loading="lazy" width={44} height={44} /><span>#{id}</span></button>)}
          </div>
          <div className="sh-row"><button className="nx-btn" onClick={onFly}><NxIcon name="command" size={16} /> Fly to my crew</button>{!mine && session && <button className="sh-link" onClick={() => onView(null)}>Back to my wallet</button>}</div>
        </div>
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ the list: the same crew as text
function ListView({ st, snap, matches, q, onOpen }: { st: ShipStatic | null; snap: Snapshot | null; matches: ((k: string) => boolean) | null; q: string; onOpen: (p: Pick) => void }) {
  const [shown, setShown] = useState(60);
  if (!st) return <div className="sh-list"><p className="sh-fine">Loading the crew…</p></div>;
  const num = /^#?(\d{1,3})$/.exec(q.trim())?.[1];
  const ids = [...st.frogs.keys()].map((i) => i + 1).filter((id) => (!matches || matches(String(id))) && (!num || String(id).startsWith(num)));
  const ws = (snap?.watchers ?? []).filter((w) => !matches || matches(`w${w.n}`));
  return (
    <div className="sh-list">
      <h2 className="sh-list-h">The crew · {ids.length} frogs{ws.length ? ` · ${ws.length} Night Watcher${ws.length === 1 ? "" : "s"}` : ""}</h2>
      <ul>
        {ws.map((w) => (
          <li key={`w${w.n}`}><button onClick={() => onOpen({ kind: "watcher", n: w.n })} style={{ "--tc": w.color } as React.CSSProperties}>
            <img src={`/api/forge/frog/${w.n}.svg`} alt="" loading="lazy" width={56} height={56} />
            <b>{w.n === 0 ? "The Captain" : `Night Watcher #${w.n}`}</b><span>Tier {w.tierName} · {w.tier === 5 ? "Captain's quarters" : "Bridge"}</span><span className="sh-acc">{fmt(w.rate, 2)} h/h</span><span className="mono">{w.o >= 0 ? short(snap!.wallets[w.o]!) : ""}</span>
          </button></li>
        ))}
        {ids.slice(0, shown).map((id) => {
          const row = st.frogs[id - 1]!, f = snap?.frogs[id - 1], station = st.rules[row[10]!]!.station;
          return (
            <li key={id}><button onClick={() => onOpen({ kind: "frog", id })} style={{ "--tc": RARITY_TONE[st.rarities[row[1]!]!] } as React.CSSProperties}>
              <img src={`/api/forge/nf/${id}.svg`} alt="" loading="lazy" width={56} height={56} />
              <b>#{id}</b><span>{st.rarities[row[1]!]} · {f?.dead ? "forged" : f?.mission && !f.mission.done ? `on a mission` : ROOM_NAME[station]}</span><span className="sh-acc">{f ? `${fmt(f.rate, 2)} h/h` : ""}</span><span className="mono">{f && f.o >= 0 ? short(snap!.wallets[f.o]!) : f?.dead ? "0x…dEaD" : ""}</span>
            </button></li>
          );
        })}
      </ul>
      {ids.length > shown && <button className="nx-btn sh-more" onClick={() => setShown(shown + 120)}>Show more ({ids.length - shown} left)</button>}
    </div>
  );
}
void CW; void CH;
