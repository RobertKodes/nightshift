// Mainnet rehearsal of the fee wallet's burns, sending nothing: a live Relay quote for each burn (SOL -> IMD at
// IMD's BurnExecutor, SOL -> SHIFT at 0x...dEaD), the checks the engine runs, then the exact deposit simulated
// from a funded public wallet (signatures not checked) to see what it would cost the wallet.
import { ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";
import { liveFeePort } from "../src/sol-fees-live.ts";
import { relayProblem, BURNS } from "../src/sol-fees.ts";
const RPC = "https://solana-rpc.publicnode.com";
const FUNDED = process.argv[2] ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const conn = new Connection(RPC, "confirmed");
const port = liveFeePort(RPC);
for (const burn of ["imd", "shift"] as const) {
  const lamports = 500_000_000n;
  const q = await port.quote({ wallet: FUNDED, burn, lamports });
  const bad = relayProblem(q, { wallet: FUNDED, burn });
  const ixs = q.instructions.map((ix) => new TransactionInstruction({ programId: new PublicKey(ix.programId), data: Buffer.from(ix.data, "hex"), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) }));
  const tables = (await Promise.all(q.lookupTables.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter((t): t is AddressLookupTableAccount => !!t);
  const { blockhash } = await conn.getLatestBlockhash();
  const me = new PublicKey(FUNDED);
  const msg = new TransactionMessage({ payerKey: me, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...ixs] }).compileToV0Message(tables);
  const tx = new VersionedTransaction(msg);
  const before = BigInt(await conn.getBalance(me));
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: [FUNDED] } });
  const after = BigInt(sim.value.accounts?.[0]?.lamports ?? 0);
  console.log(BURNS[burn].symbol, JSON.stringify({ checks: bad ?? "pass", to: q.recipient, out: q.outAmount, inUsd: q.inUsd, outUsd: q.outUsd, lossPct: +((1 - q.outUsd / q.inUsd) * 100).toFixed(2), sim: sim.value.err ?? "ok", walletLosesSol: Number(before - after) / 1e9, bytes: tx.serialize().length }));
}
