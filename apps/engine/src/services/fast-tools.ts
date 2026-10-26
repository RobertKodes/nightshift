import { type Address, type Hex, decodeAbiParameters, decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, keccak256, parseAbi, parseUnits, toFunctionSelector, toHex } from "viem";
import { namehash, normalize } from "viem/ens";
import { IMD_FACTORIES, IMD_TOKEN } from "./imd.js";
import { TtlCache } from "./cache.js";
import type { Ctx } from "./context.js";
import { scanCode } from "./evm.js";
import { type Chain, type FastId, type FastInput, addressPattern } from "./fast-input.js";
import { BazaarIndex, BAZAAR_TTL, type BazaarSnapshot } from "./bazaar-index.js";
import { type Probe, USDC, listingsFor, probeSeller, sellerVerdict } from "./seller-check.js";
import type { Pair } from "./market.js";
import { type Source, verifiedSource } from "./source.js";

export type FastDeps = {
  rpc<T>(chain: Chain, method: string, params: unknown[]): Promise<T>;
  snapshot(): Promise<BazaarSnapshot>;
  probe(target: string): Promise<Probe>;
};
type Log = { address: string; topics: string[]; data: string; blockNumber?: string; transactionHash?: string; removed?: boolean };
type Receipt = { status: string; blockNumber: string; from: string; to: string | null; logs: Log[]; gasUsed: string; effectiveGasPrice: string; l1Fee?: string };
type Tx = { from: string; to: string | null; input: string; value: string; blockNumber: string | null };
type Block = { number: string; timestamp: string; baseFeePerGas?: string };
type Metadata = { decimals: number | null; symbol: string | null };
type Answer = Record<string, unknown> & { unavailable: string[] };
const TRANSFER = keccak256(new TextEncoder().encode("Transfer(address,address,uint256)"));
const ZERO = "0x0000000000000000000000000000000000000000";
const WETH = { ethereum: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", base: "0x4200000000000000000000000000000000000006" };
const CHAIN_ID = { ethereum: 1, base: 8453 };
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const registry = { ethereum: "0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e", base: "0xb94704422c2a1e396835a571837aa5ae53285a95" };
const nsAbi = parseAbi(["function resolver(bytes32) view returns (address)", "function addr(bytes32) view returns (address)", "function name(bytes32) view returns (string)", "function node(address) pure returns (bytes32)"]);
const num = (v: string | undefined) => v ? Number(BigInt(v)) : null;
const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;
const topicAddress = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

/** Stop waiting, while the bounded read may finish warming its cache. */
async function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Read deadline reached.")), Math.max(0, ms)); })]); }
  finally { if (timer) clearTimeout(timer); }
}

class Reads {
  readonly unavailable = new Set<string>();
  readonly end = performance.now() + 1_150;
  async get<T>(label: string, p: Promise<T>): Promise<T | undefined> {
    try { return await bounded(p, this.end - performance.now()); } catch { this.unavailable.add(label); return undefined; }
  }
}

