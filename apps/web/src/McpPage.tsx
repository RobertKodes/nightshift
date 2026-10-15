import { useEffect, useState } from "react";
import { type ApiKeyView, type Health, ago, api } from "./api";
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
  const { address, signIn } = useSession();
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("Claude");
  const endpoint = `${location.origin}/mcp`;
  const key = fresh ?? "nsk_…";

  useEffect(() => { if (address) api.keys().then(setKeys).catch(() => {}); }, [address]);

  async function mint() {
    const r = await api.createKey(label);
    setFresh(r.key);
    setKeys(await api.keys());
  }

  return (
    <div className="docs">
      <h1>Run it from your AI assistant</h1>
      <p className="lead">Two MCP servers, one for each way of working with the IMD swarm. Both are open source.</p>

      <section className="card">
        <div className="card-h"><h3>1 · NIGHTSHIFT MCP: run your companies</h3><span className="pill live">hosted</span></div>
        <div className="card-b docs-b">
          <p>Ask Claude or Cursor how your companies are doing, start a new one, approve a purchase, change limits or withdraw revenue. Tools: <span className="mono">nightshift_companies, nightshift_company, nightshift_create, nightshift_shift, nightshift_approve, nightshift_decline, nightshift_limits, nightshift_pause, nightshift_withdraw</span>.</p>
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
