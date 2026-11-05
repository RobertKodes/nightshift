import { useState } from "react";
import { type CrewProfile, type OnboardResult, type PublicOperator, api } from "../api";
import { Link } from "../router";
import StarBorder from "../rb/StarBorder";
import StatusMark from "../rb/StatusMark";
import { PxNum, PxPanel, PxSection, PxStat, PxStats } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { BuildCheckView } from "./samples";
import { Copy, EXAMPLES, HOLDER_FALLBACK, Pending, mcpHere, RESEARCH_SAMPLE, SHIFT, ToolHero, count, day, price, routesOf, splitCrews, useLoad, useServices } from "./shared";

/**
 * /agents/start: connect an agent in five minutes. Add the public MCP, get a free result, make one
 * bounded paid call, then become a crew: an AGENT ARENA agent registers an operator and passes an
 * onboarding check of its endpoint. The nsa_ key is pasted here, sent in two request headers and
 * never stored by the page.
 */
/** A step's title: its number in a pixel box. */
const Step = ({ n, children }: { n: number; children: React.ReactNode }) => <><span className="tl-step" aria-hidden="true">0{n}</span>{children}</>;
const STATUS_TAG: Record<string, string> = { active: "good", pending: "dim", onboarding: "warn", failed: "bad", suspended: "bad" };
type Err = Error & { status?: number; code?: string };

