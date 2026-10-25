import { pinned, publicUrl } from "../net.js";

/**
 * Build & Check: does a public agent service work for an agent that finds it, calls it and pays it?
 * Five checks, each with an exact curl command to reproduce it: HTTPS and reachable, MCP
 * (initialize + tools/list), x402 payment terms and discovery metadata, OpenAPI, and the discovery
 * documents. Quick mode runs the first three.
 *
 * Bounded so it cannot be turned into a scanner: at most 12 requests, 8 s each, 512 KB read per
 * answer, GET or POST to the target's own origin only, redirects followed only on that origin, no
 * cookies or credentials sent. It only reads what the service answers: nothing is executed.
 * A check that could not run is "unavailable", never "pass".
 */
export type CheckId = "reachable" | "mcp" | "x402" | "openapi" | "discovery";
export type CheckStatus = "pass" | "fail" | "warn" | "unavailable";
export type Check = { id: CheckId; label: string; status: CheckStatus; detail: string; reproduce: string; ms: number };
export type BuildCheckReport = {
  target: string; origin: string; mode: "quick" | "full";
  checks: Check[];
  summary: { checks: number; pass: number; warn: number; fail: number; unavailable: number; text: string };
  /** Requests made, all to the target's origin (12 at most). */
  requests: number;
  generatedAt: string;
};
export type FetchLike = (url: string, init: RequestInit) => Promise<Response | null>;
export type BuildCheckDeps = {
  fetch?: FetchLike; now?: () => number;
  /** A paid route on the same origin to read the x402 terms from (default: the target itself). */
  paidRoute?: string;
};

export const LIMITS = { requests: 12, timeoutMs: 8_000, bodyBytes: 512 * 1024, redirects: 3 } as const;
const UA = "NIGHTSHIFT-BuildCheck/1.0";
const MCP_VERSION = "2025-06-18";
const LABELS: Record<CheckId, string> = {
  reachable: "HTTPS and reachable",
  mcp: "MCP: initialize and tools/list",
  x402: "x402: payment terms and discovery metadata",
  openapi: "OpenAPI document",
  discovery: "Discovery documents",
};

export class BuildCheckError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/**
 * The default fetch: net.ts's checks (public address only, pinned to the address that was checked),
 * one hop at a time, so a redirect is seen here and refused when it leaves the origin.
 */
export async function oneHop(url: string, init: RequestInit): Promise<Response | null> {
  const v = await publicUrl(url);
  return v ? pinned(v.url, v.address, v.family, init) : null;
}

