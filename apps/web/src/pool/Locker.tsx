import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { LITE, pixelRatio } from "../lite";
import type { CatalogItem, SelfProfile } from "./api";
import { thumbnail } from "./art";
import { BADGES, type Kind, KINDS, MAX_EMOTES } from "./catalog";
import { Avatar, Banner, Emote, Title, WinEffect } from "./cosmetics";
import { FOOT_X, FOOT_Y, rack } from "./physics";
import { PoolScene } from "./table3d";

/**
 * The gaming profile and the locker: the player's banner, frame, level and XP, titles and badges,
 * stats per game, and every cosmetic in the catalogue with its edition (numbered copies), what it
 * takes to get it, and its price. Equip anything owned; preview any item on the table. Buying is
 * the vault shop's (coming soon): in IMD, ETH, $SHIFT or USDC, through any wallet (WalletConnect included,
 * as in Telegram's in-app browser, which has no wallet of its own).
 */
export type LockerApi = {
  equip(kind: Kind, value: string | string[]): Promise<SelfProfile>;
  avatar(n: number): Promise<SelfProfile>;
  purchase(item: string, asset: string): Promise<{ status: string; price: string; asset: string; message: string; left: number | null }>;
};
const KIND_LABEL: Record<Kind, string> = { cue: "Cues", cloth: "Cloths", table: "Tables", balls: "Ball sets", frame: "Frames", banner: "Banners", title: "Titles", effect: "Win effects", emote: "Emotes" };
const RARITY: Record<string, string> = { standard: "STANDARD ISSUE", rare: "RARE", epic: "EPIC", legendary: "LEGENDARY", mythic: "MYTHIC" };
const ASSET_LABEL: Record<string, string> = { IMD: "IMD", ETH: "ETH", SHIFT: "$SHIFT", USDC: "USDC" };

/** A live preview of an item on the table (cue, cloth, table frame or ball set). */
function TablePreview({ item }: { item: CatalogItem | null }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<PoolScene | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const s = new PoolScene(host.current, { lite: LITE, pixelRatio: pixelRatio(1.5) });
    scene.current = s;
    s.setBalls(rack(17));
    return () => { s.dispose(); scene.current = null; };
  }, []);
  useEffect(() => {
    const s = scene.current;
    if (!s || !item) return;
    const k = item.kind;
    s.setLook({ ...(k === "cloth" ? { cloth: item.id } : {}), ...(k === "table" ? { table: item.id } : {}), ...(k === "balls" ? { balls: item.id } : {}), ...(k === "cue" ? { cue: item.id } : {}) });
    s.setBalls(rack(17));
    const b = rack(17)[0]!, aim = Math.round(Math.atan2(FOOT_Y - b.y, FOOT_X - b.x) * 180000 / Math.PI);
    s.showCue(k === "cue" ? b : null, aim, 0.35, 0);
    // a cue is seen from behind the cue ball, the rest from above
    if (k === "cue") s.setView("cue", aim, b); else s.setView("top");
  }, [item?.id]);
  return <div className="np-preview-stage" ref={host} />;
}

function Art({ item, big = false }: { item: CatalogItem; big?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!["cue", "cloth", "table", "balls"].includes(item.kind)) return;
    // rendered after paint, one at a time, so a page of cards never stalls
    const id = setTimeout(() => setSrc(thumbnail(item.id, big ? 480 : 320, big ? 240 : 160)), 0);
    return () => clearTimeout(id);
  }, [item.id, big]);
  if (item.kind === "frame") return <span className="np-art"><Avatar frame={item.id} avatar={2} size={big ? 120 : 78} /></span>;
  if (item.kind === "banner") return <span className="np-art banner"><Banner id={item.id} /></span>;
  if (item.kind === "title") return <span className="np-art"><Title id={item.id} /></span>;
  if (item.kind === "emote") return <span className="np-art"><Emote id={item.id} big /></span>;
  if (item.kind === "effect") return <span className="np-art effect"><Icon name="bolt" size={26} /><small>{item.name}</small></span>;
  return <span className="np-art">{src ? <img src={src} alt="" /> : <i className="np-art-wait" />}</span>;
}