/** Mainnet only, with no retries and a three-second upstream timeout. */
function liveRpc(): FastDeps["rpc"] {
  const urls = { ethereum: process.env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com", base: process.env.BASE_RPC ?? (process.env.SALES_CHAIN_ID === "8453" ? process.env.SALES_RPC : undefined) ?? "https://mainnet.base.org" };
  return async <T>(chain: Chain, method: string, params: unknown[]): Promise<T> => {
    const res = await fetch(urls[chain], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error("RPC unavailable.");
    const body = await res.json() as { result?: T; error?: unknown };
    if (body.error || !("result" in body)) throw new Error("RPC unavailable.");
    return body.result as T;
  };
}

export function fastTools(ctx: Ctx, injected?: FastDeps) {
  const index = injected ? null : new BazaarIndex(ctx.d.net, undefined, ctx.d.now);
  index?.start();
  const d: FastDeps = injected ?? { rpc: liveRpc(), snapshot: () => index!.snapshot(), probe: probeSeller };
  const raw = new TtlCache<unknown>(12_000, 8_000, ctx.d.now);
  const metadata = new TtlCache<Metadata>(60_000, 2_000, ctx.d.now);
  const sourceCache = new TtlCache<Source>(60_000, 1_000, ctx.d.now);
  const pairCache = new TtlCache<Pair[]>(30_000, 2_000, ctx.d.now);
  const probes = new TtlCache<Probe>(30_000, 1_000, ctx.d.now);
  const inflows = new TtlCache<unknown>(60 * 60_000, 500, ctx.d.now);
  const answers = new TtlCache<Answer>(30_000, 2_000, ctx.d.now);
  const names = new TtlCache<Answer>(60_000, 2_000, ctx.d.now);
  const gasCache = new TtlCache<Answer>(12_000, 2, ctx.d.now);
  const partial = new TtlCache<Answer>(3_000, 2_000, ctx.d.now);
  const pending = new Map<string, Promise<Answer>>();
  const samples = new Map<FastId, number[]>();

  const rpc = async <T>(chain: Chain, method: string, params: unknown[]): Promise<T> => method === "eth_getLogs" ? bounded(d.rpc<T>(chain, method, params), 3_000) : (await raw.get(`${chain}:${method}:${JSON.stringify(params)}`, () => bounded(d.rpc<T>(chain, method, params), 3_000))).v as T;
  const call = (chain: Chain, to: string, data: Hex, block = "latest") => rpc<Hex>(chain, "eth_call", [{ to, data }, block]);
  const source = async (chain: Chain, address: string) => (await sourceCache.get(`${chain}:${address}`, () => verifiedSource({ ...ctx.d, net: { json: (url) => bounded(ctx.d.net.json(url, 3_000), 3_000) } }, CHAIN_ID[chain], address as Address).then((v) => v.verified ? { ...v, files: {} } : v))).v;
  const pairs = async (chain: Chain, token: string): Promise<Pair[]> => (await pairCache.get(`${chain}:${token}`, async () => {
    const rows = await bounded(ctx.d.net.json<Pair[]>(`https://api.dexscreener.com/tokens/v1/${chain}/${token}`, 3_000), 3_000);
    if (!Array.isArray(rows)) throw new Error("Invalid DexScreener answer.");
    // priceUsd describes the base token, never the requested quote token.
    return rows.filter((p) => p.chainId === chain && p.baseToken?.address?.toLowerCase() === token).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  })).v;
  const ethPrice = async (chain: Chain) => { const p = (await pairs(chain, WETH[chain])).find((p) => p.priceUsd && Number(p.priceUsd) > 0); if (!p) throw new Error("ETH price unavailable."); return Number(p.priceUsd); };
  const meta = async (chain: Chain, token: string): Promise<Metadata> => (await metadata.get(`${chain}:${token}`, async () => {
    const [dec, sym] = await Promise.allSettled([call(chain, token, toFunctionSelector("decimals()")), call(chain, token, toFunctionSelector("symbol()"))]);
    let decimals: number | null = null, symbol: string | null = null;
    if (dec.status === "fulfilled") try { const n = Number(BigInt(dec.value)); if (Number.isInteger(n) && n >= 0 && n <= 255) decimals = n; } catch { /* Invalid decimals. */ }
    if (sym.status === "fulfilled") try { symbol = decodeAbiParameters([{ type: "string" }], sym.value)[0].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80); } catch { try { if (/^0x[\da-f]{64}$/i.test(sym.value)) symbol = Buffer.from(sym.value.slice(2), "hex").toString("utf8").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || null; } catch { /* Nonstandard symbol. */ } }
    return { decimals, symbol };
  })).v;

  async function tokenPrice(i: FastInput, r: Reads) {
    const [ps, m] = await Promise.all([r.get("DexScreener", pairs(i.chain!, i.token!)), r.get("on-chain token metadata", meta(i.chain!, i.token!))]);
    const p = ps?.[0];
    if (!p) r.unavailable.add("DexScreener pool and price");
    if (m?.decimals == null) r.unavailable.add("token decimals");
    if (!m?.symbol) r.unavailable.add("token symbol");
    return { token: i.token, chain: i.chain, priceUsd: p?.priceUsd ? Number(p.priceUsd) : null, liquidityUsd: p?.liquidity?.usd ?? null, volume24hUsd: p?.volume?.h24 ?? null, change24hPct: p?.priceChange?.h24 ?? null, fdv: p?.fdv ?? null, marketCap: p?.marketCap ?? null,
      topPool: p ? { address: p.pairAddress, dex: p.dexId, url: p.url } : null, pairAgeSeconds: p?.pairCreatedAt ? Math.max(0, Math.floor((ctx.d.now() - p.pairCreatedAt) / 1000)) : null, symbol: m?.symbol ?? null, decimals: m?.decimals ?? null };
  }

  async function transaction(i: FastInput, r: Reads) {
    const [receipt, tx, head] = await Promise.all([r.get("transaction receipt", rpc<Receipt | null>(i.chain!, "eth_getTransactionReceipt", [i.tx])), r.get("transaction", rpc<Tx | null>(i.chain!, "eth_getTransactionByHash", [i.tx])), r.get("confirmations", rpc<string>(i.chain!, "eth_blockNumber", []))]);
    const status = receipt ? receipt.status === "0x1" ? "success" : "reverted" : receipt === null ? tx ? "pending" : tx === null ? "not_found" : "unavailable" : "unavailable";
    return { receipt, tx, status, confirmations: receipt && head ? Math.max(0, Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n)) : receipt ? null : receipt === null ? 0 : null };
  }

  async function paymentVerify(i: FastInput, r: Reads) {
    const token = i.token === "USDC" ? USDC[i.chain!]! : i.token!;
    const [t, m] = await Promise.all([transaction(i, r), r.get("payment token metadata", meta(i.chain!, token))]);
    const logs = t.status === "success" ? t.receipt?.logs.filter((l) => !l.removed && l.address.toLowerCase() === token && l.topics[0]?.toLowerCase() === TRANSFER && l.topics.length === 3 && /^0x[\da-f]{64}$/i.test(l.data)) : t.receipt ? [] : undefined;
    const paid = logs?.filter((l) => topicAddress(l.topics[2]!) === i.recipient);
    const amountRaw = paid?.reduce((sum, l) => sum + BigInt(l.data), 0n);
    let matchesExpected: boolean | null = null;
    const reasons: string[] = [];
    if (!t.receipt) { reasons.push(t.status === "unavailable" ? "Receipt unavailable; arrival could not be verified." : "No mined receipt yet."); matchesExpected = t.status === "unavailable" ? null : false; }
    else if (t.status !== "success") { matchesExpected = false; reasons.push("Transaction reverted; no payment arrived."); }
    else if (!paid?.length) { matchesExpected = false; reasons.push("No transfer of the expected token to the expected recipient."); }
    else if (m?.decimals == null) { r.unavailable.add("payment amount: token decimals"); reasons.push("Could not compare the minimum amount without token decimals."); }
    else {
      const fraction = i.minAmount!.split(".")[1] ?? "";
      if (fraction.length > m.decimals && /[1-9]/.test(fraction.slice(m.decimals))) { matchesExpected = false; reasons.push("Minimum amount is not representable with this token's decimals."); }
      else { matchesExpected = amountRaw! >= parseUnits(i.minAmount!, m.decimals); reasons.push(matchesExpected ? "Successful receipt contains the expected token and recipient, meeting the minimum amount." : "Received amount is below the minimum."); }
    }
    return { chain: i.chain, tx: i.tx, status: t.status, confirmations: t.confirmations, from: paid?.length === 1 ? topicAddress(paid[0]!.topics[1]!) : t.tx?.from ?? t.receipt?.from ?? null, to: paid?.length ? i.recipient : null, token, amount: amountRaw != null && m?.decimals != null ? formatUnits(amountRaw, m.decimals) : null, amountRaw: amountRaw?.toString() ?? null, symbol: m?.symbol ?? null, decimals: m?.decimals ?? null, matchesExpected, reasons, transfers: paid?.map((l) => ({ from: topicAddress(l.topics[1]!), to: i.recipient, amountRaw: BigInt(l.data).toString() })) ?? [] };
  }

  async function walletCheck(i: FastInput, r: Reads) {
    const chain = i.chain!, a = i.address!;
    const [code, eth, usdc, nonce, src, impl, beacon] = await Promise.all([
      r.get("account code", rpc<Hex>(chain, "eth_getCode", [a, "latest"])), r.get("ETH balance", rpc<string>(chain, "eth_getBalance", [a, "latest"])),
      r.get("USDC balance", call(chain, USDC[chain]!, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [a as Address] }))),
      r.get("nonce", rpc<string>(chain, "eth_getTransactionCount", [a, "latest"])), r.get("verified source", source(chain, a)),
      r.get("proxy implementation slot", rpc<string>(chain, "eth_getStorageAt", [a, IMPL_SLOT, "latest"])), r.get("proxy beacon slot", rpc<string>(chain, "eth_getStorageAt", [a, BEACON_SLOT, "latest"])),
    ]);
    const delegated = !!code && /^0xef0100[\da-f]{40}$/i.test(code);
    const kind = code === undefined ? null : code === "0x" || delegated ? "EOA" : "contract";
    const labels: string[] = [];
    if (a === ZERO || a === "0x000000000000000000000000000000000000dead") labels.push("burn address");
    if (chain === "ethereum") { if (a === IMD_TOKEN) labels.push("IMD token"); if (IMD_FACTORIES[a]) labels.push(IMD_FACTORIES[a]!); if (a === "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac") labels.push("NIGHTSHIFT SHIFT token"); if (a === "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc") labels.push("NIGHTSHIFT hook"); }
    if (delegated) labels.push("EIP-7702 delegated EOA");
    const minimal = code && !delegated ? scanCode(code).minimalProxyTo : null;
    const storageImpl = impl && BigInt(impl) !== 0n ? topicAddress(impl) : null;
    const beaconAddr = beacon && BigInt(beacon) !== 0n ? topicAddress(beacon) : null;
    const proxy = kind === "EOA" ? { proxy: false } : minimal || storageImpl || beaconAddr || src?.verified && src.proxy?.proxy ? { proxy: true, implementation: minimal ?? storageImpl ?? (src?.verified ? src.proxy?.implementation : null), beacon: beaconAddr } : src?.verified && src.proxy?.proxy === false && impl !== undefined && beacon !== undefined ? { proxy: false, note: "No proxy found in verified source metadata, EIP-1967 slots or minimal-proxy bytecode." } : null;
    if (!proxy && kind === "contract") r.unavailable.add("proxy classification");
    // Name, proxy bytecode and singleton must all agree before adding a Safe label.
    if (src?.verified && /^(GnosisSafeProxy|SafeProxy)$/.test(src.contract) && code?.toLowerCase().startsWith("0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e")) {
      const singleton = await r.get("Safe singleton", rpc<string>(chain, "eth_getStorageAt", [a, "0x0", "latest"]));
      if (singleton && ["0xd9db270c1b5e3bd161e8c8503c55ceabee709552", "0x41675c099f32341bf84bfc5382af534df5c7461a"].includes(topicAddress(singleton))) labels.push("Safe proxy (verified source name and known singleton)");
    }
    if (!src?.verified || src.deployBlock == null) r.unavailable.add("first-seen (no cheap deployment record)");
    return { chain, address: a, kind, delegation: delegated ? `0x${code!.slice(8)}` : null, source: src ? src.verified ? { verified: true, name: src.contract, via: src.via } : { verified: false, note: src.note } : null, proxy, ethBalance: eth ? formatUnits(BigInt(eth), 18) : null, usdcBalance: usdc ? formatUnits(BigInt(usdc), 6) : null, nonce: num(nonce), firstSeen: src?.verified && src.deployBlock != null ? { block: src.deployBlock, tx: src.deployTx, source: src.via } : null, labels };
  }

  async function txExplain(i: FastInput, r: Reads) {
    const chain = i.chain!;
    const usdRead = r.get("ETH USD price", ethPrice(chain));
    const receiptRead = r.get("transaction receipt", rpc<Receipt | null>(chain, "eth_getTransactionReceipt", [i.tx]));
    const txRead = r.get("transaction", rpc<Tx | null>(chain, "eth_getTransactionByHash", [i.tx]));
    const headRead = r.get("confirmations", rpc<string>(chain, "eth_blockNumber", []));
    const blockRead = receiptRead.then((receipt) => receipt ? r.get("block time", rpc<Block>(chain, "eth_getBlockByNumber", [receipt.blockNumber, false])) : undefined);
    const sourceRead = txRead.then((tx) => tx?.to && tx.input.length >= 10 ? r.get("verified method ABI", source(chain, tx.to.toLowerCase())) : undefined);
    const metaRead = receiptRead.then(async (receipt) => {
      const tokens = [...new Set((receipt?.logs ?? []).filter((l) => l.topics[0]?.toLowerCase() === TRANSFER && l.topics.length === 3).slice(0, 100).map((l) => l.address.toLowerCase()))];
      if (tokens.length > 12) r.unavailable.add("metadata after the first 12 tokens");
      return new Map(await Promise.all(tokens.slice(0, 12).map(async (a) => [a, await r.get(`token metadata ${a}`, meta(chain, a))] as const)));
    });
    const [receipt, tx, head, block, src, metas, usd] = await Promise.all([receiptRead, txRead, headRead, blockRead, sourceRead, metaRead, usdRead]);
    const status = receipt ? receipt.status === "0x1" ? "success" : "reverted" : receipt === null ? tx ? "pending" : tx === null ? "not_found" : "unavailable" : "unavailable";
    const t = { status, confirmations: receipt && head ? Math.max(0, Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n)) : receipt ? null : receipt === null ? 0 : null };
    let method = tx?.input && tx.input !== "0x" ? tx.input.slice(0, 10) : null;
    if (method && !src?.verified) r.unavailable.add("method name (raw selector returned)");
    if (method && src?.verified) try { const decoded = decodeFunctionData({ abi: src.abi as never, data: tx!.input as Hex }); method = decoded.functionName ?? method; } catch { r.unavailable.add("method name (raw selector returned)"); }
    const logs = receipt?.logs.filter((l) => !l.removed && l.topics[0]?.toLowerCase() === TRANSFER && (l.topics.length === 3 || l.topics.length === 4)) ?? [];
    if (logs.length > 100) r.unavailable.add("transfers after the first 100");
    const transfers = logs.slice(0, 100).map((l) => {
      const m = metas.get(l.address.toLowerCase()), nft = l.topics.length === 4;
      let rawAmount: string | null = null;
      try { rawAmount = BigInt(nft ? l.topics[3]! : l.data).toString(); } catch { r.unavailable.add("malformed transfer log"); }
      if (!nft && m?.decimals == null) r.unavailable.add(`transfer amount decimals ${l.address}`);
      return { kind: nft ? "ERC-721" : "ERC-20", token: l.address.toLowerCase(), from: topicAddress(l.topics[1]!), to: topicAddress(l.topics[2]!), tokenId: nft ? rawAmount : null, amountRaw: nft ? null : rawAmount, amount: !nft && rawAmount != null && m?.decimals != null ? formatUnits(BigInt(rawAmount), m.decimals) : null, symbol: m?.symbol ?? null };
    });
    const executionGas = receipt ? BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) : null;
    if (receipt && chain === "base" && receipt.l1Fee === undefined) r.unavailable.add("Base L1 data fee (ETH gas paid includes execution only)");
    const gas = executionGas == null ? null : executionGas + BigInt(receipt?.l1Fee ?? "0x0");
    const first = transfers[0];
    const summary = t.status === "reverted" ? "Transaction reverted; no transfers took effect." : t.status !== "success" ? `Transaction status: ${t.status}; no confirmed transfers to explain.` : first ? `${short(first.from)} sent ${first.kind === "ERC-721" ? `NFT #${first.tokenId}` : first.amount ?? `${first.amountRaw} raw units of`} ${first.symbol ?? short(first.token)} to ${short(first.to)}${transfers.length > 1 ? ` (${transfers.length} transfers in total)` : ""}.` : tx ? `${short(tx.from)} ${BigInt(tx.value) > 0n ? `sent ${formatUnits(BigInt(tx.value), 18)} ETH to` : "called"} ${tx.to ? short(tx.to) : "a new contract"}.` : "Transaction details unavailable.";
    return { chain, tx: i.tx, status: t.status, confirmations: t.confirmations, block: num(receipt?.blockNumber), time: block ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null, from: tx?.from ?? receipt?.from ?? null, to: tx?.to ?? receipt?.to ?? null, method, transfers, gasPaidEth: gas != null ? formatUnits(gas, 18) : null, gasPaidUsd: gas != null && usd != null ? Number(formatUnits(gas, 18)) * usd : null, summary };
  }

  async function gasNow(r: Reads) {
    const chains = await Promise.all((["ethereum", "base"] as const).map(async (chain) => {
      type History = { baseFeePerGas: string[]; reward?: string[][] };
      const [history, usd] = await Promise.all([r.get(`${chain} fee history`, rpc<History>(chain, "eth_feeHistory", ["0x5", "latest", [10, 50, 90]])), r.get(`${chain} ETH USD price`, ethPrice(chain))]);
      const base = history?.baseFeePerGas.at(-1);
      const tips = [0, 1, 2].map((col) => { const rows = history?.reward?.map((row) => row[col]).filter((v): v is string => !!v).map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0); return rows?.length ? rows[Math.floor(rows.length / 2)]! : null; });
      if (tips.some((t) => t == null)) r.unavailable.add(`${chain} priority fees`);
      const priorityFeeGwei = Object.fromEntries(["slow", "normal", "fast"].map((label, n) => [label, tips[n] != null ? formatUnits(tips[n]!, 9) : null]));
      const units = { ethTransfer: 21_000, erc20Transfer: 65_000, uniswapSwap: 180_000 };
      const costs = base && tips[1] != null && usd != null ? Object.fromEntries(Object.entries(units).map(([k, n]) => [k, Number(formatUnits((BigInt(base) + tips[1]!) * BigInt(n), 18)) * usd])) : null;
      if (chain === "base") r.unavailable.add("Base L1 data fee (transaction dependent; estimates cover execution only)");
      return { chain, baseFeeGwei: base ? formatUnits(BigInt(base), 9) : null, priorityFeeGwei, costsUsd: costs, gasUnits: units, ethPriceUsd: usd ?? null, note: "Normal priority fee plus next-block base fee; illustrative gas units, not transaction simulation." };
    }));
    return { chains };
  }

  async function nameResolve(i: FastInput, r: Reads) {
    const chain = i.chain!, input = i.input!, reverse = addressPattern.test(input);
    const readAddress = async (name: string): Promise<string | null | undefined> => {
      const node = namehash(name);
      const resolverHex = await r.get("name resolver", call(chain, registry[chain], encodeFunctionData({ abi: nsAbi, functionName: "resolver", args: [node] })));
      if (resolverHex === undefined) return undefined;
      const resolver = decodeAbiParameters([{ type: "address" }], resolverHex)[0];
      if (resolver.toLowerCase() === ZERO) { r.unavailable.add("no exact resolver (inherited or off-chain resolution unavailable)"); return undefined; }
      const result = await r.get("forward address (off-chain resolution unsupported)", call(chain, resolver, encodeFunctionData({ abi: nsAbi, functionName: "addr", args: [node] })));
      if (result === undefined) return undefined;
      const a = decodeAbiParameters([{ type: "address" }], result)[0].toLowerCase(); return a === ZERO ? null : a;
    };
    if (!reverse) { const address = await readAddress(input); return { direction: "forward", chain, name: input, address: address ?? null, forwardConfirmed: address ? true : address === null ? false : null }; }
    let node: Hex;
    if (chain === "ethereum") node = namehash(`${input.slice(2)}.addr.reverse`);
    else {
      const value = await r.get("Basenames reverse node", call(chain, "0x79ea96012eea67a83431f1701b3dff7e37f9e282", encodeFunctionData({ abi: nsAbi, functionName: "node", args: [input as Address] })));
      if (!value) return { direction: "reverse", chain, address: input, name: null, forwardConfirmed: null };
      node = decodeAbiParameters([{ type: "bytes32" }], value)[0];
    }
    const resolverHex = await r.get("reverse resolver", call(chain, registry[chain], encodeFunctionData({ abi: nsAbi, functionName: "resolver", args: [node] })));
    let name: string | null = null, confirmed: boolean | null = null;
    if (resolverHex) {
      const resolver = decodeAbiParameters([{ type: "address" }], resolverHex)[0];
      if (resolver.toLowerCase() !== ZERO) {
        const value = await r.get("reverse name", call(chain, resolver, encodeFunctionData({ abi: nsAbi, functionName: "name", args: [node] })));
        if (value) { const rawName = decodeAbiParameters([{ type: "string" }], value)[0]; if (rawName) { name = normalize(rawName); const forward = await readAddress(name); confirmed = forward === undefined ? null : forward === input; if (confirmed === false) r.unavailable.add("reverse name does not resolve back to this address"); } }
      }
    }
    return { direction: "reverse", chain, address: input, name, forwardConfirmed: confirmed };
  }

  /** A complete seven-day window, or an explicit partial result. Never extrapolated. */
  async function usdcInflow(payTo: string) {
    const end = performance.now() + 45_000;
    const latest = await rpc<Block>("base", "eth_getBlockByNumber", ["latest", false]);
    const head = BigInt(latest.number), cutoff = BigInt(latest.timestamp) - 7n * 86400n;
    let low = head > 310_000n ? head - 310_000n : 0n, high = head;
    const first = await rpc<Block>("base", "eth_getBlockByNumber", [toHex(low), false]);
    if (BigInt(first.timestamp) > cutoff && low > 0n) throw new Error("Seven-day window exceeds the bounded range.");
    for (let n = 0; n < 20 && low < high; n++) { if (performance.now() > end) throw new Error("Log window lookup deadline reached."); const mid = (low + high) / 2n; const b = await rpc<Block>("base", "eth_getBlockByNumber", [toHex(mid), false]); if (BigInt(b.timestamp) < cutoff) low = mid + 1n; else high = mid; }
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let from = low; from <= head && ranges.length < 40; from += 9_000n) ranges.push({ from, to: from + 8_999n < head ? from + 8_999n : head });
    let count = 0, total = 0n, completed = 0;
    const seen = new Set<string>();
    await Promise.all(Array.from({ length: 4 }, async () => { for (;;) { if (performance.now() > end) break; const range = ranges.shift(); if (!range) break; try {
      const logs = await rpc<(Log & { logIndex?: string })[]>("base", "eth_getLogs", [{ address: USDC.base, fromBlock: toHex(range.from), toBlock: toHex(range.to), topics: [TRANSFER, null, `0x${payTo.slice(2).padStart(64, "0")}`] }]);
      if (logs.length > 10_000) continue;
      for (const l of logs) { if (l.removed) continue; if (!l.transactionHash || !l.logIndex || !/^0x[\da-f]{64}$/i.test(l.data) || l.address.toLowerCase() !== USDC.base || l.topics[0]?.toLowerCase() !== TRANSFER || topicAddress(l.topics[2] ?? "") !== payTo) throw new Error("Invalid inflow log."); const key = `${l.transactionHash}:${l.logIndex}`; if (seen.has(key)) continue; seen.add(key); count++; total += BigInt(l.data); }
      completed++;
    } catch { /* A missing chunk cannot become a complete total. */ } } }));
    const expected = Number((head - low) / 9_000n + 1n), complete = completed === expected;
    return { payTo, network: "eip155:8453", token: USDC.base, days: 7, fromBlock: Number(low), toBlock: Number(head), through: new Date(Number(BigInt(latest.timestamp)) * 1000).toISOString(), count: complete ? count : null, sumUsdc: complete ? formatUnits(total, 6) : null, observedCount: count, observedSumUsdc: formatUnits(total, 6), complete, chunksRead: completed, chunksExpected: expected, note: "USDC inflows are not proof of x402 sales or seller reliability." };
  }

  async function sellerCheck(i: FastInput, r: Reads) {
    const target = i.target!;
    const snapshot = await r.get("Bazaar index", d.snapshot());
    const rows = snapshot ? listingsFor(snapshot, target) : [];
    if (!snapshot?.updatedAt || ctx.d.now() - snapshot.updatedAt >= BAZAAR_TTL) r.unavailable.add("fresh complete Bazaar index");
    if (rows.some((row) => row.lastPaid == null)) r.unavailable.add("last-paid time (not supplied by discovery)");
    const endpoint = target.startsWith("https://") ? target : rows[0]?.resource;
    const exactRows = endpoint && snapshot ? listingsFor(snapshot, endpoint) : [];
    const payTos = [...new Set(rows.flatMap((row) => row.accepts.filter((t) => t.network.startsWith("eip155:") && addressPattern.test(t.payTo)).map((t) => t.payTo.toLowerCase())))];
    if (addressPattern.test(target) && !payTos.includes(target)) payTos.push(target);
    const [probe, flow] = await Promise.all([
      endpoint ? r.get("live x402 challenge", probes.get(endpoint, () => bounded(d.probe(endpoint), 4_000)).then((v) => v.v)) : undefined,
      Promise.all(payTos.slice(0, 2).map(async (a) => { const v = await r.get(`seven-day Base USDC inflow ${a}`, inflows.get(a, () => bounded(usdcInflow(a), 60_000)).then((v) => v.v)); if (v && !(v as { complete: boolean }).complete) r.unavailable.add(`incomplete inflow log window ${a}`); return v ?? { payTo: a, status: "unavailable", complete: false, count: null, sumUsdc: null }; })),
    ]);
    const liveTerms = (probe?.body as { accepts?: unknown[] } | null)?.accepts;
    for (const term of Array.isArray(liveTerms) ? liveTerms : []) {
      const t = term as { network?: string; payTo?: string } | null;
      if (typeof t?.network !== "string" || !t.network.startsWith("eip155:") || typeof t.payTo !== "string" || !addressPattern.test(t.payTo) || payTos.includes(t.payTo.toLowerCase())) continue;
      const a = t.payTo.toLowerCase(); payTos.push(a);
      if (flow.length >= 2) continue;
      const v = await r.get(`seven-day Base USDC inflow ${a}`, inflows.get(a, () => bounded(usdcInflow(a), 60_000)).then((v) => v.v));
      if (v && !(v as { complete: boolean }).complete) r.unavailable.add(`incomplete inflow log window ${a}`);
      flow.push(v ?? { payTo: a, status: "unavailable", complete: false, count: null, sumUsdc: null });
    }
    if (!payTos.length) r.unavailable.add("Base USDC inflow (no EVM payTo found)");
    if (payTos.length > 2) r.unavailable.add("inflows after the first two payTo addresses");
    const verdict = sellerVerdict(exactRows, probe ?? null, ctx.d.now(), [...r.unavailable]);
    const related = [...new Map([...rows, ...(snapshot && endpoint ? listingsFor(snapshot, new URL(endpoint).host) : [])].map((v) => [v.resource, v])).values()];
    const listingVerdict = sellerVerdict(related, null, ctx.d.now());
    const reasons = [...verdict.reasons, ...listingVerdict.reasons.filter((reason) => !verdict.reasons.some((v) => v.id === reason.id))];
    for (const unknown of verdict.unavailable) r.unavailable.add(unknown);
    const summary = `${reasons.length ? reasons.map((v) => v.text).join(" ") : "No issues found in the checks that ran"}${r.unavailable.size ? `; could not check: ${[...r.unavailable].join(", ")}` : "."}`;
    return { target, ...verdict, reasons, summary, verdict: reasons.some((v) => v.impact === "avoid") ? "avoid" : reasons.length || verdict.unavailable.length ? "caution" : "no_issues_found", bazaar: { listedResources: rows.length, updatedAt: snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : null, stale: !snapshot?.updatedAt || ctx.d.now() - snapshot.updatedAt >= BAZAAR_TTL, records: rows.slice(0, 50), recordsTruncated: rows.length > 50 }, probe: probe ? { endpoint, status: probe.status, validX402: verdict.validX402, refused: probe.refused ?? null } : null, inflows: flow };
  }

  async function compute(id: FastId, i: FastInput): Promise<Answer> {
    const r = new Reads();
    const result = id === "x402-seller-check" ? await sellerCheck(i, r) : id === "payment-verify" ? await paymentVerify(i, r) : id === "token-price" ? await tokenPrice(i, r) : id === "wallet-check" ? await walletCheck(i, r) : id === "tx-explain" ? await txExplain(i, r) : id === "gas-now" ? await gasNow(r) : await nameResolve(i, r);
    return { ...result, service: id, runBy: "NIGHTSHIFT", generatedAt: new Date(ctx.d.now()).toISOString(), unavailable: [...r.unavailable] };
  }
  async function run(id: FastId, input: FastInput): Promise<Answer & { cached: boolean; dataAgeSeconds: number }> {
    const start = performance.now(), key = `${id}:${JSON.stringify(input)}`;
    const cache = id === "gas-now" ? gasCache : id === "name-resolve" ? names : answers;
    const hit = cache.peek(key) ?? partial.peek(key);
    try {
      if (hit) return { ...hit.v, cached: true, dataAgeSeconds: Math.floor((ctx.d.now() - hit.at) / 1000) };
      let p = pending.get(key);
      if (!p) {
        if (pending.size >= 64) throw Object.assign(new Error("Fast services are busy. Retry shortly; nothing was charged."), { status: 503 });
        p = compute(id, input).then((v) => { (v.unavailable.length && !(id === "gas-now" && v.unavailable.every((s) => s.startsWith("Base L1 data fee"))) ? partial : cache).set(key, v); return v; }).finally(() => pending.delete(key)); pending.set(key, p);
      }
      return { ...await p, cached: false, dataAgeSeconds: 0 };
    } finally { const rows = samples.get(id) ?? []; rows.push(Math.round((performance.now() - start) * 100) / 100); if (rows.length > 256) rows.shift(); samples.set(id, rows); }
  }
  const latency = (id: string) => { const rows = samples.get(id as FastId); if (!rows?.length) return null; const sorted = [...rows].sort((a, b) => a - b); return { samples: rows.length, p50Ms: sorted[Math.ceil(rows.length * 0.5) - 1], p95Ms: sorted[Math.ceil(rows.length * 0.95) - 1], scope: "service computation, excluding payment verification and settlement" }; };
  return { run, latency, stop: () => index?.stop() };
}
