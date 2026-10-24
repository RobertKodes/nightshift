import { useState } from "react";
import { CLASSES, ITEMS, type ItemDef, SLOTS, type Slot } from "@nightshift/lastspawn";
import type { Game, Hud } from "./game";
import { ItemIcon } from "./icons";

const SLOT_NAME: Record<Slot, string> = { main: "Weapon", off: "Off hand", head: "Head", shoulders: "Shoulders", chest: "Chest", hands: "Hands", waist: "Waist", feet: "Feet" };
/** The icon an item shows: what it is held as, the slot it is worn on, or its kind. */
const iconOf = (d: ItemDef | undefined) => (d?.model && ["glaive", "blowgun", "shield", "lantern"].includes(d.model) ? d.model : d?.slot ?? d?.kind ?? "junk");

type Pick = { id: string; worn: Slot | null };

/** The bag: what you wear on the left, what you carry on the right, the one you picked below. */
export function Bag({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const d = pick ? ITEMS[pick.id] : undefined;
  const can = d?.kind === "gear" && d.slot && (!d.cls || d.cls.includes(hud.cls)) && (d.level ?? 1) <= hud.level;
  return <div className="ls-bag" role="dialog" aria-label="Bag">
    <div className="ls-bag-head">
      <b>{hud.name}</b><span>{CLASSES[hud.cls].name} · level {hud.level} · armour {hud.armor} · power {hud.power}</span>
      <button type="button" className="ls-x" aria-label="Close" onClick={onClose}>×</button>
    </div>
    <div className="ls-bag-body">
      <div className="ls-worn">{SLOTS.map((s) => {
        const id = hud.equip[s], it = id ? ITEMS[id] : undefined;
        return <button key={s} type="button" className={`ls-slot${id ? " full" : ""}${pick?.worn === s ? " on" : ""}`} onClick={() => setPick(id ? { id, worn: s } : null)}>
          <ItemIcon kind={id ? iconOf(it) : s} size={24} /><span><small>{SLOT_NAME[s]}</small>{it?.name ?? "—"}</span>
        </button>;
      })}</div>
      <div className="ls-carried">
        {hud.bag.length === 0 && <p className="ls-empty">Nothing in the bag yet. The leeches by the pump carry more than teeth.</p>}
        {hud.bag.map((b) => {
          const it = ITEMS[b.id];
          return <button key={b.id} type="button" className={`ls-item ${it?.kind ?? ""}${pick?.id === b.id && !pick.worn ? " on" : ""}`} title={it?.name} onClick={() => setPick({ id: b.id, worn: null })}>
            <ItemIcon kind={iconOf(it)} />{b.n > 1 && <i>{b.n}</i>}
          </button>;
        })}
      </div>
    </div>
    {d && pick && <div className="ls-pick">
      <div><b>{d.name}</b><small>{d.slot ? SLOT_NAME[d.slot] : d.kind === "consumable" ? "Use" : d.kind === "quest" ? "Quest item" : "Keepsake"}{d.armor ? ` · armour ${d.armor}` : ""}{d.power ? ` · power ${d.power}` : ""}{d.heal ? ` · mends ${d.heal}` : ""}{d.cls ? ` · ${d.cls.map((c) => CLASSES[c].name).join(", ")}` : ""}</small></div>
      <p>{d.desc}</p>
      <div className="ls-pick-act">
        {pick.worn && <button type="button" className="ls-btn ghost" onClick={() => { game.unequip(pick.worn!); setPick(null); }}>Take off</button>}
        {!pick.worn && d.kind === "gear" && <button type="button" className="ls-btn" disabled={!can} onClick={() => { game.equipItem(pick.id); setPick(null); }}>{can ? "Wear" : d.cls && !d.cls.includes(hud.cls) ? `For ${d.cls.map((c) => CLASSES[c].name).join(", ")}` : `Level ${d.level}`}</button>}
        {!pick.worn && d.kind === "consumable" && <button type="button" className="ls-btn" disabled={hud.dead} onClick={() => game.useItem(pick.id)}>Eat it</button>}
      </div>
    </div>}
  </div>;
}
