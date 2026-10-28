import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, formatEther, formatUnits, getAddress, isAddress, parseAbi, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { type Step, canBatch, sendSteps } from "../batch";
import { ethTransport } from "../ethRpc";
import { useSession } from "../session";
import { chooseWallet } from "../wallet";
import { NxIcon } from "../nx/icons";
import { Stat } from "../station/Station";
import { SectionIcon } from "./SectionIcon";
import "../forge.css";
import "./deals.css";

const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
/** TokenDeals, as fixed in the order IMD checked (engine src/order-deals.ts). */
const DESK = parseAbi([
  "function open(address token, uint256 amount, address payCoin, uint256 price, uint256 minBuy, uint64 expiry, address buyer) returns (uint256 dealId)",
  "function buy(uint256 dealId, uint256 amount, address recipient, uint256 maxTotal, uint64 passExpiry, bytes pass) payable",
  "function update(uint256 dealId, uint256 price, uint256 minBuy, uint64 expiry)",
  "function cancel(uint256 dealId)",
  "function claimOwed()",
  "function quote(uint256 dealId, uint256 amount, bool holder) view returns (uint256 cost, uint256 fee, uint256 total)",
  "function owed(address account) view returns (uint256)",
]);
const ETH = "0x0000000000000000000000000000000000000000";
type Coin = { symbol: string; address: Address; decimals: number };
type Verdict = { verdict: "no_issues_found" | "caution" | "avoid"; summary: string } | null;
type Deal = {
  id: number; seller: string; status: "open" | "expired" | "sold" | "cancelled" | "closed"; buyer: string | null;
  token: { address: string; name: string | null; symbol: string | null; decimals: number | null; image: string | null; chart: string | null };
  coin: Coin; held: string; left: string; price: string; minBuy: string; expiry: number;
  each: number | null; usdEach: number | null; marketUsd: number | null; vsMarketPct: number | null; liquidityUsd: number | null; volume24hUsd: number | null;
  verdict: Verdict; sellerTrades: number; partner: boolean; copycat: boolean;
};
type Desk = { open: boolean; address: Address | null; feeBps: number; holderFeeBps: number; maxFeeBps: number; coins: Coin[]; holderRule: string; deals: Deal[] };
type Buy = { payer: string; recipient: string; amount: string; cost: string; fee: string; holder: boolean; tx: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 180);
const amountOf = (v: string, decimals: number) => Number(formatUnits(BigInt(v), decimals));
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : n < 1000 ? 2 : 0 });
const small = (n: number) => n === 0 ? "0" : n < 0.0001 ? String(Number(n.toPrecision(3))) : num(n);
const usd = (n: number | null) => n === null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n >= 1 ? `$${n.toFixed(2)}` : `$${small(n)}`;
const left = (expiry: number) => { const s = expiry - Date.now() / 1000; if (s <= 0) return "Ended"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`; };
const VERDICT: Record<string, [string, string]> = { no_issues_found: ["No issues found", "good"], caution: ["Caution", "warn"], avoid: ["Avoid", "bad"] };
const sym = (d: Deal) => d.token.symbol ?? "tokens";
const isDesk = (v: unknown): v is Desk => typeof v === "object" && v !== null && Array.isArray((v as Desk).deals) && Array.isArray((v as Desk).coins);

/** Asks the wallet for Ethereum and the account, as every money page does. */
async function wallet() {
  const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet({ chain: 1 })) as never) });
  const [a] = await w.requestAddresses();
  if (!a) throw new Error("No account in the wallet.");
  await w.switchChain({ id: 1 });
  return { w, a };
}
/** Enough ETH for the network fee (and the ETH being paid), checked before the wallet opens. */
async function gasCheck(a: Address, gas: bigint, paying = 0n) {
  const [balance, price] = await Promise.all([rpc.getBalance({ address: a }), rpc.getGasPrice()]).catch(() => [null, null] as const);
  if (balance === null || price === null) return;
  const need = (gas * price * 3n) / 2n + paying, eth = (v: bigint) => Number(formatEther(v)).toPrecision(2);
  if (balance < need) throw new Error(`This wallet has ${eth(balance)} ETH and needs about ${eth(need)} ETH on Ethereum${paying ? " for the price and the network fee" : " for the network fee"}. Add ETH, then try again.`);
}

/** Token Deals: tokens sold at a fixed price from an escrow contract, all or part, with the fee paid by the buyer. */
export function DealsPage() {
  const [desk, setDesk] = useState<Desk | null>(null), [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<"open" | "all">("open"), [coin, setCoin] = useState("all"), [partners, setPartners] = useState(false), [hideAvoid, setHideAvoid] = useState(true), [sort, setSort] = useState<"new" | "discount" | "size">("new");
  const [buying, setBuying] = useState<Deal | null>(null);
  const session = useSession(), [me, setMe] = useState<string | null>(session.address ?? null);
  const load = useCallback(async () => {
    try { const r = await fetch("/api/deals"), d: unknown = await r.json(); if (!r.ok || !isDesk(d)) throw new Error(); setDesk(d); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    document.title = "Token Deals · NIGHTSHIFT";
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (session.address) setMe(session.address); }, [session.address]);

  const shown = useMemo(() => {
    const all = (desk?.deals ?? []).filter((d) => (status === "all" || d.status === "open") && (coin === "all" || d.coin.symbol === coin) && (!partners || d.partner) && (!hideAvoid || d.verdict?.verdict !== "avoid"));
    const value = (d: Deal) => d.usdEach !== null && d.token.decimals !== null ? d.usdEach * amountOf(d.left, d.token.decimals) : 0;
    return sort === "discount" ? [...all].sort((a, b) => (a.vsMarketPct ?? 999) - (b.vsMarketPct ?? 999)) : sort === "size" ? [...all].sort((a, b) => value(b) - value(a)) : all;
  }, [desk, status, coin, partners, hideAvoid, sort]);
  const mine = (desk?.deals ?? []).filter((d) => me && d.seller.toLowerCase() === me.toLowerCase());
  const open = desk?.open ?? false, fee = (desk?.feeBps ?? 100) / 100, holderFee = (desk?.holderFeeBps ?? 50) / 100;

  const [selling, setSelling] = useState(false), [ex, setEx] = useState(0);
  const sell = () => { setSelling(true); window.setTimeout(() => document.getElementById("pv-dl-sell")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const cap = (desk?.maxFeeBps ?? 200) / 100, openCount = (desk?.deals ?? []).filter((d) => d.status === "open").length;

  return <div className="st-room fg dl">
    <header className="fg-hero" style={{ "--tc": EXAMPLES[ex]!.tone } as CSSProperties}>
      <div className="fg-hero-in">
        <span className="fg-eyebrow"><NxIcon name="market" size={16} /> $SHIFT · TOKEN DEALS · {open ? "LIVE ON ETHEREUM" : "OPENING SOON"}</span>
        <h1>Token Deals. <em>Below market, from holders.</em></h1>
        <p className="fg-lead">Holders sell tokens at a fixed price from an escrow contract on Ethereum. Buy all of a deal or part of it: in one transaction the tokens reach your wallet and the seller is paid. No slippage, nothing dumped on the chart, and nobody in the middle holding your money.</p>
        <div className="fg-cta">
          {open ? <a className="nx-btn nx-btn-acc" href="#deals"><NxIcon name="market" size={18} /> See the deals</a>
            : <a className="nx-btn nx-btn-acc" href={TELEGRAM} target="_blank" rel="noreferrer"><NxIcon name="pulse" size={18} /> Get the launch alert</a>}
          {open ? <button type="button" className="nx-btn" onClick={sell}>Sell tokens</button> : <a className="nx-btn" href="/partners">List your token</a>}
          <a className="nx-btn" href="#how">How it works</a>
        </div>
        <div className="st-stats">
          <Stat label="Buyer fee" value={`${fee}%`} note="on top; the seller gets the full price" />
          <Stat label="Holders pay" value={`${holderFee}%`} note="500k $SHIFT, a frog or a Watcher" />
          <Stat label="Fee cap" value={`${cap}%`} note="written into the contract" />
          <Stat label="Desk" value={open ? String(openCount) : "SOON"} note={open ? "open deals on Ethereum" : "escrow contract in the build queue"} />
        </div>
      </div>
      <div className="fg-show">
        <DealTicket x={EXAMPLES[ex]!} />
        <div className="fg-pills dl-pills" role="group" aria-label="Example deals">{EXAMPLES.map((x, i) => <button key={x.sym} type="button" className={i === ex ? "on" : ""} aria-pressed={i === ex} onClick={() => setEx(i)}><b>{x.pill}</b><span>{x.pillLine}</span></button>)}</div>
      </div>
    </header>

    <div className="st-body">
      {open ? <>
        <section className="fg-sec" id="deals">
          <div className="pv-dl-board-head">
            <div className="fg-head"><span className="fg-kicker">On the desk</span><h2>Open deals</h2></div>
            <div className="pv-dl-filters">
              <div className="pv-dl-seg" role="group" aria-label="Status">{(["open", "all"] as const).map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === "open" ? "Open" : "All"}</button>)}</div>
              <label><span className="pv-sr">Paid in</span><select value={coin} onChange={(e) => setCoin(e.target.value)}><option value="all">Any coin</option>{desk!.coins.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}</select></label>
              <label><span className="pv-sr">Sort</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="new">Newest</option><option value="discount">Best price vs market</option><option value="size">Largest</option></select></label>
              <label className="pv-dl-check"><input type="checkbox" checked={partners} onChange={(e) => setPartners(e.target.checked)} />Partners only</label>
              <label className="pv-dl-check"><input type="checkbox" checked={hideAvoid} onChange={(e) => setHideAvoid(e.target.checked)} />Hide "Avoid"</label>
            </div>
          </div>
          {!shown.length ? <p className="st-empty">No open deals match. <button type="button" className="pv-dl-link" onClick={sell}>Be the first to sell.</button></p>
            : <div className="pv-dl-grid">{shown.map((d) => <DealCard key={d.id} d={d} onBuy={() => setBuying(d)} />)}</div>}
        </section>
        {selling && <SellForm desk={desk} onDone={() => void load()} setMe={setMe} />}
        {me && <MyDeals desk={desk!} me={me} deals={mine} onDone={() => void load()} />}
      </> : <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">Road to launch</span><h2>What happens before the first deal</h2></div>
        <ol className="fg-steps dl-track">{TRACK.map(([title, line, state]) => <li key={title} data-state={state}><b>{title}</b><span>{line}</span></li>)}</ol>
        {failed && !desk && <p className="fg-dim">The live status could not be loaded right now.</p>}
      </section>}

      <section className="fg-sec" id="how">
        <div className="fg-head"><span className="fg-kicker">How a deal works</span><h2>One transaction. Nothing left to trust.</h2></div>
        <ol className="fg-steps">
          <li><b>A holder lists</b><span>They lock their tokens in the escrow contract and set the price, the minimum buy and how long the deal stays open.</span></li>
          <li><b>You pick a card</b><span>Each card shows the price against the market, the Token Verdict, liquidity and the seller's record. Buy all of it or a part.</span></li>
          <li><b>It settles at once</b><span>The tokens go to your wallet, the seller gets the full price and the fee goes to the ecosystem. All of it happens, or none of it.</span></li>
        </ol>
      </section>

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">Why buy here</span><h2>Checked before you buy</h2></div>
        <div className="fg-perks">{PERKS.map(([icon, title, text]) => <article key={title} className="fg-perk"><NxIcon name={icon} size={22} /><b>{title}</b><p>{text.replace("{fee}", String(fee)).replace("{holder}", String(holderFee)).replace("{cap}", String(cap))}</p></article>)}</div>
      </section>

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">Where the fee goes</span><h2>Every deal pays the ecosystem</h2></div>
        <div className="pv-dl-split" role="img" aria-label="40% to stakers and NIGHT FROGS holders, 20% burned, 20% treasury, 20% team">
          <span style={{ flex: 40 }} data-tone="stake"><b>40%</b>$SHIFT stakers and NIGHT FROGS</span>
          <span style={{ flex: 20 }} data-tone="burn"><b>20%</b>Burned</span>
          <span style={{ flex: 20 }}><b>20%</b>Treasury</span>
          <span style={{ flex: 20 }}><b>20%</b>Team</span>
        </div>
        <p className="fg-dim">Each fee goes to the FeeSplitter, the same contract behind every NIGHTSHIFT fee. Its split can never change.</p>
      </section>

      <section className="fg-sec">
        <div className="pv-dl-projects">
          <div className="fg-head"><span className="fg-kicker">For projects</span><h2>Bring your token to the desk</h2><p className="fg-dim">Partners carry a badge on every deal, get announced to our community and a place in our tools. Joining is free.</p></div>
          <a className="nx-btn nx-btn-acc" href="/partners"><NxIcon name="crew" size={18} /> Become a partner</a>
        </div>
      </section>

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">Questions</span><h2>The fine print</h2></div>
        <div className="fg-faq">
          <details open><summary>Who sets the price?</summary><p>The seller. Each card shows that price next to the token's market price, so you can see whether it is a discount. A deal priced above the market says so in amber.</p></details>
          <details><summary>Can I buy part of a deal?</summary><p>Yes, from the seller's minimum up to everything that is left. The rest of a deal can always be bought, even below the minimum.</p></details>
          <details><summary>Who counts as a holder?</summary><p>{desk?.holderRule ?? "A wallet with 500,000+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher."} The page checks the wallet that receives the tokens and applies the lower fee by itself.</p></details>
          <details><summary>What if the token has a transfer tax?</summary><p>The contract counts what actually arrives, so the deal holds the right amount. When you buy, the token's own tax still applies to what reaches your wallet, as with any transfer.</p></details>
          <details><summary>Is this financial advice?</summary><p>No. Anyone can sell any token here. The checks on each card help, but they cannot rule out every risk. Only buy what you understand.</p></details>
        </div>
      </section>
    </div>

    {buying && desk && <BuyDialog desk={desk} d={buying} onClose={() => setBuying(null)} onDone={() => void load()} setMe={setMe} />}
  </div>;
}

type Example = { id: string; sym: string; name: string; price: string; usd: string; vs: string; left: string; min: string; ends: string; verdict: string; sold: number; tone: string; pill: string; pillLine: string; partner?: boolean };
/** The hero's sample tickets, each marked as an example: what a deal looks like before the desk opens. */
const EXAMPLES: Example[] = [
  { id: "0412", sym: "SHIFT", name: "NIGHTSHIFT", price: "0.00005 USDC", usd: "$0.00005 each", vs: "21% below market", left: "620,000", min: "10,000", ends: "3d 4h", verdict: "No issues", sold: 38, tone: "#ad9bd2", pill: "$SHIFT", pillLine: "paid in USDC" },
  { id: "0413", sym: "IMD", name: "Identity.md", price: "0.0019 ETH", usd: "$4.50 each", vs: "1.3% below market", left: "500", min: "Any", ends: "6d 12h", verdict: "No issues", sold: 0, tone: "#7fd6a6", pill: "$IMD", pillLine: "paid in ETH" },
  { id: "0414", sym: "YOU", name: "Your token", price: "You set it", usd: "ETH, USDC, USDT, IMD or $SHIFT", vs: "Shown live vs market", left: "Your amount", min: "You choose", ends: "1 to 365 days", verdict: "Checked", sold: 0, tone: "#d9ad66", pill: "Yours", pillLine: "partner badge", partner: true },
];
const TELEGRAM = "https://t.me/getnightshift";
const TRACK: [string, string, "done" | "next" | "later"][] = [
  ["Contract designed", "The escrow rules are written and passed IMD's check with no blockers.", "done"],
  ["Built and audited", "The IMD swarm builds and tests it; four specialist auditors and a judge review it.", "next"],
  ["Live on Ethereum", "Deployed, verified on Etherscan and switched on here.", "later"],
  ["First deals", "Partner projects and holders list the first cards.", "later"],
];
const PERKS: [Parameters<typeof NxIcon>[0]["name"], string, string][] = [
  ["money", "Below-market prices", "Big holders sell at a fixed price to move size without crashing the chart. Each card tells you how far below, or above, the market it is."],
  ["security", "Escrow, not trust", "The contract holds the tokens until you buy. Nobody, us included, can move them. A seller can only cancel and take back what is left."],
  ["sniper", "Token Verdict on every card", "Every token is checked before you see it: who controls it, whether it can be sold, its liquidity. Tokens rated Avoid stay hidden unless you ask."],
  ["crew", "Copycats flagged", "A token that borrows a partner's ticker from another contract is marked on its card, so a fake never looks like the real one."],
  ["stake", "Holders pay half", "The buyer pays {fee}% on top of the price. Holders of 500k $SHIFT, a NIGHT FROG or a Night Watcher pay {holder}%. Capped at {cap}% forever."],
  ["swap", "Buy all or a part", "Take the whole deal or any amount from the seller's minimum. Pay in the coin the seller chose: ETH, USDC, USDT, IMD or $SHIFT."],
];

/** The hero card: one deal as an escrow ticket, in the style of the Forge's Night Watcher card. */
function DealTicket({ x }: { x: Example }) {
  return <div className="dl-ticket" aria-label={`Example deal: ${x.name}`}>
    <div className="dl-ticket-in">
      <header><span>TOKEN DEALS / ESCROW</span><span>DEAL #{x.id}</span></header>
      <div className="dl-ticket-token"><i>{x.sym[0]}</i><div><b>{x.name}</b><span>${x.sym} · Ethereum</span></div>{x.partner && <em>PARTNER</em>}</div>
      <div className="dl-ticket-price"><span>Price per token</span><b>{x.price}</b><small>{x.usd}</small></div>
      <p className="dl-ticket-vs">{x.vs}</p>
      <dl><div><dt>Left</dt><dd>{x.left}</dd></div><div><dt>Min buy</dt><dd>{x.min}</dd></div><div><dt>Ends in</dt><dd>{x.ends}</dd></div><div><dt>Verdict</dt><dd>{x.verdict}</dd></div></dl>
      <div className="dl-ticket-bar"><i style={{ width: `${Math.max(x.sold, 2)}%` }} /></div>
      <footer><span>ESCROW LOCKED</span><span>EXAMPLE</span></footer>
    </div>
  </div>;
}

function DealCard({ d, onBuy }: { d: Deal; onBuy: () => void }) {
  const dec = d.token.decimals ?? 18, held = amountOf(d.held, dec), rest = amountOf(d.left, dec), sold = held ? Math.min(100, Math.round((1 - rest / held) * 100)) : 0;
  const [label, tone] = d.verdict ? VERDICT[d.verdict.verdict]! : ["Checking…", "wait"];
  const vs = d.vsMarketPct;
  return <article className="pv-dl-card" data-status={d.status}>
    <header>
      {d.token.image ? <img src={d.token.image} alt="" width="40" height="40" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden="true">{(d.token.symbol ?? "?").slice(0, 1)}</i>}
      <div><b>{d.token.name ?? short(d.token.address)}</b><span>${sym(d)} · Ethereum</span></div>
      <em className="pv-dl-badge" data-tone={tone} title={d.verdict?.summary}>{label}</em>
    </header>
    <div className="pv-dl-tags">{d.partner && <span data-tone="partner">PARTNER</span>}{d.copycat && <span data-tone="bad">Same ticker as a partner, different contract</span>}{d.buyer && <span>Private deal</span>}{d.status !== "open" && <span>{d.status === "expired" ? "Ended" : d.status === "sold" ? "Sold out" : d.status === "cancelled" ? "Cancelled" : "Closed"}</span>}</div>
    <dl>
      <div><dt>Price</dt><dd>{d.each !== null ? `${small(d.each)} ${d.coin.symbol}` : "—"}<small>{usd(d.usdEach)} each</small></dd></div>
      <div><dt>Market</dt><dd>{usd(d.marketUsd)}{vs !== null && <small data-tone={vs <= 0 ? "good" : "warn"}>{vs <= 0 ? `${Math.abs(vs)}% below market` : `${vs}% above market`}</small>}</dd></div>
      <div><dt>Left</dt><dd>{num(rest)}<small>of {num(held)} · {usd(d.usdEach !== null ? d.usdEach * rest : null)}</small></dd></div>
      <div><dt>Min buy</dt><dd>{d.minBuy === "0" ? "Any" : num(amountOf(d.minBuy, dec))}<small>{left(d.expiry)}</small></dd></div>
    </dl>
    <div className="pv-dl-bar" role="img" aria-label={`${sold}% sold`}><span style={{ width: `${sold}%` }} /></div>
    <p className="pv-dl-meta">Liquidity {usd(d.liquidityUsd)} · 24h volume {usd(d.volume24hUsd)} · Seller {short(d.seller)}, {d.sellerTrades} {d.sellerTrades === 1 ? "trade" : "trades"}</p>
    <footer>
      <nav><a href={`https://etherscan.io/token/${d.token.address}`} target="_blank" rel="noreferrer">Contract</a>{d.token.chart && <a href={d.token.chart} target="_blank" rel="noreferrer">Chart</a>}</nav>
      <button type="button" className="pv-button pv-primary" disabled={d.status !== "open"} onClick={onBuy}>Buy<SectionIcon id="arrow" /></button>
    </footer>
  </article>;
}