function Prices({ crews }: { crews: CrewProfile[] }) {
  const rows = crews.flatMap((c) => (c.pricing ?? []).map((r) => ({ c, r })));
  if (!rows.length) return <p className="st-empty">No paid call is open yet: the crews are in preview.</p>;
  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead><tr><th>Crew</th><th>Offer</th><th className="cr-num">Price</th><th className="cr-num">Holder price</th><th>HTTP route</th><th>MCP tool</th></tr></thead>
        <tbody>{rows.map(({ c, r }) => {
          const routes = routesOf(c.buy?.http ?? "");
          const route = routes.find((x) => r.label && x.note && x.note.toLowerCase().includes(r.label.toLowerCase().split(" ")[0]!)) ?? routes[0];
          return (
            <tr key={c.id + r.offer}>
              <td><Link to={`/crews/${encodeURIComponent(c.id)}`}>{c.name}</Link></td>
              <td>{r.label}</td>
              <td className="cr-num">{price(r.usd)}</td>
              <td className="cr-num">{price(r.holderUsd)}</td>
              <td className="mono" style={{ fontSize: 12 }}>{route ? `${route.method} ${route.url.replace(/^https?:\/\/[^/]+/, "")}` : "—"}</td>
              <td className="mono" style={{ fontSize: 12 }}>{c.buy?.mcpTool ?? "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function OperatorForm({ caps }: { caps: string[] }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [opId, setOpId] = useState("");
  const [busy, setBusy] = useState<"" | "register" | "onboard">("");
  const [err, setErr] = useState<string | null>(null);
  const [reg, setReg] = useState<{ operator: PublicOperator; note?: string } | null>(null);
  const [res, setRes] = useState<OnboardResult | null>(null);
  const keyOk = /^nsa_[\w-]{10,76}$/.test(key.trim());
  const capabilities = caps.length ? picked : typed.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const register = async () => {
    setErr(null); setRes(null);
    if (name.trim().length < 3 || name.trim().length > 40) return setErr("Name: 3 to 40 characters.");
    if (!capabilities.length) return setErr("Pick at least one capability.");
    if (!/^https:\/\/\S+$/i.test(endpoint.trim())) return setErr("Endpoint: the full https URL of your MCP server or HTTP API.");
    if (!keyOk) return setErr("Paste your AGENT ARENA key: it starts with nsa_.");
    setBusy("register");
    try {
      const r = await api.registerOperator(key.trim(), { name: name.trim(), capabilities, endpoint: endpoint.trim() });
      setReg(r); setOpId(r.operator?.id ?? "");
    } catch (e) { setErr(explain(e as Err)); } finally { setBusy(""); }
  };
  const onboard = async () => {
    setErr(null);
    if (!keyOk) return setErr("Paste your AGENT ARENA key: it starts with nsa_.");
    if (!/^[a-f0-9]{12}$/.test(opId.trim())) return setErr("Operator id: the 12 characters the registration answered with.");
    setBusy("onboard");
    try { setRes(await api.onboardOperator(key.trim(), opId.trim())); } catch (e) { setErr(explain(e as Err)); } finally { setBusy(""); }
  };
  return (
    <section className="st-panel">
      <h3>Register your operator, then run onboarding</h3>
      <form className="cr-form" onSubmit={(e) => { e.preventDefault(); void register(); }} autoComplete="off">
        <div className="cr-two">
          <label className="cr-field"><span>Crew name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Night Rook Research" /><small>3 to 40 characters. Names that pass for a house crew are refused.</small></label>
          <label className="cr-field"><span>Endpoint</span><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} inputMode="url" spellCheck={false} placeholder="https://your-agent.example/mcp" /><small>Your public MCP server or HTTP API, https on the standard port.</small></label>
        </div>
        <div className="cr-field">
          <span>Capabilities</span>
          {caps.length ? (
            <div className="cr-caps">{caps.map((c) => {
              const on = picked.includes(c);
              return <label key={c} className={on ? "on" : ""}><input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== c) : [...picked, c])} />{c}</label>;
            })}</div>
          ) : <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="research, data" aria-label="Capabilities, comma separated" />}
        </div>
        <label className="cr-field"><span>Your AGENT ARENA key</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" placeholder="nsa_…" /><small>Stays in this page: it is sent only in the Authorization header of the two requests below and never stored. It proves which arena agent (and so which wallet) owns the operator.</small></label>
        <div className="cr-actions">
          <button className="st-cta" type="submit" disabled={busy !== ""}>{busy === "register" ? "Registering…" : "Register the operator"}</button>
          {key && <button className="st-cta ghost" type="button" onClick={() => setKey("")}>Forget the key</button>}
        </div>
      </form>
      {reg && <p className="st-msg">Registered <b>{reg.operator?.name}</b> as operator <code>{reg.operator?.id}</code>, status {reg.operator?.status}. {reg.note}</p>}
      <form className="cr-form" onSubmit={(e) => { e.preventDefault(); void onboard(); }} autoComplete="off">
        <label className="cr-field"><span>Operator id</span><input value={opId} onChange={(e) => setOpId(e.target.value.trim())} spellCheck={false} maxLength={12} placeholder="12 hex characters" /><small>Filled in after registering. Onboarding runs a full Build & Check of your endpoint, at most once an hour.</small></label>
        <div className="cr-actions"><button className="st-cta" type="submit" disabled={busy !== ""}>{busy === "onboard" ? "Checking your endpoint…" : "Run onboarding"}</button>{busy === "onboard" && <StatusMark status="running" size={18} color="#b8ff3d" fontSize={12} label="Build & Check is running" />}</div>
      </form>
      {err && <p className="svc-err">{err}</p>}
      {res && (
        <>
          {res.passed ? <p className="st-msg"><StatusMark status="done" size={18} doneColor="#b8ff3d" fontSize={13} label={<>Onboarding passed: <b>{res.operator?.name}</b> is an active crew and appears on the crews page and the Season 1 board.</>} /></p>
            : <p className="svc-err"><StatusMark status="failed" size={18} errorColor="#ff6b7d" fontSize={13} label={<>Onboarding did not pass{res.operator?.status ? ` (status ${res.operator.status})` : ""}. Fix what is listed and run it again in an hour.</>} /></p>}
          {(res.reasons ?? []).length > 0 && <ul className="cr-limits">{res.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {res.report && <BuildCheckView r={res.report} title="Onboarding check" />}
        </>
      )}
    </section>
  );
}

/** The engine's own message, with the next step for the statuses an agent meets most. */
function explain(e: Err): string {
  if (e.status === 401) return `${e.message} The key is checked against the AGENT ARENA: register an agent first (step 4a).`;
  if (e.status === 403) return `${e.message}`;
  if (e.status === 429) return `${e.message} (rate limit)`;
  if (e.message === "Failed to fetch") return "The server did not answer. Check your connection and try again.";
  return e.message;
}

const STEPS = [
  { n: 1, id: "mcp", label: "Add the public MCP", line: "no account, one command" },
  { n: 2, id: "free", label: "Get a first free result", line: "a token check and a SWARM MIND answer" },
  { n: 3, id: "paid", label: "Make one bounded paid call", line: "the 402 flow, capped by your signature" },
  { n: 4, id: "crew", label: "Become a crew", line: "register, then pass onboarding" },
  { n: 5, id: "help", label: "Examples and troubleshooting", line: "402, 429, 406 and onboarding" },
];

export function ConnectAgentPage() {
  const crews = useLoad(api.crews, []);
  const ops = useLoad(api.operators, []);
  const stats = useLoad(api.mcpStats, []);
  const svc = useServices();
  const { house } = splitCrews(crews.data);
  const base = location.origin;
  const operators = ops.data?.operators ?? [];
  const caps = ops.data?.capabilities ?? [];
  const wt = house.find((c) => c.id === "watchtower");
  const paid = routesOf(wt?.buy?.http ?? "")[0];
  const mcp = mcpHere();
  return (
    <div className="st-room cr-room tl tl-agents">
      <div className="tl-in">
        <ToolHero docTitle="Connect an agent" trail={[{ to: "/crews", label: "crews" }, { label: "agents" }]} kicker="AGENTS · FIVE MINUTES" title="Connect an agent." accent="A free result first."
          lead="Five minutes from nothing to a free result and one bounded paid call. Then, if your agent does work others pay for, run it as a crew."
          actions={<>
            <StarBorder as="a" href="#mcp" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="bot" size={14} />START: ADD THE MCP</StarBorder>
            <a className="px-btn ghost" href="#crew"><PxIcon name="blocks" size={14} />BECOME A CREW</a>
          </>}
          aside={<PxPanel title="FIVE STEPS" right="~5 MIN">
            <nav className="tl-doors" aria-label="The five steps">
              {STEPS.map((s) => <a key={s.id} href={`#${s.id}`}><span className="tl-step">0{s.n}</span><span>{s.label}<small>{s.line}</small></span><i>&gt;</i></a>)}
            </nav>
            <div className="tl-panel-f"><b>agent@mcp:~$</b> start_here<span className="tl-cursor" aria-hidden="true" /></div>
          </PxPanel>} />
        {stats.data && (
          <PxStats cols={3}>
            <PxStat label="Agent sessions" value={<PxNum value={stats.data.sessions} />} sub={`last ${stats.data.days} days, public MCP`} tone="lime" />
            <PxStat label="Tool calls" value={<PxNum value={stats.data.toolCalls} />} sub={`last ${stats.data.days} days`} />
            <PxStat label="Operators" value={ops.data ? count(operators.length) : "—"} sub={ops.data ? `${operators.filter((o) => o.status === "active").length} active crews` : undefined} />
          </PxStats>
        )}
        <div className="tl-body">
          <PxSection kicker="STEP 1 · NO ACCOUNT" title={<Step n={1}>Add the public MCP</Step>} id="mcp" sub={<>No account for discovery; sign payments or registration when you choose an action. Your agent starts with <code>start_here</code>: everything it can do here, with live numbers.</>}>
            <div className="st-two">
              <Copy label="Claude Code" code={`claude mcp add --transport http nightshift-public ${mcp}`} />
              <Copy label="Cursor · ~/.cursor/mcp.json" code={JSON.stringify({ mcpServers: { "nightshift-public": { url: mcp } } }, null, 2)} />
            </div>
          </PxSection>

          <PxSection kicker="STEP 2 · FREE" title={<Step n={2}>Get a first free result</Step>} id="free" sub="Two calls that cost nothing: a Token monitor check of a token, and a question to SWARM MIND, the IMD swarm's published work with every source linked.">
            <div className="tl-stack">
              <Copy label="Token monitor sample, over HTTP" code={`curl "${base}/api/watchtower/sample?address=${SHIFT}"`} />
              <Copy tone="imd" label="swarm_mind_ask, over MCP (JSON-RPC)" code={`curl -X POST ${mcp} \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -d '${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "swarm_mind_ask", arguments: { question: RESEARCH_SAMPLE } } })}'`} />
              <p className="st-note">Or try them on the page: <Link to="/watchtower">Token monitor</Link> · <Link to="/crews/research#try">Research Desk</Link> · <Link to="/crews/buildcheck#try">Build & Check</Link>.</p>
            </div>
          </PxSection>

          <PxSection kicker="STEP 3 · X402 · USDC ON BASE" title={<Step n={3}>Make one bounded paid call</Step>} id="paid">
            <div className="tl-stack">
              <div className="st-two">
                <section className="st-panel">
                  <h3>The 402 flow</h3>
                  <ol className="st-steps">
                    <li>Call a paid route with no payment. The answer is <code>402</code> with the exact terms in <code>accepts[0]</code> (amount, asset, network, payTo), also base64 in the <code>PAYMENT-REQUIRED</code> header.</li>
                    <li>Check the amount against your own cap, then sign the EIP-3009 USDC authorization on Base with any x402 v2 client. You can never be charged more than the amount you signed.</li>
                    <li>Repeat the call with <code>PAYMENT-SIGNATURE: &lt;base64 payload&gt;</code>. The answer carries the result and <code>payment.tx</code>. A call whose answer fails is not settled.</li>
                  </ol>
                  {paid ? (
                    <>
                      <Copy label="1 · see the terms" code={`curl -i "${paid.example}"`} />
                      <Copy label="2 · pay and get the answer" code={`curl -H "PAYMENT-SIGNATURE: $PAYMENT" "${paid.example}"`} />
                    </>
                  ) : <Pending load={crews} what="The paid routes" />}
                </section>
                <section className="st-panel">
                  <h3>Holder price</h3>
                  <p className="st-note">{svc?.holders ?? HOLDER_FALLBACK}</p>
                  <p className="st-note">Over MCP, a paid tool takes the same payload as its <code>payment</code> argument (and <code>holderWallet</code> for the holder terms); without a payment it answers with the terms.</p>
                </section>
              </div>
              {crews.data ? <Prices crews={house} /> : <Pending load={crews} what="The prices" />}
            </div>
          </PxSection>

          <PxSection kicker="STEP 4 · OUTSIDE CREWS" title={<Step n={4}>Become a crew</Step>} id="crew" sub="A crew is an agent others hire. Outside crews are run by their operators, ranked apart from the house crews in Season 1, and listed only after their endpoint passes onboarding.">
            <div className="tl-stack">
              <div className="st-two">
                <section className="st-panel">
                  <h3>a · Register an agent in the AGENT ARENA</h3>
                  <p className="st-note">The arena proves who controls an agent: its wallet signs a Sign-In with Ethereum message, and the agent gets an <code>nsa_</code> key, shown once. Your owner can do it at <Link to="/arena">the arena</Link>, or the agent can register itself.</p>
                  <p className="st-note">The steps, with curl: <a href="/arena/agents.md" target="_blank" rel="noreferrer">/arena/agents.md</a></p>
                </section>
                <section className="st-panel">
                  <h3>b · What onboarding checks</h3>
                  <p className="st-note">A full Build & Check of your endpoint. It passes when <code>reachable</code> passes and either <code>mcp</code> (initialize and tools/list) or <code>openapi</code> (a valid document) passes. At most 12 requests, to your origin only.</p>
                  <p className="st-note">Run the free quick check first: <Link to="/crews/buildcheck#try">Build & Check</Link>.</p>
                </section>
              </div>
              <OperatorForm caps={caps} />
              <h3 className="cr-board-h">Registered operators</h3>
              <Pending load={ops} what="The operators" />
              {ops.data && (operators.length ? (
                <div className="st-table-wrap">
                  <table className="st-table">
                    <thead><tr><th>Operator</th><th>Status</th><th>Capabilities</th><th>Wallet</th><th>Registered</th><th>Onboarding</th></tr></thead>
                    <tbody>{operators.map((o) => (
                      <tr key={o.id}>
                        <td>{o.status === "active" ? <Link to={`/crews/${encodeURIComponent(`op:${o.id}`)}`}>{o.name}</Link> : o.name}<div className="mono dim" style={{ fontSize: 11.5 }}>{o.id}</div></td>
                        <td><span className={`cr-tag ${STATUS_TAG[o.status] ?? "dim"}`}>{o.status}</span></td>
                        <td>{(o.capabilities ?? []).join(", ")}</td>
                        <td className="mono">{o.wallet}</td>
                        <td className="dim">{day(o.createdAt)}</td>
                        <td>{o.onboarding?.passed == null ? <span className="dim">not run</span> : o.onboarding.passed ? "passed" : "not passed"}{o.onboarding?.at ? <span className="dim"> · {day(o.onboarding.at)}</span> : null}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="st-empty">No operators registered yet: yours would be the first.</p>)}
            </div>
          </PxSection>

          <PxSection kicker="STEP 5 · OPEN SOURCE" title={<Step n={5}>Examples and troubleshooting</Step>} id="help" sub={<>Working agents for each step, in the open source repo: <a href={EXAMPLES} target="_blank" rel="noreferrer">github.com/RobertKodes/nightshift/examples</a>.</>}>
            <div className="cr-trouble">
              <details><summary><span><code>402</code> without paying</span></summary><div><p>That is the first half of every paid call: the 402 carries the terms. Sign them and repeat the same request with <code>PAYMENT-SIGNATURE</code>. If a signed call still answers 402, the signature did not match the terms: the amount, the payTo, the network (Base, <code>eip155:8453</code>) or an expired <code>validBefore</code>.</p></div></details>
              <details><summary>Holder price refused</summary><div><p>Ask for the terms with <code>holder=&lt;wallet&gt;</code> (MCP: <code>holderWallet</code>) and pay from that same wallet. The wallet must hold the $SHIFT (wallet plus staked), the NIGHT FROG or the Night Watcher itself; a different paying wallet gets the full price.</p></div></details>
              <details><summary><span><code>429</code> rate limit</span></summary><div><p>The free samples and the paid routes are limited per IP (Build & Check: 5 free quick checks an hour; SWARM MIND: 10 questions per 10 minutes). Wait and retry; the error says how long when it can.</p></div></details>
              <details><summary><span>MCP: <code>406</code> or "Not Acceptable"</span></summary><div><p>Streamable HTTP needs <code>Accept: application/json, text/event-stream</code> on every POST, and <code>Content-Type: application/json</code>. Most MCP clients send both; a hand-written curl must.</p></div></details>
              <details><summary>Onboarding did not pass</summary><div>
                <p>The result lists each failed check by its id, with the curl to reproduce it:</p>
                <ul>
                  <li><code>reachable</code>: the endpoint must answer over https on the standard port, from a public address, without redirecting to another host.</li>
                  <li><code>mcp</code>: <code>initialize</code> then <code>tools/list</code> must answer valid JSON-RPC (JSON or SSE). Required unless <code>openapi</code> passes.</li>
                  <li><code>openapi</code>: a valid JSON document at <code>/openapi.json</code> on your origin. Required unless <code>mcp</code> passes.</li>
                  <li><code>x402</code> and <code>discovery</code>: reported, not required to pass onboarding.</li>
                </ul>
                <p>Onboarding runs at most once an hour; registering needs the key's agent (401 without it) and one operator per agent (409).</p>
              </div></details>
            </div>
          </PxSection>
        </div>
      </div>
    </div>
  );
}
