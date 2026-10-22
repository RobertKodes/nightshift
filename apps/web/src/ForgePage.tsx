import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { type Step, canBatch, sendSteps } from "./batch";
import { type NxIconName, NxIcon } from "./nx/icons";
import { Link } from "./router";
import { useSession } from "./session";
import { Stat, rememberRoom } from "./station/Station";
import { chooseWallet } from "./wallet";
import "./forge.css";

/**
 * THE FORGE: 10 NIGHT FROGS in, 1 Night Watcher (NIGHT FROGS Gen 2) out. The 10 go to 0x…dEaD; the share
 * of rare frogs in them sets the tier, and the tier sets the multiplier (10x to 40x) and the Night Watch seat. Every number here comes from /api/forge, which computes exactly what
 * the contract will: the preview art is the renderer's own SVG, so what you see is what you get.
 */
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const NIGHT_FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
/** Pinned when IMD deploys the forge, like every contract this site asks a wallet to approve. Empty: the forge is not open. */
const FORGE: string = "0xbdff33cffc3f617f808a6de012a2574dbf69d819";
const FORGE_ABI = parseAbi(["function forge(uint256[10] ids, uint8 minTier) returns (uint256)", "function fee() view returns (uint256)"]);
const NF_ABI = parseAbi(["function isApprovedForAll(address owner, address operator) view returns (bool)", "function setApprovalForAll(address operator, bool approved)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });

type Tier = { tier: number; roman: string; name: string; min: number; color: string; x: number; slots: number; crew: number };
type Info = {
  on: boolean; address: string | null; fee: string | null; tiers: Tier[]; showcase: number[][]; build: { key: string; title: string; stage: string; job: string | null }[] | null;
  rarities: { rarity: string; frogs: number; points: number }[];
  forged: { count: number; burned: number; byTier: Record<string, number>; latest: { n: number; tier: number; name: string; points: number; inputs: number[] }[] };
};
type Frog = { id: number; rank: number; rarity: string; points: number; rate: number; traits: string[] };
type Wallet = { frogs: Frog[]; plan: { strongest: number[] | null; cheapest: { tier: number; ids: number[]; points: number }[] } };
type Preview = { ids: number[]; points: number; tier: number; name: string; rate: number; before: number; toNext: number; mix: Record<string, number>; traits: { layer: string; value: string }[]; tierInfo: Tier; captain: boolean };
type Room = { on: boolean; members: number };

const RARITY_TONE: Record<string, string> = { Common: "#8e89a8", Uncommon: "#3fe6ff", Rare: "#a98bff", Epic: "#ff4fd8", Legendary: "#ffc46b" };
const ten = (...parts: [number, number][]) => parts.flatMap(([n, p]) => Array<number>(n).fill(p));
const EXAMPLES: [string, number[]][] = [["10 Common", ten([10, 1])], ["10 Uncommon", ten([10, 2])], ["10 Genesis", ten([10, 4])], ["5 Legendary + 5 Common", ten([5, 16], [5, 1])], ["6 Legendary + 4 Epic", ten([6, 16], [4, 8])], ["10 Legendary", ten([10, 16])]];
/** Each tier's seat in the Night Watch (nightwatch.ts TERMS): share weight and cut of the bonus it keeps. */
const SEATS: Record<number, { weight: number; cut: number }> = { 1: { weight: 1, cut: 10 }, 2: { weight: 1.25, cut: 9 }, 3: { weight: 1.5, cut: 8 }, 4: { weight: 2, cut: 7 }, 5: { weight: 3, cut: 6 } };
const PERKS: [NxIconName, string, string][] = [
  ["pulse", "10× to 40× shift hours", "Every Monday the frog pot pays ETH, $SHIFT and IMD by shift hours. A NIGHT FROG earns 1× to 3× however rare it is; a Night Watcher earns 10× to 40× by how rare its 10 were, and never less than they earned together. Only #1, the Zero-Sleep Captain, earns more: 50×."],
  ["security", "A seat in the Night Watch", "Run the Night Watch bot and your seat marks and liquidates unsafe imdUSD loans for a 16–18% bonus, in turn with the other seats. The rarer the seat, the bigger its share and the smaller its cut."],
  ["frogs", "+20% to +100% on your other frogs", "While a wallet holds a Night Watcher, every other NIGHT FROG in it earns more: +20% under a Shift Lead up to double under a Night Boss. Keep frogs and forge, and the ones you keep earn more."],
  ["stake", "A week up front", "The hour a Night Watcher is forged, its first week of shift hours lands in your wallet as a forge bonus: 1,680 hours for a Shift Lead, 6,720 for a Night Boss."],
  ["missions", "Every mission, every week", "It crews all three Command Room missions at once, each at its own multiplier. A NIGHT FROG crews one, at 1× to 3×."],
  ["key", "The Watch Room", "A private Telegram group only Night Watcher holders can enter: the Night Watch's calls when a loan goes under, and first word on what comes next. The bot checks your wallet at the door and walks sellers out."],
  ["companies", "+3 to +8 company slots", "Run up to 13 AI companies on NIGHTSHIFT, featured first in the market, with no platform fee on what they earn."],
  ["forge", "Living art, scarce by design", "Our neon card with an identity.md-style signal layer over it: scanlines, a signal barcode drawn from your 10 frogs, orbit rings, an ID line, code columns, every part animated and fully onchain. At most 50 exist, 4 Night Bosses, and a Night Boss writes its own name onchain."],
];
const tierOf = (tiers: Tier[], p: number) => [...tiers].reverse().find((t) => p >= t.min) ?? tiers[0]!;
const parseIds = (s: string) => [...new Set(s.split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 500))].slice(0, 10);
const imd = (wei: string | null) => (wei === null ? null : Number(BigInt(wei)) / 1e18);
const artOf = (ids: number[]) => `/api/forge/art.svg?ids=${ids.join(",")}`;
const tone = (c: string | undefined) => ({ "--tc": c } as React.CSSProperties);

export function ForgePage() {
  const { address: session, signIn, busy } = useSession();
  const [info, setInfo] = useState<Info | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [addr, setAddr] = useState("");
  const [w, setW] = useState<Wallet | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [pv, setPv] = useState<Preview | null>(null);
  const [tryIds, setTryIds] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [feat, setFeat] = useState(4);
  const [auto, setAuto] = useState(true);

  useEffect(() => rememberRoom("command"), []);
  useEffect(() => { void fetch("/api/forge").then((r) => r.json()).then(setInfo).catch(() => {}); }, [done]);
  useEffect(() => { void fetch("/api/forge/room").then((r) => r.json()).then(setRoom).catch(() => {}); }, []);
  // the hero walks through the five tiers until someone picks one
  useEffect(() => {
    if (!auto || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setFeat((f) => (f + 1) % 5), 4200);
    return () => clearInterval(t);
  }, [auto]);
  const load = (a: string, keep: number[] = []) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setErr("That is not a wallet address."); return; }
    setErr(null); setAddr(a);
    void fetch(`/api/forge/wallet?address=${a}`).then((r) => r.json()).then((d: Wallet & { error?: string }) => { if (d.error) setErr(d.error); else { setW(d); setSel(keep); } }).catch(() => setErr("Could not read the frogs right now."));
  };
  // shareable: /forge?wallet=0x… shows that wallet's bench, &ids=a,b,… (10) a ready combo
  useEffect(() => {
    const q = new URLSearchParams(location.search), qw = q.get("wallet"), qi = parseIds(q.get("ids") ?? "");
    const ids = qi.length === 10 ? qi : [];
    if (qw && /^0x[0-9a-fA-F]{40}$/.test(qw)) load(qw, ids); else setSel(ids);
  }, []);
  useEffect(() => { if (session && !addr) load(session); }, [session]);
  useEffect(() => {
    setPv(null);
    if (sel.length !== 10) return;
    void fetch(`/api/forge/preview?ids=${sel.join(",")}`).then((r) => r.json()).then((d) => (d.error ? setErr(d.error) : setPv(d))).catch(() => {});
  }, [sel.join(",")]);

  const connect = async () => {
    setErr(null);
    try {
      const [me] = await createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) }).requestAddresses();
      if (me) load(me);
    } catch (e) { setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 10 ? [...s, id] : s));
  const open = Boolean(info?.on && FORGE && info.address?.toLowerCase() === FORGE.toLowerCase());
  const mine = useMemo(() => new Set(w?.frogs.map((f) => f.id)), [w]);
  const sum = sel.reduce((s, id) => s + (w?.frogs.find((f) => f.id === id)?.points ?? 0), 0);

  const forge = async () => {
    if (!pv || !open) return;
    setErr(null); setDone(null);
    try {
      const wallet = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
      setStep("Connect your wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      if (me.toLowerCase() !== addr.toLowerCase()) throw new Error("Connect the wallet that holds these frogs.");
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum mainnet."); });
      const forgeAddr = FORGE as `0x${string}`;
      const [approved, fee] = await Promise.all([
        rpc.readContract({ address: NIGHT_FROGS, abi: NF_ABI, functionName: "isApprovedForAll", args: [me, forgeAddr] }),
        rpc.readContract({ address: forgeAddr, abi: FORGE_ABI, functionName: "fee" }),
      ]);
      const steps: Step[] = [];
      if (!approved) steps.push({ call: { address: NIGHT_FROGS, abi: NF_ABI, functionName: "setApprovalForAll", args: [forgeAddr, true] }, sign: "Let the forge move your 10 frogs to 0x…dEaD (confirm in your wallet)…", wait: "Waiting for the approval…" });
      if (fee > 0n) {
        const [bal, allowance] = await Promise.all([
          rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
          rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, forgeAddr] }),
        ]);
        if (bal < fee) throw new Error(`The forge costs ${Number(fee) / 1e18} IMD; this wallet has ${(Number(bal) / 1e18).toFixed(3)}.`);
        if (allowance < fee) steps.push({ call: { address: IMD, abi: erc20Abi, functionName: "approve", args: [forgeAddr, fee] }, sign: `Approve exactly ${Number(fee) / 1e18} IMD for the forge fee (confirm in your wallet)…`, wait: "Waiting for the IMD approval…" });
      }
      steps.push({ call: { address: forgeAddr, abi: FORGE_ABI, functionName: "forge", args: [pv.ids.map(BigInt) as never, pv.tier] }, sign: `Forge a Tier ${pv.tierInfo.roman} ${pv.name} (confirm in your wallet)…`, wait: "Forging…" });
      const batched = steps.length > 1 && (await canBatch(wallet, me));
      // in one batch the forge's approval is taken back at the end, so it never outlives this forge
      if (batched && !approved) steps.push({ call: { address: NIGHT_FROGS, abi: NF_ABI, functionName: "setApprovalForAll", args: [forgeAddr, false] }, sign: "Take the forge's approval back…", wait: "Forging…" });
      const r = await sendSteps(wallet, me, steps, { batched, once: `Confirm once in your wallet: forge a Tier ${pv.tierInfo.roman} ${pv.name}…`, wait: batched ? "Forging…" : undefined, say: setStep });
      if (!r.ok) throw new Error(`The forge reverted: ${r.hash}`);
      setStep(null); setDone(r.hash); load(me);
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  const tiers = info?.tiers ?? [];
  const fee = imd(info?.fee ?? null) ?? 2;
  const ft = tiers[feat];
  const bosses = info?.forged.byTier[5] ?? 0;
  const pick = (i: number) => { setAuto(false); setFeat(i); };
  return (
    <div className="st-room fg">
      <header className="fg-hero" style={tone(ft?.color ?? "#ffc46b")}>
        <div className="fg-hero-in">
          <span className="fg-eyebrow"><NxIcon name="forge" size={16} /> DECK 05 · THE FORGE · NIGHT WATCHERS · GEN 2</span>
          <h1>Burn 10. <em>Forge 1.</em></h1>
          <p className="fg-lead">Put 10 NIGHT FROGS through the night shift's forge and 1 Night Watcher comes out: fully onchain, glowing in its tier's colour, earning 10× to 40× of the frog pot and holding a seat in the Night Watch, the bot crew that liquidates unsafe imdUSD loans for a bonus. The rarer your 10, the higher the tier. No luck and no reveal: you see the exact Night Watcher before you sign.</p>
          <div className="fg-cta">
            <a className="nx-btn nx-btn-acc" href="#bench"><NxIcon name="forge" size={18} /> Start forging</a>
            <a className="nx-btn" href="#perks">What you get</a>
          </div>
          <div className="st-stats">
            <Stat label="The forge" value={open ? "OPEN" : "WAITING FOR IMD"} note={open ? "10 frogs in, 1 Night Watcher out" : "the IMD swarm builds the 3 contracts"} />
            <Stat label="Night Watchers" value={info ? `${info.forged.count} / 50` : "— / 50"} note="500 frogs ÷ 10, never more" />
            <Stat label="Night Bosses" value={`${bosses} / 4`} note={`${4 - bosses} can still be forged`} />
            <Stat label="Forge fee" value={`${fee} IMD`} note="1 burned, 1 to NIGHTSHIFT" />
          </div>
        </div>
        <div className="fg-show">
          <TiltCard src={info ? artOf(info.showcase[feat]!) : null} alt={ft ? `Night Watcher, Tier ${ft.roman} ${ft.name}` : "Night Watcher"} />
          {/* every tier's art, loaded once so switching never flickers */}
          <div className="fg-preload" aria-hidden="true">{info?.showcase.map((ids) => <img key={ids.join()} src={artOf(ids)} alt="" width={1} height={1} />)}</div>
          <div className="fg-pills" role="tablist" aria-label="The five tiers">
            {tiers.map((t, i) => (
              <button key={t.tier} role="tab" aria-selected={i === feat} className={i === feat ? "on" : ""} style={tone(t.color)} onClick={() => pick(i)}>
                <b>{t.roman}</b><span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="st-body">
        {!open && (
          <section className="fg-sec">
            <div className="fg-wait">
              <span className="fg-kicker">Waiting for IMD</span>
              <h2>The IMD swarm is building the Night Watchers</h2>
              <p>Three contracts, each coded, tested, audited by four agents and a judge, and deployed by IMD on Ethereum: the art, the identity layer and the forge. Everything on this page is already the exact preview of what they will make. Forging opens the day they are deployed and checked against it.</p>
              <ul className="fg-build">
                {(info?.build ?? [{ key: "art", title: "NIGHT WATCHERS art", stage: "…", job: null }, { key: "skin", title: "NIGHT WATCHERS identity layer", stage: "…", job: null }, { key: "forge", title: "NIGHT WATCHERS forge (Gen 2)", stage: "…", job: null }]).map((b) => (
                  <li key={b.key}><b>{b.title}</b><span>{b.stage}</span>{b.job && <a href={`https://explorer.imd.fun/jobs/${b.job}`} target="_blank" rel="noreferrer">follow it on IMD ↗</a>}</li>
                ))}
              </ul>
            </div>
          </section>
        )}
        <section id="perks" className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Why forge</span><h2>What a Night Watcher gets</h2></div>
          <div className="fg-perks">
            {PERKS.map(([icon, title, text]) => (
              <article key={title} className="fg-perk"><NxIcon name={icon} size={22} /><b>{title}</b><p>{text}</p></article>
            ))}
          </div>
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Keep or forge</span><h2>Ten frogs, side by side with one Night Watcher</h2></div>
          <div className="fg-vs" role="table">
            <div className="fg-vs-row fg-vs-h" role="row"><span /><span>Keep 10 NIGHT FROGS</span><span>Forge 1 Night Watcher</span></div>
            {[
              ["Shift hours an hour", "10 (1× each; Genesis 2×, #2–25 3×)", "10× to 40× by rarity, never less than the 10 earned"],
              ["Does rarity earn?", "No: a frog earns by its number", "Yes: rarity sets the tier and the multiplier"],
              ["The first week", "Nothing extra", "A week of its hours, credited the hour it is forged"],
              ["Your other frogs", "Earn as they are", "Earn 20% to 100% more while you hold it"],
              ["Missions", "One frog per mission, at 1× to 3×", "All three missions at once, at its multiplier"],
              ["The Night Watch", "No seat", "A keeper seat: liquidation bonuses of 16–18%, a bigger share and a smaller cut the rarer it is"],
              ["The Watch Room", "No", "Yes, the private holders' room"],
              ["Company slots", "The frog holder's slots", "+3 to +8 more, up to 13 companies"],
              ["The art", "A NIGHT FROG", "A living Gen 2 card: the rarest trait of each layer from your 10, neon tier glow and an animated identity.md-style signal layer"],
              ["How many", "500", "50 at most, 4 Night Bosses"],
            ].map(([k, a, b]) => <div key={k} className="fg-vs-row" role="row"><b>{k}</b><span>{a}</span><span>{b}</span></div>)}
          </div>
          <p className="st-note">Every frog a forge burns leaves the pot for good, so the frogs and Night Watchers left share it with fewer. #1, the Zero-Sleep Captain, stays above everything as it is: 50× and the Night Watch's Captain's seat. Forged, it becomes something better still: The Captain.</p>
        </section>

        <section id="bench" className="fg-sec" aria-label="Forge bench">
          <div className="fg-head"><span className="fg-kicker">The bench</span><h2>Pick 10, see the Night Watcher, forge</h2></div>
          <ol className="fg-steps">
            <li><b>Pick 10 frogs</b><span>Each brings forge points from its rarity: Common 1, Uncommon 2, Rare 4, Epic 8, Legendary 16. Genesis count at least 4, #2–25 at least 8.</span></li>
            <li><b>Points set the tier</b><span>5 Epic + 5 Common lands higher than 1 Epic + 9 Common, and a higher tier earns more. The preview is exact.</span></li>
            <li><b>Forge</b><span>The 10 go to 0x…dEaD forever; the Night Watcher wears the rarest trait of each layer among them. Put #1 in and The Captain comes out too.</span></li>
          </ol>
          <div className="fg-bench">
            <div className="fg-pick">
              <div className="fg-pick-head">
                <h3>Your frogs</h3>
                {addr && <span className="mono fg-dim">{addr.slice(0, 6)}…{addr.slice(-4)} · {w?.frogs.length ?? 0} frogs</span>}
              </div>
              {!w ? (
                <div className="fg-connect">
                  <button className="nx-btn nx-btn-acc" onClick={() => void connect()}><NxIcon name="wallet" size={18} /> Use my wallet</button>
                  <form onSubmit={(e) => { e.preventDefault(); load(addr.trim()); }}><input className="field mono" placeholder="or paste 0x… a wallet" value={addr} onChange={(e) => setAddr(e.target.value.trim())} /></form>
                </div>
              ) : w.frogs.length === 0 ? (
                <p className="st-empty">No NIGHT FROGS in this wallet. <a href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">Find frogs on OpenSea ↗</a> or try any 10 below.</p>
              ) : (
                <>
                  {w.plan.strongest && (
                    <div className="fg-plans">
                      <button className="fg-plan" onClick={() => setSel(w.plan.strongest!)}>Strongest 10</button>
                      {w.plan.cheapest.map((c) => <button key={c.tier} className="fg-plan" style={tone(tiers[c.tier - 1]?.color)} onClick={() => setSel(c.ids)}>Cheapest {tiers[c.tier - 1]?.name} · {c.points} pts</button>)}
                    </div>
                  )}
                  <div className="fg-grid">
                    {w.frogs.map((f) => (
                      <button key={f.id} className={`fg-frog${sel.includes(f.id) ? " on" : ""}`} style={{ "--rt": RARITY_TONE[f.rarity] } as React.CSSProperties} onClick={() => toggle(f.id)} aria-pressed={sel.includes(f.id)}>
                        <img src={`/api/forge/nf/${f.id}.svg`} alt={`NIGHT FROG #${f.id}`} loading="lazy" width={160} height={160} />
                        <span className="fg-frog-id">#{f.id}</span>
                        <span className="fg-frog-r">{f.rarity} · {f.points} pt{f.points === 1 ? "" : "s"}</span>
                        {sel.includes(f.id) && <i className="fg-frog-n">{sel.indexOf(f.id) + 1}</i>}
                      </button>
                    ))}
                  </div>
                  {w.frogs.length < 10 && <p className="st-empty">You need 10 frogs to forge; this wallet has {w.frogs.length}. <a href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">Find more on OpenSea ↗</a></p>}
                </>
              )}
              <div className="fg-try">
                <label htmlFor="fg-try">Try any 10 frogs</label>
                <div><input id="fg-try" className="field mono" placeholder="e.g. 12 45 103 120 188 250 301 377 420 499" value={tryIds} onChange={(e) => setTryIds(e.target.value)} />
                  <button className="nx-btn" onClick={() => { const ids = parseIds(tryIds); if (ids.length === 10) { setErr(null); setSel(ids); } else setErr("Type 10 different frog numbers from 2 to 500."); }}>Preview</button></div>
              </div>
            </div>

            <aside className="fg-result" style={tone(pv?.tierInfo.color ?? "var(--acc)")}>
              {pv ? (
                <>
                  {pv.captain && (
                    <div className="fg-captain-note">
                      <TiltCard src={`/api/forge/captain.svg?ids=${pv.ids.join(",")}`} alt="The Captain, the one Night Watcher forged from #1" small />
                      <p><b>#1 is in: this forge makes two.</b> The Captain (token #0, the only one there will ever be: 60×, +150% on your other frogs, the Captain's seat in the Night Watch, #1's own look in platinum) and, below, the Night Watcher these 10 make.</p>
                    </div>
                  )}
                  <TiltCard src={artOf(pv.ids)} alt={`Night Watcher preview, Tier ${pv.tierInfo.roman} ${pv.name}`} small />
                  <div className="fg-tier"><span>TIER {pv.tierInfo.roman}</span><b>{pv.name}</b></div>
                  <Meter tiers={tiers} points={pv.points} />
                  <div className="fg-nums">
                    <div><b>{pv.points}</b><span>forge points</span></div>
                    <div><b>{pv.before}→{pv.rate}</b><span>shift hours / hour</span></div>
                    <div><b>{pv.rate}×</b><span>on all 3 missions</span></div>
                    <div><b>{SEATS[pv.tier]!.weight}× · {SEATS[pv.tier]!.cut}%</b><span>Night Watch share · cut</span></div>
                  </div>
                  <p className="fg-dim">These 10 earn {pv.before} shift hours an hour today; the Night Watcher earns {pv.rate}{pv.rate > pv.before ? `, ${(pv.rate / pv.before).toFixed(1)}× as much` : ", the same"}, gets {(pv.rate * 168).toLocaleString("en-US")} hours as its forge bonus, lifts your other frogs by {pv.tierInfo.crew}%, and adds +{pv.tierInfo.slots} company slots and its Night Watch seat.</p>
                  <div className="fg-mix">{Object.entries(pv.mix).filter(([, n]) => n > 0).map(([r, n]) => <span key={r} style={{ "--rt": RARITY_TONE[r] } as React.CSSProperties}>{n} {r}</span>)}</div>
                  {pv.toNext > 0 && <p className="fg-dim">{pv.toNext} more point{pv.toNext === 1 ? "" : "s"} would make it a {tiers[pv.tier]?.name}.</p>}
                  <dl className="fg-traits">{pv.traits.map((t) => <div key={t.layer}><dt>{t.layer}</dt><dd>{t.value}</dd></div>)}</dl>
                  {open ? (
                    mine.size && pv.ids.every((id) => mine.has(id))
                      ? <button className="nx-btn nx-btn-acc fg-go" onClick={() => void forge()} disabled={Boolean(step)}>FORGE · BURN 10 FROGS <span>→</span></button>
                      : <p className="fg-dim">Preview only: forge from the wallet that holds these 10.</p>
                  ) : <p className="fg-soon">Waiting for IMD: the forge opens when the swarm has built, audited and deployed it. This preview is exactly the Night Watcher it will make.</p>}
                  {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
                  {done && <div className="good">Forged. <a href={`https://etherscan.io/tx/${done}`} target="_blank" rel="noreferrer">See the transaction ↗</a> · <a href="/watch">Take your Night Watch seat</a> · <a href="#room">Enter the Watch Room</a></div>}
                </>
              ) : (
                <div className="fg-empty">
                  <div className="fg-slots">{Array.from({ length: 10 }, (_, i) => <i key={i} className={sel[i] ? "on" : ""}>{sel[i] ? `#${sel[i]}` : i + 1}</i>)}</div>
                  <p>{sel.length ? `${10 - sel.length} more to go${w ? ` · ${sum} points so far` : ""}.` : "Pick 10 frogs to see the Night Watcher that comes out."}</p>
                </div>
              )}
              {err && <div className="bad">{err}</div>}
            </aside>
          </div>
        </section>

        <section className="fg-sec">
          <div className="fg-captain" style={tone("#E9E4FF")}>
            <TiltCard src="/api/forge/captain.svg" alt="The Captain" />
            <div>
              <span className="fg-kicker">1 of 1 · token #0</span>
              <h2>The Captain</h2>
              <p>Burn NIGHT FROG #1 with any 9 others and the forge makes two NFTs: the Night Watcher those 10 make by the usual rule, and The Captain, the best NFT in the collection, which can only ever exist once.</p>
              <ul>
                <li><b>60×</b> shift hours, above #1's 50× and every Night Watcher's 40×</li>
                <li><b>+150%</b> on every other frog in the wallet</li>
                <li><b>The Captain's seat</b> in the Night Watch: 4× share, the most turns to mark, 5% cut</li>
                <li><b>#1's own 1-of-1 look</b> with its onchain marks, in a platinum card with every effect, three orbits and its own ID line</li>
                <li>+10 company slots, the Watch Room, and its name onchain</li>
              </ul>
              <p className="fg-dim">Or keep #1 as it is: 50×, +150% on the wallet's other frogs and the Captain's seat. Either way #1 stays the top of the crew.</p>
            </div>
          </div>
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">The ladder</span><h2>Five tiers, from Shift Lead to Night Boss</h2></div>
          <p className="st-note">Shift hours are what the weekly frog pot is shared by, so the multiplier is the share of the NIGHTSHIFT fees a frog takes. A NIGHT FROG earns 1× (2× Genesis, 3× #2–25) however rare it is: the forge is where rarity pays. A Night Watcher never earns less than its 10 frogs did, and #1 stays the top of the crew at 50×.</p>
          <div className="fg-ladder">
            {tiers.map((t, i) => (
              <article key={t.tier} className="fg-rung" style={tone(t.color)}>
                {info && <img src={artOf(info.showcase[i]!)} alt={`Tier ${t.roman} ${t.name}`} loading="lazy" width={400} height={400} />}
                <span className="fg-rung-r">TIER {t.roman}</span>
                <b>{t.name}</b>
                <span className="fg-rung-p">{t.min}{tiers[i + 1] ? `–${tiers[i + 1]!.min - 1}` : "+"} forge points</span>
                <ul>
                  <li><b>{t.x}×</b> shift hours, every hour</li>
                  <li><b>{t.x}×</b> on all 3 missions</li>
                  <li><b>+{t.crew}%</b> on your other frogs</li>
                  <li><b>Night Watch</b> seat: {SEATS[t.tier]!.weight}× share, {SEATS[t.tier]!.cut}% cut</li>
                  <li><b>+{t.slots}</b> company slots</li>
                  <li><b>Watch Room</b> access</li>
                  {t.tier >= 3 && <li><b>Glowing eyes</b> and embers</li>}
                  {t.tier >= 4 && <li><b>Holo</b> sheen, pulsing frame</li>}
                  {t.tier === 5 && <li><b>Crown</b> and its name onchain</li>}
                </ul>
                <span className="fg-rung-n">{info ? `${info.forged.byTier[t.tier] ?? 0} forged${t.tier === 5 ? ` of 4 possible` : ""}` : " "}</span>
              </article>
            ))}
          </div>
          <div className="fg-examples">{EXAMPLES.map(([label, pts]) => { const p = pts.reduce((a, b) => a + b, 0), t = tiers.length ? tierOf(tiers, p) : null; return <div key={label}><span>{label}</span><b>{p} pts</b><i style={{ color: t?.color }}>{t ? `Tier ${t.roman} ${t.name} · ${t.x}×` : ""}</i></div>; })}</div>
        </section>

        <section id="room" className="fg-sec">
          <div className="fg-room">
            <div>
              <span className="fg-kicker">Holders only</span>
              <h2>The Watch Room</h2>
              <p>A private Telegram group for Night Watcher holders: the crew that forged, the Night Watch's calls when a loan goes under, first word on what the station builds next, and the people who run it. Sign in with the wallet that holds your Night Watcher and the bot hands you an invite for one person. Sell your last one and the bot walks you out.</p>
            </div>
            <RoomDoor room={room} session={session} signIn={signIn} busy={busy} />
          </div>
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Forge points</span><h2>What each frog brings</h2></div>
          <div className="fg-rarity">
            {(info?.rarities ?? []).map((r) => <div key={r.rarity} style={{ "--rt": RARITY_TONE[r.rarity] } as React.CSSProperties}><b>{r.points}</b><span>{r.rarity}</span><small>{r.frogs} frogs</small></div>)}
          </div>
          <p className="st-note">Rarity is fixed forever: every frog's traits come from the collection's Chainlink draw, ranked by how few frogs share each trait (#1–25 Legendary, then 50 Epic, 75 Rare, 125 Uncommon, 225 Common). Genesis frogs count at least as a Rare (4) and early Genesis #2–25 at least as an Epic (8), so ten of them always reach the tier that pays what they earned together. The table lives in the contract; anyone can rebuild it from the chain.</p>
        </section>

        {info && info.forged.latest.length > 0 && (
          <section className="fg-sec">
            <div className="fg-head"><span className="fg-kicker">Fresh from the forge</span><h2>The newest Night Watchers</h2></div>
            <div className="fg-gallery">{info.forged.latest.map((f) => <a key={f.n} href={`/api/forge/frog/${f.n}.svg`} target="_blank" rel="noreferrer" style={tone(tiers[f.tier - 1]?.color)}><img src={`/api/forge/frog/${f.n}.svg`} alt={`Night Watcher #${f.n}`} loading="lazy" width={220} height={220} /><span>#{f.n} · {f.name || tiers[f.tier - 1]?.name}</span></a>)}</div>
          </section>
        )}

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Questions</span><h2>The fine print</h2></div>
          <div className="fg-faq">
            <details open><summary>Is there a reveal, or anything to pay for one?</summary><p>No. Nothing is hidden and there is no reveal fee: the tier and the art are fixed by the 10 frogs you burn, this page draws them before you sign, and the contract draws the same Night Watcher onchain the moment you forge.</p></details>
            <details><summary>Where does the {fee} IMD go?</summary><p>Half is burned through IMD's own BurnExecutor; half goes to NIGHTSHIFT, which builds and runs the station. The forge never holds any IMD.</p></details>
            <details><summary>Do I earn less after forging?</summary><p>Never. A Night Watcher earns its tier's multiplier or what its 10 frogs earned together, whichever is more: ten ordinary frogs earn 10 an hour and so does the weakest Night Watcher, ten Genesis earn 20 and forge at least a Supervisor at 20×, and ten Legendary frogs, 13 an hour as they are, become a 40× Night Boss. On top it crews all three missions at its multiplier instead of one at 1×.</p></details>
            <details><summary>Why burn my rarest frogs?</summary><p>Because an ordinary NIGHT FROG earns by its number, not its rarity: a Legendary #300 earns 1×, the same as a Common. Forged, rarity is what counts: it sets the tier, the multiplier (up to 40×), the art, and the Night Watch seat, where a rarer seat takes a bigger share of every liquidation and pays a smaller cut.</p></details>
            <details><summary>What is the crew boost?</summary><p>While a wallet holds a Night Watcher, every other NIGHT FROG in it earns more shift hours: +20% under a Shift Lead, +30% Foreman, +50% Supervisor, +75% Chief, +100% (double) under a Night Boss. The best Night Watcher in the wallet counts, and the holder of #1 gets +150%. So forging 10 frogs makes the frogs you keep earn more.</p></details>
            <details><summary>What is the forge bonus?</summary><p>The hour a new Night Watcher first shows up, the wallet that forged it is credited its first week of shift hours (168 hours at its multiplier): 1,680 for a Shift Lead up to 6,720 for a Night Boss. It counts in the next Monday payout.</p></details>
            <details><summary>What about #1?</summary><p>#1, the Zero-Sleep Captain, is the top of the crew either way. Kept, it earns 50× (more than any Night Watcher), lifts the wallet's other frogs by 150% and holds the Night Watch's Captain's seat, open now, before the first forge. Forged with any 9 others, it makes two NFTs for sure: The Captain, the one 60× Night Watcher with #1's own look (it takes over the Captain's seat), and the Night Watcher those 10 make. #1's 50× is counted once: it lives on in The Captain, so the other Night Watcher's floor counts the other 9.</p></details>
            <details><summary>What is the Night Watch?</summary><p>The keeper crew of imdUSD, IMD's dollar stablecoin. When a loan falls under 170%, a seat marks it; six hours later, if the borrower has not topped up, the seats repay part of its debt with their own imdUSD and receive staked IMD worth 20% more. Each holder runs the bot on their own machine with their own wallet. <Link to="/watch">The Night Watch</Link></p></details>
            <details><summary>What is next for the Night Watch?</summary><p>The plan, not built yet: every Night Watcher an AI agent with its own onchain wallet and money, the whole crew one swarm with a shared treasury, shared rules written onchain and profits shared by seat, an autonomous fund run by its agents. Nothing of it is live or promised; it needs its own contracts, audits and a legal review first. <Link to="/watch">The Night Watch</Link></p></details>
            <details><summary>Why only 4 Night Bosses?</summary><p>A Night Boss needs 128 points: 6 Legendary and 4 Epic frogs, or 8 Legendary. Only 25 Legendary frogs exist, and #1 makes The Captain when it is forged.</p></details>
            <details><summary>Burned means burned?</summary><p>Yes. The NIGHT FROGS contract has no burn function, so the 10 go to 0x…dEaD, where nobody can ever move them. The forge also refuses to give less than the tier you saw.</p></details>
            <details><summary>Do rarer frogs give a better Night Watcher?</summary><p>Yes, always. Rarer frogs bring more forge points, more points mean a higher tier, and a higher tier means a higher multiplier (10× up to 40×), a bigger crew boost, a bigger Night Watch share, a smaller cut and more effects in the art. The preview shows exactly where your 10 land.</p></details>
            <details><summary>Is this an investment?</summary><p>No. Shift hours, missions, slots, the seat and the room are NIGHTSHIFT perks for crew who take part. What a Night Watch seat earns depends on loans going under and on the imdUSD its owner puts in; nothing here is a promise of income.</p></details>
            <details><summary>Who builds it?</summary><p>The IMD swarm: two contracts (the art renderer and the forge), each coded, tested, audited by four agents and deployed by IMD, fully onchain. <Link to="/frogs">About NIGHT FROGS</Link> · <Link to="/command">Missions</Link></p></details>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The card: tilts toward the pointer with a moving glare, like holding a foil card. Still for reduced motion. */
function TiltCard({ src, alt, small }: { src: string | null; alt: string; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`); el.style.setProperty("--ry", `${(x - 0.5) * 16}deg`);
    el.style.setProperty("--gx", `${x * 100}%`); el.style.setProperty("--gy", `${y * 100}%`);
  };
  const leave = () => { const el = ref.current; if (el) { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); } };
  return (
    <div ref={ref} className={`fg-card${small ? " small" : ""}`} onPointerMove={move} onPointerLeave={leave}>
      <div className="fg-card-in">{src ? <img src={src} alt={alt} width={600} height={600} /> : <div className="fg-card-wait" />}<i className="fg-glare" /></div>
    </div>
  );
}

/** The door to the Watch Room: sign in, then one-time invite from the bot. */
function RoomDoor({ room, session, signIn, busy }: { room: Room | null; session: string | null; signIn: () => Promise<void>; busy: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [wait, setWait] = useState(false);
  const ask = async () => {
    setMsg(null); setWait(true);
    try {
      const r = await fetch("/api/forge/room", { method: "POST", credentials: "same-origin" });
      const d = await r.json() as { url?: string; error?: string };
      if (d.url) { setLink(d.url); window.open(d.url, "_blank", "noopener"); } else setMsg(d.error ?? "Try again in a minute.");
    } catch { setMsg("Try again in a minute."); }
    setWait(false);
  };
  return (
    <div className="fg-door">
      <NxIcon name="key" size={30} />
      <b>{room?.on ? `${room.members} inside` : "Opens with the first forge"}</b>
      {!room?.on ? <p className="fg-dim">The room's door opens on the day the forge does.</p>
        : !session ? <button className="nx-btn nx-btn-acc" onClick={() => void signIn()} disabled={busy}>{busy ? "Check your wallet…" : "Sign in to enter"}</button>
        : link ? <a className="nx-btn nx-btn-acc" href={link} target="_blank" rel="noreferrer">Open the bot in Telegram ↗</a>
        : <button className="nx-btn nx-btn-acc" onClick={() => void ask()} disabled={wait}>{wait ? "Checking your Night Watchers…" : "Get my invite"}</button>}
      {link && <p className="fg-dim">The code works once, for 15 minutes.</p>}
      {msg && <div className="bad">{msg}</div>}
    </div>
  );
}

/** Where the points land on the ladder, 10 to 160, with each tier's threshold marked. */
function Meter({ tiers, points }: { tiers: Tier[]; points: number }) {
  const at = (p: number) => `${Math.min(100, ((p - 10) / 150) * 100)}%`;
  return (
    <div className="fg-meter" role="img" aria-label={`${points} forge points of 160`}>
      <i className="fg-meter-fill" style={{ width: at(points) }} />
      {tiers.slice(1).map((t) => <span key={t.tier} className="fg-meter-tick" style={{ left: at(t.min), color: t.color }}><b>{t.roman}</b></span>)}
    </div>
  );
}
