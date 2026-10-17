import { useEffect, useState } from "react";
import { FrogClaims } from "./FrogClaims";
import { Icon } from "./Icon";
import { inUsd, useImdUsd } from "./price";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
/** The NIGHT FROGS contract, deployed by IMD (launch 1fc22c34). The page never approves anything else. */
const NIGHT_FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const FROGS = parseAbi([
  "function mint(uint256 quantity)",
  "function price() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)",
]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });

type Info = { on: boolean; address: string | null; extraSlots: number; stats: { minted: number; burned: number; price: number; revealed: boolean; revealRequested: boolean } | null; order: { stage: string; done: boolean; error: string | null; jobId: string | null } | null };

const PREVIEWS = ["001", "002", "077", "078", "079", "080", "081", "082", "083", "084", "112", "113", "131", "187", "224", "500"];
const RARITY: [string, string][] = [
  ["Background", "Neon City · Ultraviolet Storm · Moonlit Sky · Deep Starfield · Server Corridor · Genesis Sunburst (#1–77 only)"],
  ["Body", "Black Hoodie · Purple Hoodie · Hi-vis Vest · Grey Work Jacket · NIGHTSHIFT Jumpsuit · Gold Tracksuit (3%)"],
  ["Skin", "Classic · Dark · Acid Neon · Mint Zombie · Ice Blue · Purple Alien · Gold (4%) · Chrome (1%)"],
  ["Mouth", "Corner Smirk · Toothpick · Big Grin · 3 AM Yawn · Knowing Smile · Gritted Teeth"],
  ["Eyes", "Heavy Lids · Laser (7%) · Neon Shades · Cyan VR Visor · Wired · Deadpan Wink · Acid Glow · Monocle (2%)"],
  ["Headwear", "Headlamp Hard Hat · Night Beanie · Dispatcher Headset · Gold Crown (3%) · Backwards Cap · Night Vision · Moonlight Halo (1%) · None"],
  ["Accessory", "$SHIFT Chain · Crew ID Badge · Shipping Coffee · Overtime Energy · IMD Swarm Earpiece · None"],
];

