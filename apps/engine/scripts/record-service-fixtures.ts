// Records the house services' test fixtures from mainnet (read-only): every HTTP answer and RPC
// result a run needs, gzipped, so the tests replay real data with no network.
//   cd apps/engine && npx tsx scripts/record-service-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), "ns-fixtures-"));
const { eth } = await import("../src/chain.js");
const { liveNet, liveRpc, recorder } = await import("../src/services/net.js");
const { context } = await import("../src/services/context.js");
const { tokenVerdict } = await import("../src/services/verdict.js");
const { inspectHook } = await import("../src/services/hook.js");

const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const COPYCAT = "0x6d6e7616c60bde669200522908426af1847ce60c"; // IMD launch #2129, a later "SHIFT"
const UNVERIFIED = "0x1e0381f367a82da1b6136606f894f17ed05d8c5e"; // IMD launch #2226, not on Sourcify
const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc";
/** The launches the cases need (the SHIFT family and the unverified one), so the fixtures stay small. */
const KEEP = new Set([2031, 2106, 2124, 2126, 2129, 2226]);

type Row = { launchNumber: number };
const trim = (url: string, v: unknown): unknown => {
  if (url.startsWith("https://api.imd.fun/launches?")) return { ...(v as object), launches: ((v as { launches?: Row[] }).launches ?? []).filter((l) => KEEP.has(l.launchNumber)) };
  if (url.startsWith("https://sourcify.dev/")) {
    const x = v as { sources?: Record<string, unknown> };
    // library files are never analysed (source.ts leaves them out): not worth keeping
    if (x.sources) return { ...x, sources: Object.fromEntries(Object.entries(x.sources).filter(([p]) => !/^(lib\/|node_modules\/|@)/.test(p))) };
  }
  return v;
};

const out = new URL("../src/services/fixtures/", import.meta.url);
mkdirSync(out, { recursive: true });
async function record(name: string, run: (ctx: ReturnType<typeof context>) => Promise<unknown>) {
  const now = Date.now();
  const rec = recorder(liveNet, liveRpc(eth as never), trim);
  rec.tape.recordedAt = new Date(now).toISOString();
  const ctx = context({ net: rec.net, rpc: rec.rpc, now: () => now, etherscanKey: "", watchtowerUrl: "" });
  const t = Date.now();
  const r = await run(ctx);
  const raw = JSON.stringify(rec.tape);
  writeFileSync(new URL(`${name}.tape.json.gz`, out), gzipSync(raw, { level: 9 }));
  console.log(`${name}: ${Object.keys(rec.tape.net).length} http + ${Object.keys(rec.tape.rpc).length} rpc answers, ${(raw.length / 1024).toFixed(0)} KB raw, ${Date.now() - t} ms`);
  return r;
}

await record("shift", async (ctx) => {
  await tokenVerdict(ctx, "ethereum", SHIFT, "quick");
  await tokenVerdict(ctx, "ethereum", SHIFT, "deep");
  await inspectHook(ctx, HOOK, true);
});
await record("copycat", (ctx) => tokenVerdict(ctx, "ethereum", COPYCAT, "quick"));
await record("unverified", (ctx) => tokenVerdict(ctx, "ethereum", UNVERIFIED, "quick"));
