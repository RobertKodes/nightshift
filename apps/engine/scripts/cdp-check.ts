/**
 * Read-only check of the CDP facilitator key: one authenticated GET /supported, nothing verified or
 * settled. Prints the HTTP status and the payment kinds, never the key.
 *
 *   npx tsx apps/engine/scripts/cdp-check.ts                      (the key saved on /setup, or CDP_API_KEY_ID / CDP_API_KEY_SECRET)
 *   npx tsx apps/engine/scripts/cdp-check.ts --key cdp_api_key.json   (a key file from the CDP portal: { id, privateKey })
 */
import { readFileSync } from "node:fs";
import { CdpFacilitator, FacilitatorUnavailable } from "@nightshift/x402";
import { readSettings } from "../src/settings.js";

function key(): { id: string; secret: string } {
  const i = process.argv.indexOf("--key");
  if (i > 0 && process.argv[i + 1]) {
    const f = JSON.parse(readFileSync(process.argv[i + 1]!, "utf8")) as { id?: string; privateKey?: string };
    return { id: f.id ?? "", secret: f.privateKey ?? "" };
  }
  const s = { ...process.env, ...readSettings() } as Record<string, string | undefined>;
  return { id: s.CDP_API_KEY_ID ?? "", secret: s.CDP_API_KEY_SECRET ?? "" };
}

// a parse error can quote the file it failed on: say only that it failed
let k: { id: string; secret: string };
try { k = key(); } catch { console.log("The key file could not be read as JSON with id and privateKey."); process.exit(1); }
if (!k.id || !k.secret) { console.log("No CDP key: set CDP_API_KEY_ID and CDP_API_KEY_SECRET on /setup, or pass --key <file>."); process.exit(1); }
try {
  const r = await new CdpFacilitator(k).supported();
  console.log(`GET /supported: HTTP ${r.status}`);
  for (const x of r.kinds) console.log(`  x402 v${x.x402Version} ${x.scheme} ${x.network}`);
} catch (e) {
  console.log(e instanceof FacilitatorUnavailable ? `GET /supported failed: ${e.status ? `HTTP ${e.status}` : "no answer"}` : "GET /supported failed");
  process.exit(1);
}
