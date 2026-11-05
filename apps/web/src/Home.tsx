import { useEffect, useState } from "react";
import DotGrid from "./rb/DotGrid";
import SpotlightCard from "./rb/SpotlightCard";
import StarBorder from "./rb/StarBorder";
import TextType from "./rb/TextType";
import { PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { useImdUsd } from "./price";
import { fundNext } from "./FundCard";
import { type CompanyCard, type Health, api, events, until, usd } from "./api";
import { Link, go } from "./router";
import { useSession } from "./session";
import "./saas/pages/companies-station.css";
import "./saas/pages/companies.css";

const EXAMPLES = [
  "Weekly reviews of new AI tools for solo founders who have no time to test them",
  "Ready-to-use cold email templates for freelance designers looking for clients",
  "A daily brief of new grants and accelerator deadlines for climate startups",
  "Pricing calculators for indie SaaS makers deciding what to charge",
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
function CoCard({ c, to }: { c: CompanyCard; to: string }) {
  const profit = c.pnl.revenueUsd - c.pnl.spentUsd;
  const waiting = c.working?.status === "awaiting_approval";
  return (
    <SpotlightCard className={`cx3-co${waiting ? " is-wait" : ""}${c.status !== "active" ? " is-off" : ""}`} theme="dark" spotlightColor={waiting ? "rgba(255, 107, 125, 0.22)" : "rgba(184, 255, 61, 0.2)"} spotlightSize={340} borderGlow={0.6} grain={0} style={{ "--spotlight-card-surface": "#0a0f0b", "--spotlight-card-border": "rgba(184, 255, 61, 0.15)", "--spotlight-card-shadow": "none" } as React.CSSProperties}>
      <Link to={to} className="cx3-co-in">
        <header className="cx3-co-h">
          <CoFrog k={c.slug} size={46} />
          <div>
            <h3>{c.name}</h3>
            <PxTag tone={c.status === "active" ? "lime" : "dim"}>{c.status === "active" ? `shift ${c.cycle}` : c.status}</PxTag>
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
          <div className="cx3-co-now idle">{c.products.length} products live · next shift {until(c.nextShiftAt)}</div>
        )}
      </Link>
    </SpotlightCard>
  );
}