/** The target as a URL, or a 400: http(s), standard ports, no credentials, no fragment. */
export function parseTarget(t: unknown): URL {
  const s = String(t ?? "").trim();
  if (!s || s.length > 2_000) throw new BuildCheckError(400, "url: a full https URL (up to 2,000 characters).");
  let u: URL;
  try { u = new URL(s); } catch { throw new BuildCheckError(400, "url is not a valid URL."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BuildCheckError(400, "url must be an https URL.");
  if (u.username || u.password) throw new BuildCheckError(400, "url must not carry a user name or password.");
  if (u.port && u.port !== "443" && u.port !== "80") throw new BuildCheckError(400, "url must use the standard port.");
  u.hash = "";
  return u;
}

/** Shell-safe single quoting for the curl commands. */
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Text a server sent, made safe to show: one line, no control characters, bounded. */
const clean = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const kb = (n: number) => n.toLocaleString("en-US");
const looksHtml = (t: string) => /^\s*(<!doctype html|<html|<head|<body)/i.test(t);
const json = (t: string): unknown => { try { return JSON.parse(t); } catch { return undefined; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ADDR = /^0x[0-9a-fA-F]{40}$/;

type Hit = { status: number; headers: Headers; text: string; truncated: boolean; url: string; bytes: number };
type Got = { ok: true; hit: Hit } | { ok: false; why: "budget" | "redirect" | "noanswer"; reason: string };

/** Reads at most `max` bytes of a body. */
async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (!res.body) return { text: "", truncated: false, bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) { chunks.push(value.subarray(0, max - size)); size = max; truncated = true; await reader.cancel().catch(() => {}); break; }
    chunks.push(value); size += value.length;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated, bytes: size };
}

/** The JSON-RPC message with this id, from a JSON answer or an SSE stream. */
function rpcOf(h: Hit, id: number): Record<string, unknown> | null {
  const ct = (h.headers.get("content-type") ?? "").toLowerCase();
  const msgs: unknown[] = [];
  if (ct.includes("text/event-stream")) {
    for (const ev of h.text.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      const v = data ? json(data) : undefined;
      if (v !== undefined) msgs.push(...(Array.isArray(v) ? v : [v]));
    }
  } else {
    const v = json(h.text);
    if (v !== undefined) msgs.push(...(Array.isArray(v) ? v : [v]));
  }
  return (msgs.find((m) => isObj(m) && m.jsonrpc === "2.0" && m.id === id && ("result" in m || "error" in m)) as Record<string, unknown> | undefined) ?? null;
}

export async function buildCheck(target: string, deps: BuildCheckDeps = {}, mode: "quick" | "full" = "quick"): Promise<BuildCheckReport> {
  const fetcher = deps.fetch ?? oneHop;
  const now = deps.now ?? Date.now;
  const url = parseTarget(target);
  const origin = url.origin, href = url.toString();
  let used = 0;

  /** One request to the origin, following same-origin redirects (each hop counts toward the 12). */
  async function request(to: string, method: "GET" | "POST", headers: Record<string, string>, body?: string): Promise<Got> {
    let cur = new URL(to);
    if (cur.origin !== origin) return { ok: false, why: "redirect", reason: "not the target's origin: not requested" };
    for (let hop = 0; hop <= LIMITS.redirects; hop++) {
      if (used >= LIMITS.requests) return { ok: false, why: "budget", reason: `not run: the ${LIMITS.requests}-request limit was reached` };
      used++;
      let res: Response | null;
      try {
        res = await fetcher(cur.toString(), { method, headers: { "user-agent": UA, ...headers }, ...(body !== undefined ? { body } : {}), redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(LIMITS.timeoutMs) });
      } catch (e) {
        const n = (e as Error)?.name;
        return { ok: false, why: "noanswer", reason: n === "TimeoutError" || n === "AbortError" ? `no answer within ${LIMITS.timeoutMs / 1000} s` : "the connection failed" };
      }
      if (!res) return { ok: false, why: "noanswer", reason: "refused: the host is not a public address or did not resolve" };
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        let next: URL;
        try { next = new URL(loc, cur); } catch { return { ok: false, why: "redirect", reason: `HTTP ${res.status} to an invalid location` }; }
        if (next.origin !== origin) return { ok: false, why: "redirect", reason: `HTTP ${res.status} redirect to another host (${clean(next.host, 80)}): not followed` };
        // a POST follows only redirects that keep the method (307, 308)
        if (method === "GET" || res.status === 307 || res.status === 308) { cur = next; continue; }
      }
      try {
        const b = await readCapped(res, LIMITS.bodyBytes);
        return { ok: true, hit: { status: res.status, headers: res.headers, text: b.text, truncated: b.truncated, url: cur.toString(), bytes: b.bytes } };
      } catch {
        return { ok: false, why: "noanswer", reason: `the answer did not finish within ${LIMITS.timeoutMs / 1000} s` };
      }
    }
    return { ok: false, why: "redirect", reason: `more than ${LIMITS.redirects} redirects` };
  }

  const checks: Check[] = [];
  const add = (id: CheckId, status: CheckStatus, detail: string, reproduce: string, t0: number) => { checks.push({ id, label: LABELS[id], status, detail: clean(detail, 900), reproduce, ms: Math.max(0, now() - t0) }); };
  /** A request that did not come back: a refused redirect is a finding (fail), anything else means the check could not run. */
  const lost = (g: Exclude<Got, { ok: true }>): CheckStatus => (g.why === "redirect" ? "fail" : "unavailable");
  const order: CheckId[] = mode === "full" ? ["reachable", "mcp", "x402", "openapi", "discovery"] : ["reachable", "mcp", "x402"];

  // the exact commands that reproduce each check (also shown for a check that did not run)
  const accept = "application/json, text/html;q=0.9, */*;q=0.8";
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: "nightshift-buildcheck", version: "1.0.0" } } };
  const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const curlPost = (b: object, extra = "") => `curl -sS -X POST ${sh(href)} -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream'${extra} -d ${sh(JSON.stringify(b))}`;
  let paidRoute: URL | null = url;
  if (deps.paidRoute) { try { paidRoute = new URL(deps.paidRoute, href); } catch { paidRoute = null; } }
  const docs = [
    { path: "/llms.txt", json: false },
    { path: "/.well-known/agent-card.json", json: true },
    { path: "/.well-known/mcp.json", json: true },
  ];
  const REP: Record<CheckId, string> = {
    reachable: `curl -sS -o /dev/null -w '%{http_code} %{content_type} %{time_total}s\\n' -H ${sh(`Accept: ${accept}`)} ${sh(href)}`,
    mcp: curlPost(init),
    x402: `curl -sS -i ${sh(paidRoute?.toString() ?? href)}`,
    openapi: `curl -sS ${sh(`${origin}/openapi.json`)}`,
    discovery: docs.map((d) => `curl -sS -o /dev/null -w '%{http_code} %{size_download}\\n' ${sh(`${origin}${d.path}`)}`).join(" ; "),
  };

  // ---- a. HTTPS and reachable
  let t0 = now();
  const repA = REP.reachable;
  if (url.protocol !== "https:") {
    add("reachable", "fail", "Not https: agents and x402 clients expect TLS. Nothing else was requested.", repA, t0);
    for (const id of order.slice(1)) add(id, "unavailable", "Not run: the target must be https.", REP[id], now());
    return finish();
  }
  const a = await request(href, "GET", { accept });
  if (!a.ok) {
    add("reachable", a.why === "budget" ? "unavailable" : "fail", `Unreachable: ${a.reason}.`, repA, t0);
    for (const id of order.slice(1)) add(id, "unavailable", "Not run: the target did not answer.", REP[id], now());
    return finish();
  }
  const root: Hit = a.hit;
  {
    const s = root.status, ct = clean(root.headers.get("content-type") ?? "none", 80);
    const moved = root.url !== href ? ` after a redirect to ${clean(new URL(root.url).pathname, 120)}` : "";
    const base = `HTTP ${s}${moved}, content-type ${ct}, ${kb(root.bytes)} bytes${root.truncated ? " (cut at 512 KB)" : ""}`;
    const st: CheckStatus = s >= 200 && s < 300 ? "pass" : [401, 402, 405, 406].includes(s) ? "pass" : s >= 500 ? "fail" : "warn";
    const why = s === 402 ? ": payment required, as a paid route answers" : s === 405 || s === 406 ? ": the URL answers, but not to a plain GET (usual for an MCP endpoint)" : s === 401 ? ": it asks for credentials" : s === 404 || s === 410 ? ": not found, check the URL" : s >= 500 ? ": a server error" : "";
    add("reachable", st, `${base}${why}.`, repA, t0);
  }

  // ---- b. MCP: initialize, then tools/list
  t0 = now();
  const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let repB = REP.mcp;
  const ini = await request(href, "POST", mcpHeaders, JSON.stringify(init));
  if (!ini.ok) add("mcp", lost(ini), `initialize: ${ini.reason}.`, repB, t0);
  else {
    const m = rpcOf(ini.hit, 1);
    const r = isObj(m?.result) ? m.result : null, info = isObj(r?.serverInfo) ? r.serverInfo : null;
    if (!m) add("mcp", "fail", `No MCP answer to initialize: HTTP ${ini.hit.status}, content-type ${clean(ini.hit.headers.get("content-type") ?? "none", 80)}.`, repB, t0);
    else if (!r) add("mcp", "fail", `initialize returned a JSON-RPC error${isObj(m.error) ? ` ${clean(m.error.code, 12)}: ${clean(m.error.message, 160)}` : ""}.`, repB, t0);
    else if (typeof info?.name !== "string" || !info.name || typeof r.protocolVersion !== "string") add("mcp", "fail", "initialize answered without serverInfo.name or protocolVersion.", repB, t0);
    else {
      const pv = clean(r.protocolVersion, 20);
      const who = `${clean(info.name, 60)}${typeof info.version === "string" ? ` ${clean(info.version, 20)}` : ""}, protocol ${pv}`;
      const sid = ini.hit.headers.get("mcp-session-id");
      const session: Record<string, string> = sid && /^[\x21-\x7e]{1,200}$/.test(sid) ? { "mcp-session-id": sid } : {};
      const follow = { ...mcpHeaders, ...session, "mcp-protocol-version": pv };
      const sidFlag = sid ? " -H 'Mcp-Session-Id: <the Mcp-Session-Id header of the first answer>'" : "";
      repB = `${curlPost(init)} && ${curlPost(list, `${sidFlag} -H ${sh(`MCP-Protocol-Version: ${pv}`)}`)}`;
      // the client's "initialized" notification, as the protocol asks, before the first request
      await request(href, "POST", follow, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
      const tl = await request(href, "POST", follow, JSON.stringify(list));
      if (!tl.ok) add("mcp", lost(tl), `initialize passed (${who}); tools/list: ${tl.reason}.`, repB, t0);
      else {
        const lm = rpcOf(tl.hit, 2);
        const tools = isObj(lm?.result) && Array.isArray(lm.result.tools) ? (lm.result.tools as unknown[]) : null;
        if (!tools) add("mcp", "fail", `initialize passed (${who}), but tools/list gave no tool list (HTTP ${tl.hit.status}${isObj(lm?.error) ? `, error: ${clean(lm.error.message, 120)}` : ""}).`, repB, t0);
        else {
          const named = tools.filter((t): t is Record<string, unknown> => isObj(t) && typeof t.name === "string" && !!t.name);
          const noDesc = named.filter((t) => typeof t.description !== "string" || !t.description.trim()).length;
          const long = named.filter((t) => typeof t.description === "string" && t.description.length > 1_000).length;
          const names = named.slice(0, 20).map((t) => clean(t.name, 64)).join(", ");
          const issues = [
            tools.length !== named.length ? `${tools.length - named.length} without a name` : "",
            noDesc ? `${noDesc} without a description` : "",
            long ? `${long} with a description over 1,000 characters` : "",
          ].filter(Boolean);
          const listed = `${tools.length} tool${tools.length === 1 ? "" : "s"}${names ? `: ${names}${named.length > 20 ? ", …" : ""}` : ""}`;
          if (!tools.length) add("mcp", "warn", `${who}; tools/list answered with no tools.`, repB, t0);
          else if (issues.length) add("mcp", "warn", `${who}; ${listed}. ${issues.join("; ")}.`, repB, t0);
          else add("mcp", "pass", `${who}; ${listed}. Every tool has a description of 1,000 characters or less.`, repB, t0);
        }
      }
    }
  }

  // ---- c. x402: the 402 answer, its terms and its discovery metadata
  t0 = now();
  let paid: Got = { ok: true, hit: root };
  if (deps.paidRoute) {
    paid = !paidRoute || paidRoute.origin !== origin
      ? { ok: false, why: "redirect", reason: "the paid route is not on the target's origin: not requested" }
      : await request(paidRoute.toString(), "GET", { accept: "application/json" });
  }
  const repC = REP.x402;
  if (!paid.ok) add("x402", lost(paid), `${paid.reason}.`, repC, t0);
  else if (paid.hit.status !== 402) add("x402", "fail", `HTTP ${paid.hit.status}, not 402: no x402 payment terms at this URL.`, repC, t0);
  else {
    let terms: Record<string, unknown> | null = null, where = "";
    const body = json(paid.hit.text);
    if (isObj(body) && Array.isArray(body.accepts)) { terms = body; where = "body"; }
    else {
      const h = paid.hit.headers.get("payment-required");
      const dec = h ? json(Buffer.from(h, "base64").toString("utf8")) : undefined;
      if (isObj(dec) && Array.isArray(dec.accepts)) { terms = dec; where = "PAYMENT-REQUIRED header"; }
    }
    const a0 = terms && isObj((terms.accepts as unknown[])[0]) ? ((terms.accepts as unknown[])[0] as Record<string, unknown>) : null;
    if (!terms || !a0) add("x402", "fail", "402 without terms: no accepts[0] in the body or the PAYMENT-REQUIRED header.", repC, t0);
    else {
      const bad = [
        a0.scheme !== "exact" ? `scheme is ${clean(a0.scheme, 20) || "missing"}, not "exact"` : "",
        typeof a0.network !== "string" || !/^eip155:\d{1,12}$/.test(a0.network) ? "network is not eip155:<chain id>" : "",
        typeof a0.asset !== "string" || !ADDR.test(a0.asset) ? "asset is not a 0x address" : "",
        typeof a0.payTo !== "string" || !ADDR.test(a0.payTo) ? "payTo is not a 0x address" : "",
        typeof a0.amount !== "string" || !/^\d{1,30}$/.test(a0.amount) || /^0+$/.test(a0.amount) ? "amount is not a positive whole number of atomic units" : "",
      ].filter(Boolean);
      const res = isObj(terms.resource) ? terms.resource : null;
      const desc = typeof res?.description === "string" ? res.description : null;
      const bz = isObj(terms.extensions) && isObj(terms.extensions.bazaar) ? terms.extensions.bazaar : null;
      const bzInfo = bz && isObj(bz.info) ? bz.info : null;
      const warn = [
        desc === null || !desc.trim() ? "resource.description is missing" : desc.length >= 500 ? `resource.description is ${kb(desc.length)} characters (under 500 is what discovery indexes take)` : "",
        !bz ? "extensions.bazaar is missing (discovery indexes will not list it)" : !bzInfo || !isObj(bzInfo.input) || !isObj(bzInfo.output) ? "extensions.bazaar has no info.input and info.output" : "",
      ].filter(Boolean);
      const what = bad.length ? "" : `${a0.scheme} on ${a0.network}, amount ${a0.amount} of ${short(String(a0.asset))} to ${short(String(a0.payTo))}`;
      if (bad.length) add("x402", "fail", `402 with terms in the ${where}, but ${bad.join("; ")}.`, repC, t0);
      else if (warn.length) add("x402", "warn", `402 with terms in the ${where}: ${what}. ${warn.join("; ")}.`, repC, t0);
      else add("x402", "pass", `402 with terms in the ${where}: ${what}; resource.description ${kb(desc!.length)} characters; extensions.bazaar with info.input and info.output.`, repC, t0);
    }
  }
  if (mode === "quick") return finish();

  // ---- d. OpenAPI: the target itself, or <origin>/openapi.json
  t0 = now();
  const isSpec = (v: unknown): v is Record<string, unknown> => isObj(v) && (typeof v.openapi === "string" || typeof v.swagger === "string");
  const rootDoc = json(root.text);
  let doc: unknown = undefined, docUrl = href;
  let docFail: { status: CheckStatus; detail: string } | null = null;
  if (isSpec(rootDoc)) doc = rootDoc;
  else {
    docUrl = `${origin}/openapi.json`;
    const g = await request(docUrl, "GET", { accept: "application/json" });
    if (!g.ok) docFail = { status: lost(g), detail: `/openapi.json: ${g.reason}.` };
    else if (g.hit.status < 200 || g.hit.status >= 300) docFail = { status: "warn", detail: `No OpenAPI document at /openapi.json (HTTP ${g.hit.status}).` };
    else if (looksHtml(g.hit.text)) docFail = { status: "warn", detail: "No OpenAPI document: /openapi.json answered with an HTML page." };
    else if ((doc = json(g.hit.text)) === undefined) docFail = { status: "fail", detail: `/openapi.json is not valid JSON${g.hit.truncated ? " (over 512 KB)" : ""}.` };
  }
  const repD = `curl -sS ${sh(docUrl)}`;
  if (docFail) add("openapi", docFail.status, docFail.detail, repD, t0);
  else if (!isSpec(doc)) add("openapi", "fail", `${docUrl === href ? "The target" : "/openapi.json"} is JSON without an openapi (or swagger) version.`, repD, t0);
  else {
    const version = clean(doc.openapi ?? doc.swagger, 20);
    const paths = isObj(doc.paths) ? doc.paths : {};
    const ops: Record<string, unknown>[] = [];
    for (const item of Object.values(paths)) if (isObj(item)) for (const m of ["get", "put", "post", "delete", "options", "head", "patch", "trace"]) if (isObj(item[m])) ops.push(item[m] as Record<string, unknown>);
    const withSummary = ops.filter((o) => typeof o.summary === "string" && o.summary.trim()).length;
    const where = docUrl === href ? "the target" : "/openapi.json";
    const counts = `${Object.keys(paths).length} path${Object.keys(paths).length === 1 ? "" : "s"}, ${ops.length} operation${ops.length === 1 ? "" : "s"}, ${withSummary} with a summary`;
    const versionOk = /^3\.\d/.test(version) || version === "2.0";
    if (!versionOk) add("openapi", "fail", `${where}: unknown OpenAPI version "${version}"; ${counts}.`, repD, t0);
    else if (!ops.length) add("openapi", "fail", `OpenAPI ${version} at ${where} lists no operations.`, repD, t0);
    else if (withSummary < ops.length) add("openapi", "warn", `OpenAPI ${version} at ${where}: ${counts}.`, repD, t0);
    else add("openapi", "pass", `OpenAPI ${version} at ${where}: ${counts}.`, repD, t0);
  }

  // ---- e. discovery documents on the origin
  t0 = now();
  let present = 0, unknown = 0;
  const parts: string[] = [];
  for (const d of docs) {
    const g = await request(`${origin}${d.path}`, "GET", { accept: d.json ? "application/json" : "text/plain, text/markdown;q=0.9, */*;q=0.5" });
    if (!g.ok) { if (g.why === "redirect") parts.push(`${d.path}: absent (${g.reason})`); else { unknown++; parts.push(`${d.path}: not checked (${g.reason})`); } continue; }
    const h = g.hit;
    if (h.status < 200 || h.status >= 300) { parts.push(`${d.path}: absent (HTTP ${h.status})`); continue; }
    if (!h.text.trim()) { parts.push(`${d.path}: absent (empty, HTTP ${h.status})`); continue; }
    if (looksHtml(h.text)) { parts.push(`${d.path}: absent (an HTML page, HTTP ${h.status})`); continue; }
    if (d.json && !isObj(json(h.text))) { parts.push(`${d.path}: present but not a JSON object (${kb(h.bytes)} bytes)`); continue; }
    present++;
    parts.push(`${d.path}: present (${kb(h.bytes)}${h.truncated ? "+" : ""} bytes)`);
  }
  add("discovery", present === docs.length ? "pass" : present ? "warn" : unknown ? "unavailable" : "fail", `${parts.join("; ")}.`, REP.discovery, t0);
  return finish();

  function finish(): BuildCheckReport {
    const byId = new Map(checks.map((c) => [c.id, c]));
    const rows = order.map((id) => byId.get(id)).filter((c): c is Check => !!c);
    const n = (s: CheckStatus) => rows.filter((c) => c.status === s).length;
    const summary = { checks: rows.length, pass: n("pass"), warn: n("warn"), fail: n("fail"), unavailable: n("unavailable"), text: "" };
    summary.text = `${summary.checks} checks: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.unavailable} unavailable`;
    return { target: href, origin, mode, checks: rows, summary, requests: used, generatedAt: new Date(now()).toISOString() };
  }
}