function BuyDialog({ desk, d, onClose, onDone, setMe }: { desk: Desk; d: Deal; onClose: () => void; onDone: () => void; setMe: (a: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dec = d.token.decimals ?? 18, rest = amountOf(d.left, dec), min = amountOf(d.minBuy, dec);
  const [amount, setAmount] = useState(String(rest)), [step, setStep] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null), [buys, setBuys] = useState<Buy[]>([]);
  useEffect(() => { dialog.current?.showModal(); void fetch(`/api/deals/${d.id}`).then((r) => r.json()).then((x: { buys?: Buy[] }) => setBuys(x.buys ?? [])).catch(() => {}); }, [d.id]);
  const n = Number(amount), cost = d.each !== null && n > 0 ? n * d.each : null;
  const bad = !(n > 0) ? "Enter an amount." : n > rest ? `Only ${num(rest)} ${sym(d)} are left.` : n < min && n !== rest ? `The minimum is ${num(min)} ${sym(d)}.` : "";

  async function buy() {
    setMsg(null);
    try {
      if (!desk.address) throw new Error("Token Deals is not open yet.");
      const raw = n === rest ? BigInt(d.left) : parseUnits(amount, dec);
      const { w, a } = await wallet(); setMe(a);
      setStep("Checking the holder fee…");
      const pass = await fetch("/api/deals/pass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient: a }) }).then((r) => r.json()).catch(() => ({ holder: false })) as { holder: boolean; expiry?: number; signature?: `0x${string}` };
      const holder = pass.holder && !!pass.signature;
      const [, , total] = await rpc.readContract({ address: desk.address, abi: DESK, functionName: "quote", args: [BigInt(d.id), raw, holder] });
      const paysEth = d.coin.address === ETH, steps: Step[] = [];
      if (!paysEth) {
        const [have, allowed] = await Promise.all([rpc.readContract({ address: d.coin.address, abi: erc20Abi, functionName: "balanceOf", args: [a] }), rpc.readContract({ address: d.coin.address, abi: erc20Abi, functionName: "allowance", args: [a, desk.address] })]);
        if (have < total) throw new Error(`This costs ${formatUnits(total, d.coin.decimals)} ${d.coin.symbol} with the fee, and this wallet has ${formatUnits(have, d.coin.decimals)}.`);
        // exactly what this buy needs, never more
        if (allowed < total) steps.push({ call: { address: d.coin.address, abi: erc20Abi, functionName: "approve", args: [desk.address, total] }, sign: `Approve ${formatUnits(total, d.coin.decimals)} ${d.coin.symbol}…`, wait: "Waiting for the approval…", fail: "The approval failed. Nothing was bought." });
      }
      steps.push({ call: { address: desk.address, abi: DESK, functionName: "buy", args: [BigInt(d.id), raw, a, total, holder ? BigInt(pass.expiry!) : 0n, holder ? pass.signature! : "0x"], value: paysEth ? total : undefined }, sign: `Buy ${num(n)} ${sym(d)}…` });
      await gasCheck(a, (steps.length > 1 ? 60_000n : 0n) + 220_000n, paysEth ? total : 0n);
      const batched = steps.length > 1 && (await canBatch(w, a));
      const sent = await sendSteps(w, a, steps, { batched, once: `Confirm once in your wallet (approve + buy ${num(n)} ${sym(d)})…`, say: setStep });
      setStep("Waiting for Ethereum…");
      const r = await rpc.waitForTransactionReceipt({ hash: sent.hash });
      setMsg(r.status === "success" ? { ok: true, text: `Bought. The ${sym(d)} are in your wallet${holder ? ", at the holder fee" : ""}.`, tx: sent.hash } : { ok: false, text: "It reverted. Nothing moved but the network fee.", tx: sent.hash });
      onDone();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setStep(""); }
  }

  return <dialog ref={dialog} className="pv-dl-dialog" aria-labelledby="pv-dl-buy-h" onClose={() => { if (!dialog.current?.open) onClose(); }}>
    <header><h2 id="pv-dl-buy-h">Buy {sym(d)}</h2><button type="button" className="pv-icon-button" aria-label="Close" onClick={() => dialog.current?.close()}><SectionIcon id="close" /></button></header>
    <p className="pv-dl-sub">{d.token.name ?? short(d.token.address)} · deal #{d.id} · {small(d.each ?? 0)} {d.coin.symbol} each</p>
    <label className="pv-dl-field">Amount of {sym(d)}<input value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} inputMode="decimal" /></label>
    <div className="pv-dl-quick">{[25, 50, 100].map((p) => <button key={p} type="button" className="pv-button" onClick={() => setAmount(String(p === 100 ? rest : Math.max(min, (rest * p) / 100)))}>{p === 100 ? "All" : `${p}%`}</button>)}</div>
    <dl className="pv-dl-sum">
      <div><dt>Price</dt><dd>{cost !== null ? `${small(cost)} ${d.coin.symbol}` : "—"}</dd></div>
      <div><dt>Fee</dt><dd>{desk.feeBps / 100}% · {desk.holderFeeBps / 100}% for holders</dd></div>
      <div><dt>You pay</dt><dd>{cost !== null ? `about ${small(cost * (1 + desk.feeBps / 10_000))} ${d.coin.symbol}` : "—"}<small>The exact total comes from the contract before your wallet opens.</small></dd></div>
    </dl>
    {d.vsMarketPct !== null && d.vsMarketPct > 0 && <p className="pv-dl-warn">This deal costs {d.vsMarketPct}% more than the market price.</p>}
    {d.verdict?.verdict === "avoid" && <p className="pv-dl-warn">Token Verdict says avoid: {d.verdict.summary}</p>}
    {msg && <p className={msg.ok ? "pv-dl-ok" : "pv-dl-err"} role="alert">{msg.text}{msg.tx && <> <a href={`https://etherscan.io/tx/${msg.tx}`} target="_blank" rel="noreferrer">View on Etherscan</a></>}</p>}
    <button type="button" className="pv-button pv-primary pv-dl-go" disabled={!!step || !!bad || !desk.open} onClick={() => void buy()}>{step || bad || (desk.open ? `Buy ${num(n)} ${sym(d)}` : "Opens when the contract is live")}</button>
    {!!buys.length && <section className="pv-dl-buys"><h3>Recent buys</h3><ul>{buys.map((b) => <li key={b.tx}><span>{num(amountOf(b.amount, dec))} {sym(d)}</span><span>{short(b.recipient)}{b.holder ? " · holder" : ""}</span><a href={`https://etherscan.io/tx/${b.tx}`} target="_blank" rel="noreferrer">tx</a></li>)}</ul></section>}
  </dialog>;
}

function SellForm({ desk, onDone, setMe }: { desk: Desk | null; onDone: () => void; setMe: (a: string) => void }) {
  const [f, setF] = useState({ token: "", amount: "", coin: "USDC", each: "", min: "", days: "7", buyer: "" });
  const [meta, setMeta] = useState<{ symbol: string; decimals: number; name: string } | null>(null), [step, setStep] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  useEffect(() => {
    setMeta(null);
    if (!isAddress(f.token)) return;
    const token = getAddress(f.token);
    void Promise.all((["symbol", "decimals", "name"] as const).map((fn) => rpc.readContract({ address: token, abi: erc20Abi, functionName: fn }))).then(([s, d, n]) => setMeta({ symbol: String(s), decimals: Number(d), name: String(n) })).catch(() => setMeta(null));
  }, [f.token]);
  const coin = desk?.coins.find((c) => c.symbol === f.coin) ?? null, total = Number(f.amount) * Number(f.each);

  async function sell() {
    setMsg(null);
    try {
      if (!desk?.address || !coin) throw new Error("Token Deals is not open yet.");
      if (!meta) throw new Error("Enter the token's contract address on Ethereum.");
      if (f.buyer && !isAddress(f.buyer)) throw new Error("The private buyer must be a 0x wallet address, or leave it empty.");
      const token = getAddress(f.token), amount = parseUnits(f.amount, meta.decimals);
      const price = (parseUnits(f.each, coin.decimals) * 10n ** 18n) / 10n ** BigInt(meta.decimals);
      if (!(amount > 0n)) throw new Error("Enter how many tokens to sell.");
      if (!(price > 0n)) throw new Error("The price per token is too small for this coin. Raise it a little.");
      const minBuy = f.min ? parseUnits(f.min, meta.decimals) : 0n, days = Math.min(365, Math.max(1, Math.round(Number(f.days) || 7)));
      if (minBuy > amount) throw new Error("The minimum buy is larger than the amount.");
      const { w, a } = await wallet(); setMe(a);
      const [have, allowed] = await Promise.all([rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] }), rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a, desk.address] })]);
      if (have < amount) throw new Error(`This wallet has ${formatUnits(have, meta.decimals)} ${meta.symbol}.`);
      const steps: Step[] = [];
      // exactly the amount for sale, never more
      if (allowed < amount) steps.push({ call: { address: token, abi: erc20Abi, functionName: "approve", args: [desk.address, amount] }, sign: `Approve ${f.amount} ${meta.symbol}…`, wait: "Waiting for the approval…", fail: "The approval failed. Nothing was listed." });
      steps.push({ call: { address: desk.address, abi: DESK, functionName: "open", args: [token, amount, coin.address, price, minBuy, BigInt(Math.floor(Date.now() / 1000) + days * 86_400), f.buyer ? getAddress(f.buyer) : ETH] }, sign: `Open the deal for ${f.amount} ${meta.symbol}…` });
      await gasCheck(a, (steps.length > 1 ? 60_000n : 0n) + 260_000n);
      const batched = steps.length > 1 && (await canBatch(w, a));
      const sent = await sendSteps(w, a, steps, { batched, once: `Confirm once in your wallet (approve + open the deal)…`, say: setStep });
      setStep("Waiting for Ethereum…");
      const r = await rpc.waitForTransactionReceipt({ hash: sent.hash });
      setMsg(r.status === "success" ? { ok: true, text: "Your deal is open. It appears on the board within a minute.", tx: sent.hash } : { ok: false, text: "It reverted. Nothing moved but the network fee.", tx: sent.hash });
      onDone();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setStep(""); }
  }

  return <section className="pv-dl-sell" id="pv-dl-sell" aria-labelledby="pv-dl-sell-h">
    <h2 id="pv-dl-sell-h">Sell tokens</h2>
    <p className="pv-dl-sub">Your tokens go into the escrow contract until someone buys. You get the full price; the buyer pays the fee. Cancel any time to take back what is left.</p>
    <fieldset>
      <label className="pv-dl-wide">Token contract on Ethereum<input value={f.token} onChange={set("token")} placeholder="0x…" spellCheck={false} autoComplete="off" />{meta && <small>{meta.name} (${meta.symbol})</small>}</label>
      <label>Amount to sell<input value={f.amount} onChange={set("amount")} inputMode="decimal" placeholder="100000" /></label>
      <label>Paid in<select value={f.coin} onChange={set("coin")}>{(desk?.coins ?? []).map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}</select></label>
      <label>Price per token ({f.coin})<input value={f.each} onChange={set("each")} inputMode="decimal" placeholder="0.0005" /></label>
      <label>Minimum buy (optional)<input value={f.min} onChange={set("min")} inputMode="decimal" placeholder="Any amount" /></label>
      <label>Open for (days)<input value={f.days} onChange={set("days")} inputMode="numeric" /></label>
      <label>Private buyer (optional)<input value={f.buyer} onChange={set("buyer")} placeholder="0x… only this wallet can buy" spellCheck={false} /></label>
    </fieldset>
    <p className="pv-dl-total">{Number.isFinite(total) && total > 0 ? <>If it all sells you receive <b>{small(total)} {f.coin}</b>.</> : "Fill in the amount and the price to see what you receive."}</p>
    {msg && <p className={msg.ok ? "pv-dl-ok" : "pv-dl-err"} role="alert">{msg.text}{msg.tx && <> <a href={`https://etherscan.io/tx/${msg.tx}`} target="_blank" rel="noreferrer">View on Etherscan</a></>}</p>}
    <button type="button" className="pv-button pv-primary pv-dl-go" disabled={!!step || !desk?.open} onClick={() => void sell()}>{step || (desk?.open ? "Approve and open the deal" : "Opens when the contract is live")}</button>
  </section>;
}

