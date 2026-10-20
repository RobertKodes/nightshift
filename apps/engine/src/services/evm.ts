import { type Address, type Hex, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, keccak256, pad, parseAbi, toFunctionSelector, toHex } from "viem";
import { dispatcherSelectors } from "../shift-verify.js";
import { type Rpc, multicall } from "./net.js";

/** Reading contracts without trusting their names: opcodes, dispatchers, storage slots. */

export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
export const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const lc = (a: string) => a.toLowerCase() as Address;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ---------------------------------------------------------------- bytecode

export type CodeScan = {
  bytes: number; selectors: string[];
  delegatecall: boolean; selfdestruct: boolean; callcode: boolean; create2: boolean;
  /** Addresses written into the code as constants (PUSH20): what the contract is wired to. */
  embedded: Address[];
  /** EIP-1167 minimal proxy: the implementation it forwards every call to. */
  minimalProxyTo: Address | null;
  /** Every 4-byte constant in the code: the selectors it calls on other contracts are among them. */
  pushed4: Set<string>;
};

/** Walks the code once, skipping PUSH data, so an opcode found is an opcode the contract can run. */
export function scanCode(code: Hex): CodeScan {
  const b = Buffer.from(code.replace(/^0x/, ""), "hex");
  const seen = new Set<number>();
  const embedded = new Set<string>();
  const pushed4 = new Set<string>();
  for (let i = 0; i < b.length; i++) {
    const op = b[i]!;
    seen.add(op);
    if (op === 0x63 && i + 4 < b.length) pushed4.add(b.subarray(i + 1, i + 5).toString("hex"));
    if (op === 0x73 && i + 20 < b.length) {
      const a = `0x${b.subarray(i + 1, i + 21).toString("hex")}`;
      if (!/^0x(0{40}|f{40})$/.test(a) && !/^0x0{24}/.test(a)) embedded.add(a);
    }
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  const hex = b.toString("hex");
  const m = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/.exec(hex);
  return {
    bytes: b.length, selectors: dispatcherSelectors(code),
    delegatecall: seen.has(0xf4), selfdestruct: seen.has(0xff), callcode: seen.has(0xf2), create2: seen.has(0xf5),
    embedded: [...embedded].map((a) => a as Address), minimalProxyTo: m ? (`0x${m[1]}` as Address) : null, pushed4,
  };
}

// ---------------------------------------------------------------- what functions can do

export type Power = "mint" | "pause" | "blacklist" | "fees" | "limits" | "trading" | "ownership" | "upgrade" | "withdraw" | "burn-other" | "roles" | "hook-admin" | "rebase";
const POWER_SIGS: Record<Power, string[]> = {
  mint: ["mint(address,uint256)", "mint(uint256)", "mintTo(address,uint256)", "mint(address,uint256,bytes)", "issue(uint256)", "mintFor(address,uint256)", "ownerMint(address,uint256)", "adminMint(address,uint256)", "airdropMint(address[],uint256[])"],
  pause: ["pause()", "unpause()", "setPaused(bool)", "togglePause()", "setPause(bool)"],
  blacklist: ["blacklist(address)", "blacklist(address,bool)", "addToBlacklist(address)", "removeFromBlacklist(address)", "setBlacklist(address,bool)", "setBlacklisted(address,bool)", "blockAddress(address)", "addBlacklist(address)",
    "setBots(address[],bool)", "setBot(address,bool)", "blockBots(address[])", "addBots(address[])", "delBot(address)", "freeze(address)", "setFrozen(address,bool)", "setBlocked(address,bool)", "denylist(address,bool)", "isBlacklisted(address)", "isBot(address)", "bots(address)"],
  fees: ["setFee(uint256)", "setFees(uint256,uint256)", "setFees(uint16,uint16)", "setTaxes(uint256,uint256)", "setBuyFee(uint256)", "setSellFee(uint256)", "setTax(uint256)", "setTaxFee(uint256)", "updateFees(uint256,uint256)", "setBuyTax(uint256)", "setSellTax(uint256)",
    "setFeePercent(uint256)", "setSwapFee(uint256)", "setFeeRecipient(address)", "setTreasury(address)", "setMarketingWallet(address)", "setFeeBps(uint256)", "setHookFee(uint24)", "setLpFee(uint24)", "setDynamicFee(uint24)", "setFeeTo(address)", "updateBuyFees(uint256,uint256,uint256)", "updateSellFees(uint256,uint256,uint256)"],
  limits: ["setMaxTxAmount(uint256)", "setMaxWallet(uint256)", "setMaxWalletSize(uint256)", "setMaxTransaction(uint256)", "removeLimits()", "setCooldown(uint256)", "excludeFromFee(address)", "excludeFromFees(address,bool)", "setExcludedFromFee(address,bool)", "excludeFromMaxTransaction(address,bool)", "setWhitelist(address,bool)"],
  trading: ["setTradingEnabled(bool)", "enableTrading()", "openTrading()", "setTradingOpen(bool)", "startTrading()", "setTrading(bool)"],
  ownership: ["transferOwnership(address)", "renounceOwnership()", "acceptOwnership()", "setOwner(address)"],
  upgrade: ["upgradeTo(address)", "upgradeToAndCall(address,bytes)", "changeAdmin(address)", "setImplementation(address)", "upgrade(address)"],
  withdraw: ["withdraw()", "withdraw(address)", "withdraw(address,address)", "withdrawTokens(address)", "rescueTokens(address,uint256)", "rescueETH()", "emergencyWithdraw()", "recoverERC20(address,uint256)", "sweep(address)", "withdrawETH()", "rescue(address,uint256)", "clearStuckBalance()", "manualSwap()", "manualsend()"],
  "burn-other": ["burn(address,uint256)", "adminBurn(address,uint256)", "burnFromAddress(address,uint256)"],
  roles: ["grantRole(bytes32,address)", "revokeRole(bytes32,address)", "setMinter(address,bool)", "addMinter(address)", "setOperator(address,bool)", "setAdmin(address)"],
  "hook-admin": ["setPoolManager(address)", "setRouter(address)", "setAllowedRouter(address,bool)", "setKeeper(address)", "setSigner(address)"],
  rebase: ["rebase(uint256,int256)", "setRebase(uint256)", "rebase(int256)"],
};
/** Every selector we can name, with what it can do. */
export const SELECTOR_POWER = new Map<string, { sig: string; power: Power }>();
for (const [power, sigs] of Object.entries(POWER_SIGS) as [Power, string[]][]) for (const sig of sigs) SELECTOR_POWER.set(toFunctionSelector(sig).slice(2), { sig, power });
/** Plain names for selectors that carry no power, so a report can say what a contract is. */
export const PLAIN = new Map<string, string>([
  "name()", "symbol()", "decimals()", "totalSupply()", "balanceOf(address)", "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)", "allowance(address,address)",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "nonces(address)", "DOMAIN_SEPARATOR()", "eip712Domain()", "burn(uint256)", "burnFrom(address,uint256)", "owner()", "getOwner()", "supportsInterface(bytes4)",
  "increaseAllowance(address,uint256)", "decreaseAllowance(address,uint256)", "paused()", "implementation()", "proxiableUUID()",
].map((s) => [toFunctionSelector(s).slice(2), s]));

/** A name by power, for a function found in source (any capitalisation). */
export function powerOfName(name: string): Power | null {
  const n = name.toLowerCase();
  if (/^_/.test(n)) return null;
  if (/^(mint|mintto|ownermint|adminmint|issue|mintfor)$/.test(n)) return "mint";
  if (/^(pause|unpause|setpaused|togglepause|setpause)$/.test(n)) return "pause";
  if (/(blacklist|blocklist|denylist|setbots?$|addbots|delbot|blockbots|freeze|setfrozen|setblocked)/.test(n)) return "blacklist";
  if (/^(set|update)\w*(fee|tax)/.test(n) || /^set(treasury|feerecipient|marketingwallet|feeto|feesplitter)$/.test(n)) return "fees";
  if (/^(setmax|removelimits|setcooldown|exclude|setexcluded|setwhitelist)/.test(n)) return "limits";
  if (/^(settradingenabled|enabletrading|opentrading|settradingopen|starttrading|settrading)$/.test(n)) return "trading";
  if (/^(transferownership|renounceownership|acceptownership|setowner)$/.test(n)) return "ownership";
  if (/^(upgradeto|upgradetoandcall|changeadmin|setimplementation|upgrade)$/.test(n)) return "upgrade";
  if (/^(withdraw|rescue|recover|sweep|emergencywithdraw|clearstuck|manualswap|manualsend)/.test(n)) return "withdraw";
  if (/^(grantrole|revokerole|setminter|addminter|setoperator|setadmin)$/.test(n)) return "roles";
  if (/^(setpoolmanager|setrouter|setallowedrouter|setkeeper|setsigner)$/.test(n)) return "hook-admin";
  if (/^(rebase|setrebase)$/.test(n)) return "rebase";
  return null;
}

/** Names for unknown selectors from the public signature database (openchain.xyz), best guess first. */
export async function lookupSelectors(net: { json<T>(u: string, t?: number): Promise<T> }, sels: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = sels.filter((s) => !SELECTOR_POWER.has(s) && !PLAIN.has(s));
  for (let i = 0; i < want.length; i += 60) {
    const part = want.slice(i, i + 60);
    const r = await net.json<{ ok?: boolean; result?: { function?: Record<string, { name: string; hasVerifiedContract?: boolean }[] | null> } }>(
      `https://api.openchain.xyz/signature-database/v1/lookup?function=${part.map((s) => `0x${s}`).join(",")}&filter=true`, 8_000).catch(() => null);
    for (const [k, v] of Object.entries(r?.result?.function ?? {})) {
      const best = (v ?? []).sort((a, b) => Number(Boolean(b.hasVerifiedContract)) - Number(Boolean(a.hasVerifiedContract)))[0];
      if (best) out.set(k.replace(/^0x/, ""), best.name);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ERC-20 and owner reads

const ERC20 = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)", "function owner() view returns (address)", "function getOwner() view returns (address)",
]);
const dec1 = <T,>(type: string, data: Hex | null): T | null => { try { return data ? (decodeAbiParameters([{ type }], data)[0] as T) : null; } catch { return null; } };
/** bytes32 names (old tokens) as text. */
const str = (data: Hex | null): string | null => {
  const s = dec1<string>("string", data);
  if (s !== null) return s;
  if (data && data.length === 66) return Buffer.from(data.slice(2), "hex").toString("utf8").replace(/\0+$/, "") || null;
  return null;
};

export type TokenBasics = { name: string | null; symbol: string | null; decimals: number | null; totalSupply: bigint | null; owner: Address | null };
export async function tokenBasics(rpc: Rpc, token: Address): Promise<TokenBasics> {
  const fns = ["name", "symbol", "decimals", "totalSupply", "owner", "getOwner"] as const;
  const r = await multicall(rpc, fns.map((f) => ({ to: token, data: encodeFunctionData({ abi: ERC20, functionName: f }) })));
  const owner = dec1<Address>("address", r[4] ?? null) ?? dec1<Address>("address", r[5] ?? null);
  const d = dec1<number>("uint8", r[2] ?? null);
  return { name: str(r[0] ?? null), symbol: str(r[1] ?? null), decimals: d === null ? null : Number(d), totalSupply: dec1<bigint>("uint256", r[3] ?? null), owner: owner ? lc(owner) : null };
}

export async function balancesOf(rpc: Rpc, token: Address, who: Address[]): Promise<(bigint | null)[]> {
  const r = await multicall(rpc, who.map((a) => ({ to: token, data: encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [a] }) })));
  return r.map((x) => dec1<bigint>("uint256", x));
}

