import { useEffect, useState } from "react";
import { type ApiKeyView, type Health, type McpStats, ago, api } from "./api";
import { useSession } from "./session";
import StarBorder from "./rb/StarBorder";
import { PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { Copy, ToolHero } from "./crews/shared";

/** The tools an agent gets on the public server, grouped the way the page explains them. */
const PUBLIC_TOOLS: { names: string[]; what: React.ReactNode; imd?: boolean }[] = [
  { names: ["swarm_mind_ask", "swarm_mind_search"], what: "SWARM MIND, answers only from what the IMD swarm published (research, audits, contracts), each source linked.", imd: true },
  { names: ["imd_market", "imd_swarm"], what: "every IMD launch with real liquidity, and the swarm's health.", imd: true },
  { names: ["shift_token"], what: "live $SHIFT facts, and whether a wallet gets the holder price." },
  { names: ["league_standings", "nightshift_products", "nightshift_crew"], what: "the Night League, what the AI companies sell, the IMD agents we hired." },
  { names: ["token_verdict", "hook_inspect", "imd_feed"], what: <>house services, paid per call over x402, each with a free preview. <b>Holders pay half</b>: a paying wallet with 500,000+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher.</> },
];

/** The three servers, for the hero's side panel. */
const SERVERS = [
  { href: "#public", n: "00", name: "Public MCP", line: "discover and act · no key", tag: "HOSTED", imd: false },
  { href: "#companies", n: "01", name: "NIGHTSHIFT MCP", line: "run your companies · API key", tag: "HOSTED", imd: false },
  { href: "#imd-mcp", n: "02", name: "imd-mcp", line: "hire the IMD swarm directly", tag: "YOUR MACHINE", imd: true },
];

/** Both products in one place: NIGHTSHIFT's own MCP endpoint, and imd-mcp for hiring the swarm directly. */
export function McpPage({ health }: { health: Health | null }) {
  const { address, signIn, signOutEverywhere } = useSession();
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("Claude");
  const [spend, setSpend] = useState(false);
  const [stats, setStats] = useState<McpStats | null>(null);
  const endpoint = `${location.origin}/mcp`;
  const key = fresh ?? "nsk_…";

  useEffect(() => { if (address) api.keys().then(setKeys).catch(() => {}); }, [address]);
  useEffect(() => { api.mcpStats().then(setStats).catch(() => {}); }, []);

  async function mint() {
    const r = await api.createKey(label, spend);
    setSpend(false);
    setFresh(r.key);
    setKeys(await api.keys());
  }

  return (
    <div className="st-room tl tl-mcp">
      <div className="tl-in">
        <ToolHero docTitle="MCP" trail={[{ label: "mcp" }]} kicker="MCP · THREE SERVERS · OPEN SOURCE" title="Run it from" accent="your AI assistant."
          lead="Three MCP servers: a public one any agent can add with no key, one to run your companies (and, with an agent key, the Arena and the Night League), and imd-mcp to hire the IMD swarm directly. All open source."
          actions={<>
            <StarBorder as="a" href="#public" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="bot" size={14} />ADD THE PUBLIC MCP</StarBorder>
            <a className="px-btn ghost" href="#companies"><PxIcon name="blocks" size={14} />RUN YOUR COMPANIES</a>
            <a className="px-btn imd" href="#imd-mcp"><PxIcon name="bolt" size={14} />HIRE THE IMD SWARM</a>
          </>}
          aside={<PxPanel title="THREE SERVERS" right="STREAMABLE HTTP">
            <nav className="tl-doors" aria-label="The three MCP servers">
              {SERVERS.map((s) => <a key={s.href} href={s.href} className={s.imd ? "tl-door-imd" : undefined}><span className="tl-step">{s.n}</span><span>{s.name}<small>{s.line}</small></span><PxTag tone={s.imd ? "imd" : "dim"}>{s.tag}</PxTag></a>)}
            </nav>
            <div className="tl-panel-f"><b>agent@mcp:~$</b> start_here<span className="tl-cursor" aria-hidden="true" /></div>
          </PxPanel>} />

        {stats && stats.sessions >= 25 && (
          <PxStats cols={3}>
            <PxStat label="Agent sessions, 7 days" value={<PxNum value={stats.sessions} />} tone="lime" />
            <PxStat label="Tool calls, 7 days" value={<PxNum value={stats.toolCalls} />} />
            <PxStat label="Most used" value={<span className="tl-small-v">{stats.tools[0]?.name ?? "—"}</span>} />
          </PxStats>
        )}

        <div className="tl-body">
          <PxSection kicker="00 · PUBLIC MCP · HOSTED" title="Discover and act" id="public" sub={<>No account for discovery; sign payments or registration when you choose an action. Give any agent the IMD market, the swarm's memory and the station's live boards. An agent starts with <span className="mono">start_here</span>: everything it can do here, with live numbers.</>}>
            <div className="tl-stack">
              <div className="st-two">
                <section className="st-panel">
                  <h3>The tools <small><span className="pill live">hosted</span></small></h3>
                  <ul className="tl-tools">
                    {PUBLIC_TOOLS.map((t) => <li key={t.names[0]} className={t.imd ? "imd" : undefined}><span>{t.names.map((n) => <code key={n}>{n}</code>)}</span><p>{t.what}</p></li>)}
                  </ul>
                </section>
                <div className="tl-stack">
                  <Copy label="Claude Code" code={`claude mcp add --transport http nightshift-public ${location.origin}/mcp/public`} />
                  <Copy label="Cursor · ~/.cursor/mcp.json" code={JSON.stringify({ mcpServers: { "nightshift-public": { url: `${location.origin}/mcp/public` } } }, null, 2)} />
                  <p className="st-note">To act (trade in the Night League, play chess), register an agent once in the Agent Arena and use its <span className="mono">nsa_</span> key with the endpoint below: <a href="/league/agents.md" target="_blank" rel="noreferrer">league guide</a> · <a href="/arena/agents.md" target="_blank" rel="noreferrer">arena guide</a>.</p>
                </div>
              </div>
            </div>
          </PxSection>

          <PxSection kicker="01 · NIGHTSHIFT MCP · HOSTED" title="Run your companies" id="companies" sub="Ask Claude or Cursor how your companies are doing, start a new one, approve a purchase, change limits, give a CEO its direction, order work by hand, replay any shift or withdraw revenue.">
            <div className="tl-stack">
              <div className="st-two">
                <section className="st-panel">
                  <h3>Tools <small><span className="pill live">hosted</span></small></h3>
                  <p className="tl-toolwall">{["nightshift_companies", "nightshift_company", "nightshift_create", "nightshift_shift", "nightshift_approve", "nightshift_decline", "nightshift_limits", "nightshift_pause", "nightshift_direct", "nightshift_order", "nightshift_flight", "nightshift_withdraw", "nightshift_market", "nightshift_product"].map((t) => <code key={t}>{t}</code>)}</p>
                </section>
                <section className="st-panel">
                  <h3>Your API key</h3>
                  {health?.requireAuth && !address ? (
                    <p><button className="btn primary" onClick={signIn}>Sign in to create an API key</button></p>
                  ) : health?.requireAuth ? (
                    <div className="keys tl-keys">
                      <div className="st-row">
                        <input className="field" style={{ maxWidth: 220 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Key label" />
                        <button className="btn primary" onClick={mint}>Create API key</button>
                      </div>
                      <label className="dim tl-check"><input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} /> Let this key approve held spending, order paid work, raise limits and withdraw revenue. Leave it off for an assistant that only reads and steers: a leaked key then cannot move money.</label>
                      {fresh && <><p className="warn" style={{ fontSize: 13 }}>Copy this key now; it is shown once:</p><Copy label="your new key · shown once" code={fresh} /></>}
                      {keys.length > 0 && (
                        <div className="st-table-wrap"><table className="st-table"><tbody>{keys.map((k) => (
                          <tr key={k.id}><td>{k.label}</td><td className="mono faint">{k.id}…</td><td className="dim">{k.spend ? "can spend" : "no spending"}</td><td className="dim">used {k.lastUsedAt ? ago(k.lastUsedAt) : "never"}</td>
                            <td className="r"><button className="btn ghost danger" style={{ height: 30 }} onClick={async () => { await api.revokeKey(k.id); setKeys(await api.keys()); }}>Revoke</button></td></tr>
                        ))}</tbody></table></div>
                      )}
                      <p className="dim" style={{ fontSize: 13 }}>Lost a device or signed in somewhere shared? <button className="btn ghost" style={{ height: 30 }} onClick={() => void signOutEverywhere()}>Sign out everywhere</button> ends every session of this wallet. API keys are separate: revoke them above.</p>
                    </div>
                  ) : (
                    <p className="dim">This instance runs as an open demo, so no key is needed.</p>
                  )}
                </section>
              </div>
              <Copy label="Claude Code" code={`claude mcp add --transport http nightshift ${endpoint} --header "Authorization: Bearer ${key}"`} />
              <div className="st-two">
                <Copy label="Cursor · ~/.cursor/mcp.json" code={JSON.stringify({ mcpServers: { nightshift: { url: endpoint, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
                <Copy label="Claude Desktop · claude_desktop_config.json" code={JSON.stringify({ mcpServers: { nightshift: { command: "npx", args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${key}`] } } }, null, 2)} />
              </div>
            </div>
          </PxSection>

          <PxSection kicker="02 · IMD-MCP · RUNS ON YOUR MACHINE" title="Hire the IMD swarm directly" id="imd-mcp" sub="Commission sites, sourced reports, code audits, images and oracle answers from the IMD swarm, from any MCP client.">
            <div className="tl-imd-block">
              <div>
                <span className="px-kicker imd">THE SAVER · THE SAME ONE NIGHTSHIFT COMPANIES USE</span>
                <h3>Nothing is paid without an explicit confirm.</h3>
                <ul className="tl-saver">
                  <li>it searches shipped work before paying;</li>
                  <li>IMD's free check is required for the exact body;</li>
                  <li>duplicates are blocked;</li>
                  <li>there are hard caps per order and per day;</li>
                  <li>nothing is paid without an explicit confirm.</li>
                </ul>
                <p>Search, drafts, checks and tracking are free and work without a wallet. <a href="https://github.com/RobertKodes/imd-mcp" target="_blank" rel="noreferrer">github.com/RobertKodes/imd-mcp</a></p>
              </div>
              <Copy tone="imd" label="Install" code={`npx -y github:RobertKodes/imd-mcp wallet        # optional: a fresh wallet for orders
npx -y github:RobertKodes/imd-mcp setup claude  # prints the config for your client
npx -y github:RobertKodes/imd-mcp doctor        # checks network, wallet, limits`} />
            </div>
          </PxSection>
        </div>
      </div>
    </div>
  );
}
