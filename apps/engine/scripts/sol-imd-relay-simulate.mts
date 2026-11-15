// Mainnet rehearsal of paying the IMD swarm's job in SOL, sending nothing: a live NIGHTSHIFT Swap (Relay) quote for a
// sample launch's exact job body (SOL on Solana -> 0.5 IMD on Robinhood Chain -> approve + Intake.request), the checks
// the engine runs before the page sees it, then the exact deposit the creator would sign, simulated from a funded
// public wallet (signatures not checked), to see what it would cost that wallet.
//   npx tsx scripts/sol-imd-relay-simulate.mts [funded Solana address] [picks, comma-separated]
import { VersionedTransaction } from "@solana/web3.js";
import { swarmBody, SWARM_PICKS, swarmEta, type SwarmPick } from "../src/sol-launch.ts";
import { liveRelayPay, relayPayProblem, relayPayRequest } from "../src/sol-relay.ts";
import { swapSettings } from "../src/swap.ts";

const RPC = process.env.SOL_RPC || "https://solana-rpc.publicnode.com";
const FUNDED = process.argv[2] ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const picks = (process.argv[3]?.split(",") ?? SWARM_PICKS) as SwarmPick[];
// the swap's fee wallet and fee from the environment only (never the live settings file)
const s = swapSettings({}, process.env);
const settings = { key: s.relayKey, feeWallet: s.feeWallet, feeBps: s.feeBps };
const sample = { mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgimd", name: "Night Frog", symbol: "NFROG", description: "A frog that works the night shift.", website: "", twitter: "https://x.com/nightfrog", telegram: "", image: "", creator: FUNDED, dev: null, logoIdea: "a green frog in a black hoodie" };
const body = JSON.stringify(swarmBody(sample, picks, "https://getnightshift.tech"));
const pay = liveRelayPay(() => RPC, () => settings);

console.log("request", JSON.stringify({ ...relayPayRequest({ creator: FUNDED, body, ...settings }), txs: `[approve, request(${body.length} bytes)]` }));
const { quote, feeWallet } = await pay.quote({ creator: FUNDED, body });
const bad = relayPayProblem(quote, { creator: FUNDED, body, feeWallet });
console.log("quote", JSON.stringify({
  checks: bad ?? "pass", requestId: quote.requestId, sol: Number(quote.inLamports) / 1e9, usdIn: quote.inUsd, usdOut: quote.outUsd, lossPct: +((1 - quote.outUsd / quote.inUsd) * 100).toFixed(2),
  out: `${Number(quote.outAmount) / 1e18} IMD on chain ${quote.outChain}`, recipient: quote.recipient, refunds: quote.refunds, calls: quote.calls.length, relaySeconds: quote.timeEstimate,
  steps: quote.steps, items: quote.items, programs: [...new Set(quote.instructions.map((i) => i.programId))],
}));
const eta = swarmEta(picks);
console.log("swarm eta (minutes, approximate)", JSON.stringify({ picks, ...eta }));
if (bad) process.exit(1);
try {
  const built = await pay.build(quote, FUNDED);
  const tx = VersionedTransaction.deserialize(Buffer.from(built.tx, "base64"));
  console.log("simulated", JSON.stringify({ from: FUNDED, walletLosesSol: Number(built.lamports) / 1e9, quotedSol: Number(quote.inLamports) / 1e9, bytes: tx.serialize().length, signers: tx.message.header.numRequiredSignatures, signed: tx.signatures.some((x) => x.some((b) => b !== 0)), lookupTables: tx.message.addressTableLookups.length }));
} catch (e) {
  console.log("simulation refused:", (e as Error).message);
  process.exit(1);
}

process.exit(0);