/** The symbol() of many tokens in one or a few calls. */
export async function symbolsOf(rpc: Rpc, tokens: Address[]): Promise<(string | null)[]> {
  const r = await multicall(rpc, tokens.map((t) => ({ to: t, data: encodeFunctionData({ abi: ERC20, functionName: "symbol" }) })));
  return r.map(str);
}

// ---------------------------------------------------------------- proxies

export const SLOTS = {
  eip1967Impl: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  eip1967Admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  eip1967Beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  zeppelinosImpl: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
} as const satisfies Record<string, Hex>;
const slotAddr = (v: Hex): Address | null => { const a = `0x${v.replace(/^0x/, "").padStart(64, "0").slice(24)}`; return /^0x0{40}$/.test(a) ? null : lc(a); };

export type ProxyInfo = { proxy: boolean; kind: "eip1967" | "beacon" | "eip1167" | "zeppelinos" | null; implementation: Address | null; admin: Address | null };
export async function proxyInfo(rpc: Rpc, address: Address, scan: CodeScan): Promise<ProxyInfo> {
  if (scan.minimalProxyTo) return { proxy: true, kind: "eip1167", implementation: lc(scan.minimalProxyTo), admin: null };
  const [impl, admin, beacon, zos] = await Promise.all([SLOTS.eip1967Impl, SLOTS.eip1967Admin, SLOTS.eip1967Beacon, SLOTS.zeppelinosImpl].map((s) => rpc.storage(address, s).catch(() => "0x" as Hex)));
  const i = slotAddr(impl!), a = slotAddr(admin!), b = slotAddr(beacon!), z = slotAddr(zos!);
  if (i) return { proxy: true, kind: "eip1967", implementation: i, admin: a };
  if (b) return { proxy: true, kind: "beacon", implementation: b, admin: a };
  if (z) return { proxy: true, kind: "zeppelinos", implementation: z, admin: a };
  return { proxy: false, kind: null, implementation: null, admin: a };
}

