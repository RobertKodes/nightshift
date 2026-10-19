import { encodeFunctionData, erc20Abi, parseAbi, parseEther, toFunctionSelector } from "viem";
import { eth } from "./chain.js";
import { DEAD, DEV_WALLET, FIRST_BUYER, IMD_BURN_EXECUTOR, TREASURY_WALLET } from "./shift-launch.js";
import { type PoolKey, V4, findPool, quoteArgs, quoterAbi, routerAbi, swapCall } from "./v4.js";

/**
 * Did IMD build what we asked for? Run after deploy and before the first buyer buys: until then
 * nobody can trade, so a wrong deploy costs nothing but a new launch. Every check reads the
 * chain itself; addresses baked into a contract are found in its bytecode, so no check trusts
 * the names or the ABI the swarm chose.
 */
export type Check = { label: string; ok: boolean; detail: string };

const FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const OWNED = parseAbi(["function owner() view returns (address)", "function tradingOpen() view returns (bool)"]);
/**
 * Every function a plain fixed-supply token may have: ERC-20, permit, burning your own tokens, and
 * read-only constants. Anything else in its dispatcher (a mint under any name, a tax, a blocklist,
 * a pause, an owner switch) fails the check, whatever it is called.
 */
const ALLOWED = new Set([
  "name()", "symbol()", "decimals()", "totalSupply()", "balanceOf(address)", "transfer(address,uint256)", "transferFrom(address,address,uint256)",
  "approve(address,uint256)", "allowance(address,address)", "increaseAllowance(address,uint256)", "decreaseAllowance(address,uint256)",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "nonces(address)", "DOMAIN_SEPARATOR()", "eip712Domain()",
  "burn(uint256)", "SUPPLY()", "MAX_SUPPLY()", "TOTAL_SUPPLY()", "supportsInterface(bytes4)",
].map((x) => toFunctionSelector(x).slice(2)));
/** Names for the selectors that matter most, in the report. */
const KNOWN: Record<string, string> = { "40c10f19": "mint(address,uint256)", "a0712d68": "mint(uint256)", "449a52f8": "mintTo(address,uint256)", "8456cb59": "pause()", "f9f92be4": "blacklist(address)", "69fe0e2d": "setFee(uint256)", "8da5cb5b": "owner()", "f2fde38b": "transferOwnership(address)" };

/**
 * The function selectors in a contract's dispatcher: each `PUSH4 <selector>` that is compared with
 * the call's selector (EQ, also after a DUP/SWAP, or the GT/LT of a split dispatcher).
 */
export function dispatcherSelectors(code: string): string[] {
  const b = Buffer.from(code.replace(/^0x/, ""), "hex");
  const out = new Set<string>();
  for (let i = 0; i < b.length; i++) {
    const op = b[i]!;
    if (op === 0x63 && i + 5 < b.length) {
      const next = b[i + 5]!, after = b[i + 6];
      const compared = next === 0x14 || next === 0x11 || next === 0x10 || ((next >= 0x80 && next <= 0x9f) && after === 0x14);
      const sel = b.subarray(i + 1, i + 5).toString("hex");
      if (compared && sel !== "ffffffff") out.add(sel); // not the uint32 mask of a range check
    }
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // skip push data
  }
  return [...out];
}

const has = (code: string, addr: string) => code.toLowerCase().includes(addr.toLowerCase().slice(2));

