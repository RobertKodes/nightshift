// Live smoke test: free endpoints only. Run `npm run build` first.
import { NightshiftClient } from "../dist/index.js";
const c = new NightshiftClient();
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const results = [];
async function step(name, fn, optional = false) {
  try {
    const r = await fn();
    results.push([name, "ok"]);
    console.log("ok  ", name, JSON.stringify(r).slice(0, 110));
  } catch (e) {
    const soft = optional && e.status === 404; // endpoints that are not deployed yet
    results.push([name, soft ? "not-deployed-yet" : "FAIL"]);
    console.log(soft ? "skip" : "FAIL", name, e.status ?? "", e.message);
  }
}
await step("startHere", () => c.startHere());
await step("askSwarm", () => c.askSwarm("What is IMD?"));
await step("verdictPreview", () => c.verdictPreview(USDT));
await step("services", () => c.services());
await step("watchtowerSample", () => c.watchtowerSample(USDT), true);
await step("buildcheckSample", () => c.buildcheckSample("https://example.com"), true);
await step("crews", () => c.crews(), true);
process.exit(results.some((r) => r[1] === "FAIL") ? 1 : 0);
