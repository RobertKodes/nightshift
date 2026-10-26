// Quote first; save the exact signed payment before sending, then resume that same request.
import { mkdirSync, existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { NightshiftClient, HOUSE_TOOLS, type HouseTool, type SignedRequest, type SwarmInput, type SwarmQuote } from "../../integrations/nightshift-client/dist/index.js";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2), value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const maxUsd = Number(value("--max-usd")), file = value("--state"), dry = args.includes("--dry-run");
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("Pass --max-usd <positive finite budget>.");
if (!file && !dry) throw new Error("Pass --state <private-json-file> to save payment before submission.");
const c = new NightshiftClient();
type State = { quote?: SwarmQuote; tool?: HouseTool; input?: Record<string, string>; request?: SignedRequest; receipt?: Record<string, any> };
let state: State = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const save = () => { if (!file) return; mkdirSync(dirname(file), { recursive: true }); const fd = openSync(`${file}.tmp`, "w", 0o600); try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); } finally { closeSync(fd); } renameSync(`${file}.tmp`, file); };
if (!state.quote && !state.tool) {
  const path = value("--input"), input = path ? JSON.parse(readFileSync(path, "utf8")) : { kind: "research", brief: "Compare Ethereum rollup proof systems with primary citations." };
  const tool = value("--tool");
  if (tool) { if (!(HOUSE_TOOLS as readonly string[]).includes(tool)) throw new Error("Unknown house tool."); state = { tool: tool as HouseTool, input: path ? input : {} }; }
  else state.quote = await c.swarmQuote(input as SwarmInput);
  save();
}
console.log(state.quote ? { kind: state.quote.kind, priceUsd: state.quote.priceUsd, expiresAt: state.quote.expiresAt } : { tool: state.tool, maxUsd });
if (!dry) {
  if (!state.request) {
    const key = process.env.NIGHTSHIFT_PRIVATE_KEY;
    if (!/^0x[\da-f]{64}$/i.test(key ?? "")) throw new Error("Set NIGHTSHIFT_PRIVATE_KEY in your secret environment (a funded Base USDC wallet).");
    const x402 = new x402Client().register("eip155:8453", new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(key as `0x${string}`))));
    const sign = async (requirement: any, ctx: any) => encodePaymentSignatureHeader(await x402.createPaymentPayload({ x402Version: 2, resource: ctx.resource, accepts: [requirement] }));
    const opts = { maxUsd, sign };
    state.request = state.quote ? await c.prepareSwarmOrder(state.quote, opts) : await c.prepareHouseTool(state.tool!, state.input!, opts);
    save();
  }
  if (!state.receipt) {
    const receipt = await c.submitPaid(state.request);
    if (receipt.pending || receipt.status === "settling") { console.log("Pending. Rerun with the same --state file; never sign a replacement."); process.exit(0); }
    state.receipt = receipt; save();
  }
  const result = state.quote ? await c.pollSwarm(state.receipt!.orderId, state.receipt!.orderToken) : state.receipt;
  console.log(JSON.stringify(result, null, 2));
  // orderToken and signature remain only in the private --state file.
} else console.log("Dry run: no payment signed or submitted.");
