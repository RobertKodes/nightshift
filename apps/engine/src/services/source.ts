import type { Address } from "viem";
import { type Power, lc, powerOfName } from "./evm.js";
import { type Deps, HttpError } from "./net.js";

/**
 * Verified source: Etherscan (v2 API, with ETHERSCAN_API_KEY) first, then Sourcify. Only the
 * project's own files are analysed; libraries (OpenZeppelin, v4-core, forge-std…) are not where
 * a token hides its powers.
 */
export type AbiFn = { type: string; name?: string; inputs?: { name?: string; type: string; components?: unknown[] }[]; outputs?: { type: string }[]; stateMutability?: string };
export type Source = {
  verified: true; via: "etherscan" | "sourcify"; url: string; contract: string; compiler: string | null;
  abi: AbiFn[]; files: Record<string, string>; libraryFiles: number;
  proxy: { proxy: boolean; implementation: Address | null } | null;
  deployer: Address | null; deployBlock: number | null; deployTx: string | null;
} | { verified: false; checked: string[]; note: string };

const LIB = /^(lib\/|node_modules\/|@openzeppelin\/|@uniswap\/|solmate\/|solady\/|forge-std\/|openzeppelin-contracts|v4-core\/|v4-periphery\/|permit2\/|@chainlink\/)|\/lib\/|\/node_modules\//;
function split(files: Record<string, string>): { files: Record<string, string>; libraryFiles: number } {
  const own = Object.entries(files).filter(([p]) => !LIB.test(p));
  return { files: Object.fromEntries(own.length ? own : Object.entries(files)), libraryFiles: Object.keys(files).length - own.length };
}

type EsRow = { SourceCode?: string; ABI?: string; ContractName?: string; CompilerVersion?: string; Proxy?: string; Implementation?: string };
async function fromEtherscan(d: Deps, chainId: number, address: Address): Promise<Source | null> {
  if (!d.etherscanKey) return null;
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${d.etherscanKey}`;
  const r = await d.net.json<{ status?: string; result?: EsRow[] | string }>(url);
  const row = Array.isArray(r.result) ? r.result[0] : undefined;
  if (!row?.SourceCode) return { verified: false, checked: ["etherscan"], note: "Etherscan has no verified source for this address." };
  let files: Record<string, string> = {};
  const sc = row.SourceCode.trim();
  try {
    if (sc.startsWith("{{")) files = Object.fromEntries(Object.entries((JSON.parse(sc.slice(1, -1)) as { sources: Record<string, { content: string }> }).sources).map(([p, v]) => [p, v.content]));
    else if (sc.startsWith("{")) { const j = JSON.parse(sc) as Record<string, { content: string }> | { sources: Record<string, { content: string }> }; const src = "sources" in j ? j.sources : j; files = Object.fromEntries(Object.entries(src as Record<string, { content: string }>).map(([p, v]) => [p, v.content])); }
    else files = { [`${row.ContractName ?? "Contract"}.sol`]: sc };
  } catch { files = { [`${row.ContractName ?? "Contract"}.sol`]: sc }; }
  let abi: AbiFn[] = [];
  try { abi = JSON.parse(row.ABI ?? "[]") as AbiFn[]; } catch { /* "Contract source code not verified" */ }
  let deployer: Address | null = null, deployBlock: number | null = null, deployTx: string | null = null;
  const cr = await d.net.json<{ result?: { contractCreator?: string; txHash?: string; blockNumber?: string }[] }>(`https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${d.etherscanKey}`).catch(() => null);
  const c0 = cr?.result?.[0];
  if (c0?.contractCreator) { deployer = lc(c0.contractCreator); deployTx = c0.txHash ?? null; deployBlock = c0.blockNumber ? Number(c0.blockNumber) : null; }
  return {
    verified: true, via: "etherscan", url: `https://etherscan.io/address/${address}#code`, contract: row.ContractName ?? "", compiler: row.CompilerVersion ?? null, abi, ...split(files),
    proxy: { proxy: row.Proxy === "1", implementation: row.Implementation && /^0x[0-9a-fA-F]{40}$/.test(row.Implementation) ? lc(row.Implementation) : null },
    deployer, deployBlock, deployTx,
  };
}