// ---------------------------------------------------------------- balances by storage override

const OZ5_ERC20 = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";
/** Where a holder's balance may live, for the usual ERC-20 layouts (Solidity mappings, Vyper, OpenZeppelin 5 namespaced, Solady). */
export function balanceSlotCandidates(holder: Address): { name: string; slot: Hex }[] {
  const out: { name: string; slot: Hex }[] = [];
  for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 51, 101]) out.push({ name: `mapping@${s}`, slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(s)])) });
  for (const s of [0, 1, 2, 3]) out.push({ name: `vyper@${s}`, slot: keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [BigInt(s), holder])) });
  out.push({ name: "oz5-namespaced", slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [holder, OZ5_ERC20])) });
  out.push({ name: "solady", slot: keccak256(encodePacked(["address", "uint64", "uint32"], [holder, 0n, 0x87a211a2])) });
  return out;
}

/**
 * Finds the storage slot of `holder`'s balance in one eth_call: every candidate slot is overridden
 * with its own marker value and balanceOf says which one the token reads. Null for tokens whose
 * balance is computed (reflection, rebasing) rather than stored.
 */
export async function findBalanceSlot(rpc: Rpc, token: Address, holder: Address): Promise<Hex | null> {
  const c = balanceSlotCandidates(holder);
  const base = 0x5eed000000n;
  const r = await rpc.call({
    to: token, data: encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [holder] }),
    override: [{ address: token, stateDiff: c.map((x, i) => ({ slot: x.slot, value: pad(toHex(base + BigInt(i)), { size: 32 }) })) }],
  });
  if (!r.ok) return null;
  const v = dec1<bigint>("uint256", r.data);
  if (v === null || v < base || v >= base + BigInt(c.length)) return null;
  return c[Number(v - base)]!.slot;
}

export const checksum = (a: string) => getAddress(a);
