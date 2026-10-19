import { type Abi, type Address, type Hex, type WalletClient, createPublicClient, http } from "viem";
import { getCapabilities, sendCalls, waitForCallsStatus, writeContract } from "viem/actions";
import { mainnet } from "viem/chains";

/**
 * One wallet confirmation for "approve, then act" where the wallet can do it (EIP-5792): the calls
 * go to the wallet as one atomic batch, so the approval and the action land together or not at
 * all. A wallet without batches gets the old way: each call in turn, the next one only after the
 * previous one confirmed. Approvals stay for the exact amount: the batch changes how many times
 * the person confirms, never what they allow.
 */
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });

export type Call = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint };
/**
 * One call and what the page says while it is signed and mined. A function is asked for its call
 * right before it is needed (null skips it): before the batch is sent, or, one by one, before
 * that call is signed, so a ticket or a check is always fresh.
 */
export type Step = { call: Call | (() => Promise<Call | null>); sign: string; wait?: string; fail?: string };
export type Sent = { ok: boolean; hash: Hex; hashes: Hex[]; batched: boolean };

// wallets that refused a batch at send time, or whose person declined the smart-account switch:
// asked the old way for the rest of the visit
const noBatch = new Set<string>();

const chain = (e: unknown): { codes: number[]; names: string[]; text: string } => {
  const codes: number[] = [], names: string[] = [];
  let text = "";
  for (let x = e as { code?: unknown; name?: unknown; message?: unknown; details?: unknown; cause?: unknown } | undefined, i = 0; x && i < 8; x = x.cause as typeof x, i++) {
    if (typeof x.code === "number") codes.push(x.code);
    if (typeof x.name === "string") names.push(x.name);
    text += ` ${typeof x.details === "string" ? x.details : ""} ${typeof x.message === "string" ? x.message : ""}`;
  }
  return { codes, names, text };
};
/** The person said no in the wallet. */
export const rejected = (e: unknown) => {
  const c = chain(e);
  return c.codes.includes(4001) || c.names.includes("UserRejectedRequestError") || /user (rejected|denied|cancell?ed)|rejected by (the )?user/i.test(c.text);
};
/** The wallet cannot send this batch: nothing was sent, so the calls can go one by one. */
const unsupported = (e: unknown) => {
  const c = chain(e);
  return c.codes.some((n) => [4100, 4200, 5700, 5710, 5740, 5760, -32601, -32602].includes(n))
    || /not supported|unsupported|does not exist|not available|method not found|not implemented|unknown method|no error or result/i.test(c.text);
};

/** Whether this wallet sends atomic batches on Ethereum now ("supported") or after a switch it offers itself ("ready"). */
export async function canBatch(w: WalletClient, account: Address): Promise<boolean> {
  if (noBatch.has(account.toLowerCase())) return false;
  try {
    // a wallet that never answers (some WalletConnect apps) is treated as one without batches
    const caps = await Promise.race([
      getCapabilities(w, { account, chainId: 1 }),
      new Promise<null>((r) => setTimeout(() => r(null), 4_000)),
    ]) as { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } } | null;
    const s = caps?.atomic?.status;
    return s === "supported" || s === "ready" || caps?.atomicBatch?.supported === true;
  } catch { return false; }
}

const resolve = async (s: Step) => (typeof s.call === "function" ? s.call() : s.call);

/**
 * Sends the steps in order: as one atomic batch when the wallet can (`batched`, from canBatch),
 * otherwise each in turn. `say` gets the step text; `sent` runs once the last call is in the
 * wallet's hands. Resolves when everything is mined; `ok` is false when the last call (or the
 * batch) reverted. A rejection in the wallet is thrown as it is, never retried the other way.
 */
export async function sendSteps(w: WalletClient, account: Address, steps: Step[], o: { batched: boolean; once: string; wait?: string; say: (s: string) => void; sent?: () => void }): Promise<Sent> {
  let ready: (Call | null)[] | null = null;
  if (o.batched && !noBatch.has(account.toLowerCase())) {
    ready = [];
    for (const s of steps) ready.push(await resolve(s));
    const calls = ready.filter((c): c is Call => c !== null);
    if (calls.length > 1) {
      o.say(o.once);
      let id: string | null = null;
      try {
        ({ id } = await sendCalls(w, {
          account, chain: mainnet, forceAtomic: true,
          calls: calls.map((c) => ({ to: c.address, abi: c.abi as Abi, functionName: c.functionName, args: c.args ?? [], value: c.value })) as never,
        }));
      } catch (e) {
        if (rejected(e)) throw e;
        if (chain(e).codes.includes(5750)) {
          noBatch.add(account.toLowerCase());
          throw new Error("You declined the wallet's smart-account switch, so nothing was sent. Try again: it will ask for each step on its own.");
        }
        if (!unsupported(e)) throw e;
        noBatch.add(account.toLowerCase());
      }
      if (id) {
        o.sent?.();
        o.say(o.wait ?? steps.at(-1)?.wait ?? "Waiting for Ethereum…");
        const r = await waitForCallsStatus(w, { id, timeout: 600_000 });
        const hashes = [...new Set((r.receipts ?? []).map((x) => x.transactionHash))];
        const hash = hashes.at(-1);
        if (!hash) throw new Error("The wallet reported the batch as failed. Nothing was sent.");
        return { ok: r.status === "success" && (r.receipts ?? []).every((x) => x.status === "success"), hash, hashes, batched: true };
      }
    }
  }
  // one by one: a step given as a function is asked again, so what it signs is fresh
  const hashes: Hex[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!, last = i === steps.length - 1;
    const c = typeof s.call === "function" || !ready ? await resolve(s) : ready[i]!;
    if (!c) continue;
    o.say(s.sign);
    const hash = await writeContract(w, { account, chain: mainnet, address: c.address, abi: c.abi as Abi, functionName: c.functionName, args: c.args ?? [], value: c.value } as never);
    hashes.push(hash);
    if (last) o.sent?.();
    o.say((last ? o.wait : undefined) ?? s.wait ?? "Waiting for Ethereum…");
    const r = await rpc.waitForTransactionReceipt({ hash });
    if (last) return { ok: r.status === "success", hash, hashes, batched: false };
    if (r.status !== "success") throw new Error(s.fail ?? "A step reverted. Nothing more was sent.");
  }
  const hash = hashes.at(-1);
  if (!hash) throw new Error("Nothing to send.");
  return { ok: true, hash, hashes, batched: false };
}
