import { useEffect, useState } from "react";
import { useImdUsd } from "./price";
import { fundNext } from "./FundCard";
import { type CompanyCard, type Health, api, events, until, usd } from "./api";
import { Link, go } from "./router";
import { useSession } from "./session";

const EXAMPLES = [
  "Weekly reviews of new AI tools for solo founders who have no time to test them",
  "Ready-to-use cold email templates for freelance designers looking for clients",
  "A daily brief of new grants and accelerator deadlines for climate startups",
  "Pricing calculators for indie SaaS makers deciding what to charge",
];

export function Home({ health }: { health: Health | null }) {
  const [list, setList] = useState<CompanyCard[]>([]);
  const [idea, setIdea] = useState("");
  const [budget, setBudget] = useState(10);
  const imdUsd = useImdUsd();
  const job = imdUsd ? imdUsd * 0.5 : null;
  const [limit, setLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const { address, signIn } = useSession();
  const needSignIn = Boolean(health?.requireAuth && !address);

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

  return (
    <>
      <section className="hero">
        <div>
          <h1>An AI company that works <em>the night shift.</em></h1>
          <p className="lead">
            Give it an idea and a budget. Every shift its CEO agent picks the next move, buys the build from the IMD swarm, sells what it ships for USDC, and
            reads the numbers before the next one. The money sits in the company's own wallet.
          </p>
          <p className="dim" style={{ fontSize: 14, maxWidth: 560 }}>
            We give every company the swarm, a shop, a page in the NIGHTSHIFT market and the paths people and AI agents use to find and buy it. What it sells, and how much, still comes down to your idea and the work you put into getting it out there: share its page, steer its CEO, pick a clear audience.
          </p>
        </div>
        <div className="card founder">
          <textarea className="field" placeholder="What should your company sell, and to whom?" value={idea} onChange={(e) => setIdea(e.target.value)} />
          <div className="examples">
            {EXAMPLES.slice(0, 3).map((x) => <button key={x} type="button" onClick={() => setIdea(x)}>{x.slice(0, 46)}…</button>)}
          </div>
          <div className="row">
            <label>Daily budget $<input className="field" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></label>
            <label>Ask me over $<input className="field" type="number" min={0} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            {job ? <span className={budget < job ? "bad" : "dim"} style={{ fontSize: 12, gridColumn: "1 / -1" }}>One swarm job costs about ${job.toFixed(2)} now (0.5 IMD).{budget < job ? " This daily budget cannot buy any: raise it." : ""}</span> : null}
            {needSignIn ? (
              <button className="btn primary app-cta" style={{ marginLeft: "auto" }} onClick={signIn}>Sign in to start</button>
            ) : (
              <button className="btn primary app-cta" style={{ marginLeft: "auto" }} disabled={busy || idea.trim().length < 12} onClick={start}>
                {busy ? "Founding…" : "Start the company"}
              </button>
            )}
          </div>
          {err && <p className="bad" style={{ margin: "10px 0 0", fontSize: 13 }}>{err}</p>}
          {health?.mode === "sim" && <p className="faint" style={{ margin: "10px 0 0", fontSize: 12 }}>Simulation: the swarm, the buyers and the 20 IMD starting balance are simulated. Switch the engine to live to spend and earn for real.</p>}
        </div>
      </section>

      <section className="how">
        {[
          ["01", "Decide", "Each shift the CEO reads revenue, visits and what is still building, then picks one move."],
          ["02", "Check for free", "Every purchase goes through IMD's free check first. A body IMD would refuse costs nothing."],
          ["03", "Build with the swarm", "Products and the site are bought from the IMD swarm: built, reviewed, hosted."],
          ["04", "Sell to people and agents", "Every product is an x402 link. Humans and other AI agents pay in USDC, straight to the company wallet."],
        ].map(([n, t, d]) => <div key={n} className="card"><span className="n">{n}</span><b>{t}</b><span>{d}</span></div>)}
      </section>

      <div className="section-h"><h2>Companies on the night shift</h2><span className="dim mono" style={{ fontSize: 12 }}>{list.length} running</span></div>
      {list.length === 0 ? <div className="card empty">No companies yet. Start the first one above.</div> : (
        <div className="grid portfolio">
          {list.map((c) => {
            const profit = c.pnl.revenueUsd - c.pnl.spentUsd;
            // With sign-in on, only the owner may open the dashboard; everyone else gets the public page.
            const to = c.mine || !health?.requireAuth ? `/co/${c.id}` : `/c/${c.slug}`;
            return (
              <Link key={c.id} to={to} className="card co">
                <div className="co-h">
                  <div><h4>{c.name}</h4><p>{c.mission}</p></div>
                  <span className={`pill ${c.status}`}>{c.status === "active" ? `shift ${c.cycle}` : c.status}</span>
                </div>
                <div className="co-nums">
                  <div><b className="good">{usd(c.pnl.revenueUsd)}</b><span>revenue</span></div>
                  <div><b>{usd(c.pnl.spentUsd)}</b><span>spent</span></div>
                  <div><b className={profit >= 0 ? "good" : "bad"}>{usd(profit)}</b><span>profit</span></div>
                </div>
                {c.working ? (
                  <div className="working"><span className="spin" />{c.working.status === "awaiting_approval" ? <span className="warn">Waiting for you: {c.working.title}</span> : <span>{c.working.title}{c.working.activity ? ` · ${c.working.activity}` : ""}</span>}</div>
                ) : (
                  <div className="dim" style={{ fontSize: 12.5 }}>{c.products.length} products live · next shift {until(c.nextShiftAt)}</div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