type SfRow = {
  abi?: AbiFn[]; sources?: Record<string, { content: string }>; compilation?: { name?: string; compilerVersion?: string; fullyQualifiedName?: string };
  proxyResolution?: { isProxy?: boolean; implementations?: { address: string }[] } | null; deployment?: { transactionHash?: string; blockNumber?: string; deployer?: string } | null;
};
async function fromSourcify(d: Deps, chainId: number, address: Address): Promise<Source> {
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=abi,sources,compilation,proxyResolution,deployment`;
  try {
    const r = await d.net.json<SfRow>(url, 15_000);
    const files = Object.fromEntries(Object.entries(r.sources ?? {}).map(([p, v]) => [p, v.content]));
    const impl = r.proxyResolution?.implementations?.[0]?.address;
    return {
      verified: true, via: "sourcify", url: `https://sourcify.dev/server/repo-ui/${chainId}/${address}`, contract: r.compilation?.name ?? r.compilation?.fullyQualifiedName?.split(":").pop() ?? "", compiler: r.compilation?.compilerVersion ?? null,
      abi: r.abi ?? [], ...split(files),
      proxy: r.proxyResolution ? { proxy: Boolean(r.proxyResolution.isProxy), implementation: impl ? lc(impl) : null } : null,
      deployer: r.deployment?.deployer ? lc(r.deployment.deployer) : null, deployBlock: r.deployment?.blockNumber ? Number(r.deployment.blockNumber) : null, deployTx: r.deployment?.transactionHash ?? null,
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { verified: false, checked: ["sourcify"], note: "Sourcify has no verified source for this address." };
    throw e;
  }
}

/** Verified source from Etherscan (when a key is set) or Sourcify. */
export async function verifiedSource(d: Deps, chainId: number, address: Address): Promise<Source> {
  const es = await fromEtherscan(d, chainId, address).catch(() => null);
  if (es?.verified) return es;
  const sf = await fromSourcify(d, chainId, address);
  if (sf.verified) return sf;
  return { verified: false, checked: [...(es ? ["etherscan"] : []), "sourcify"], note: d.etherscanKey ? "Not verified on Etherscan or Sourcify." : "Not verified on Sourcify (Etherscan not checked: the server has no ETHERSCAN_API_KEY)." };
}

// ---------------------------------------------------------------- reading the source

export type Fn = {
  name: string; file: string; line: number; params: string; visibility: string; mutability: string;
  /** Who may call it: from its modifiers and the first checks in its body. */
  gate: "owner" | "role" | "pool-manager" | "factory" | "keeper" | "self" | "anyone" | "internal";
  modifiers: string[]; power: Power | null; body: string;
};

/** The body of a function from its opening brace, by brace matching (strings and comments ignored). */
function bodyFrom(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open, Math.min(src.length, open + 2000));
}

