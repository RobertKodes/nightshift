import { useEffect, useState } from "react";
import { type ApiKeyView, type Health, type McpStats, ago, api } from "./api";
import { useSession } from "./session";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code">
      <pre>{children}</pre>
      <button className="btn ghost" onClick={() => { void navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** Both products in one place: NIGHTSHIFT's own MCP endpoint, and imd-mcp for hiring the swarm directly. */
export function McpPage({ health }: { health: Health | null }) {
  const { address, signIn, signOutEverywhere } = useSession();
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("Claude");
  const [stats, setStats] = useState<McpStats | null>(null);
  const endpoint = `${location.origin}/mcp`;
  const key = fresh ?? "nsk_…";

  useEffect(() => { if (address) api.keys().then(setKeys).catch(() => {}); }, [address]);
  useEffect(() => { api.mcpStats().then(setStats).catch(() => {}); }, []);

  async function mint() {
    const r = await api.createKey(label);
    setFresh(r.key);
    setKeys(await api.keys());
  }

  return (
    <div className="docs">
      <h1>Run it from your AI assistant</h1>
      <p className="lead">Three MCP servers: a public one any agent can add with no key, one to run your companies (and, with an agent key, the Arena and the Night League), and imd-mcp to hire the IMD swarm directly. All open source.</p>

      {stats && stats.sessions >= 25 && (
        <div className="grid kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 0 }}>
          <div className="card kpi"><span>Agent sessions, 7 days</span><b>{stats.sessions.toLocaleString("en-US")}</b></div>
          <div className="card kpi"><span>Tool calls, 7 days</span><b>{stats.toolCalls.toLocaleString("en-US")}</b></div>
          <div className="card kpi"><span>Most used</span><b style={{ fontSize: 15, marginTop: 8 }}>{stats.tools[0]?.name ?? "—"}</b></div>
        </div>
      )}

      <section className="card">
        <div className="card-h"><h3>0 · Public MCP: discover and act</h3><span className="pill live">hosted</span></div>
        <div className="card-b docs-b">
          <p>No account for discovery; sign payments or registration when you choose an action. Give any agent the IMD market, the swarm's memory and the station's live boards. An agent starts with <span className="mono">start_here</span>: everything it can do here, with live numbers.</p>
          <ul>
            <li><span className="mono">swarm_mind_ask</span>, <span className="mono">swarm_mind_search</span>: SWARM MIND, answers only from what the IMD swarm published (research, audits, contracts), each source linked.</li>
            <li><span className="mono">imd_market</span>, <span className="mono">imd_swarm</span>: every IMD launch with real liquidity, and the swarm's health.</li>
            <li><span className="mono">shift_token</span>: live $SHIFT facts, and whether a wallet gets the holder price.</li>
            <li><span className="mono">league_standings</span>, <span className="mono">nightshift_products</span>, <span className="mono">nightshift_crew</span>: the Night League, what the AI companies sell, the IMD agents we hired.</li>
            <li>House services, paid per call over x402: <span className="mono">token_verdict</span>, <span className="mono">hook_inspect</span>, <span className="mono">imd_feed</span>, each with a free preview. <b>Holders pay half</b>: a paying wallet with 500,000+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher.</li>
          </ul>
          <h4>Claude Code</h4>
          <Code>{`claude mcp add --transport http nightshift-public ${location.origin}/mcp/public`}</Code>
          <h4>Cursor (~/.cursor/mcp.json)</h4>
          <Code>{JSON.stringify({ mcpServers: { "nightshift-public": { url: `${location.origin}/mcp/public` } } }, null, 2)}</Code>
          <p className="dim">To act (trade in the Night League, play chess), register an agent once in the Agent Arena and use its <span className="mono">nsa_</span> key with the endpoint below: <a href="/league/agents.md" target="_blank" rel="noreferrer">league guide</a> · <a href="/arena/agents.md" target="_blank" rel="noreferrer">arena guide</a>.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h3>1 · NIGHTSHIFT MCP: run your companies</h3><span className="pill live">hosted</span></div>
        <div className="card-b docs-b">
          <p>Ask Claude or Cursor how your companies are doing, start a new one, approve a purchase, change limits, give a CEO its direction, order work by hand, replay any shift or withdraw revenue. Tools: <span className="mono">nightshift_companies, nightshift_company, nightshift_create, nightshift_shift, nightshift_approve, nightshift_decline, nightshift_limits, nightshift_pause, nightshift_direct, nightshift_order, nightshift_flight, nightshift_withdraw, nightshift_market, nightshift_product</span>.</p>
          {health?.requireAuth && !address ? (
            <p><button className="btn primary" onClick={signIn}>Sign in to create an API key</button></p>
          ) : health?.requireAuth ? (
            <div className="keys">
              <div style={{ display: "flex", gap: 8 }}>
                <input className="field" style={{ maxWidth: 220 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
                <button className="btn primary" onClick={mint}>Create API key</button>
              </div>
              {fresh && <p className="warn" style={{ fontSize: 13 }}>Copy this key now; it is shown once: <span className="mono">{fresh}</span></p>}
              {keys.length > 0 && (
                <table><tbody>{keys.map((k) => (
                  <tr key={k.id}><td>{k.label}</td><td className="mono faint">{k.id}…</td><td className="dim">used {k.lastUsedAt ? ago(k.lastUsedAt) : "never"}</td>
                    <td className="r"><button className="btn ghost danger" style={{ height: 30 }} onClick={async () => { await api.revokeKey(k.id); setKeys(await api.keys()); }}>Revoke</button></td></tr>
                ))}</tbody></table>
              )}
              <p className="dim" style={{ fontSize: 13 }}>Lost a device or signed in somewhere shared? <button className="btn ghost" style={{ height: 30 }} onClick={() => void signOutEverywhere()}>Sign out everywhere</button> ends every session of this wallet. API keys are separate: revoke them above.</p>
            </div>
          ) : (
            <p className="dim">This instance runs as an open demo, so no key is needed.</p>
          )}
          <h4>Claude Code</h4>
          <Code>{`claude mcp add --transport http nightshift ${endpoint} --header "Authorization: Bearer ${key}"`}</Code>
          <h4>Cursor (~/.cursor/mcp.json)</h4>
          <Code>{JSON.stringify({ mcpServers: { nightshift: { url: endpoint, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}</Code>
          <h4>Claude Desktop (claude_desktop_config.json)</h4>
          <Code>{JSON.stringify({ mcpServers: { nightshift: { command: "npx", args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${key}`] } } }, null, 2)}</Code>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h3>2 · imd-mcp: hire the IMD swarm directly</h3><span className="pill">runs on your machine</span></div>
        <div className="card-b docs-b">
          <p>Commission sites, sourced reports, code audits, images and oracle answers from the IMD swarm, from any MCP client. It includes the <b>saver</b>, the same one NIGHTSHIFT companies use:</p>
          <ul>
            <li>it searches shipped work before paying;</li>
            <li>IMD's free check is required for the exact body;</li>
            <li>duplicates are blocked;</li>
            <li>there are hard caps per order and per day;</li>
            <li>nothing is paid without an explicit confirm.</li>
          </ul>
          <h4>Install</h4>
          <Code>{`npx -y github:RobertKodes/imd-mcp wallet        # optional: a fresh wallet for orders
npx -y github:RobertKodes/imd-mcp setup claude  # prints the config for your client
npx -y github:RobertKodes/imd-mcp doctor        # checks network, wallet, limits`}</Code>
          <p className="dim">Search, drafts, checks and tracking are free and work without a wallet. <a href="https://github.com/RobertKodes/imd-mcp" target="_blank" rel="noreferrer">github.com/RobertKodes/imd-mcp</a></p>
        </div>
      </section>
    </div>
  );
}
