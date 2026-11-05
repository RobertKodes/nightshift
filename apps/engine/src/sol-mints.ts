import { chmodSync, existsSync, readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { writeAtomic } from "./atomic.js";

/**
 * The token addresses of IMD launches on Solana: every one ends in "imd", the way pump.fun's end in
 * "pump". Found ahead of time in small slices (about 200,000 tries each, a few seconds of CPU spread
 * so the server never stalls) and kept in the data folder, readable by the engine only. A key here
 * can do one thing: create its token, which happens inside the creator's own signed launch. It is
 * dropped once the token exists. If none is ready, a launch gets a plain random address.
 */

export const SUFFIX = "imd";
const READY = 4;
const SLICE = 1_500;

type Stored = { ready: string[]; held: Record<string, string> };

export class MintKeys {
  private file: string;
  private s: Stored;
  private grinding = false;

  constructor(dir: string, private suffix = SUFFIX, private ready = READY) {
    this.file = join(dir, "sol-mint-keys.json");
    this.s = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Stored) : { ready: [], held: {} };
  }

  private save() {
    writeAtomic(this.file, JSON.stringify(this.s));
    try { chmodSync(this.file, 0o600); } catch { /* not on every filesystem */ }
  }

  /** A fresh address for a new launch; its key is held until the token exists or the launch is dropped. */
  take(): string {
    const secret = this.s.ready.shift() ?? Buffer.from(Keypair.generate().secretKey).toString("base64");
    const kp = Keypair.fromSecretKey(Buffer.from(secret, "base64"));
    const mint = kp.publicKey.toBase58();
    this.s.held[mint] = secret;
    this.save();
    void this.fill();
    return mint;
  }

  keypair(mint: string): Keypair | null {
    const s = this.s.held[mint];
    return s ? Keypair.fromSecretKey(Buffer.from(s, "base64")) : null;
  }

  drop(mint: string) { if (this.s.held[mint]) { delete this.s.held[mint]; this.save(); } }

  readyCount() { return this.s.ready.length; }

  /** Keep a few suffixed addresses ready, a slice at a time. */
  async fill(): Promise<void> {
    if (this.grinding) return;
    this.grinding = true;
    try {
      while (this.s.ready.length < this.ready) {
        const found = await grind(this.suffix);
        this.s.ready.push(found);
        this.save();
      }
    } finally { this.grinding = false; }
  }
}

/** One key whose address ends with the suffix, searched in slices with a yield between them. */
export async function grind(suffix: string, slice = SLICE): Promise<string> {
  for (;;) {
    for (let i = 0; i < slice; i++) {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
      if (!new PublicKey(pub).toBase58().endsWith(suffix)) continue;
      const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
      return Buffer.from(Keypair.fromSeed(seed).secretKey).toString("base64");
    }
    await new Promise((r) => setImmediate(r));
  }
}