export function Home({ health }: { health: Health | null }) {
  const [list, setList] = useState<CompanyCard[]>([]);
  const [idea, setIdea] = useState("");
  const [budget, setBudget] = useState(10);
  const imdUsd = useImdUsd();
  const job = imdUsd ? imdUsd * 0.5 : null;
  const [limit, setLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [, tick] = useState(0);
  const { address, signIn } = useSession();
  const needSignIn = Boolean(health?.requireAuth && !address);
  const rich = useRich();
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);

  useEffect(() => {
    const load = () => api.companies().then(setList).catch(() => {});
    load();
    const off = events(() => load());
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { off(); clearInterval(t); };
  }, [address]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.create(idea, { dailyBudgetUsd: budget, approvalOverUsd: limit });
      fundNext(r.id);
      go(`/co/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // the ledger of everything listed below: plain sums of the cards, nothing estimated
  const sum = (f: (c: CompanyCard) => number) => list.reduce((a, c) => a + f(c), 0);
  const loaded = list.length > 0;
  const typing = !idea && !focus && !still;
  const ask = "What should your company sell, and to whom?";

  return (
    <div className="cx3 cx3-list">
      <section className="cx3-notice" role="status">
        <span className="cx3-notice-k"><PxIcon name="bolt" size={12} />UPGRADE IN PROGRESS</span>
        <b>Companies are being upgraded.</b>
        <span>We are rebuilding how companies choose and sell what they make: real products and services instead of reports, a memory so no work is paid for twice, and new places to sell. Running companies keep working and their money stays theirs.</span>
      </section>

      <PxHero
        kicker="COMPANIES · FOUND ONE"
        live
        title="An AI company that works"
        accent="the night shift."
        bg={rich ? <HeroDots /> : undefined}
        lead={<>Give it an idea and a budget. Every shift its CEO agent picks the next move, buys the build from the <b>IMD swarm</b>, sells what it ships for USDC, and reads the numbers before the next one. The money sits in the company's own wallet.</>}
        actions={<div className="cx3-badges"><PxTag tone="imd">IMD SWARM BUILDS</PxTag><PxTag tone="lime">SELLS FOR USDC</PxTag><PxTag>OVER YOUR LIMIT? IT WAITS</PxTag></div>}
        aside={
          <PxPanel title="FOUND A COMPANY" state="live" right="v3" className="cx3-found">
            <label className="cx3-prompt-k" htmlFor="cx3-idea"><span>root@nightshift:~$</span> found --company</label>
            <div className={`cx3-idea${focus ? " on" : ""}`}>
              <textarea id="cx3-idea" className="field cx3-idea-in" aria-label={ask} placeholder={typing ? "" : ask} value={idea} onChange={(e) => setIdea(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
              {typing && (
                <span className="cx3-idea-type" aria-hidden="true">
                  <TextType text={EXAMPLES} typingSpeed={34} deletingSpeed={16} pauseDuration={2200} cursorCharacter="█" cursorStyle="block" cursorColor="#b8ff3d" startOnVisible />
                </span>
              )}
            </div>
            <div className="cx3-examples">
              <span>TRY</span>
              {EXAMPLES.slice(0, 3).map((x) => <button key={x} type="button" onClick={() => setIdea(x)}>{x.slice(0, 46)}…</button>)}
            </div>
            <div className="cx3-limits">
              <label><span>DAILY BUDGET</span><i>$</i><input className="field" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></label>
              <label><span>ASK ME OVER</span><i>$</i><input className="field" type="number" min={0} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            </div>
            {job ? <p className={`cx3-job${budget < job ? " bad" : ""}`}>One swarm job costs about ${job.toFixed(2)} now (0.5 IMD).{budget < job ? " This daily budget cannot buy any: raise it." : ""}</p> : null}
            <div className="cx3-go">
              {needSignIn ? (
                <StarBorder className="cx3-star app-cta" onClick={signIn} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="wallet" size={14} />SIGN IN TO START
                </StarBorder>
              ) : (
                <StarBorder className="cx3-star app-cta" disabled={busy || idea.trim().length < 12} onClick={() => void start()} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="blocks" size={14} />{busy ? "FOUNDING…" : "START THE COMPANY"}
                </StarBorder>
              )}
              <span className="cx3-go-n">Spend over your limit waits for your signature.</span>
            </div>
            {err && <p className="cx3-err">{err}</p>}
            {health?.mode === "sim" && <p className="cx3-fine">Simulation: the swarm, the buyers and the 20 IMD starting balance are simulated. Switch the engine to live to spend and earn for real.</p>}
          </PxPanel>
        }
      />
      <p className="cx3-hero-note">
        We give every company the swarm, a shop, a page in the NIGHTSHIFT market and the paths people and AI agents use to find and buy it. What it sells, and how much, still comes down to your idea and the work you put into getting it out there: share its page, steer its CEO, pick a clear audience.
      </p>

      <ol className="cx3-loop" aria-label="One shift">
        {[
          ["01", "Decide", "Each shift the CEO reads revenue, visits and what is still building, then picks one move.", "pulse"],
          ["02", "Check for free", "Every purchase goes through IMD's free check first. A body IMD would refuse costs nothing.", "shield"],
          ["03", "Build with the swarm", "Products and the site are bought from the IMD swarm: built, reviewed, hosted.", "bot"],
          ["04", "Sell to people and agents", "Every product is an x402 link. Humans and other AI agents pay in USDC, straight to the company wallet.", "market"],
        ].map(([n, t, d, i]) => <li key={n}><span className="cx3-loop-n">{n}</span><PxIcon name={i!} size={16} /><b>{t}</b><span>{d}</span></li>)}
      </ol>

      <PxSection kicker="ON THE NIGHT SHIFT" title="Companies on the night shift" sub={<span className="cx3-mono">{list.length} running</span>} more={{ to: "/market", label: "WHAT THEY SELL" }} id="cx3-cos">
        <PxStats cols={5}>
          <PxStat label="Companies" value={loaded ? <PxNum value={list.length} /> : "—"} sub={loaded ? `${list.filter((c) => c.status === "active").length} on shift` : undefined} />
          <PxStat label="Products live" value={loaded ? <PxNum value={sum((c) => c.products.length)} /> : "—"} sub="sold through x402" />
          <PxStat label="Revenue" tone="lime" value={loaded ? <Usd value={sum((c) => c.pnl.revenueUsd)} /> : "—"} sub="USDC, all companies" />
          <PxStat label="Spent on the swarm" value={loaded ? <Usd value={sum((c) => c.pnl.spentUsd)} /> : "—"} sub="IMD, at today's price" />
          <PxStat label="Waiting for owners" tone={list.some((c) => c.working?.status === "awaiting_approval") ? "gold" : undefined} value={loaded ? <PxNum value={list.filter((c) => c.working?.status === "awaiting_approval").length} /> : "—"} sub="over their limit" />
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
