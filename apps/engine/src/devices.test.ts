import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVAL_WINDOW_MS, Devices, MAX_DEVICES_PER_OWNER, approvalPayload, deviceId, deviceView } from "./devices.js";

const dir = () => mkdtempSync(join(tmpdir(), "devices-test-"));
const me = "0xabc0000000000000000000000000000000000001";
const other = "0xabc0000000000000000000000000000000000002";
/** A phone's key: what Android's Keystore would hold, as SPKI DER in base64 (wrapped like Android's default Base64). */
function phone() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { pubKey: pub, wrapped: pub.replace(/(.{76})/g, "$1\n"), sign: (msg: string) => sign("sha256", Buffer.from(msg), privateKey).toString("base64") };
}
const token = (n: number) => `f${n}Xyz_${"a".repeat(140)}:APA91b${"b".repeat(20)}`;

describe("the owner's phones", () => {
  it("registers a phone by its key, again as the same phone, and lists only the owner's own", () => {
    const d = new Devices(dir()), p = phone();
    const a = d.register(me, { pubKey: p.wrapped, fcmToken: token(1), name: "Pixel <8>" });
    expect(a.id).toBe(deviceId(p.pubKey));
    expect(a.name).toBe("Pixel 8");
    const again = d.register(me, { pubKey: p.pubKey, fcmToken: token(2) });
    expect(again.id).toBe(a.id);
    expect(d.list(me)).toHaveLength(1);
    expect(d.list(me)[0]!.fcmToken).toBe(token(2));
    expect(d.list(other)).toHaveLength(0);
    // the view never shows the push token
    expect(JSON.stringify(deviceView(a))).not.toContain("APA91b");
  });

  it("refuses what is not a P-256 key, a key that is another wallet's, and a token that is not one", () => {
    const d = new Devices(dir()), p = phone();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(() => d.register(me, { pubKey: rsa })).toThrow(/P-256/);
    expect(() => d.register(me, { pubKey: "nonsense" })).toThrow(/P-256/);
    d.register(me, { pubKey: p.pubKey });
    expect(() => d.register(other, { pubKey: p.pubKey })).toThrow(/another wallet/);
    expect(() => d.register(me, { pubKey: phone().pubKey, fcmToken: "short" })).toThrow(/push token/);
  });

  it("moves a push token with its phone, so one phone never hears two wallets", () => {
    const d = new Devices(dir());
    d.register(me, { pubKey: phone().pubKey, fcmToken: token(1) });
    d.register(other, { pubKey: phone().pubKey, fcmToken: token(1) });
    expect(d.reach(me, "sale")).toHaveLength(0);
    expect(d.reach(other, "sale")).toHaveLength(1);
  });

  it("keeps prefs per phone and reaches only phones that want that kind", () => {
    const d = new Devices(dir());
    const a = d.register(me, { pubKey: phone().pubKey, fcmToken: token(1), prefs: { sale: false, junk: true } });
    d.register(me, { pubKey: phone().pubKey, fcmToken: token(2) });
    expect(a.prefs).toEqual({ approval: true, sale: false, result: true, warning: true });
    expect(d.reach(me, "sale")).toHaveLength(1);
    expect(d.reach(me, "approval")).toHaveLength(2);
    d.update(me, a.id, { prefs: { approval: false } });
    expect(d.reach(me, "approval")).toHaveLength(1);
  });

  it("caps phones per wallet, removes one, drops a token FCM calls gone, and keeps all of it on disk", () => {
    const where = dir(), d = new Devices(where);
    const ids = Array.from({ length: MAX_DEVICES_PER_OWNER }, (_, i) => d.register(me, { pubKey: phone().pubKey, fcmToken: token(i) }).id);
    expect(() => d.register(me, { pubKey: phone().pubKey })).toThrow(/remove one/);
    expect(d.remove(me, ids[0]!)).toBe(true);
    expect(d.remove(other, ids[1]!)).toBe(false);
    d.dropToken(token(1));
    const back = new Devices(where);
    expect(back.list(me)).toHaveLength(MAX_DEVICES_PER_OWNER - 1);
    expect(back.list(me).find((x) => x.id === ids[1])!.fcmToken).toBeNull();
    expect(back.removeAll(me)).toBe(MAX_DEVICES_PER_OWNER - 1);
  });
});

describe("approvals signed on the phone", () => {
  const now = 1_800_000_000_000;
  const setup = () => { const d = new Devices(dir()), p = phone(); const dev = d.register(me, { pubKey: p.pubKey }); return { d, p, dev }; };
  const ask = (dev: { id: string }, sig: string, over: Partial<{ ts: number; costUsd: number; taskId: string }> = {}) => ({ deviceId: dev.id, sig, ts: now, companyId: "co1", taskId: "t1", costUsd: 7.68, ...over });

  it("accepts the phone's signature over this company, task, price and moment", () => {
    const { d, p, dev } = setup();
    const sig = p.sign(approvalPayload("co1", "t1", 7.68, now));
    expect(d.checkApproval(me, ask(dev, sig), now + 5_000)).toMatchObject({ ok: true });
    // Android wraps base64 lines: still the same signature
    expect(d.checkApproval(me, ask(dev, sig.replace(/(.{40})/g, "$1\n")), now)).toMatchObject({ ok: true });
  });

  it("refuses a stale signature, another task, another price, another phone, and another wallet", () => {
    const { d, p, dev } = setup();
    const sig = p.sign(approvalPayload("co1", "t1", 7.68, now));
    expect(d.checkApproval(me, ask(dev, sig), now + APPROVAL_WINDOW_MS + 1)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(d.checkApproval(me, ask(dev, sig, { taskId: "t2" }), now)).toMatchObject({ ok: false, error: expect.stringMatching(/does not match/) });
    expect(d.checkApproval(me, ask(dev, sig, { costUsd: 7.69 }), now)).toMatchObject({ ok: false });
    const stranger = phone();
    expect(d.checkApproval(me, ask(dev, stranger.sign(approvalPayload("co1", "t1", 7.68, now))), now)).toMatchObject({ ok: false });
    expect(d.checkApproval(other, ask(dev, sig), now)).toMatchObject({ ok: false, error: expect.stringMatching(/not registered/) });
    expect(d.checkApproval(me, ask(dev, "not base64 at all!"), now)).toMatchObject({ ok: false });
    // a removed phone approves nothing
    d.remove(me, dev.id);
    expect(d.checkApproval(me, ask(dev, sig), now)).toMatchObject({ ok: false });
  });

  it("signs the price in cents, as the app shows it", () => {
    expect(approvalPayload("co", "t", 7.6799, 5)).toBe("nightshift-approve|co|t|7.68|5");
  });
});
