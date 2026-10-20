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

// The owner desk: edit, direct, inspect, delete and restore.
const desk = await (await fetch(`${base}/api/my/companies`, { headers: H(tOwner) })).json();
ok(desk.companies.length === 2 && desk.archived.length === 0, "the owner desk lists both companies");
const madeSlug = desk.companies.find((x) => x.id === made.id)?.slug;
ok((await fetch(`${base}/api/my/companies`)).status === 401, "the desk needs the owner's sign-in");
const post = (path, body, t = tOwner) => fetch(`${base}${path}`, { method: "POST", headers: H(t), body: JSON.stringify(body) });
ok((await post(`/api/companies/${created.id}/profile`, { name: "Hacked" }, tStranger)).status === 403, "a stranger cannot edit the company");
ok((await post(`/api/companies/${created.id}/profile`, { name: "<b>x</b>" })).status === 400, "markup is refused in a name");
ok((await post(`/api/companies/${created.id}/profile`, { name: "Pitch Club", direction: "Only write for freelance brand designers in Europe." })).status === 200, "the owner renames it and gives the CEO a direction");
const pub0 = await (await fetch(`${base}/api/public/${created.slug}`)).json();
ok(pub0.name === "Pitch Club", "the public page shows the new name under the same link");
// the autopilot may already be on its first shift: either way one is recorded
await post(`/api/companies/${created.id}/shift`, {});
let full = { tasks: [] };
for (let i = 0; i < 40 && !full.tasks.length; i++) { full = await (await fetch(`${base}/api/companies/${created.id}`, { headers: H(tOwner) })).json(); if (!full.tasks.length) await new Promise((r) => setTimeout(r, 300)); }
const task = full.tasks.at(-1);
const rec = await (await fetch(`${base}/api/companies/${created.id}/shifts/${task.id}`, { headers: H(tOwner) })).json();
ok(rec.trace?.[0]?.children?.length >= 2 && rec.mind?.saw && rec.brief?.includes("brand designers in Europe"), "the flight record shows the phases, what the CEO saw, and the direction in the brief");
const pubRec = await (await fetch(`${base}/api/public/${created.slug}/shifts/${task.id}`)).json();
ok(pubRec.trace?.length === 1 && pubRec.brief === undefined && pubRec.receipts.files === null, "the public flight record leaves out the brief and the files");
ok((await fetch(`${base}/api/companies/${created.id}/shifts/${task.id}`, { headers: H(tStranger) })).status === 403, "a stranger cannot read the owner's record");
const csv = await (await fetch(`${base}/api/companies/${created.id}/books.csv`, { headers: H(tOwner) })).text();
ok(csv.startsWith('"date","kind"') && csv.includes('"funding"'), "the books download as CSV");
for (let i = 0; i < 30 && ["checking", "ordering"].includes((await (await fetch(`${base}/api/companies/${made.id}`, { headers: H(tOwner) })).json()).tasks.at(-1)?.status); i++) await new Promise((r) => setTimeout(r, 300));
ok((await post(`/api/companies/${made.id}/delete`, { confirm: "wrong" })).status === 400, "delete needs the company's name typed");
ok((await post(`/api/companies/${made.id}/delete`, { confirm: made.name ?? "" }, tStranger)).status === 403, "a stranger cannot delete it");
const name2 = (await (await fetch(`${base}/api/companies/${made.id}`, { headers: H(tOwner) })).json()).name;
ok((await post(`/api/companies/${made.id}/delete`, { confirm: name2 })).status === 200, "the owner deletes a company");
const desk2 = await (await fetch(`${base}/api/my/companies`, { headers: H(tOwner) })).json();
ok(desk2.companies.length === 1 && desk2.archived[0]?.id === made.id, "it leaves the desk and waits under deleted");
ok(Boolean(madeSlug) && (await fetch(`${base}/api/public/${madeSlug}`)).status === 404, "a deleted company no longer sells");
ok((await post(`/api/my/archived/${made.id}/restore`, {}, tStranger)).status === 400, "a stranger cannot restore it");
ok((await post(`/api/my/archived/${made.id}/restore`, {})).status === 200, "the owner restores it");
const desk3 = await (await fetch(`${base}/api/my/companies`, { headers: H(tOwner) })).json();
ok(desk3.companies.length === 2 && desk3.companies.find((x) => x.id === made.id)?.status === "paused", "it comes back paused");

engine.kill();
console.log("\nall good");
process.exit(0);
