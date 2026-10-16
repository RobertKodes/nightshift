import { useEffect, useState } from "react";
import { type Hex, createWalletClient, custom } from "viem";
import { type Health, type PublicCompany, api, events, short, usd } from "./api";

interface Requirement { network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}`; maxTimeoutSeconds: number; extra: { name: string; version: string } }

/** Pays an x402 link from the visitor's own wallet: sign a USDC authorization, send it, get the product. */
async function buyWithWallet(buyUrl: string): Promise<{ deliverable: string | null; tx: string }> {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth) throw new Error("No wallet found. Install MetaMask or Rabby.");
  const challenge = await fetch(buyUrl);
  if (challenge.status !== 402) throw new Error(((await challenge.json().catch(() => ({}))) as { error?: string }).error ?? `unexpected ${challenge.status}`);
  const ch = (await challenge.json()) as { accepts: Requirement[] };
  const req = ch.accepts[0]!;
  const chainId = Number(req.network.split(":")[1]);
  const wallet = createWalletClient({ transport: custom(eth as never) });
  const [from] = await wallet.requestAddresses();
  if (!from) throw new Error("No account");
  await wallet.switchChain({ id: chainId }).catch(() => { throw new Error(`Switch your wallet to chain ${chainId}.`); });
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from, to: req.payTo, value: req.amount, validAfter: String(now - 5), validBefore: String(now + req.maxTimeoutSeconds),
    nonce: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex,
  };
  const signature = await wallet.signTypedData({
    account: from,
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const payment = { x402Version: 2, accepted: req, payload: { signature, authorization } };
  const res = await fetch(buyUrl, { headers: { "PAYMENT-SIGNATURE": btoa(JSON.stringify(payment)) } });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "payment refused");
  return j;
}

export function PublicPage({ slug, health }: { slug: string; health: Health | null }) {
  const [c, setC] = useState<PublicCompany | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [got, setGot] = useState<{ name: string; url: string } | null>(null);
  useEffect(() => {
    const load = () => api.publicCompany(slug).then(setC).catch((e) => setErr((e as Error).message));
    load();
    const off = events(() => load());
    return off;
  }, [slug]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  async function buy(p: PublicCompany["products"][number]) {
    try {
      if (health?.mode === "sim") {
        const r = await fetch(`${p.buyUrl.replace(/^https?:\/\/[^/]+/, "")}?sim=1`, { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "purchase failed");
        say("Demo purchase recorded. In live mode your wallet pays in USDC.");
        if (j.deliverable) { setGot({ name: p.name, url: j.deliverable }); window.open(j.deliverable, "_blank"); }
        return;
      }
      const r = await buyWithWallet(p.buyUrl);
      say(`Paid · ${short(r.tx)}`);
      if (r.deliverable) { setGot({ name: p.name, url: r.deliverable }); window.open(r.deliverable, "_blank"); }
    } catch (e) {
      say((e as Error).message);
    }
  }

  if (err) return <div className="card empty">{err}</div>;
  if (!c) return <div className="card empty">Loading…</div>;
  return (
    <div className="pub">
      <span className="pill">An autonomous company on NIGHTSHIFT · shift {c.cycle}</span>
      <h1>{c.name}</h1>
      <p className="lead">{c.mission}</p>
      <div className="grid kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="card kpi"><span>Revenue</span><b className="good">{usd(c.pnl.revenueUsd)}</b></div>
        <div className="card kpi"><span>Spent on the swarm</span><b>{usd(c.pnl.spentUsd)}</b></div>
        <div className="card kpi"><span>Sales</span><b>{c.pnl.sales}</b></div>
      </div>
      <div className="grid products">
        {c.products.length === 0 ? <div className="card empty">The first product ships tonight.</div> : c.products.map((p) => (
          <div key={p.id} id={p.id} className="card product">
            <span className="pill">{p.kind}</span>
            <h4>{p.name}</h4>
            <p>{p.pitch}</p>
            <div className="buy-row">
              <span className="price">{usd(p.priceUsd)}</span>
              <button className="btn primary" onClick={() => buy(p)}>{health?.mode === "sim" ? "Buy (demo)" : "Buy with USDC"}</button>
            </div>
            <span className="faint mono buy-agents">agents: GET {p.buyUrl.replace(/^https?:\/\//, "")} → x402</span>
          </div>
        ))}
      </div>
      {got && <div className="card card-b got"><b>Your download: {got.name}</b><a className="btn primary" href={got.url}>Download</a><span className="faint">The link works for 7 days. Save the file.</span></div>}
      <div className="card">
        <div className="card-h"><h3>What it did, shift by shift</h3><span className="faint mono" style={{ fontSize: 11 }}>wallet {short(c.wallet)}</span></div>
        <table><tbody>{c.shifts.filter((s) => s.status !== "failed" && s.status !== "rejected").map((s, i) => <tr key={i}><td className="mono faint">{s.cycle}</td><td>{s.title}</td><td><span className={`pill ${s.status}`}>{s.status.replace(/_/g, " ")}</span></td></tr>)}</tbody></table>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
