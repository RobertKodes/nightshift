import { useEffect, useState } from "react";
import DotGrid from "./rb/DotGrid";
import SpotlightCard from "./rb/SpotlightCard";
import StarBorder from "./rb/StarBorder";
import TextType from "./rb/TextType";
import { PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { type CompanyCard, type Health, api, events, until, usd } from "./api";
import { type CardV2, v2 } from "./CompanyPage.api";
import { Link, go } from "./router";
import { useSession } from "./session";
import "./saas/pages/companies-station.css";
import "./saas/pages/companies.css";
import "./CompanyPage.v2.css";

/** Ideas a company can start on at once, with what it makes in-house on free shifts. */
const EXAMPLES = [
  "Résumé rewrites for nurses moving from hospital wards to clinic jobs",
  "Business name and slogan packs for people opening a home bakery",
  "30-day Instagram content calendars for independent yoga teachers",
  "Checklist packs for first-time landlords renting out one flat",
];

// ---------------------------------------------------------------- shared by the companies pages

/** The NIGHT FROG art on the station: each company wears one, picked from its slug, always the same. */
const FROGS = [1, 2, 77, 78, 79, 80, 81, 82, 83, 84, 112, 113, 131, 187, 224, 500];
export function frogFor(key: string): string {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `/frogs/frog-${String(FROGS[h % FROGS.length]).padStart(3, "0")}.webp`;
}
/** A company's frog avatar: decoration, never data. */
export function CoFrog({ k, size = 44, className = "" }: { k: string; size?: number; className?: string }) {
  return <img className={`cx3-frog ${className}`} src={frogFor(k)} alt="" aria-hidden="true" width={size} height={size} loading="lazy" draggable={false} />;
}

/** Heavy effects are decoration: wide screens only, never with reduced motion or the lite mode. */
export function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

/** A dollar amount that counts up, in the same words as usd(): "−$3.19", "$12.00". A dash while missing. */
export function Usd({ value, decimals = 2 }: { value: number | null | undefined; decimals?: number }) {
  if (value == null || !Number.isFinite(value)) return <>—</>;
  return <>{value < 0 ? "−" : ""}<PxNum value={Math.abs(value)} decimals={decimals} prefix="$" /></>;
}

/** The lime dot grid behind a hero, desktop only. */
export function HeroDots({ color = "#b8ff3d", base = "#16261a" }: { color?: string; base?: string }) {
  return <DotGrid dotSize={2} gap={20} baseColor={base} activeColor={color} proximity={110} shockRadius={160} shockStrength={3} shape="square" glow={0.25} clickShock={false} />;
}

// ---------------------------------------------------------------- /companies and /launch

/** One company's row on the night shift: its frog, what it sells, its money, and what it is doing now. */
function CoCard({ c, to }: { c: CardV2; to: string }) {
  const profit = c.pnl.revenueUsd - c.pnl.spentUsd;
  const waiting = c.working?.status === "awaiting_approval";
  return (
    <SpotlightCard className={`cx3-co${waiting ? " is-wait" : ""}${c.status !== "active" ? " is-off" : ""}`} theme="dark" spotlightColor={waiting ? "rgba(255, 107, 125, 0.22)" : "rgba(184, 255, 61, 0.2)"} spotlightSize={340} borderGlow={0.6} grain={0} style={{ "--spotlight-card-surface": "#0a0f0b", "--spotlight-card-border": "rgba(184, 255, 61, 0.15)", "--spotlight-card-shadow": "none" } as React.CSSProperties}>
      <Link to={to} className="cx3-co-in">
        <header className="cx3-co-h">
          <CoFrog k={c.slug} size={46} />
          <div>
            <h3>{c.name}</h3>
            <PxTag tone={c.hidden ? "red" : c.status === "active" ? "lime" : "dim"}>{c.hidden ? "hidden" : c.status === "active" ? `shift ${c.cycle}` : c.status}</PxTag>
            {c.plan === "free" && !c.hidden && <PxTag>free shifts</PxTag>}
          </div>
          <PxIcon name="arrow" size={14} className="cx3-co-go" />
        </header>
        <p className="cx3-co-m">{c.mission}</p>
        <dl className="cx3-co-nums">
          <div><dt>REVENUE</dt><dd className="lime">{usd(c.pnl.revenueUsd)}</dd></div>
          <div><dt>SPENT</dt><dd>{usd(c.pnl.spentUsd)}</dd></div>
          <div><dt>PROFIT</dt><dd className={profit >= 0 ? "lime" : "red"}>{usd(profit)}</dd></div>
        </dl>
        {c.working ? (
          <div className={`cx3-co-now${waiting ? " wait" : ""}`}><span className="cx3-spin" aria-hidden="true" />{waiting ? <span>Waiting for you: {c.working.title}</span> : <span>{c.working.title}{c.working.activity ? ` · ${c.working.activity}` : ""}</span>}</div>
        ) : (
          <div className="cx3-co-now idle">{c.products.length} product{c.products.length === 1 ? "" : "s"} live{c.status === "active" && c.nextShiftAt ? ` · next shift ${until(c.nextShiftAt)}` : ""}</div>
        )}
      </Link>
    </SpotlightCard>
  );
}

export function Home({ health }: { health: Health | null }) {
  const [list, setList] = useState<CardV2[]>([]);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [, tick] = useState(0);
  const { address, signIn } = useSession();
  const needSignIn = Boolean(health?.requireAuth && !address);
  const rich = useRich();
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);

  useEffect(() => {
    const load = () => api.companies().then((l) => setList(l as CardV2[])).catch(() => {});
    load();
    const off = events(() => load());
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { off(); clearInterval(t); };
  }, [address]);

  /** "Surprise me": the engine invents a sensible idea (its own list answers when the free model is busy). It lands in the box, to read and change. */
  async function surprise() {
    setRolling(true);
    setErr(null);
    try { setIdea((await v2.surprise()).idea); } catch (e) { setErr((e as Error).message); } finally { setRolling(false); }
  }

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      // no funding step: the company is founded and its first free shift is already running when its page opens
      const r = await v2.found(idea);
      go(`/co/${r.id}?new=1`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // the ledger of everything listed below: plain sums of the cards, nothing estimated
  const sum = (f: (c: CompanyCard) => number) => list.reduce((a, c) => a + f(c), 0);
  const loaded = list.length > 0;
  const typing = !idea && !focus && !still && !rolling;
  const ask = "What should your company sell, and to whom?";
  const freeShifts = (health as (Health & { free?: { shifts: number } }) | null)?.free?.shifts ?? 3;

  return (
    <div className="cx3 cx3-list">
      <PxHero
        kicker="COMPANIES · FOUND ONE IN TWO MINUTES"
        live
        title="An AI company that works"
        accent="the night shift."
        bg={rich ? <HeroDots /> : undefined}
        lead={<>Describe an idea, or let the CEO surprise you. The company starts working <b>at once, with nothing to fund</b>: on {freeShifts} free shifts its CEO makes finished digital goods in-house, opens a shop, and sells them at $2 to $5 to people and AI agents for USDC. Fund it later to hire the <b>IMD swarm</b>.</>}
        actions={<div className="cx3-badges"><PxTag tone="lime">{freeShifts} FREE SHIFTS</PxTag><PxTag tone="imd">NO FUNDING TO START</PxTag><PxTag>NOTHING PUBLIC OR PAID WITHOUT YOU</PxTag></div>}
        aside={
          <PxPanel title="FOUND A COMPANY" state="live" right="free" className="cx3-found">
            <label className="cx3-prompt-k" htmlFor="cx3-idea"><span>root@nightshift:~$</span> found --company</label>
            <div className={`cx3-idea${focus ? " on" : ""}`}>
              <textarea id="cx3-idea" className="field cx3-idea-in" aria-label={ask} placeholder={typing ? "" : rolling ? "Thinking of an idea…" : ask} value={idea} maxLength={1000} onChange={(e) => setIdea(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
              {typing && (
                <span className="cx3-idea-type" aria-hidden="true">
                  <TextType text={EXAMPLES} typingSpeed={34} deletingSpeed={16} pauseDuration={2200} cursorCharacter="█" cursorStyle="block" cursorColor="#b8ff3d" startOnVisible />
                </span>
              )}
            </div>
            <div className="cx3-examples">
              <button type="button" className="cv2-surprise" disabled={rolling || busy} onClick={() => void surprise()}><PxIcon name="bolt" size={12} />{rolling ? "Thinking…" : idea ? "Surprise me again" : "Surprise me"}</button>
              <span>OR TRY</span>
              {EXAMPLES.slice(0, 2).map((x) => <button key={x} type="button" onClick={() => setIdea(x)}>{x.slice(0, 44)}…</button>)}
            </div>
            <ul className="cv2-promise">
              <li><b>Free to start.</b> No IMD, no ETH, no card. {freeShifts} free shifts run at once, on free models and the in-house studio.</li>
              <li><b>You stay in charge.</b> Nothing is posted and nothing is paid without your yes. No messages are ever sent to strangers.</li>
              <li><b>No lock-in.</b> Export everything or close the company in one click, any time.</li>
            </ul>
            <div className="cx3-go">
              {needSignIn ? (
                <StarBorder className="cx3-star app-cta" onClick={signIn} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="wallet" size={14} />SIGN IN TO START
                </StarBorder>
              ) : (
                <StarBorder className="cx3-star app-cta" disabled={busy || rolling || idea.trim().length < 12} onClick={() => void start()} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="blocks" size={14} />{busy ? "FOUNDING…" : "START THE COMPANY"}
                </StarBorder>
              )}
              <span className="cx3-go-n">{needSignIn ? "Signing in is a wallet signature: no transaction, no cost." : "Its first shift starts the moment you press."}</span>
            </div>
            {err && <p className="cx3-err" role="alert">{err}</p>}
            {health?.mode === "sim" && <p className="cx3-fine">Simulation: buyers and money are simulated. Switch the engine to live to earn for real.</p>}
          </PxPanel>
        }
      />
      <p className="cx3-hero-note">
        Every company gets a shop, a place in the NIGHTSHIFT market and the paths people and AI agents use to find and buy from it. What it sells, and how much, still comes down to your idea and to the first people who see it: share its shop link, steer its CEO, pick a clear audience. Sales shown here are counted from the ledger; no review or number is ever invented.
      </p>

      <ol className="cx3-loop" aria-label="How a company works">
        {[
          ["01", "Found it", "One sentence, or Surprise me. The idea is checked (legal, safe for work, honest), named, and the company exists.", "blocks"],
          ["02", "Free shifts", "The CEO makes products in-house at once: files made for each buyer, PDF packs, planners. No order, no gas.", "bolt"],
          ["03", "It asks, you decide", "Posts and purchases wait for your yes. When it is stuck it asks you one concrete thing instead of guessing.", "shield"],
          ["04", "Sell to people and agents", "Every product is an x402 link in its shop and the market. USDC goes straight to the company wallet.", "market"],
        ].map(([n, t, d, i]) => <li key={n}><span className="cx3-loop-n">{n}</span><PxIcon name={i!} size={16} /><b>{t}</b><span>{d}</span></li>)}
      </ol>

      <PxSection kicker="ON THE NIGHT SHIFT" title="Companies on the night shift" sub={<span className="cx3-mono">{list.length} running</span>} more={{ to: "/market", label: "WHAT THEY SELL" }} id="cx3-cos">
        <PxStats cols={5}>
          <PxStat label="Companies" value={loaded ? <PxNum value={list.length} /> : "—"} sub={loaded ? `${list.filter((c) => c.status === "active").length} on shift` : undefined} />
          <PxStat label="Products live" value={loaded ? <PxNum value={sum((c) => c.products.length)} /> : "—"} sub="sold through x402" />
          <PxStat label="Revenue" tone="lime" value={loaded ? <Usd value={sum((c) => c.pnl.revenueUsd)} /> : "—"} sub="USDC, all companies" />
          <PxStat label="Spent on the swarm" value={loaded ? <Usd value={sum((c) => c.pnl.spentUsd)} /> : "—"} sub="IMD, at today's price" />
          <PxStat label="Waiting for owners" tone={list.some((c) => c.working?.status === "awaiting_approval") ? "gold" : undefined} value={loaded ? <PxNum value={list.filter((c) => c.working?.status === "awaiting_approval").length} /> : "—"} sub="a yes or a no" />
        </PxStats>
        {list.length === 0 ? (
          <div className="cx3-empty"><img src="/brand/pepe-operator.svg" alt="" width={40} height={40} /><span>No companies yet. Start the first one above.</span></div>
        ) : (
          <div className="cx3-grid">
            {list.map((c) => {
              // With sign-in on, only the owner may open the dashboard; everyone else gets the public page.
              const to = c.mine || !health?.requireAuth ? `/co/${c.id}` : `/c/${c.slug}`;
              return <CoCard key={c.id} c={c} to={to} />;
            })}
          </div>
        )}
      </PxSection>
    </div>
  );
}
