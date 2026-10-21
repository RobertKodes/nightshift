#!/usr/bin/env node
// NIGHT WATCH: the keeper bot of a Night Watch seat (a Night Watcher, or the Captain's seat of NIGHT FROG #1).
//
//   node bot.mjs start         first run: makes a fresh keeper wallet if there is none, prints the pairing link,
//                              waits until you have signed it, then runs (report only; add --execute to act)
//   node bot.mjs doctor        checks everything: Node, the key, gas, imdUSD, the coordinator, the seat
//   node bot.mjs pair          prints the pairing link again
//   node bot.mjs               report only: ask for jobs and print what it would do, send nothing
//   node bot.mjs --execute     do the jobs: mark loans, liquidate your share, pay the cut
//   add --once                 one pass, then exit (for cron)
//
// It acts only on the jobs the NIGHTSHIFT coordinator hands this seat, so the seats never race each other.
// Everything a liquidation pays (staked IMD at a 16-18% bonus) stays in this keeper wallet; the cut, a share
// of that bonus, goes in IMD to the NIGHTSHIFT FeeSplitter, which shares it with $SHIFT stakers and frog
// holders and burns a fifth of it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { erc20Abi, formatEther, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = new URL("./.env", import.meta.url);
// .env next to the bot, so `node bot.mjs` works without --env-file; the shell's own variables win
const loadEnv = () => {
  if (!existsSync(ENV)) return;
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
};
loadEnv();

const args = process.argv.slice(2);
const CMD = args.find((a) => !a.startsWith("--")) ?? "run";
const EXECUTE = args.includes("--execute"), ONCE = args.includes("--once");

// first run: a fresh keeper wallet, kept in .env on this machine only
if (CMD === "start" && !process.env.KEEPER_PRIVATE_KEY && !process.env.KEEPER_MNEMONIC) {
  const key = generatePrivateKey();
  writeFileSync(ENV, `# The keeper wallet of this Night Watch bot. It never leaves this machine: back it up, never share it.\nKEEPER_PRIVATE_KEY=${key}\n`, { mode: 0o600 });
  try { chmodSync(ENV, 0o600); } catch { /* Windows */ }
  process.env.KEEPER_PRIVATE_KEY = key;
  console.log(`\nMade a fresh keeper wallet: ${privateKeyToAccount(key).address}\nIts key is in ${fileURLToPath(ENV)} (only on this machine). Back it up.`);
}

const { describe, keeperAccount, reader, send } = await import("./lib/chain.mjs");
const { SITE, jobs, pairLink } = await import("./lib/coordinator.mjs");
const { cutPayment, decide } = await import("./lib/plan.mjs");

