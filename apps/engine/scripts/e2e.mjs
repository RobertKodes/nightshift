// End-to-end: a signed-in owner founds a company, a stranger cannot touch it, and the owner's
// API key drives it over MCP (streamable HTTP). Runs the real engine in sim mode on a temp folder.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PORT = 8799;
const base = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "ns-e2e-"));
const engine = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_URL: base, DATA_DIR: data, REQUIRE_AUTH: "1", SIM_JOB_SECONDS: "5" }, stdio: "ignore" });
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); engine.kill(); process.exit(1); } console.log("ok -", msg); };

for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

async function signIn(acct) {
  const { nonce, message } = await (await fetch(`${base}/api/auth/nonce?address=${acct.address}`)).json();
  const signature = await acct.signMessage({ message });
  const r = await (await fetch(`${base}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: acct.address, nonce, signature }) })).json();
  return r.token;
}
const H = (t) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const anon = await fetch(`${base}/api/companies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idea: "Cold email templates for freelance designers looking for clients" }) });
ok(anon.status === 401, "anonymous visitors cannot start a company");

const tOwner = await signIn(owner);
const created = await (await fetch(`${base}/api/companies`, { method: "POST", headers: H(tOwner), body: JSON.stringify({ idea: "Cold email templates for freelance designers looking for clients" }) })).json();
ok(Boolean(created.id), "a signed-in owner starts a company");

const tStranger = await signIn(stranger);
ok((await fetch(`${base}/api/companies/${created.id}`, { headers: H(tStranger) })).status === 403, "a stranger cannot open the owner's dashboard");
ok((await fetch(`${base}/api/companies/${created.id}/shift`, { method: "POST", headers: H(tStranger) })).status === 403, "a stranger cannot run its shifts");
ok((await fetch(`${base}/api/public/${created.slug}`)).status === 200, "the public page stays public");

const { key } = await (await fetch(`${base}/api/keys`, { method: "POST", headers: H(tOwner), body: JSON.stringify({ label: "e2e" }) })).json();
ok(key?.startsWith("nsk_"), "the owner mints an MCP key");
ok((await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" })).status === 401, "MCP without a key is refused");

const client = new Client({ name: "e2e", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
const tools = (await client.listTools()).tools.map((t) => t.name);
ok(tools.includes("nightshift_create") && tools.includes("nightshift_withdraw"), `MCP lists ${tools.length} tools`);
const list = JSON.parse((await client.callTool({ name: "nightshift_companies", arguments: {} })).content[0].text);
ok(list.length === 1 && list[0].id === created.id, "MCP sees exactly the owner's company");
const made = JSON.parse((await client.callTool({ name: "nightshift_create", arguments: { idea: "A weekly digest of new grants for climate startups, with deadlines" } })).content[0].text);
ok(made.ok && made.id, "MCP founds a second company");
await client.close();

engine.kill();
console.log("\nall good");
process.exit(0);