export async function verifyShift(c: Record<string, string>): Promise<Check[]> {
  const out: Check[] = [];
  const add = (label: string, ok: boolean, detail = "") => out.push({ label, ok, detail });
  const code = async (a?: string) => (a ? ((await eth.getCode({ address: a as `0x${string}` }).catch(() => undefined)) ?? "0x") : "0x");
  const token = c.token as `0x${string}`;

  // The token
  const [supply, decimals, symbol, name, devBal] = await Promise.all([
    eth.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }).catch(() => -1n),
    eth.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => -1),
    eth.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => ""),
    eth.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => ""),
    eth.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [DEV_WALLET] }).catch(() => -1n),
  ]);
  add("Token is NIGHTSHIFT / SHIFT", symbol === "SHIFT" && /nightshift/i.test(name), `${name} / ${symbol}`);
  add("Supply is 1,000,000,000 with 18 decimals", supply === 10n ** 27n && decimals === 18, `${supply} / ${decimals}`);
  add("Your dev wallet got its share", devBal > 0n, `${(Number(devBal) / 1e18).toLocaleString("en-US")} SHIFT (IMD seeds poolBps of the whole supply)`);
  const tcode = await code(token);
  const sels = dispatcherSelectors(tcode);
  const bad = sels.filter((x) => !ALLOWED.has(x)).map((x) => KNOWN[x] ?? `0x${x}`);
  add("Token has no mint, pause, blacklist or fee switch", tcode.length > 2 && sels.length > 0 && bad.length === 0, bad.length ? `functions beyond a plain ERC-20: ${bad.join(", ")}` : `${sels.length} functions, all plain ERC-20`);

  // The hook: closed, owned by you, gated on the first buyer
  const hook = c.hook as `0x${string}` | undefined;
  const hcode = await code(hook);
  add("Hook contract deployed", hcode.length > 2, hook ?? "not found in the launch");
  if (hook) {
    const open = await eth.readContract({ address: hook, abi: OWNED, functionName: "tradingOpen" }).catch(() => null);
    add(open ? "Trading is open to everyone (the treasury bought first)" : "Trading is still closed (only the first buyer can buy)", open === false || open === true, String(open));
    const owner = await eth.readContract({ address: hook, abi: OWNED, functionName: "owner" }).catch(() => null);
    add("Hook owner is your dev wallet", owner?.toLowerCase() === DEV_WALLET, String(owner));
    add("Hook names the first buyer 0x3322…4D69", has(hcode, FIRST_BUYER));
    // The gate, tried for real without spending: simulated swaps against today's chain.
    const pool = await findPool(eth, token, hook).catch(() => null);
    add("SHIFT/ETH pool exists with our hook", Boolean(pool), pool ? `fee ${pool.fee}, tick spacing ${pool.tickSpacing}` : "no Initialize event found");
    if (pool) for (const r of await simulateGate(pool)) out.push(open && r.label.startsWith("A stranger") ? { label: "Anyone can buy now", ok: r.detail === "ok", detail: r.detail } : r);
  }

  // The fee split: every fixed address is in the splitter's code
  const scode = await code(c.splitter);
  add("Fee splitter deployed", scode.length > 2, c.splitter ?? "not found in the launch");
  add("Splitter pays your dev wallet", has(scode, DEV_WALLET));
  add("Splitter pays the treasury 0x3322…4D69", has(scode, TREASURY_WALLET));
  add("Splitter burns IMD at IMD's BurnExecutor 0xe293…c750", has(scode, IMD_BURN_EXECUTOR));
  const dead = c.splitter ? await eth.readContract({ address: c.splitter as `0x${string}`, abi: parseAbi(["function DEAD() view returns (address)"]), functionName: "DEAD" }).catch(() => null) : null;
  add("Splitter burns SHIFT at 0x…dEaD", dead?.toLowerCase() === DEAD || has(scode, DEAD) || scode.includes("61dead"), String(dead ?? ""));

  // Rewards: owned by you, pays NIGHT FROGS
  const rewards = c.rewards as `0x${string}` | undefined;
  const rcode = await code(rewards);
  add("Rewards / staking contract deployed", rcode.length > 2, rewards ?? "not found in the launch");
  if (rewards) {
    const owner = await eth.readContract({ address: rewards, abi: OWNED, functionName: "owner" }).catch(() => null);
    add("Rewards owner is your dev wallet", owner?.toLowerCase() === DEV_WALLET, String(owner));
    add("Rewards pays NIGHT FROGS holders", has(rcode, FROGS));
  }

  // Every function the site, the keeper and /setup call is really there (selectors in the code).
  const missing = (code: string, sigs: string[]) => sigs.filter((x) => !code.includes(toFunctionSelector(x).slice(2)));
  const sm = missing(scode, ["distribute(address)", "burnReserve(address,uint256,uint256)", "setKeeper(address)", "reserve(address)"]);
  add("Splitter has distribute, burnReserve, setKeeper, reserve", scode.length > 2 && sm.length === 0, sm.join(", ") || "all found");
  const rm = missing(rcode, ["stake(uint256,uint256)", "withdraw(uint256)", "getReward()", "balanceOf(address)", "earned(address,address)", "postRoot(uint256,bytes32,address,uint256)", "claimFrogs(uint256,address,uint256,bytes32[])"]);
  add("Rewards has stake, withdraw, claim, earned, postRoot, claimFrogs", rcode.length > 2 && rm.length === 0, rm.join(", ") || "all found");
  return out;
}

const RANDOM = "0x1111111111111111111111111111111111111111";

/**
 * Before trading opens: a stranger's buy must fail, and the treasury's buy must go through the
 * Universal Router (the same call the site and Uniswap send). Both are eth_calls with a balance
 * override, so nothing is signed or spent.
 */
export async function simulateGate(pool: PoolKey): Promise<Check[]> {
  const amt = parseEther("0.001");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const buy = (from: `0x${string}`) => eth.call({
    account: from, to: V4.router, value: amt, stateOverride: [{ address: from, balance: parseEther("1") }],
    data: encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ((s) => [s.commands, s.inputs, s.deadline] as const)(swapCall(pool, true, amt, 1n, deadline)) }),
  }).then(() => "ok", (e: Error) => `reverted: ${e.message.split("\n")[0]!.slice(0, 100)}`);
  const stranger = await buy(RANDOM);
  const treasury = await buy(FIRST_BUYER as `0x${string}`);
  const quote = await eth.simulateContract({ account: FIRST_BUYER as `0x${string}`, address: V4.quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: quoteArgs(pool, true, amt) as never })
    .then((r) => (r.result as readonly bigint[])[0]!, () => 0n);
  return [
    { label: "A stranger's buy is refused before the first buy", ok: stranger !== "ok", detail: stranger },
    { label: "The treasury's first buy works through the Uniswap router", ok: treasury === "ok", detail: treasury },
    { label: "The quoter prices the treasury's buy", ok: quote > 0n, detail: `0.001 ETH → ${Number(quote) / 1e18} SHIFT` },
  ];
}
