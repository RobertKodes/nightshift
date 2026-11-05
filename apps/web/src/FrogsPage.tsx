import { ethTransport } from "./ethRpc";
import { useEffect, useState } from "react";
import { FrogClaims } from "./FrogClaims";
import { Icon } from "./Icon";
import { inUsd, useImdUsd } from "./price";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";
import { go } from "./router";
import { type Step, canBatch, sendSteps } from "./batch";
import ChromaGrid from "./rb/ChromaGrid";
import PixelCard from "./rb/PixelCard";
import { PxButton, PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { Flap, HeroDots, ShStar } from "./saas/pages/shift-kit";
import "./saas/pages/frogs.css";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
/** The NIGHT FROGS contract, deployed by IMD (launch 1fc22c34). The page never approves anything else. */
const NIGHT_FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const FROGS = parseAbi([
  "function mint(uint256 quantity)",
  "function price() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)",
]);
const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });

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
      const steps: Step[] = [];
      if (allowance < cost) steps.push({ call: { address: IMD, abi: erc20Abi, functionName: "approve", args: [nft, cost] }, sign: `1/2 · Approve exactly ${Number(cost) / 1e18} IMD for NIGHT FROGS (confirm in your wallet)…`, wait: "1/2 · Waiting for the approval…", fail: "The approval failed. Nothing was minted." });
      const two = steps.length > 0, frogs = `${qty} frog${qty > 1 ? "s" : ""}`;
      steps.push({ call: { address: nft, abi: FROGS, functionName: "mint", args: [BigInt(qty)] }, sign: two ? `2/2 · Mint ${frogs} (confirm in your wallet)…` : `Mint ${frogs} (confirm in your wallet)…`, wait: two ? "2/2 · Waiting for the mint…" : "Waiting for the mint…" });
      const batched = two && (await canBatch(wallet, me));
      const r = await sendSteps(wallet, me, steps, { batched, once: `Confirm once in your wallet (approve exactly ${Number(cost) / 1e18} IMD + mint ${frogs})…`, wait: batched ? "Waiting for the mint…" : undefined, say: setStep });
      const tx = r.hash;
      if (!r.ok) throw new Error(`The mint reverted: ${tx}`);
      setStep(null);
      setDone(tx);
      void load();
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  const minting = Boolean(info?.on && left > 0);
  const status = info?.on ? (left > 0 ? "MINTING" : "SOLD OUT") : info?.order && !info.order.error ? "BUILDING" : "COMING SOON";
  const crew = PREVIEWS.map((id, i) => ({
    image: `/frogs/frog-${id}.webp`,
    title: `NIGHT FROG #${Number(id)}`,
    subtitle: Number(id) === 1 ? "Zero-Sleep Captain" : Number(id) <= 77 ? "Genesis" : "Crew",
    alt: `NIGHT FROG #${Number(id)}`,
    accent: i % 3 === 0 ? "#b8ff3d" : i % 3 === 1 ? "#57d97b" : "#f2c14e",
  }));
  const card = (
    <PxPanel className="sh-board frg-card" title="CREW CARD · #001" state={info ? (info.on ? "live" : "idle") : "idle"} right={status}>
      <PixelCard className="frg-pix" colors={["#b8ff3d", "#57d97b", "#1f6b3a"]} gap={6} speed={30} pixelSize={2} trigger="hover" radius={2} glow={0.3} spotlight={0.3} intro={false} theme="dark">
        <img src="/frogs/frog-001.webp" alt="NIGHT FROG #1, the Zero-Sleep Captain" width={300} height={300} />
      </PixelCard>
      <div className="frg-id"><b>NIGHT FROG #1</b><span>ZERO-SLEEP CAPTAIN · 1 OF 1 · 50× SHIFT HOURS</span></div>
      <div className="frg-flap"><span className="sh-board-k">MINTED OF 500</span><Flap text={s ? `${minted}/500` : "…"} size={20} /></div>
    </PxPanel>
  );

  return (
    <div className="sh sh-frogs">
      <PxHero
        kicker="THE COLLECTION · NIGHT FROGS"
        live={Boolean(info?.on)}
        title="Frogs."
        accent="The crew of the 3 AM shift."
        lead={<>500 frogs that work the night shift on the NIGHTSHIFT ship while the founders sleep. Tired, caffeinated, a little dangerous, always shipping. Drawn, coded and audited by the <b>IMD swarm</b>, and stored fully onchain: no server, no IPFS, the art lives in the contract.</>}
        actions={<>
          {minting ? <ShStar href="#mint" icon="blocks">MINT · {price} IMD</ShStar> : <ShStar href="https://opensea.io/collection/night-frogs-825445489" external icon="market">NIGHT FROGS ON OPENSEA</ShStar>}
          <PxButton to="/forge" icon="bolt">UPGRADE FROGS</PxButton>
          <a href="#frog-rewards" className="px-btn ghost"><PxIcon name="pulse" size={14} />REWARDS</a>
        </>}
        aside={card}
        bg={<HeroDots />}
      />

      <nav className="sh-chips" aria-label="Frogs"><a href="/command">Missions</a><a href="/forge">Upgrade Frogs</a><a href="#frog-rewards">Rewards</a><a href="/token">$SHIFT benefits</a><a href="/how-it-works">How it works</a></nav>
      <a className="frogs-ship" href="/ship" onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go("/ship"); }}><b><i className="frg-dot" />THE SHIP · LIVE</b><span>All 500 frogs and every Night Watcher at work on the ship, drawn from their onchain art: find yours, see what it earns an hour.</span><em>Board the ship →</em></a>

      <section id="mint" className="frg-mint" aria-label="Mint NIGHT FROGS">
        <PxPanel title={<>NIGHT FROGS · NFROG · ERC-721 · ETHEREUM · MINTED ONLY IN IMD</>} state={info?.on ? "live" : "idle"} right={status}>
          {info?.on ? (
            <div className="frg-mint-b">
              <div className="frogs-countdown">
                {s?.revealed ? <><b>Revealed</b><span>every frog has its traits</span></>
                  : left > 0 ? <><b><PxNum value={left} /></b><span>frogs until the reveal · when the 500th is minted, one Chainlink draw wakes the whole crew</span></>
                  : <><b>Sold out</b><span>the reveal is next</span></>}
              </div>
              <div className="frogs-meter" role="img" aria-label={`${minted} of 500 minted`}>{Array.from({ length: 50 }, (_, i) => <i key={i} className={i < Math.round((minted / 500) * 50) ? "on" : ""} />)}</div>
              <PxStats cols={3}>
                <PxStat label="Minted" tone="lime" value={<><PxNum value={minted} /><small className="frg-of"> / 500</small></>} sub="of 500 minted" />
                <PxStat label="Price" value={<PxNum value={price} suffix=" IMD" />} sub={<>per frog{usd ? ` · ${inUsd(price, usd)}` : ""}</>} />
                <PxStat label="IMD burned forever" tone="gold" value={<><Icon name="flame" size={18} /> <PxNum value={s?.burned ?? 0} decimals={(s?.burned ?? 0) % 1 ? 2 : 0} /></>} sub="half of every mint, onchain" />
              </PxStats>
              {left > 0 ? (
                <div className="frogs-buy">
                  <div className="frogs-qty">
                    <button className="px-btn" onClick={() => setQty(Math.max(1, qty - 1))} disabled={Boolean(step)} aria-label="One fewer">−</button>
                    <b aria-live="polite">{qty}</b>
                    <button className="px-btn" onClick={() => setQty(Math.min(10, qty + 1, left))} disabled={Boolean(step)} aria-label="One more">+</button>
                  </div>
                  <button className="ns-cta sm" onClick={mint} disabled={Boolean(step)}>MINT {qty} · {qty * price} IMD <span className="arr">→</span></button>
                </div>
              ) : <p className="sh-msg good">All 500 frogs are minted. <a href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">Buy one on OpenSea ↗</a></p>}
              {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
              {err && <div className="sh-msg bad">{err}</div>}
              {done && <div className="sh-msg good">Minted. Welcome to the crew. <a href={`https://etherscan.io/tx/${done}`} target="_blank" rel="noreferrer">See the transaction</a></div>}
              <div className="tkn-addr"><span>CONTRACT</span><a href={`https://etherscan.io/address/${info.address}`} target="_blank" rel="noreferrer">{info.address}</a></div>
              <div className="tkn-addr"><span>MARKET</span><a href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">NIGHT FROGS on OpenSea ↗</a></div>
            </div>
          ) : (
            <div className="tkn-addr">
              <span>STATUS</span>
              <code>{info?.order ? info.order.stage : "The IMD swarm is preparing the collection."}</code>
              {info?.order?.jobId && <a href={`https://explorer.imd.fun/jobs/${info.order.jobId}`} target="_blank" rel="noreferrer">Follow the build on the IMD explorer →</a>}
            </div>
          )}
          <p className="tkn-warn frg-warn">Only mint through this page or the contract above. The address appears here, on @nightshiftimd and in t.me/getnightshift; anything else is fake.</p>
        </PxPanel>
      </section>

      <PxSection kicker="THE CREW" title={<>500 frogs. <em>Always shipping.</em></>} id="frg-crew" sub="Previews rendered from the contract with a test seed. The real traits are drawn by Chainlink VRF at reveal.">
        <div className="frg-crew">
          <ChromaGrid items={crew} columns={4} minCardWidth={150} gap={10} radius={240} cardRadius={2} grayscale={0.6} dim={0.15} glow={0.3} reveal="card" aspectRatio="1 / 1" showInfo frame={false} theme="dark" />
        </div>
      </PxSection>

      <PxSection kicker="PERKS" title={<>What a frog <em>does for you.</em></>} id="frg-perks">
        <ul className="sh-grid three frg-perks">
          <li><b>0% platform fee</b> on everything your NIGHTSHIFT companies earn.</li>
          <li><b>Featured first</b> in the market, for people and AI agents.</li>
          <li><b>+{info?.extraSlots ?? 2} company slots</b>run {5 + (info?.extraSlots ?? 2)} companies instead of 5.</li>
          <li><b>Every mint burns IMD.</b> 1 IMD of every 2 goes to the burn address, provable onchain (<code>totalBurned</code>).</li>
          <li><b>Earned hours:</b> earn hours just by holding, no locking (below).</li>
          <li><b>Coming next:</b> a holders-only crew chat and votes on what the swarm builds next.</li>
          <li className="wide"><b>Upgrade Frogs (Gen 2):</b> burn 10 frogs for 1 Night Watcher that earns 10× to 40× shift hours (never less than its 10 did), crews every mission, takes a seat in the Night Watch (the imdUSD keeper network) and opens the private Watch Room. The rarer the 10, the higher the tier: an ordinary frog earns by its number, a forged one by its rarity. <a href="/forge">Upgrade Frogs →</a></li>
        </ul>
      </PxSection>

      <Staking on={Boolean(info?.on)} />

      <PxSection kicker="HOW IT WORKS" title={<>Minted in IMD, <em>stored onchain.</em></>} id="frg-how">
        <ul className="sh-grid">
          <li><b>500 frogs</b>Ids 1–500. <b>#1–77 are Genesis</b> with the golden sunburst; <b>#1 is the 1-of-1 Zero-Sleep Captain</b>. Nothing is pre-minted, not even #1.</li>
          <li><b>2 IMD each</b>At most 10 per wallet. The contract sends half to <code>0x…dEaD</code> and half to the treasury in the same transaction. The split can never change.</li>
          <li><b>Reveal</b>until all 500 are minted every frog shows the moon. Then one Chainlink VRF draw gives every frog its traits at once; nobody can pick or reroll them.</li>
          <li><b>Fully onchain</b>48 layered vector traits stored in the contract (SSTORE2), the SVG and metadata are built by <code>tokenURI</code>. 5% royalties.</li>
        </ul>
      </PxSection>

      <PxSection kicker="TRAITS" title={<>Seven layers, <em>drawn once.</em></>} id="frg-traits">
        <div className="frogs-traits">{RARITY.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}</div>
      </PxSection>
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
    <section id="staking" className="px-sec pk-sec frg-staking" aria-labelledby="frog-rewards">
      <div className="px-sec-head"><div><span className="px-kicker">SOFT STAKING · NOTHING LOCKED</span><h2 className="px-h2" id="frog-rewards">Earned hours <em>&amp; rewards.</em></h2></div></div>
      <FrogClaims />
      <p className="sh-note">Keep your frog in your own wallet. Nothing is locked or sent anywhere, no transactions, no gas. Every hour you hold it you earn shift hours: <b>1×</b> a frog, <b>2×</b> a Genesis (#26–77), <b>3×</b> an early Genesis (#2–25), <b>50×</b> the Zero-Sleep Captain (#1), the top of the crew, which also holds the Night Watch's Captain's seat. A Night Watcher (Gen 2) from <a href="/forge">Upgrade Frogs</a> earns <b>10× to 40×</b>. Holding an <b>IMD seat</b> as well doubles it all. Hours go to the wallet holding the frog; selling it stops the clock.</p>
      <p className="sh-note"><b>How earned hours count:</b> hours are reward weights, not tokens or a fixed exchange rate. Your total is cumulative; selling a Frog stops future accrual from that NFT. A funded epoch uses hours added since the last paid epoch, in the assets received by the Frog pot. The team must post its root before you can claim. With no funded pot, hours carry forward; there is no automatic Monday payout. Mission bonuses count toward the same total.</p>
      <PxPanel title="SHIFT HOURS · LEADERBOARD" state={on ? "live" : "idle"} right={data?.board.length ? `${data.board.length} WALLETS` : undefined}>
        {on ? (
          <div className="frg-board">
            <div className="frogs-buy">
              <input className="field mono" style={{ flex: 1, minWidth: 240 }} placeholder="0x… your wallet" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} aria-label="Wallet address" />
              <button className="px-btn" onClick={() => load()}>Check</button>
              <button className="px-btn" onClick={mine}><PxIcon name="wallet" size={14} />Use my wallet</button>
            </div>
            {err && <div className="sh-msg bad">{err}</div>}
            {data?.me && (
              <PxStats cols={3}>
                <PxStat label="Shift hours" tone="lime" value={<PxNum value={data.me.hours} suffix=" h" />} sub="cumulative, never resets" />
                <PxStat label="Earning per hour" value={`${data.me.perHour}×`} sub={<>{data.me.frogs.length} frog{data.me.frogs.length === 1 ? "" : "s"}{data.me.imdSeat ? " · IMD seat 2×" : ""}</>} />
                <PxStat label="Rank in the crew" value={data.me.rank ? `#${data.me.rank}` : "—"} sub="by shift hours" />
              </PxStats>
            )}
            {data?.board.length ? (
              <div className="frogs-traits frg-lead">
                {data.board.map((r, i) => <div key={r.wallet}><b>#{i + 1}</b><span className="mono"><a href={`https://etherscan.io/address/${r.wallet}`} target="_blank" rel="noreferrer">{short(r.wallet)}</a> · {r.hours.toLocaleString("en-US")} h · {r.frogs} frog{r.frogs === 1 ? "" : "s"}</span></div>)}
              </div>
            ) : <p className="sh-line">The leaderboard starts with the first mints.</p>}
          </div>
        ) : <p className="sh-line">Starts automatically with the first mint.</p>}
      </PxPanel>
    </section>
  );
}
