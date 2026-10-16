import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Each company owns a wallet. Its key lives here, encrypted with AES-256-GCM under a key derived
 * from NIGHTSHIFT_SECRET. Without a secret one is generated into the data folder, which is fine for
 * a demo and wrong for production: the engine says so at start.
 */
export class Vault {
  readonly #file: string;
  readonly #key: Buffer;
  readonly #entries: Record<string, { iv: string; tag: string; data: string }>;
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
      if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 });
      s = readFileSync(f, "utf8").trim();
      this.generatedSecret = true;
    }
    this.material = s;
    this.#key = scryptSync(s, "nightshift-vault-v1", 32);
    this.#entries = existsSync(this.#file) ? JSON.parse(readFileSync(this.#file, "utf8")) : {};
  }

  create(id: string): `0x${string}` {
    const pk = generatePrivateKey();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.#key, iv);
    const data = Buffer.concat([c.update(pk, "utf8"), c.final()]);
    this.#entries[id] = { iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("hex") };
    writeFileSync(this.#file, JSON.stringify(this.#entries, null, 2), { mode: 0o600 });
    return privateKeyToAccount(pk).address;
  }

  /** Any other secret (an app password, a bot token), encrypted like the wallet keys. */
  putSecret(name: string, value: string | null): void {
    const k = `secret:${name}`;
    if (value === null) delete this.#entries[k];
    else {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", this.#key, iv);
      const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
      this.#entries[k] = { iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("hex") };
    }
    writeFileSync(this.#file, JSON.stringify(this.#entries, null, 2), { mode: 0o600 });
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