export function LockerView({ me, catalog, api, onClose }: { me: SelfProfile; catalog: CatalogItem[]; api: LockerApi; onClose?: () => void }) {
  const [profile, setProfile] = useState(me);
  const [kind, setKind] = useState<Kind>("cue");
  const [pick, setPick] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null), [buy, setBuy] = useState<CatalogItem | null>(null);
  const [effect, setEffect] = useState(0);
  useEffect(() => setProfile(me), [me]);
  const owned = useMemo(() => new Map(profile.items.map((o) => [o.id, o])), [profile.items]);
  const items = catalog.filter((i) => i.kind === kind);
  const equipped = (i: CatalogItem) => kind === "emote" ? profile.equip.emote.includes(i.id) : (profile.equip as Record<string, unknown>)[kind] === i.id;
  const has = (i: CatalogItem) => i.rarity === "standard" || owned.has(i.id);
  const run = async (f: () => Promise<SelfProfile>) => { if (busy) return; setBusy(true); setMsg(null); try { setProfile(await f()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const wear = (i: CatalogItem) => {
    if (kind === "emote") {
      const set = equipped(i) ? profile.equip.emote.filter((x) => x !== i.id) : [...profile.equip.emote, i.id].slice(-MAX_EMOTES);
      if (!set.length) { setMsg("Keep at least one emote."); return; }
      void run(() => api.equip("emote", set));
    } else void run(() => api.equip(kind, i.id));
  };
  const how = (i: CatalogItem) => {
    const o = owned.get(i.id);
    if (o) return o.serial ? `#${o.serial} of ${i.supply}` : "Yours";
    if (i.rarity === "standard") return "Standard issue: yours";
    const left = i.left ?? 0, ed = i.supply ? `${i.supply} numbered · ${left} left` : "";
    if (i.unlock.by === "level") return `Level ${i.unlock.level} · ${ed}`;
    if (i.unlock.by === "badge") return `Badge: ${BADGES[i.unlock.badge as keyof typeof BADGES]?.name ?? i.unlock.badge} · ${ed}`;
    return ed;
  };
  const pct = Math.max(0, Math.min(1, (profile.xp - profile.floor) / Math.max(1, profile.next - profile.floor)));
  const preview = pick && ["cue", "cloth", "table", "balls"].includes(pick.kind) ? pick : null;
  return <div className="np-locker">
    <section className="np-profile">
      <Banner id={profile.banner} className="np-profile-banner" />
      <div className="np-profile-row">
        <Avatar frame={profile.frame} avatar={profile.avatar} size={92} level={profile.level} />
        <div className="np-profile-who">
          <b>{profile.name}</b>
          <Title id={profile.title} />
          <div className="np-xp" aria-label={`Level ${profile.level}, ${profile.xp} XP`}><span>LEVEL {profile.level}</span><i><em style={{ width: `${pct * 100}%` }} /></i><small>{profile.xp - profile.floor} / {profile.next - profile.floor} XP</small></div>
        </div>
        {onClose && <button type="button" className="np-btn ghost small" onClick={onClose}><Icon name="close" size={14} />CLOSE</button>}
      </div>
      <div className="np-stats">{(["pool", "chess", "poker", "pinball"] as const).map((g) => { const s = profile.stats[g] ?? { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0 }; return <div key={g}><span>{g === "pool" ? "NIGHT POOL" : g === "chess" ? "NIGHT CHESS" : g === "poker" ? "NIGHT POKER" : "SPACE PINBALL"}</span><b>{s.wins}<small>W</small> {s.losses}<small>L</small></b><small>{s.played} played · best run {s.best}</small></div>; })}<div><span>BALLS DROPPED</span><b>{profile.potted}</b><small>{profile.editions} numbered items</small></div></div>
      <div className="np-badges">{profile.badges.length ? profile.badges.map((b) => <span key={b.id} className="np-badge" title={b.line}><Icon name="trophy" size={13} />{b.name}</span>) : <span className="np-badge off">No badges yet: play a rack.</span>}</div>
      <div className="np-faces" role="group" aria-label="Your crew frog">{[0, 1, 2, 3, 4].map((n) => <button type="button" key={n} aria-pressed={profile.avatar === n} className={profile.avatar === n ? "on" : ""} disabled={busy} onClick={() => void run(() => api.avatar(n))}><img src={`/games/pinball/frog-${n}.webp`} alt={`Crew frog ${n + 1}`} width={40} height={40} /></button>)}</div>
    </section>
    <div className="np-kinds" role="tablist" aria-label="Item kinds">{KINDS.map((k) => <button type="button" role="tab" key={k} aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setPick(null); }}>{KIND_LABEL[k]}</button>)}</div>
    {preview && <div className="np-preview"><TablePreview item={preview} /><span className="np-kicker">PREVIEW · {preview.name.toUpperCase()}</span></div>}
    {pick?.kind === "effect" && <div className="np-preview effect"><WinEffect id={pick.id} play key={effect} lite={LITE} /><button type="button" className="np-btn ghost small" onClick={() => setEffect(effect + 1)}><Icon name="play" size={13} />PLAY AGAIN</button></div>}
    {msg && <p className="np-error" role="alert"><Icon name="alert" size={15} />{msg}</p>}
    <ul className="np-items">{items.map((i) => <li key={i.id} className={`np-item r-${i.rarity} ${equipped(i) ? "worn" : ""} ${pick?.id === i.id ? "picked" : ""}`}>
      <button type="button" className="np-item-art" onClick={() => setPick(i)} aria-label={`Preview ${i.name}`}><Art item={i} /></button>
      <div className="np-item-text"><span className="np-rarity">{RARITY[i.rarity]}</span><b>{i.name}</b><small>{i.line}</small>
        <span className="np-edition">{how(i)}{i.guide ? ` · guide +${i.guide}% (free games)` : ""}</span></div>
      <div className="np-item-act">
        {has(i) ? <button type="button" className={`np-btn small ${equipped(i) ? "ghost" : ""}`} disabled={busy || (equipped(i) && kind !== "emote")} onClick={() => wear(i)}>{equipped(i) ? kind === "emote" ? "IN YOUR SET" : "EQUIPPED" : kind === "emote" ? "ADD TO SET" : "EQUIP"}</button>
          : i.unlock.by === "shop" ? <button type="button" className="np-btn small" onClick={() => setBuy(i)}>{`${i.price?.USDC ?? "?"} USDC`}</button>
          : <span className="np-lock"><Icon name="lock" size={13} />EARN IT</span>}
      </div>
    </li>)}</ul>
    {buy && <div className="np-overlay" role="dialog" aria-modal="true" aria-labelledby="np-buy"><div className="np-dialog">
      <span className="np-kicker">{RARITY[buy.rarity]} · {buy.supply} NUMBERED</span>
      <h2 id="np-buy">{buy.name}</h2>
      <Art item={buy} big />
      {<p className="np-prices">{Object.entries(buy.price ?? {}).map(([a, v]) => <span key={a}><b>{Number(v).toLocaleString("en-US")}</b> {ASSET_LABEL[a]}</span>)}</p>}
      <p>{buy.left} of {buy.supply} left. Each copy carries its own number, for good.</p>
      <div className="np-end-actions">
        {["USDC", "ETH", "IMD", "SHIFT"].map((a) => <button key={a} type="button" className="np-btn small" disabled={busy} onClick={() => { setBusy(true); void api.purchase(buy.id, a).then((r) => setMsg(r.message)).catch((e) => setMsg((e as Error).message)).finally(() => { setBusy(false); setBuy(null); }); }}>{`PAY IN ${ASSET_LABEL[a]}`}</button>)}
        <button type="button" className="np-btn ghost small" onClick={() => setBuy(null)}>NOT NOW</button>
      </div>
      <p className="np-note">The vault shop opens soon: nothing is charged today.</p>
    </div></div>}
  </div>;
}