const OWNER_MOD = /^(onlyOwner|onlyAdmin|onlyGovernance|onlyGov|onlyOperator|onlyDev|onlyDeployer|onlyManager|onlyController|auth|requiresAuth|onlyMinter|onlyAuthorized|onlyOwnerOrAdmin)$/;
/** Every function the project's own files declare, with who may call it. */
export function functionsOf(files: Record<string, string>): Fn[] {
  const out: Fn[] = [];
  const re = /function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)([^{;]*)([{;])/g;
  for (const [file, src] of Object.entries(files)) {
    for (const m of src.matchAll(re)) {
      const [, name, params, tail, end] = m;
      const head = tail!.replace(/returns\s*\([^)]*\)/g, " ");
      const words = head.split(/[\s,]+/).filter(Boolean);
      const visibility = words.find((w) => ["external", "public", "internal", "private"].includes(w)) ?? "public";
      const mutability = words.find((w) => ["view", "pure", "payable"].includes(w)) ?? "nonpayable";
      const modifiers = words.filter((w) => !["external", "public", "internal", "private", "view", "pure", "payable", "virtual", "override", "returns"].includes(w)).map((w) => w.replace(/\(.*$/, "")).filter((w) => /^[A-Za-z_]\w*$/.test(w));
      const body = end === "{" ? bodyFrom(src, m.index! + m[0].length - 1) : "";
      const first = body.slice(0, 600);
      let gate: Fn["gate"] = visibility === "internal" || visibility === "private" ? "internal" : "anyone";
      if (gate === "anyone") {
        if (modifiers.some((x) => OWNER_MOD.test(x)) || /_checkOwner\(\)|msg\.sender\s*[!=]=\s*(owner\b|owner\(\)|_owner|admin\b|dev\b)|require\(\s*(owner\(\)|owner|_owner)\s*==\s*msg\.sender|if\s*\(\s*msg\.sender\s*!=\s*(owner|owner\(\)|_owner)\s*\)/.test(first)) gate = "owner";
        else if (modifiers.some((x) => /^onlyRole$|^onlyRoles$/.test(x)) || /hasRole\(|_checkRole\(/.test(first)) gate = "role";
        else if (modifiers.some((x) => /^onlyPoolManager$|^poolManagerOnly$/.test(x)) || /msg\.sender\s*[!=]=\s*(address\()?\s*(poolManager|manager|POOL_MANAGER)/.test(first)) gate = "pool-manager";
        else if (/msg\.sender\s*[!=]=\s*(address\()?\s*(factory|FACTORY|launchFactory)/.test(first) || modifiers.includes("onlyFactory")) gate = "factory";
        else if (/msg\.sender\s*[!=]=\s*(keeper|KEEPER|signer|operator)\b/.test(first) || modifiers.some((x) => /^only(Keeper|Signer|Relayer)$/.test(x))) gate = "keeper";
        else if (/msg\.sender\s*[!=]=\s*address\(this\)/.test(first) || modifiers.includes("selfOnly")) gate = "self";
      }
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ name: name!, file, line, params: params!.replace(/\s+/g, " ").trim(), visibility, mutability, gate, modifiers, power: powerOfName(name!), body });
    }
  }
  return out;
}

export type SourceFacts = {
  /** _mint reachable outside the constructor. */
  mintAfterDeploy: { fn: string; file: string; line: number }[];
  txOrigin: boolean; selfdestruct: boolean; delegatecall: boolean; blacklistWords: boolean; pausable: boolean;
  /** Fee caps written as constants: e.g. MAX_FEE_BPS = 250. */
  feeConstants: { name: string; value: string; file: string; line: number }[];
  constructorMints: number;
};

export function factsOf(files: Record<string, string>, fns: Fn[]): SourceFacts {
  const all = Object.entries(files);
  const mintAfterDeploy = fns.filter((f) => f.name !== "constructor" && f.visibility !== "private" && /\b_mint\s*\(/.test(f.body) && !/^_/.test(f.name)).map((f) => ({ fn: f.name, file: f.file, line: f.line }));
  const feeConstants: SourceFacts["feeConstants"] = [];
  for (const [file, src] of all) for (const m of src.matchAll(/\b(?:uint\d*|int\d*)\s+(?:public\s+|private\s+|internal\s+)?(?:constant|immutable)\s+(?:public\s+)?([A-Z0-9_]*(?:FEE|TAX|BPS)[A-Z0-9_]*)\s*=\s*([0-9_e.]+)/g)) {
    feeConstants.push({ name: m[1]!, value: m[2]!.replace(/_/g, ""), file, line: src.slice(0, m.index).split("\n").length });
  }
  const text = all.map(([, s]) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")).join("\n");
  const ctor = /constructor\s*\([^)]*\)[^{]*\{/g;
  let constructorMints = 0;
  for (const [, src] of all) for (const m of src.matchAll(ctor)) constructorMints += (bodyFrom(src, m.index! + m[0].length - 1).match(/\b_mint\s*\(/g) ?? []).length;
  return {
    mintAfterDeploy, feeConstants, constructorMints,
    txOrigin: /\btx\.origin\b/.test(text), selfdestruct: /\bselfdestruct\s*\(/.test(text), delegatecall: /\.delegatecall\s*\(/.test(text),
    blacklistWords: /\b(blacklist|blocklist|isBot|_isBlacklisted|bots\s*\[|isBlocked|frozen\s*\[)/i.test(text), pausable: /\bwhenNotPaused\b|\b_pause\s*\(|\bPausable\b/.test(text),
  };
}

/**
 * The deployed contract and the project contracts it inherits from, nothing else: a source bundle
 * often compiles several contracts together (a hook with its fee splitter), and only the one at
 * this address matters. Text outside them is blanked, line numbers kept.
 */
export function scopeTo(files: Record<string, string>, contract: string): Record<string, string> {
  const decl = /\b(?:abstract\s+)?contract\s+([A-Za-z_]\w*)\s*(?:is\s+([^{]+))?\{/g;
  const defs = new Map<string, { file: string; start: number; end: number; bases: string[] }>();
  for (const [file, src] of Object.entries(files)) for (const m of src.matchAll(decl)) {
    const open = m.index! + m[0].length - 1;
    defs.set(m[1]!, { file, start: m.index!, end: open + bodyFrom(src, open).length, bases: (m[2] ?? "").split(",").map((b) => b.replace(/\(.*$/s, "").trim()).filter(Boolean) });
  }
  if (!defs.has(contract)) return files;
  const keep = new Map<string, [number, number][]>();
  const seen = new Set<string>();
  const walk = (name: string) => {
    const d = defs.get(name);
    if (!d || seen.has(name)) return;
    seen.add(name);
    keep.set(d.file, [...(keep.get(d.file) ?? []), [d.start, d.end]]);
    d.bases.forEach(walk);
  };
  walk(contract);
  const out: Record<string, string> = {};
  for (const [file, ranges] of keep) {
    const src = files[file]!;
    const chars = [...src].map((ch, i) => (ch === "\n" || ranges.some(([a, b]) => i >= a && i < b) ? ch : " "));
    out[file] = chars.join("");
  }
  return out;
}

/** A few lines of a function, for the explained reports: where the power lives, with its line numbers. */
export function excerpt(f: Fn, maxLines = 14): string {
  const lines = f.body.split("\n");
  const cut = lines.length > maxLines ? [...lines.slice(0, maxLines), "    // …"] : lines;
  return `// ${f.file}:${f.line}\nfunction ${f.name}(${f.params}) ${[f.visibility, ...(f.mutability === "nonpayable" ? [] : [f.mutability]), ...f.modifiers].join(" ")} ${cut.join("\n")}`;
}
