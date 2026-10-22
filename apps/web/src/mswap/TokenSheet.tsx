import { CHAINS, CHAIN_ORDER, type ChainKey, type Token } from "@nightshift/swap";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { swapApi } from "./api";

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** A token's logo, or its first letter when there is none or it does not load. */
export function TokenLogo({ t }: { t: Pick<Token, "logo" | "symbol"> }) {
  const [bad, setBad] = useState(false);
  return t.logo && !bad ? <img className="ms-logo" src={t.logo} alt="" width={28} height={28} loading="lazy" onError={() => setBad(true)} /> : <span className="ms-logo ms-letter" aria-hidden="true">{t.symbol.slice(0, 1)}</span>;
}

/** Picking a chain and a token: NIGHTSHIFT's tokens first, then the provider's verified list, or a search. */
export function TokenSheet({ side, chain, onPick, onClose }: { side: "from" | "to"; chain: ChainKey; onPick: (t: Token) => void; onClose: () => void }) {
  const [c, setC] = useState<ChainKey>(chain === "xrpl" && side === "from" ? "eth" : chain);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Token[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => {
    let on = true;
    setList(null); setErr(null);
    const t = setTimeout(() => { swapApi.tokens(c, q).then((x) => { if (on) setList(x); }, (e: Error) => { if (on) setErr(e.message); }); }, q ? 250 : 0);
    return () => { on = false; clearTimeout(t); };
  }, [c, q]);
  // on <body>, above the site's header and outside any transformed ancestor
  return createPortal(
    <div className="ms-sheet" role="dialog" aria-modal="true" aria-label={side === "from" ? "Choose what you pay with" : "Choose what you get"} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ms-sheet-in">
        <div className="ms-sheet-h"><b>{side === "from" ? "You pay with" : "You get"}</b><button type="button" className="ms-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="ms-chains" role="tablist" aria-label="Chain">
          {CHAIN_ORDER.map((k) => {
            const soon = side === "from" && k === "xrpl";
            return <button key={k} type="button" role="tab" aria-selected={c === k} className={c === k ? "on" : ""} disabled={soon} title={soon ? "Swapping out of XRP is coming soon" : undefined} onClick={() => { setC(k); setQ(""); }}>{CHAINS[k].name}{soon && <small>soon</small>}</button>;
          })}
        </div>
        {c !== "xrpl" && <input ref={input} className="ms-search" placeholder="Symbol, name or address" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off" />}
        <div className="ms-list">
          {err && <p className="bad">{err}</p>}
          {!err && list === null && <p className="dim">Loading {CHAINS[c].name} tokens…</p>}
          {list?.length === 0 && <p className="dim">No token found on {CHAINS[c].name}. Paste its address to look it up.</p>}
          {list?.map((t) => (
            <button key={`${t.chain}:${t.address}`} type="button" className="ms-tok" onClick={() => onPick(t)}>
              <TokenLogo t={t} />
              <span className="ms-tok-n"><b>{t.symbol}{t.pinned && t.address !== CHAINS[t.chain].native.address && <em className="ms-pin">NIGHTSHIFT</em>}</b><i>{t.name}</i></span>
              <span className="ms-tok-a">{t.address === CHAINS[t.chain].native.address ? "native" : shortAddr(t.address)}{!t.verified && <em className="ms-unv">unverified</em>}</span>
            </button>
          ))}
        </div>
        {list?.some((t) => !t.verified) && <p className="ms-fine">Unverified: not on the provider's verified list. Check the address on the explorer before swapping.</p>}
      </div>
    </div>,
    document.body,
  );
}