/** NIGHT FROGS: the crew of the 3 AM shift. Mint in IMD, half of it burned forever. */
export function FrogsPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [qty, setQty] = useState(1);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const usd = useImdUsd();
  const load = () => fetch("/api/frogs").then((r) => r.json()).then(setInfo).catch(() => {});
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, []);

  const s = info?.stats;
  const price = s?.price ?? 2;
  const minted = s?.minted ?? 0;
  const left = 500 - minted;

  const mint = async () => {
    if (!info?.address) return;
    setErr(null); setDone(null);
    if (info.address.toLowerCase() !== NIGHT_FROGS) { setErr("Contract mismatch: refusing to mint."); return; }
    const nft = NIGHT_FROGS as `0x${string}`;
    try {
      const eth = await chooseWallet();
      const wallet = createWalletClient({ chain: mainnet, transport: custom(eth as never) });
      setStep("Connect your wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum mainnet."); });
      const [unit, mine] = await Promise.all([
        rpc.readContract({ address: nft, abi: FROGS, functionName: "price" }),
        rpc.readContract({ address: nft, abi: FROGS, functionName: "mintedBy", args: [me] }),
      ]);
      if (Number(mine) + qty > 10) throw new Error(`One wallet mints at most 10 frogs; this one has minted ${mine}.`);
      const cost = unit * BigInt(qty);
      const bal = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < cost) throw new Error(`You need ${Number(cost) / 1e18} IMD; this wallet has ${(Number(bal) / 1e18).toFixed(3)}. Buy IMD on Uniswap first.`);
      const allowance = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, nft] });
      if (allowance < cost) {
        setStep(`1/2 · Approve exactly ${Number(cost) / 1e18} IMD for NIGHT FROGS (confirm in your wallet)…`);
        const a = await wallet.writeContract({ account: me, address: IMD, abi: erc20Abi, functionName: "approve", args: [nft, cost] });
        setStep("1/2 · Waiting for the approval…");
        await rpc.waitForTransactionReceipt({ hash: a });
      }
      setStep(`2/2 · Mint ${qty} frog${qty > 1 ? "s" : ""} (confirm in your wallet)…`);
      const tx = await wallet.writeContract({ account: me, address: nft, abi: FROGS, functionName: "mint", args: [BigInt(qty)] });
      setStep("2/2 · Waiting for the mint…");
      const r = await rpc.waitForTransactionReceipt({ hash: tx as Hex });
      if (r.status !== "success") throw new Error(`The mint reverted: ${tx}`);
      setStep(null);
      setDone(tx);
      void load();
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  return (
    <div className="docs token-page frogs-page">
      <span className="eyebrow">THE COLLECTION</span>
      <h1>NIGHT FROGS. <em>The crew of the 3 AM shift.</em></h1>
      <p className="lead">500 frogs that work the night shift on the NIGHTSHIFT ship while the founders sleep. Tired, caffeinated, a little dangerous, always shipping. Drawn, coded and audited by the IMD swarm, and stored fully onchain: no server, no IPFS, the art lives in the contract.</p>

      <section className="tkn-card frogs-mint">
        <div className="tkn-head">
          <img className="tkn-thumb" src="/frogs/frog-001.webp" alt="" width={52} height={52} />
          <div><b>NIGHT FROGS</b><span>NFROG · ERC-721 · Ethereum · minted only in IMD</span></div>
          <span className={`tkn-state${info?.on ? " on" : ""}`}>{info?.on ? (left > 0 ? "MINTING" : "SOLD OUT") : info?.order && !info.order.error ? "BUILDING" : "COMING SOON"}</span>
        </div>
        {info?.on ? (
          <>
            <div className="frogs-countdown">
              {s?.revealed ? <><b>Revealed</b><span>every frog has its traits</span></>
                : left > 0 ? <><b>{left}</b><span>frogs until the reveal · when the 500th is minted, one Chainlink draw wakes the whole crew</span></>
                : <><b>Sold out</b><span>the reveal is next</span></>}
            </div>
            <div className="frogs-meter"><i style={{ width: `${(minted / 500) * 100}%` }} /></div>
            <div className="frogs-nums">
              <div><b>{minted}</b><span>of 500 minted</span></div>
              <div><b>{price} IMD</b><span>per frog{usd ? ` · ${inUsd(price, usd)}` : ""}</span></div>
              <div><b><Icon name="flame" size={20} /> {(s?.burned ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b><span>IMD burned forever</span></div>
            </div>
            {left > 0 ? (
              <div className="frogs-buy">
                <div className="frogs-qty">
                  <button className="btn" onClick={() => setQty(Math.max(1, qty - 1))} disabled={Boolean(step)}>−</button>
                  <b>{qty}</b>
                  <button className="btn" onClick={() => setQty(Math.min(10, qty + 1, left))} disabled={Boolean(step)}>+</button>
                </div>
                <button className="ns-cta sm" onClick={mint} disabled={Boolean(step)}>MINT {qty} · {qty * price} IMD <span className="arr">→</span></button>
              </div>
            ) : <p className="good">All 500 frogs are minted. Buy one on a marketplace.</p>}
            {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
            {err && <div className="bad">{err}</div>}
            {done && <div className="good">Minted. Welcome to the crew. <a href={`https://etherscan.io/tx/${done}`} target="_blank" rel="noreferrer">See the transaction</a></div>}
            <div className="tkn-addr"><span>CONTRACT</span><a href={`https://etherscan.io/address/${info.address}`} target="_blank" rel="noreferrer">{info.address}</a></div>
          </>
        ) : (
          <div className="tkn-addr">
            <span>STATUS</span>
            <code>{info?.order ? info.order.stage : "The IMD swarm is preparing the collection."}</code>
            {info?.order?.jobId && <a href={`https://explorer.imd.fun/jobs/${info.order.jobId}`} target="_blank" rel="noreferrer">Follow the build on the IMD explorer →</a>}
          </div>
        )}
        <p className="tkn-warn">Only mint through this page or the contract above. The address appears here, on @nightshiftimd and in t.me/getnightshift; anything else is fake.</p>
      </section>

      <h2>The crew</h2>
      <p className="dim">Previews rendered from the contract with a test seed. The real traits are drawn by Chainlink VRF at reveal.</p>
      <div className="frogs-grid">{PREVIEWS.map((id) => <figure key={id}><img src={`/frogs/frog-${id}.webp`} alt={`NIGHT FROG #${Number(id)}`} loading="lazy" width={300} height={300} /><figcaption>#{Number(id)}{Number(id) === 1 ? " · Zero-Sleep Captain" : Number(id) <= 77 ? " · Genesis" : ""}</figcaption></figure>)}</div>

      <h2>What a frog does for you</h2>
      <ul className="frogs-util">
        <li><b>0% platform fee</b> on everything your NIGHTSHIFT companies earn.</li>
        <li><b>Featured first</b> in the market, for people and AI agents.</li>
        <li><b>+{info?.extraSlots ?? 2} company slots</b>: run {5 + (info?.extraSlots ?? 2)} companies instead of 5.</li>
        <li><b>Every mint burns IMD.</b> 1 IMD of every 2 goes to the burn address, provable onchain (<code>totalBurned</code>).</li>
        <li><b>Soft staking:</b> earn shift hours just by holding, no locking (below).</li>
        <li><b>Coming next:</b> a holders-only crew chat and votes on what the swarm builds next.</li>
      </ul>

      <Staking on={Boolean(info?.on)} />

      <h2>How it works</h2>
      <ul className="frogs-util">
        <li><b>500 frogs</b>, ids 1–500. <b>#1–77 are Genesis</b> with the golden sunburst; <b>#1 is the 1-of-1 Zero-Sleep Captain</b>. Nothing is pre-minted, not even #1.</li>
        <li><b>2 IMD each</b>, at most 10 per wallet. The contract sends half to <code>0x…dEaD</code> and half to the treasury in the same transaction. The split can never change.</li>
        <li><b>Reveal</b>: until all 500 are minted every frog shows the moon. Then one Chainlink VRF draw gives every frog its traits at once; nobody can pick or reroll them.</li>
        <li><b>Fully onchain</b>: 48 layered vector traits stored in the contract (SSTORE2), the SVG and metadata are built by <code>tokenURI</code>. 5% royalties.</li>
      </ul>

      <h2>Traits</h2>
      <div className="frogs-traits">{RARITY.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}</div>
    </div>
  );
}

type Board = { board: { wallet: string; hours: number; frogs: number }[]; me: { hours: number; rank: number | null; frogs: { id: number; multiplier: number }[]; perHour: number; imdSeat?: boolean } | null };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Soft staking: hold a frog in your own wallet and earn shift hours. Nothing is locked. */
function Staking({ on }: { on: boolean }) {
  const [wallet, setWallet] = useState("");
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = (w = wallet) => fetch(`/api/frogs/staking${/^0x[0-9a-fA-F]{40}$/.test(w) ? `?wallet=${w}` : ""}`).then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { void load(); }, []);
  const mine = async () => {
    setErr(null);
    try {
      const eth = await chooseWallet();
      const [me] = await createWalletClient({ chain: mainnet, transport: custom(eth as never) }).requestAddresses();
      if (me) { setWallet(me); void load(me); }
    } catch (e) { setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };
  return (
    <section id="staking">
      <h2>Soft staking · shift hours</h2>
      <FrogClaims />
      <p className="dim">Keep your frog in your own wallet. Nothing is locked or sent anywhere, no transactions, no gas. Every hour you hold it you earn shift hours: <b>1×</b> a frog, <b>2×</b> a Genesis (#26–77), <b>3×</b> an early Genesis (#2–25), <b>6×</b> the Zero-Sleep Captain (#1). Holding an <b>IMD seat</b> as well doubles it all. Hours go to the wallet holding the frog; selling it stops the clock.</p>
      <p className="dim">Shift hours will be redeemable for perks (fee discounts, early access, holder roles) and later for $SHIFT airdrops paid from platform fees. The weekly top crew is posted in the Telegram chat every Sunday.</p>
      {on ? (
        <>
          <div className="frogs-buy">
            <input className="field mono" style={{ flex: 1, minWidth: 240 }} placeholder="0x… your wallet" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} />
            <button className="btn" onClick={() => load()}>Check</button>
            <button className="btn" onClick={mine}>Use my wallet</button>
          </div>
          {err && <div className="bad">{err}</div>}
          {data?.me && (
            <div className="frogs-nums" style={{ marginTop: 12 }}>
              <div><b>{data.me.hours.toLocaleString("en-US")} h</b><span>shift hours</span></div>
              <div><b>{data.me.perHour}×</b><span>earning per hour · {data.me.frogs.length} frog{data.me.frogs.length === 1 ? "" : "s"}{data.me.imdSeat ? " · IMD seat 2×" : ""}</span></div>
              <div><b>{data.me.rank ? `#${data.me.rank}` : "—"}</b><span>rank in the crew</span></div>
            </div>
          )}
          {data?.board.length ? (
            <div className="frogs-traits" style={{ marginTop: 14 }}>
              {data.board.map((r, i) => <div key={r.wallet}><b>#{i + 1}</b><span className="mono"><a href={`https://etherscan.io/address/${r.wallet}`} target="_blank" rel="noreferrer">{short(r.wallet)}</a> · {r.hours.toLocaleString("en-US")} h · {r.frogs} frog{r.frogs === 1 ? "" : "s"}</span></div>)}
            </div>
          ) : <p className="faint">The leaderboard starts with the first mints.</p>}
        </>
      ) : <p className="faint">Starts automatically with the first mint.</p>}
    </section>
  );
}
