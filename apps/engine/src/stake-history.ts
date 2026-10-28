import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, parseAbiItem } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { launchState } from "./token.js";

const STAKED = parseAbiItem("event Staked(address indexed account, uint256 amount, uint256 unlockAt)");
const WITHDRAWN = parseAbiItem("event Withdrawn(address indexed account, uint256 amount)");
const PAID = parseAbiItem("event RewardPaid(address indexed account, address indexed token, uint256 amount)");
const ZERO = "0x0000000000000000000000000000000000000000";
const SPAN = 9_000n;

type Row = { kind: "staked" | "withdrawn" | "paid"; account: string; amount: string; unlockAt?: number; token?: string; tx: string; block: number };
type Index = { contract: string; next: number; rows: Row[] };
type Reader = Pick<typeof eth, "getBlockNumber" | "getLogs">;

/**
 * Every stake, withdrawal and reward payment of ShiftRewards, read once on the server and kept in the data folder.
 * The Stake page asks here for one wallet's history instead of scanning Ethereum through free nodes from the
 * browser (they refuse or rate-limit log ranges). A read brings the index up to the chain's head first.
 */
export class StakeHistory {
  readonly #file: string; readonly #chain: Reader;
  #index: Index | null = null; #catching: Promise<void> | null = null; #checked = 0;
  constructor(dir: string, chain: Reader = eth) {
    this.#file = join(dir, "stake-history.json"); this.#chain = chain;
    try { this.#index = existsSync(this.#file) ? JSON.parse(readFileSync(this.#file, "utf8")) as Index : null; } catch { this.#index = null; }
  }

  async #catchUp(contract: string, from: number) {
    if (!this.#index || this.#index.contract !== contract) this.#index = { contract, next: from, rows: [] };
    const index = this.#index, head = await this.#chain.getBlockNumber();
    for (let a = BigInt(index.next); a <= head; a += SPAN) {
      const range = { address: contract as Address, fromBlock: a, toBlock: a + SPAN - 1n > head ? head : a + SPAN - 1n };
      const [s, w, p] = await Promise.all([this.#chain.getLogs({ ...range, event: STAKED }), this.#chain.getLogs({ ...range, event: WITHDRAWN }), this.#chain.getLogs({ ...range, event: PAID })]);
      const rows: Row[] = [
        ...s.map((l) => ({ kind: "staked" as const, account: String(l.args.account).toLowerCase(), amount: String(l.args.amount), unlockAt: Number(l.args.unlockAt), tx: l.transactionHash!, block: Number(l.blockNumber) })),
        ...w.map((l) => ({ kind: "withdrawn" as const, account: String(l.args.account).toLowerCase(), amount: String(l.args.amount), tx: l.transactionHash!, block: Number(l.blockNumber) })),
        ...p.map((l) => ({ kind: "paid" as const, account: String(l.args.account).toLowerCase(), amount: String(l.args.amount), token: String(l.args.token).toLowerCase(), tx: l.transactionHash!, block: Number(l.blockNumber) })),
      ];
      index.rows.push(...rows.sort((x, y) => x.block - y.block));
      index.next = Number(range.toBlock) + 1;
      writeAtomic(this.#file, JSON.stringify(index));
    }
  }

  /** One wallet's stakes (amount, unlock time, transaction), what it withdrew and the ETH it was paid, as of the chain's head. */
  async of(wallet: string) {
    const l = launchState(), contract = l?.contracts?.rewards?.toLowerCase();
    if (!l?.open || !contract || !l.scanFrom) return null;
    // at most one catch-up at a time, and not more than every 12 seconds (one block)
    if (Date.now() - this.#checked > 12_000) {
      this.#catching ??= this.#catchUp(contract, Math.max(0, l.scanFrom - 100)).finally(() => { this.#catching = null; this.#checked = Date.now(); });
    }
    if (this.#catching) await this.#catching;
    const who = wallet.toLowerCase(), mine = (this.#index?.rows ?? []).filter((r) => r.account === who);
    return {
      stakes: mine.filter((r) => r.kind === "staked").map((r) => ({ amount: r.amount, unlockAt: r.unlockAt!, tx: r.tx })),
      out: mine.filter((r) => r.kind === "withdrawn").reduce((s, r) => s + BigInt(r.amount), 0n).toString(),
      paidEth: mine.filter((r) => r.kind === "paid" && r.token === ZERO).reduce((s, r) => s + BigInt(r.amount), 0n).toString(),
      asOfBlock: (this.#index?.next ?? 1) - 1,
    };
  }
}

let live: StakeHistory | null = null;
export const liveStakeHistory = () => (live ??= new StakeHistory(config.dataDir));
