// Sends each omni order to IMD's FREE check and saves the answer in docs/launchpad/checks/. Pays nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as o from "../src/order-omni.js";

const out = join(import.meta.dirname, "..", "..", "..", "docs", "launchpad", "checks");
mkdirSync(out, { recursive: true });
const CREATOR = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
// A real graduated pump.fun coin as the stand-in (read on 2026-10-22).
const coin = (chainId: 1 | 4663): o.OmniCoin => ({ name: "Night Owl", symbol: "OWL", solMint: "8QtbrC9d3BezyCwzBFUQbNsWJGte7ckrZ7HWcn81pump", curve: "26fbbjPUhTPVTyaiEUENhQBWPf2XhaRUAVh9z4evBHW9", creator: CREATOR, chainId });
const only = process.argv[2];
const orders = [o.omniSpokeOrder(coin(1)), o.omniSpokeOrder(coin(4663)), o.omniGateOrder(coin(1)), o.omniHookOrder(coin(1)), o.omniHookOrder(coin(4663)), o.omniVaultOrder(coin(1)), o.omniKeeperOrder(coin(1))];
for (const ord of orders) {
  if (only && !ord.key.includes(only)) continue;
  const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: ord.action, input: ord.body }) });
  const response = await r.json().catch(() => null);
  writeFileSync(join(out, `${ord.key}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), status: r.status, action: ord.action, intake: ord.intake, title: ord.title, request: ord.body, response }, null, 2));
  const rs = response as { blockers?: unknown[] } | null;
  console.log(ord.key, r.status, "blockers:", rs?.blockers?.length ?? "?", JSON.stringify(rs?.blockers ?? response).slice(0, 800));
}
