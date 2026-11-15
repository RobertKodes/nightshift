import { Keypair } from "@solana/web3.js";
import { encodeAbiParameters, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { COMPUTE_BUDGET, NATIVE_SOL, RELAY_DEPOSITORY, SOLANA_RELAY_CHAIN } from "./sol-fees.js";
import { INTAKE } from "./sol-imd.js";
import { encodeCall, IMD_WEI, imdCalls, MAX_PAY_LAMPORTS, RH_IMD, readCall, readRelayQuote, readRelayStatus, relayPayProblem, relayPayRequest } from "./sol-relay.js";

const CREATOR = Keypair.generate().publicKey.toBase58();
const FEE_WALLET = "0x3322a0b8e8c0b6c4b2b2c2a3c6d8e9f0a1b2c3d4";
const BODY = JSON.stringify({ objective: "The IMD swarm's work before a Solana token launch through NIGHTSHIFT. Token Night Frog ($NFROG).", shape: "chain", steps: [{ skill: "token-logo", objective: "a frog" }] });
const REQUEST = `0x${"17".repeat(32)}`;

/** Relay's committed destination calls, encoded the way its order data carries them: abi.encode(to, data, value). */
const orderCalls = (body: string) => imdCalls(body).map((c) => encodeCall({ to: c.to, data: c.data, value: 0n }));

/** A Relay /quote/v2 answer in the shape Relay sent on 2026-11-15 (SOL on Solana to 0.5 IMD on Robinhood Chain with our calls). */
function relayAnswer(o: { body?: string; calls?: string[]; steps?: number; sender?: string; recipient?: string; outCurrency?: string; outAmount?: string; inLamports?: string; inUsd?: string; outUsd?: string; program?: string; signer?: string; refundTo?: string; destRefund?: string } = {}) {
  const item = { status: "incomplete", data: { instructions: [{ keys: [{ pubkey: "Dodg2HifwU8rmaVVyMyUZDGTRbqAJTyVYxXPwcbNpBKc", isSigner: false, isWritable: false }, { pubkey: o.signer ?? CREATOR, isSigner: true, isWritable: true }, { pubkey: "7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ", isSigner: false, isWritable: true }], programId: o.program ?? RELAY_DEPOSITORY, data: "0d9e0ddf5fd51c066a6b300100000000" }], addressLookupTableAddresses: ["Hm9fUgcn7qwDaiNTFiGh6pNtVATgnaRcmK6Bbx6EMZfP"] } };
  const step = { id: "deposit", kind: "transaction", requestId: REQUEST, items: [item] };
  return {
    requestId: REQUEST,
    steps: Array.from({ length: o.steps ?? 1 }, () => step),
    details: {
      sender: o.sender ?? CREATOR, recipient: o.recipient ?? getAddress(FEE_WALLET),
      currencyIn: { currency: { chainId: SOLANA_RELAY_CHAIN, address: NATIVE_SOL }, amount: o.inLamports ?? "19950442", amountUsd: o.inUsd ?? "1.361589" },
      currencyOut: { currency: { chainId: 4663, address: o.outCurrency ?? RH_IMD }, amount: o.outAmount ?? IMD_WEI.toString(), amountUsd: o.outUsd ?? "1.238746" },
      timeEstimate: 1,
    },
    protocol: { v2: { orderData: {
      inputs: [{ refunds: [{ chainId: "solana", recipient: o.refundTo ?? CREATOR }, { chainId: "robinhood", recipient: o.destRefund ?? getAddress(FEE_WALLET) }] }],
      output: { chainId: "robinhood", calls: o.calls ?? orderCalls(o.body ?? BODY) },
    } } },
  };
}
const check = (o: Parameters<typeof relayAnswer>[0] = {}) => relayPayProblem(readRelayQuote(relayAnswer(o)), { creator: CREATOR, body: BODY, feeWallet: FEE_WALLET });

describe("the swarm paid in SOL through NIGHTSHIFT Swap", () => {
  it("asks Relay for exactly 0.5 IMD on Robinhood Chain, with the job's two calls, the IMD's fallback to the fee wallet and refunds to the creator", () => {
    const r = relayPayRequest({ creator: CREATOR, body: BODY, key: "", feeWallet: FEE_WALLET, feeBps: 25 });
    expect(r).toMatchObject({
      user: CREATOR, originChainId: SOLANA_RELAY_CHAIN, originCurrency: NATIVE_SOL, destinationChainId: 4663, tradeType: "EXACT_OUTPUT", amount: "500000000000000000",
      // checksummed: Relay misreads lowercase addresses
      destinationCurrency: getAddress(RH_IMD), recipient: getAddress(FEE_WALLET), refundTo: CREATOR, appFees: [{ recipient: getAddress(FEE_WALLET), fee: "25" }],
    });
    const [approve, request] = r.txs as { to: string; data: string; value: string }[];
    expect(approve).toMatchObject({ to: getAddress(RH_IMD), value: "0" });
    expect(approve!.data.toLowerCase()).toBe(`0x095ea7b3${INTAKE.slice(2).padStart(64, "0")}${IMD_WEI.toString(16).padStart(64, "0")}`);
    expect(request!.to).toBe(getAddress(INTAKE));
    // the body travels whole, as bytes, in the Intake call
    expect(request!.data).toContain(Buffer.from(BODY).toString("hex"));
    expect(relayPayRequest({ creator: CREATOR, body: BODY, key: "", feeWallet: FEE_WALLET, feeBps: 0 })).not.toHaveProperty("appFees");
  });

  it("reads Relay's committed calls back, in the layout Relay sends (seen 2026-11-15) or the plain one", () => {
    // the approve Relay committed to in a live quote: (to, (calldata), value)
    const live = `0x${["0000000000000000000000005f7bb59365ce557c26dbcaa4ee9d39a4b95b7127", "60".padStart(64, "0"), "0".repeat(64), "20".padStart(64, "0"), "44".padStart(64, "0"), "095ea7b3000000000000000000000000a43e6f75ee006411f79ac1c84120606c", "2330de8200000000000000000000000000000000000000000000000006f05b59", "d3b2000000000000000000000000000000000000000000000000000000000000"].join("")}`;
    expect(readCall(live)).toEqual({ to: RH_IMD, data: imdCalls(BODY)[0]!.data.toLowerCase(), value: 0n });
    expect(encodeCall({ to: RH_IMD, data: imdCalls(BODY)[0]!.data, value: 0n })).toBe(live);
    const plain = encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "uint256" }], [getAddress(RH_IMD), imdCalls(BODY)[0]!.data as `0x${string}`, 0n]);
    expect(readCall(plain)).toEqual({ to: RH_IMD, data: imdCalls(BODY)[0]!.data.toLowerCase(), value: 0n });
    expect(readCall("0x1234")).toBeNull();
  });

  it("passes a quote that is exactly the job, and names everything else", () => {
    expect(check()).toBeNull();
    expect(check({ steps: 2 })).toMatch(/more than one/);
    expect(check({ sender: Keypair.generate().publicKey.toBase58() })).toMatch(/not from the creator/);
    expect(check({ outCurrency: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" })).toMatch(/IMD on Robinhood/);
    expect(check({ outAmount: "400000000000000000" })).toMatch(/exactly 0.5 IMD/);
    expect(check({ recipient: "0x000000000000000000000000000000000000dEaD" })).toMatch(/swap wallet/);
    expect(check({ program: Keypair.generate().publicKey.toBase58() })).toMatch(/unknown program/);
    expect(check({ program: COMPUTE_BUDGET })).toBeNull();
    expect(check({ signer: Keypair.generate().publicKey.toBase58() })).toMatch(/another signer/);
    // another launch's body, a changed approval, calls added or dropped
    expect(check({ body: BODY.replace("NFROG", "OTHER") })).toMatch(/not IMD's job/);
    expect(check({ calls: [orderCalls(BODY)[1]!, orderCalls(BODY)[0]!] })).toMatch(/not IMD's job/);
    expect(check({ calls: orderCalls(BODY).slice(1) })).toMatch(/not IMD's job/);
    expect(check({ calls: [...orderCalls(BODY), orderCalls(BODY)[0]!] })).toMatch(/not IMD's job/);
    const withValue = encodeCall({ to: RH_IMD, data: imdCalls(BODY)[0]!.data, value: 1n });
    expect(check({ calls: [withValue, orderCalls(BODY)[1]!] })).toMatch(/not IMD's job/);
    expect(check({ refundTo: Keypair.generate().publicKey.toBase58() })).toMatch(/refund would go to another wallet/);
    expect(check({ destRefund: "0x000000000000000000000000000000000000dEaD" })).toMatch(/refund would go to another wallet/);
    expect(check({ inLamports: (MAX_PAY_LAMPORTS + 1n).toString() })).toMatch(/out of range/);
    expect(check({ inUsd: "3", outUsd: "1.2" })).toMatch(/route costs 60.0%/);
    expect(() => readRelayQuote({ message: "No routes found" })).toThrow(/No routes found/);
  });

  it("reads Relay's status: the destination transaction once it is done", () => {
    const tx = `0x${"29".repeat(32)}`;
    expect(readRelayStatus({ status: "success", inTxHashes: ["38kz"], txHashes: [tx], destinationChainId: 4663, failReason: "N/A" })).toEqual({ state: "success", destTx: tx, destChain: 4663, inTx: "38kz", why: null });
    expect(readRelayStatus({ status: "pending" }).state).toBe("pending");
    expect(readRelayStatus({ status: "waiting" }).state).toBe("waiting");
    expect(readRelayStatus({ status: "refund", failReason: "SOLVER_CAPACITY_EXCEEDED" })).toMatchObject({ state: "refunded", why: "SOLVER_CAPACITY_EXCEEDED" });
    expect(readRelayStatus({ status: "failure" }).state).toBe("failed");
    expect(readRelayStatus(null).state).toBe("waiting");
  });
});