function MyDeals({ desk, me, deals, onDone }: { desk: Desk; me: string; deals: Deal[]; onDone: () => void }) {
  const [owed, setOwed] = useState(0n), [step, setStep] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [prices, setPrices] = useState<Record<number, string>>({});
  useEffect(() => { if (desk.address && isAddress(me)) void rpc.readContract({ address: desk.address, abi: DESK, functionName: "owed", args: [getAddress(me)] }).then(setOwed).catch(() => {}); }, [desk.address, me]);
  const run = async (label: string, call: Step["call"]) => {
    setMsg(null);
    try {
      const { w, a } = await wallet();
      await gasCheck(a, 120_000n);
      const sent = await sendSteps(w, a, [{ call, sign: label }], { batched: false, once: label, say: setStep });
      setStep("Waiting for Ethereum…");
      const r = await rpc.waitForTransactionReceipt({ hash: sent.hash });
      setMsg(r.status === "success" ? { ok: true, text: "Done." } : { ok: false, text: "It reverted. Nothing moved but the network fee." });
      onDone();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setStep(""); }
  };
  const live = deals.filter((d) => d.status === "open" || d.status === "expired");
  if (!live.length && owed === 0n) return null;
  return <section className="pv-dl-mine" aria-labelledby="pv-dl-mine-h">
    <h2 id="pv-dl-mine-h">Your deals</h2>
    {owed > 0n && <p className="pv-dl-sub">{formatEther(owed)} ETH from your sales is waiting for you. <button type="button" className="pv-button" disabled={!!step} onClick={() => void run("Claim your ETH…", { address: desk.address!, abi: DESK, functionName: "claimOwed" })}>Claim</button></p>}
    <ul>{live.map((d) => {
      const dec = d.token.decimals ?? 18, coinDec = d.coin.decimals;
      const repriced = prices[d.id] ? (parseUnits(prices[d.id]!, coinDec) * 10n ** 18n) / 10n ** BigInt(dec) : 0n;
      return <li key={d.id}>
        <div><b>#{d.id} · {num(amountOf(d.left, dec))} {sym(d)} left</b><span>{small(d.each ?? 0)} {d.coin.symbol} each · {left(d.expiry)}</span></div>
        <input aria-label={`New price for deal ${d.id}`} placeholder={`New price (${d.coin.symbol})`} inputMode="decimal" value={prices[d.id] ?? ""} onChange={(e) => setPrices((v) => ({ ...v, [d.id]: e.target.value.replace(",", ".") }))} />
        <button type="button" className="pv-button" disabled={!!step || !(repriced > 0n)} onClick={() => void run(`Change the price of deal #${d.id}…`, { address: desk.address!, abi: DESK, functionName: "update", args: [BigInt(d.id), repriced, BigInt(d.minBuy), BigInt(Math.max(d.expiry, Math.floor(Date.now() / 1000) + 86_400))] })}>Change price</button>
        <button type="button" className="pv-button" disabled={!!step} onClick={() => void run(`Cancel deal #${d.id} and take back ${num(amountOf(d.left, dec))} ${sym(d)}…`, { address: desk.address!, abi: DESK, functionName: "cancel", args: [BigInt(d.id)] })}>Cancel and take back</button>
      </li>;
    })}</ul>
    {step && <p className="pv-dl-sub">{step}</p>}
    {msg && <p className={msg.ok ? "pv-dl-ok" : "pv-dl-err"} role="alert">{msg.text}</p>}
  </section>;
}
