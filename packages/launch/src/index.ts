/**
 * The NIGHTSHIFT Launchpad's launch request: a simple form turned into the exact IMD `launch.open` body
 * that the page signs and the engine checks for free (docs/launchpad/DESIGN.md). Shared by the page and
 * the engine so both build the same bytes: the page never signs a body it did not build itself.
 *
 * The body follows the one IMD's own explorer sends for a coin (explorer.imd.fun/launch, read
 * 2026-10-22), the format behind the 300+ live `custom_token` launches: a fixed-supply ERC-20 with
 * plain transfers, seeded single-sided into a Uniswap v4 pool by IMD's LaunchFactory.
 */

export type LaunchChainId = 1 | 4663;
export type PairWith = "eth" | "imd";

/** The chains IMD opens to a launch today and what each pairs with (GET /requests/capabilities, 2026-10-22). Base 8453 is not open. */
export const LAUNCH_CHAINS: Record<LaunchChainId, {
  chainId: LaunchChainId; key: "eth" | "rh"; name: string; explorer: string; dex: string; gecko: string;
  /** The chain's IMD: what the Intake takes as payment there. */
  imd: string;
  pairings: Record<PairWith, { symbol: string; currency: string; min: string; max: string; suggested: string }>;
}> = {
  1: {
    chainId: 1, key: "eth", name: "Ethereum", explorer: "https://etherscan.io", dex: "ethereum", gecko: "eth",
    imd: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
    pairings: {
      eth: { symbol: "ETH", currency: "0x0000000000000000000000000000000000000000", min: "1", max: "1000", suggested: "2" },
      imd: { symbol: "IMD", currency: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", min: "250", max: "250000", suggested: "2500" },
    },
  },
  4663: {
    chainId: 4663, key: "rh", name: "Robinhood Chain", explorer: "https://robin.etherscan.io", dex: "robinhood", gecko: "robinhood",
    imd: "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127",
    pairings: {
      eth: { symbol: "ETH", currency: "0x0000000000000000000000000000000000000000", min: "1", max: "1000", suggested: "2" },
      imd: { symbol: "IMD", currency: "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127", min: "250", max: "250000", suggested: "2500" },
    },
  },
};
export const isLaunchChain = (x: unknown): x is LaunchChainId => x === 1 || x === 4663;

/** IMD's Intake v2, the same address on every chain: approve 0.5 IMD, then one `request` (imd.fun/docs, "Pay onchain"). */
export const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
export const LAUNCH_ACTION = "launch.open";
export const LAUNCH_ACTION_ID = "launch.open@launch-1";
/** 0.5 IMD, the price of every IMD action (GET /requests/capabilities). */
export const LAUNCH_PRICE = 500_000_000_000_000_000n;
/** The line that marks a launch made here, readable by anyone in the job's public objective. */
export const LAUNCHPAD_MARK = "Launched with the NIGHTSHIFT Launchpad, getnightshift.tech/launchpad.";

/** The four IMD launch kinds and their rules, as IMD states them (imd.fun/docs, "Launch fields"). The form launches the first. */
export const LAUNCH_KINDS = [
  { kind: "custom_token", name: "Coin", here: true, rules: "Your name, symbol and supply, 18 decimals, plain transfers, nothing minted after launch. You choose how much of the supply seeds the pool (10 to 90%) and its opening market cap. IMD's swarm builds, tests and audits it, IMD deploys it with its Uniswap v4 pool. No owner." },
  { kind: "univ4_hook", name: "Coin with a v4 hook", here: false, rules: "A Uniswap v4 hook with its own rules on every swap (a fee, a gate, a burn), its token and its pool. The hook's owner functions go to the owner you name. A custom build: order it from IMD's explorer or the NIGHTSHIFT hook template (coming)." },
  { kind: "evm_project", name: "Coin + contracts", here: false, rules: "IMD's fixed token (1,000,000,000, 18 decimals) and up to 8 contracts around it, such as staking or a game." },
  { kind: "evm_contracts", name: "Contracts only", here: false, rules: "1 to 8 contracts, no token and no pool. Owner roles go to the owner you name; nothing is called after deployment." },
] as const;

export type LaunchForm = {
  chainId: LaunchChainId;
  pairWith: PairWith;
  name: string;
  symbol: string;
  /** Whole tokens, digits only (commas and spaces are ignored). */
  supply: string;
  /** Share of the supply seeded in the pool, 10 to 90 whole percent; the swarm always takes 10%. */
  poolPercent: number;
  /** Opening market cap in the paired currency, e.g. "2" (ETH) or "2500" (IMD). */
  cap: string;
  /** The creator's wallet: it pays, so IMD makes it the launch's requester (1% of every trade); the rest of its share goes here too. */
  creator: string;
  about: string;
  website: string;
  x: string;
  telegram: string;
  /** What the logo should show; IMD's swarm draws it (the request has no image field). */
  logo: string;
};
export const EMPTY_FORM: LaunchForm = { chainId: 1, pairWith: "eth", name: "", symbol: "", supply: "1000000000", poolPercent: 90, cap: "2", creator: "", about: "", website: "", x: "", telegram: "", logo: "" };

export type Problem = { field: keyof LaunchForm; text: string };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** One line of plain text: no line breaks or control characters, so nothing typed can add a line to the request. */
const oneLine = (s: string) => !/[\u0000-\u001f\u007f\u2028\u2029]/.test(s);
const digits = (s: string) => s.replace(/[,_\s]/g, "");

/** A decimal amount in the currency's smallest unit, as IMD's explorer converts it. */
export function toMinor(amount: string, decimals = 18): string {
  const [w = "0", f = ""] = amount.trim().split(".");
  return (BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
const capOk = (s: string) => /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(s.trim()) && Number(s) > 0;
const link = (s: string, hosts: RegExp) => { try { const u = new URL(s); return u.protocol === "https:" && hosts.test(u.hostname) && s.length <= 120 && oneLine(s); } catch { return false; } };

/** What is wrong with the form, field by field: IMD's own rules for a coin (explorer.imd.fun), plus ours for the text. */
export function formProblems(f: LaunchForm): Problem[] {
  const out: Problem[] = [];
  const chain = LAUNCH_CHAINS[f.chainId];
  if (!chain) return [{ field: "chainId", text: "IMD launches on Ethereum and Robinhood Chain. Base is not open yet." }];
  const pair = chain.pairings[f.pairWith];
  if (!pair) out.push({ field: "pairWith", text: "Pair it with ETH or IMD." });
  const name = f.name.trim();
  if (!name || name.length > 40 || !oneLine(name) || !/^[\p{L}\p{N} .,'&!?$-]+$/u.test(name)) out.push({ field: "name", text: "A name of up to 40 letters, digits, spaces and . , ' & ! ? $ -" });
  if (!/^[A-Z0-9]{2,11}$/.test(f.symbol.trim())) out.push({ field: "symbol", text: "A symbol of 2 to 11 capital letters or digits." });
  if (!/^[1-9][0-9]{0,17}$/.test(digits(f.supply))) out.push({ field: "supply", text: "A supply in whole tokens, from 1 to 18 digits." });
  if (!Number.isInteger(f.poolPercent) || f.poolPercent < 10 || f.poolPercent > 90) out.push({ field: "poolPercent", text: "A pool share of 10 to 90% of the supply, in whole percent." });
  if (pair) {
    if (!capOk(f.cap)) out.push({ field: "cap", text: `An opening market cap in ${pair.symbol}, such as ${pair.suggested}.` });
    else {
      const v = BigInt(toMinor(f.cap)), lo = BigInt(toMinor(pair.min)), hi = BigInt(toMinor(pair.max));
      if (v < lo || v > hi) out.push({ field: "cap", text: `An opening market cap between ${Number(pair.min).toLocaleString("en-US")} and ${Number(pair.max).toLocaleString("en-US")} ${pair.symbol}.` });
    }
  }
  if (!ADDRESS.test(f.creator.trim()) || /^0x0{40}$/i.test(f.creator.trim())) out.push({ field: "creator", text: "Connect the wallet that launches and pays: it is the launch's requester." });
  if (f.about.trim().length > 280 || !oneLine(f.about)) out.push({ field: "about", text: "What it is, in one line of up to 280 characters." });
  if (f.website.trim() && !link(f.website.trim(), /\./)) out.push({ field: "website", text: "A website starting with https://" });
  if (f.x.trim() && !link(f.x.trim(), /^(www\.)?(x|twitter)\.com$/)) out.push({ field: "x", text: "An X link: https://x.com/yourname" });
  if (f.telegram.trim() && !link(f.telegram.trim(), /^t\.me$/)) out.push({ field: "telegram", text: "A Telegram link: https://t.me/yourgroup" });
  if (f.logo.trim().length > 160 || !oneLine(f.logo)) out.push({ field: "logo", text: "The logo idea, in one line of up to 160 characters." });
  return out;
}

/** The objective IMD's swarm reads: the explorer's coin lines, the rules said outright (so the check assumes nothing), then the creator's words. */
export function objectiveOf(f: LaunchForm): string {
  const name = f.name.trim(), sym = f.symbol.trim();
  const lines = [
    `A custom token: ${name} (${sym}).`,
    `Token name: ${name}`,
    `Token symbol: ${sym}`,
    `Token supply: ${BigInt(digits(f.supply)).toLocaleString("en-US")} with 18 decimals, all minted once to the deployer in the constructor.`,
    "Transfers: plain ERC-20 transfers with no fee, tax or limit. Fixed supply: no owner, nobody can mint more.",
  ];
  if (f.about.trim()) lines.push(`What it does: ${f.about.trim()}`);
  if (f.website.trim()) lines.push(`Website: ${f.website.trim()}`);
  if (f.x.trim()) lines.push(`X: ${f.x.trim()}`);
  if (f.telegram.trim()) lines.push(`Telegram: ${f.telegram.trim()}`);
  if (f.logo.trim()) lines.push(`Logo: ${f.logo.trim()}`);
  lines.push(LAUNCHPAD_MARK);
  return lines.join("\n");
}

export type LaunchBody = {
  objective: string; shape: "chain"; steps: { skill: string }[]; onchain: "custom_token"; github: true; chainId: LaunchChainId;
  pairWith?: "imd"; economics: { poolBps: number; initialMarketCapWei: string; remainderTo?: string };
};

/** The exact `launch.open` body for a valid form (throws on an invalid one). Keys in a fixed order: the same form gives the same bytes. */
export function launchBody(f: LaunchForm): LaunchBody {
  const p = formProblems(f);
  if (p.length) throw new Error(p[0]!.text);
  return {
    objective: objectiveOf(f),
    shape: "chain",
    steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }],
    onchain: "custom_token",
    github: true,
    chainId: f.chainId,
    ...(f.pairWith === "imd" ? { pairWith: "imd" as const } : {}),
    economics: {
      poolBps: f.poolPercent * 100,
      initialMarketCapWei: toMinor(f.cap),
      ...(f.poolPercent < 90 ? { remainderTo: f.creator.trim().toLowerCase() } : {}),
    },
  };
}

/** A form from untrusted JSON (the engine's check endpoint): only the known fields, as strings and numbers. */
export function readForm(x: unknown): LaunchForm | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>, s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 400) : "");
  const chainId = Number(o.chainId), poolPercent = Number(o.poolPercent);
  if (!isLaunchChain(chainId) || (o.pairWith !== "eth" && o.pairWith !== "imd")) return null;
  return { chainId, pairWith: o.pairWith, name: s("name"), symbol: s("symbol"), supply: s("supply"), poolPercent, cap: s("cap"), creator: s("creator"), about: s("about"), website: s("website"), x: s("x"), telegram: s("telegram"), logo: s("logo") };
}

/**
 * Before the wallet signs: the body is exactly the one this form builds, and every address in it is the
 * creator's own. Anything else is refused, unsigned.
 */
export function refuseBody(body: unknown, f: LaunchForm, payer: string): string | null {
  let mine: LaunchBody;
  try { mine = launchBody(f); } catch (e) { return `Refused: ${(e as Error).message}`; }
  if (JSON.stringify(body) !== JSON.stringify(mine)) return "Refused: the launch request is not the one your form builds.";
  if (payer.toLowerCase() !== f.creator.trim().toLowerCase()) return "Refused: the wallet that pays is not the creator named in the form. Connect the creator's wallet.";
  const to = mine.economics.remainderTo;
  if (to && to !== payer.toLowerCase()) return "Refused: the rest of the supply would go to another wallet.";
  return null;
}

/** What the creator, the pool and IMD's swarm each get, in whole percent of the supply. */
export function split(f: Pick<LaunchForm, "poolPercent">): { pool: number; creator: number; swarm: number } {
  return { pool: f.poolPercent, creator: 90 - f.poolPercent, swarm: 10 };
}