const VAULT = "0x0b69F8DA8D8cE521d74Ea69a7A3475B77302EF82";
const IMDUSD = "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25";
const SIMD = "0x9Efa934D9fAd4AE28c998a40195646b965a97247";
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const VAULT_ABI = parseAbi(["function barkFor(address owner, address beneficiary)", "function bite(address owner, uint256 debtToRepay)"]);
const SIMD_ABI = parseAbi(["function withdraw(uint256 assets, address to, address owner) returns (uint256)", "function previewWithdraw(uint256 assets) view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);

const POLL = Number(process.env.POLL_SECONDS ?? 15);
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (...a) => console.log(stamp(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wad = (x) => Number(formatEther(x)).toLocaleString("en-US", { maximumFractionDigits: 4 });

const STATE = new URL("./state/", import.meta.url);
const PAID = new URL("./state/paid.json", import.meta.url);
const lastPaid = () => { try { return existsSync(PAID) ? JSON.parse(readFileSync(PAID, "utf8")) : null; } catch { return null; } };

const account = keeperAccount();
const fund = `Send it some ETH for gas (0.03 is plenty) and the imdUSD you want to liquidate with. A seat with no imdUSD can still mark loans.`;

if (CMD === "pair") {
  console.log(`\nKeeper wallet: ${account.address}\n\nOpen this link, connect the wallet that holds your seat (your Night Watcher, or NIGHT FROG #1), pick it and sign:\n\n  ${pairLink(account.address)}\n`);
  try { console.log(`Already paired: this keeper serves ${(await jobs(account)).seat}.`); }
  catch (e) { console.log(e.status === 404 ? "Not paired yet. Run `node bot.mjs doctor` after signing to check." : `The coordinator at ${SITE} said: ${e.message}`); }
  process.exit(0);
}

if (CMD === "doctor") process.exit(await doctor());

if (CMD === "start") {
  // wait for the holder's signature, like an IMD worker waits for its seat
  let r = await jobs(account).catch((e) => e);
  if (r?.status === 404) {
    console.log(`\nKeeper wallet: ${account.address}\n${fund}\n\nNow pair it to your seat. Open this link, connect the wallet that holds your Night Watcher (or NIGHT FROG #1) and sign:\n\n  ${pairLink(account.address)}\n\nWaiting for the signature… (Ctrl-C to stop; run \`node bot.mjs start\` again any time)`);
    for (let i = 0; i < 180 && r?.status === 404; i++) { await sleep(5_000); r = await jobs(account).catch((e) => e); }
  }
  if (r instanceof Error) { console.log(r.status === 404 ? "Still not paired. Run `node bot.mjs start` again when you have signed." : `The coordinator at ${SITE} said: ${r.message}`); process.exit(1); }
  console.log(`\nPaired: this keeper serves ${r.seat}.\nNext: \`node bot.mjs doctor\` checks the setup, and the bot below runs report-only until you start it with --execute.\nTo keep it running after you log out, see nightwatch.service in this folder.\n`);
}

/** Every check a holder needs before running with --execute. Exit code 0 when nothing blocks. */
async function doctor() {
  let bad = 0;
  const line = (ok, what, more = "") => { console.log(`${ok === true ? "  ok  " : ok === false ? "  FIX " : "  --  "} ${what}${more ? `: ${more}` : ""}`); if (ok === false) bad++; };
  console.log(`\nNIGHT WATCH doctor\n`);
  line(Number(process.versions.node.split(".")[0]) >= 20, "Node.js 20 or newer", process.versions.node);
  line(true, "Keeper wallet", account.address);
  const block = await reader.getBlockNumber().catch(() => null);
  line(block !== null, "Ethereum reachable", block === null ? "no node answered (READ_RPC_URLS)" : `block ${block}`);
  if (block !== null) {
    const [eth, usd, simd, imd] = await Promise.all([
      reader.getBalance({ address: account.address }),
      reader.readContract({ address: IMDUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
      reader.readContract({ address: SIMD, abi: SIMD_ABI, functionName: "balanceOf", args: [account.address] }),
      reader.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    ]);
    line(eth >= parseEther(process.env.MIN_ETH ?? "0.003"), "ETH for gas", `${wad(eth)} ETH${eth < parseEther("0.003") ? ". " + fund : ""}`);
    line(usd > 0n ? true : null, "imdUSD to liquidate with", usd > 0n ? `${wad(usd)} imdUSD` : "none: this seat can mark loans but not liquidate them (buy imdUSD in its USDC pool or borrow it at imdusd.com)");
    line(null, "Staked IMD and IMD (paid in, used for the cut)", `${wad(simd)} sIMD, ${wad(imd)} IMD`);
  }
  const r = await jobs(account).catch((e) => e);
  if (r instanceof Error) {
    line(false, "Paired to a seat", r.status === 404 ? `no: run \`node bot.mjs start\` and sign the link with the wallet that holds the seat` : `the coordinator at ${SITE} said: ${r.message}`);
  } else {
    line(true, "Paired to a seat", `${r.seat}, share ${r.weight}x, cut ${r.cut.bps / 100}%`);
    line(r.valid !== false, "The seat's holder still holds it", r.valid === false ? "no: the NFT changed hands; its new holder pairs their own keeper" : "yes");
    line(!r.arrears, "Cut paid up", r.arrears ? `${wad(BigInt(r.cut.dueImd))} IMD overdue: the bot pays it on its next pass if it holds the IMD or sIMD` : BigInt(r.cut.dueImd) > 0n ? `${wad(BigInt(r.cut.dueImd))} IMD due, paid on the next pass` : "nothing due");
    line(null, "Prices", r.stale?.length ? `waiting for a fresh price (${r.stale.join(", ")}): normal in a quiet market` : "live");
    line(null, "Jobs right now", r.jobs.length ? r.jobs.map((j) => j.kind).join(", ") : "none: no loan is under the line");
  }
  line(existsSync(new URL("./state/STOP", import.meta.url)) ? false : true, "Kill switch off", existsSync(new URL("./state/STOP", import.meta.url)) ? "state/STOP exists: nothing will be sent" : "");
  console.log(bad ? `\n${bad} thing${bad === 1 ? "" : "s"} to fix before --execute.\n` : `\nReady. Run \`node bot.mjs --execute\` (or the service) to act.\n`);
  return bad ? 1 : 0;
}

async function payCut(r) {
  const prev = lastPaid();
  const [simd, imd] = await Promise.all([
    reader.readContract({ address: r.cut.simd, abi: SIMD_ABI, functionName: "balanceOf", args: [account.address] }),
    reader.readContract({ address: r.cut.token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  const due = BigInt(r.cut.dueImd ?? "0");
  const need = due > 0n ? await reader.readContract({ address: r.cut.simd, abi: SIMD_ABI, functionName: "previewWithdraw", args: [due] }).catch(() => null) : 0n;
  const p = cutPayment({ dueImd: r.cut.dueImd, simdCovers: need !== null && simd >= need, imdBalance: imd, lastPaidAgoSeconds: prev ? (Date.now() - prev.at) / 1000 : null });
  if (!p.pay) { if (p.why) log(`cut     ${p.why}`); return; }
  log(`cut     ${wad(p.amount)} IMD due to the FeeSplitter, paying from ${p.from === "simd" ? "staked IMD" : "IMD"}`);
  if (!EXECUTE) return;
  const res = p.from === "simd"
    ? await send(account, "cut", { address: r.cut.simd, abi: SIMD_ABI, functionName: "withdraw", args: [p.amount, r.cut.to, account.address] })
    : await send(account, "cut", { address: r.cut.token, abi: erc20Abi, functionName: "transfer", args: [r.cut.to, p.amount] });
  log(`cut     ${describe(res)}`);
  if (res.hash) { mkdirSync(STATE, { recursive: true }); writeFileSync(PAID, JSON.stringify({ at: Date.now(), hash: res.hash, amount: p.amount.toString() })); }
}

async function pass() {
  let r;
  try {
    r = await jobs(account);
  } catch (e) {
    log(e.status === 404 ? `not paired: run \`node bot.mjs start\`` : `coordinator: ${e.message}`);
    return;
  }
  if (r.valid === false) log(`WARNING the wallet that paired ${r.seat} no longer holds it: no jobs until its holder pairs again`);
  if (r.arrears) log(`PAUSED  the cut is overdue: no jobs until it is paid`);
  await payCut(r).catch((e) => log(`cut     failed: ${e.message}`));
  if (r.stale?.length) { if (!r.jobs.length) log(`idle    ${r.seat}: prices are stale (${r.stale.join(", ")}), nothing can be marked or liquidated until a fresh price lands`); return; }
  if (!r.jobs.length) { log(`idle    ${r.seat}: no loan to act on`); return; }

  let inventory = await reader.readContract({ address: IMDUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  for (const job of r.jobs) {
    const now = Number((await reader.getBlock()).timestamp);
    let d = decide(job, { now, inventory, soonSeconds: POLL + 75 });
    if (d.act === "wait") {
      log(`wait    ${job.owner}: its window opens in ${d.seconds}s, ready to repay ${wad(d.amount)} imdUSD`);
      // sleep to the opening, then until a block carries a timestamp past it
      await sleep(Math.max(0, d.seconds - 2) * 1000);
      for (let i = 0; i < 30 && Number((await reader.getBlock()).timestamp) < job.opensAt; i++) await sleep(2_000);
      d = decide(job, { now: Number((await reader.getBlock()).timestamp), inventory });
    }
    if (d.act === "skip") { log(`skip    ${job.owner}: ${d.why}`); continue; }
    if (d.act === "bark") {
      log(`mark    ${job.owner}: under the minimum ratio, marking it for this seat (the marker's share is 2% of the debt)`);
      if (EXECUTE) log(`mark    ${describe(await send(account, "bark", { address: VAULT, abi: VAULT_ABI, functionName: "barkFor", args: [job.owner, account.address] }))}`);
      continue;
    }
    log(`bite    ${job.owner}: repaying ${wad(d.amount)} imdUSD for staked IMD worth about ${wad((d.amount * 120n) / 100n)} dollars`);
    if (!EXECUTE) continue;
    const res = await send(account, "bite", { address: VAULT, abi: VAULT_ABI, functionName: "bite", args: [job.owner, d.amount] });
    log(`bite    ${describe(res)}`);
    if (res.hash) inventory -= d.amount;
  }
}

log(`NIGHT WATCH keeper ${account.address} ${EXECUTE ? "IN EXECUTE MODE" : "report only (add --execute to act)"}, coordinator ${SITE}`);
for (;;) {
  await pass().catch((e) => log(`error   ${e.message}`));
  if (ONCE) break;
  await sleep(POLL * 1000);
}
