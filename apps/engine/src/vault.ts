import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

type Entries = Record<string, { iv: string; tag: string; data: string }>;

/**
 * Each company owns a wallet. Its key lives here, encrypted with AES-256-GCM under a key derived
 * from NIGHTSHIFT_SECRET. Without a secret one is generated into the data folder, which is fine for
 * a demo and wrong for production: the engine says so at start.
 */
export class Vault {
  readonly #file: string;
  readonly #key: Buffer;
  readonly #entries: Entries;
  readonly generatedSecret: boolean;
  /** The secret material, for deriving other keys (sessions). Never sent anywhere. */
  readonly material: string;

  constructor(dataDir: string, secret: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#file = join(dataDir, "vault.json");
    let s = secret;
    this.generatedSecret = false;
    if (!s) {
      const f = join(dataDir, "secret.key");
      if (!existsSync(f)) writeAtomic(f, randomBytes(32).toString("hex"), { mode: 0o600 });
      s = readFileSync(f, "utf8").trim();
      if (!s) throw new Error(`${f} is empty; refusing to start`);
      this.generatedSecret = true;
    }
    this.material = s;
    this.#key = scryptSync(s, "nightshift-vault-v1", 32);
    this.#entries = Vault.#load(this.#file);
  }

  /** The only copy of every wallet key: a vault that does not read back stops the engine instead of starting empty. */
  static #load(file: string): Entries {
    if (!existsSync(file)) {
      if (existsSync(`${file}.bak`)) throw new Error(`${file} is missing but ${file}.bak exists: restore it before starting, or every company wallet is lost`);
      return {};
    }
    let v: unknown;
    try { v = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
      throw new Error(`${file} does not parse (${(e as Error).message}); the previous version is ${file}.bak. Refusing to start with an empty vault.`);
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${file} is not a vault; refusing to start`);
    return v as Entries;
  }

  /**
   * Atomic, with the previous file kept as vault.json.bak: an interrupted write never loses a key.
   * A write that fails takes the change back, so no wallet is handed out that is not on disk.
   */
  #save(key: string, before: Entries[string] | undefined): void {
    try {
      writeAtomic(this.#file, JSON.stringify(this.#entries, null, 2), { mode: 0o600, backup: true });
    } catch (e) {
      if (before) this.#entries[key] = before; else delete this.#entries[key];
      throw e;
    }
  }

  create(id: string): `0x${string}` {
    // never overwrite a key: it may hold funds
    if (this.#entries[id]) throw new Error(`a wallet for ${id} already exists`);
    const pk = generatePrivateKey();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.#key, iv);
    const data = Buffer.concat([c.update(pk, "utf8"), c.final()]);
    this.#entries[id] = { iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("hex") };
    this.#save(id, undefined);
    return privateKeyToAccount(pk).address;
  }

  /** Any other secret (an app password, a bot token), encrypted like the wallet keys. */
  putSecret(name: string, value: string | null): void {
    const k = `secret:${name}`;
    const before = this.#entries[k];
    if (value === null) delete this.#entries[k];
    else {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", this.#key, iv);
      const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
      this.#entries[k] = { iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("hex") };
    }
    this.#save(k, before);
  }
  getSecret(name: string): string | null {
    const e = this.#entries[`secret:${name}`];
    if (!e) return null;
    const d = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(e.iv, "hex"));
    d.setAuthTag(Buffer.from(e.tag, "hex"));
    return Buffer.concat([d.update(Buffer.from(e.data, "hex")), d.final()]).toString("utf8");
  }

  account(id: string) {
    const e = this.#entries[id];
    if (!e) throw new Error(`no wallet for ${id}`);
    const d = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(e.iv, "hex"));
    d.setAuthTag(Buffer.from(e.tag, "hex"));
    const pk = Buffer.concat([d.update(Buffer.from(e.data, "hex")), d.final()]).toString("utf8") as Hex;
    return privateKeyToAccount(pk);
  }
}
