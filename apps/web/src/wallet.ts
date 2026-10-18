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

const WC_ICON = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3b99fc"/><path d="M9.6 12.4c3.5-3.4 9.3-3.4 12.8 0l.4.4a.4.4 0 0 1 0 .6l-1.5 1.4a.2.2 0 0 1-.3 0l-.6-.6a6.3 6.3 0 0 0-8.8 0l-.6.6a.2.2 0 0 1-.3 0l-1.5-1.4a.4.4 0 0 1 0-.6l.4-.4Zm15.8 2.9 1.3 1.3a.4.4 0 0 1 0 .6l-6 5.8a.5.5 0 0 1-.6 0L16 18.9a.1.1 0 0 0-.2 0l-4.2 4.1a.5.5 0 0 1-.6 0l-6-5.8a.4.4 0 0 1 0-.6l1.3-1.3a.5.5 0 0 1 .6 0l4.2 4.1c.1.1.2.1.2 0l4.2-4.1a.5.5 0 0 1 .6 0l4.2 4.1c.1.1.2.1.2 0l4.2-4.1a.5.5 0 0 1 .6 0Z" fill="#fff"/></svg>');
let wcId: Promise<string | null> | null = null;
const walletConnectId = () => (wcId ??= fetch("/api/wallet-config").then((r) => r.json()).then((d) => (d.walletConnect as string) || null).catch(() => null));
let wcProvider: unknown = null;
/** WalletConnect: a wallet app on the phone (QR code on a computer), loaded only when chosen. */
async function walletConnect(projectId: string): Promise<unknown> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const p = await EthereumProvider.init({
    projectId, chains: [1], optionalChains: [8453], showQrModal: true,
    metadata: { name: "NIGHTSHIFT", description: "Autonomous AI companies and Space Pinball", url: location.origin, icons: [`${location.origin}/brand/shift-icon-512.png`] },
  });
  await p.connect();
  wcProvider = p;
  return p;
}

async function discover(): Promise<Detail[]> {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const [, id] = await Promise.all([new Promise((r) => setTimeout(r, 250)), walletConnectId()]);
  const list = [...found.values()];
  const legacy = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!list.length && legacy) list.push({ info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" }, provider: legacy });
  if (id) list.push({ info: { uuid: "walletconnect", name: "WalletConnect · phone wallet", icon: WC_ICON, rdns: "walletconnect" }, provider: id });
  return list;
}
/** A picked entry's provider; WalletConnect's is made on first use. */
const open = (d: Detail): Promise<unknown> => (d.info.rdns === "walletconnect" ? walletConnect(d.provider as string) : Promise.resolve(d.provider));

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
  if (!list.length) {
    // A phone browser has no wallet inside it: open this page in a wallet app's own browser instead.
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) { openInWalletApp(); throw new Error("Open NIGHTSHIFT in your wallet app to sign in."); }
    throw new Error("No wallet in this browser. Install the Uniswap Wallet, MetaMask or Rabby extension.");
  }
  if (list.length === 1) return open(list[0]!);
  const saved = list.find((d) => d.info.rdns === remembered());
  if (saved && !opts.ask) return open(saved);
  const d = await pick(list);
  if (!d) throw new Error("No wallet chosen.");
  remember(d.info.rdns);
  return open(d);
}

/** The wallet apps that can open a page in their own browser, by their official links. */
const APPS: { name: string; href: (url: string) => string }[] = [
  { name: "MetaMask", href: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { name: "Trust Wallet", href: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}` },
  { name: "Coinbase Wallet", href: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
];

/** A sheet with one button per wallet app; the page reopens there, signed-in flows work as on a computer. */
function openInWalletApp(): void {
  const url = location.href;
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(3,2,10,.72);display:grid;place-items:end center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom,0px));font-family:Inter,system-ui,sans-serif";
  const box = document.createElement("div");
  box.style.cssText = "width:min(420px,100%);background:#0d0a1f;border:1px solid #2c2550;border-radius:16px;padding:18px;color:#f2efff;box-shadow:0 20px 60px rgba(0,0,0,.6)";
  box.innerHTML = `<div style="font:600 12px 'JetBrains Mono',monospace;letter-spacing:.2em;color:#a9a3c4;margin-bottom:6px">OPEN IN YOUR WALLET</div><p style="margin:0 0 12px;color:#a9a3c4;font-size:13px;line-height:1.5">Your phone's browser has no wallet. Open this page in your wallet app: you sign in there and nothing leaves your phone.</p>`;
  for (const a of APPS) {
    const l = document.createElement("a");
    l.href = a.href(url);
    l.rel = "noopener";
    l.textContent = `Open in ${a.name}`;
    l.style.cssText = "display:block;padding:13px 12px;margin:6px 0;background:#15112b;border:1px solid #2c2550;border-radius:12px;color:#f2efff;font:500 15px Inter,system-ui,sans-serif;text-decoration:none";
    box.append(l);
  }
  const c = document.createElement("button");
  c.textContent = "Cancel";
  c.style.cssText = "margin-top:8px;background:none;border:0;color:#a9a3c4;cursor:pointer;font:500 13px Inter,system-ui,sans-serif";
  c.onclick = () => wrap.remove();
  box.append(c);
  wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
  wrap.append(box);
  document.body.append(wrap);
}

/** Forget the remembered wallet so the next action asks again. */
export const forgetWallet = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };
