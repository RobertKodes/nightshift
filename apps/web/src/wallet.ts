/**
 * Finds every wallet extension in the browser (EIP-6963), not only the one that took
 * window.ethereum, and lets the person pick: Uniswap Wallet, MetaMask, Rabby, Phantom… The choice
 * is remembered for next time.
 */
type Info = { uuid: string; name: string; icon: string; rdns: string };
type Detail = { info: Info; provider: unknown };

const found = new Map<string, Detail>();
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = (e as CustomEvent<Detail>).detail;
    if (d?.info?.rdns) found.set(d.info.rdns, d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

const KEY = "ns-wallet";
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (rdns: string) => { try { localStorage.setItem(KEY, rdns); } catch { /* private window */ } };

async function discover(): Promise<Detail[]> {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 250));
  const list = [...found.values()];
  const legacy = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!list.length && legacy) list.push({ info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" }, provider: legacy });
  return list;
}

function pick(list: Detail[]): Promise<Detail | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(3,2,10,.72);display:grid;place-items:center;padding:16px;font-family:Inter,system-ui,sans-serif";
    const box = document.createElement("div");
    box.style.cssText = "width:min(360px,100%);background:#0d0a1f;border:1px solid #2c2550;border-radius:16px;padding:18px;color:#f2efff;box-shadow:0 20px 60px rgba(0,0,0,.6)";
    box.innerHTML = `<div style="font:600 12px 'JetBrains Mono',monospace;letter-spacing:.2em;color:#a9a3c4;margin-bottom:12px">CHOOSE A WALLET</div>`;
    const done = (d: Detail | null) => { wrap.remove(); resolve(d); };
    for (const d of list) {
      const b = document.createElement("button");
      b.style.cssText = "display:flex;align-items:center;gap:12px;width:100%;padding:12px;margin:6px 0;background:#15112b;border:1px solid #2c2550;border-radius:12px;color:#f2efff;font:500 15px Inter,system-ui,sans-serif;cursor:pointer;text-align:left";
      b.onmouseenter = () => { b.style.borderColor = "#7c5cff"; };
      b.onmouseleave = () => { b.style.borderColor = "#2c2550"; };
      if (d.info.icon) { const i = document.createElement("img"); i.src = d.info.icon; i.alt = ""; i.style.cssText = "width:28px;height:28px;border-radius:8px"; b.append(i); }
      b.append(document.createTextNode(d.info.name));
      b.onclick = () => done(d);
      box.append(b);
    }
    const c = document.createElement("button");
    c.textContent = "Cancel";
    c.style.cssText = "margin-top:8px;background:none;border:0;color:#a9a3c4;cursor:pointer;font:500 13px Inter,system-ui,sans-serif";
    c.onclick = () => done(null);
    box.append(c);
    wrap.onclick = (e) => { if (e.target === wrap) done(null); };
    wrap.append(box);
    document.body.append(wrap);
  });
}

/** The wallet to use: the only one, the remembered one, or the person's pick. */
export async function chooseWallet(opts: { ask?: boolean } = {}): Promise<unknown> {
  const list = await discover();
  if (!list.length) throw new Error("No wallet in this browser. Install the Uniswap Wallet, MetaMask or Rabby extension.");
  if (list.length === 1) return list[0]!.provider;
  const saved = list.find((d) => d.info.rdns === remembered());
  if (saved && !opts.ask) return saved.provider;
  const d = await pick(list);
  if (!d) throw new Error("No wallet chosen.");
  remember(d.info.rdns);
  return d.provider;
}

/** Forget the remembered wallet so the next action asks again. */
export const forgetWallet = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };
