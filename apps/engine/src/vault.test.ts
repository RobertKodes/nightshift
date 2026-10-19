import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { Vault } from "./vault.js";

const dir = () => mkdtempSync(join(tmpdir(), "ns-vault-"));

describe("the wallet vault", () => {
  it("keeps every key across restarts, with the previous file as vault.json.bak", () => {
    const d = dir();
    const v = new Vault(d, "s3cret");
    const a = v.create("a");
    const b = v.create("b");
    expect(existsSync(join(d, "vault.json.bak"))).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(join(d, "vault.json.bak"), "utf8")))).toEqual(["a"]);
    const again = new Vault(d, "s3cret");
    expect(again.account("a").address).toBe(a);
    expect(again.account("b").address).toBe(b);
  });

  it("an interrupted write leaves the vault as it was (only the .tmp is partial)", () => {
    const d = dir();
    const a = new Vault(d, "s3cret").create("a");
    writeFileSync(join(d, "vault.json.tmp"), '{"a": {"iv": "tru');
    expect(new Vault(d, "s3cret").account("a").address).toBe(a);
  });

  it("refuses to start on a vault that does not read back, instead of starting empty", () => {
    const d = dir();
    const v = new Vault(d, "s3cret");
    v.create("a");
    v.create("b");
    writeFileSync(join(d, "vault.json"), "");
    expect(() => new Vault(d, "s3cret")).toThrow(/Refusing to start/);
    rmSync(join(d, "vault.json"));
    expect(() => new Vault(d, "s3cret")).toThrow(/vault.json.bak exists/);
  });

  it("a write that fails hands out no wallet that is not on disk", () => {
    const d = dir();
    const v = new Vault(d, "s3cret");
    v.create("a");
    mkdirSync(join(d, "vault.json.tmp")); // the next write cannot happen
    expect(() => v.create("b")).toThrow();
    expect(() => v.account("b")).toThrow(/no wallet/);
    rmSync(join(d, "vault.json.tmp"), { recursive: true });
    expect(() => new Vault(d, "s3cret").account("b")).toThrow(/no wallet/);
  });

  it("never overwrites a key that exists", () => {
    const v = new Vault(dir(), "s3cret");
    const a = v.create("keeper");
    expect(() => v.create("keeper")).toThrow(/already exists/);
    expect(v.account("keeper").address).toBe(a);
  });
});

describe("the state file", () => {
  it("is on disk when an awaited save returns, even with a timer flush running at the same time", async () => {
    const d = dir();
    const s = new Store(d);
    s.requestTokens.set("c1", "t1");
    s.markDirty();
    const timer = s.flush();
    s.requestTokens.set("c2", "t2");
    await s.save();
    await timer;
    const back = new Store(d);
    await back.load();
    expect([...back.requestTokens.keys()]).toEqual(["c1", "c2"]);
  });
});
