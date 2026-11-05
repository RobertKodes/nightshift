import { createPublicKey, verify } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";

/** Meteora's Dynamic Bonding Curve program. */
export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

/**
 * The creator's signed launch, checked before NIGHTSHIFT adds the one signature it holds (the token's
 * mint address) and sends it. The creator signs in their own wallet; NIGHTSHIFT's mint signature must
 * only ever create that token on Meteora's bonding curve, so the transaction may contain nothing else:
 * the durable nonce advance (for a launch that waits for the IMD swarm), compute budget, Meteora DBC,
 * and the token-account and SOL-wrapping steps of the creator's own first buy.
 */

const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PEnBqCXEpPxuEb";
const ALLOWED = new Set([ComputeBudgetProgram.programId.toBase58(), SystemProgram.programId.toBase58(), DBC_PROGRAM, ATA, TOKEN, TOKEN22]);

export type LaunchTxExpect = {
  creator: string; mint: string; config: string;
  /** a launch that waits for the swarm: the nonce account (the creator is its authority) and its current value */
  nonce: { account: string; value: string } | null;
};

export function readTx(b64: string): Transaction {
  if (!/^[A-Za-z0-9+/=]{100,3000}$/.test(b64)) throw new Error("That is not a transaction.");
  return Transaction.from(Buffer.from(b64, "base64"));
}

/** Why this transaction may not be sent with NIGHTSHIFT's mint signature, or null when it is exactly a launch. */
export function launchTxProblem(tx: Transaction, e: LaunchTxExpect): string | null {
  const msg = tx.compileMessage();
  if (tx.feePayer?.toBase58() !== e.creator) return "The launch must be paid by the creator's wallet.";
  const signers = msg.accountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
  if (signers.length !== 2 || !signers.includes(e.creator) || !signers.includes(e.mint)) return "The launch must be signed by the creator and the token's address only.";
  const own = tx.signatures.find((s) => s.publicKey.toBase58() === e.creator)?.signature;
  if (!own) return "The creator's signature is missing.";
  if (tx.signatures.some((s) => s.publicKey.toBase58() === e.mint && s.signature)) return "The token's address is signed by NIGHTSHIFT only.";
  if (!tx.verifySignatures(false)) return "The creator's signature does not match the transaction: the wallet changed it.";

  const ixs = tx.instructions;
  if (e.nonce) {
    const first = ixs[0];
    if (!first || !first.programId.equals(SystemProgram.programId) || SystemInstruction.decodeInstructionType(first) !== "AdvanceNonceAccount") return "A launch that waits for the swarm must start with its nonce.";
    const n = SystemInstruction.decodeNonceAdvance(first);
    if (n.noncePubkey.toBase58() !== e.nonce.account || n.authorizedPubkey.toBase58() !== e.creator) return "The launch uses another nonce account.";
    if (tx.recentBlockhash !== e.nonce.value) return "The launch was signed with an old nonce: sign it again.";
  }
  let created = false;
  for (const [i, ix] of ixs.entries()) {
    const program = ix.programId.toBase58();
    if (!ALLOWED.has(program)) return "The launch contains a step that is not part of a launch.";
    // a decoded transaction marks an account signer everywhere it appears, so the rule is per program:
    // the token's address may appear in Meteora's steps and in creating the buyer's token account for it
    const hasMint = ix.keys.some((k) => k.pubkey.toBase58() === e.mint);
    if (program === DBC_PROGRAM) {
      if (hasMint && ix.keys.some((k) => k.pubkey.toBase58() === e.config)) created = true;
      continue;
    }
    if (program === ATA) {
      // Create (no data or 0) and CreateIdempotent (1) only: the token account is the program's own address
      if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0]! > 1)) return "The launch contains a token-account step that is not part of a launch.";
      continue;
    }
    if (hasMint) return "The launch uses the token's address outside Meteora.";
    if (program === SystemProgram.programId.toBase58()) {
      const kind = SystemInstruction.decodeInstructionType(ix);
      if (kind === "AdvanceNonceAccount" && i === 0 && e.nonce) continue;
      if (kind !== "Transfer") return "The launch contains a system step that is not part of a launch.";
      if (SystemInstruction.decodeTransfer(ix).fromPubkey.toBase58() !== e.creator) return "The launch moves SOL from another wallet.";
    }
  }
  if (!created) return "The transaction does not create the token on the launch's Meteora config.";
  return null;
}

/** An ed25519 signature by a Solana wallet over a short text (the creator's "launch without the swarm" or "cancel"). */
export function walletSigned(address: string, text: string, signatureB64: string): boolean {
  try {
    const raw = new PublicKey(address).toBytes();
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(raw)]), format: "der", type: "spki" });
    const sig = Buffer.from(signatureB64, "base64");
    return sig.length === 64 && verify(null, Buffer.from(text, "utf8"), key, sig);
  } catch { return false; }
}
