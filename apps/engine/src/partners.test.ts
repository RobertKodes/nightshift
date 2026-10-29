import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { partnerRoutes } from "./partner-routes.js";
import { type Application, PartnerError, Partners, base58, partnerMessage, postLink, unbase58, verifySolanaSignature } from "./partners.js";

const T0 = Date.parse("2026-10-28T12:00:00.000Z");
const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET = "0xabcdef0123456789abcdef0123456789abcdef01";
const SIG = `0x${"ab".repeat(65)}`;

function make(over: Partial<ConstructorParameters<typeof Partners>[0]> = {}) {
  const notify = vi.fn(async () => true), announce = vi.fn(async () => true);
  const partners = new Partners({
    dir: mkdtempSync(join(tmpdir(), "partners-")), now: () => T0,
    verifyEvm: async () => true, control: async () => "owner", notify, announce,
    market: async () => ({ symbol: "MOON", name: "Moon", priceUsd: 0.01, liquidityUsd: 120_000, volume24hUsd: 9_000, image: "https://img.example/moon.png", pairUrl: "https://dexscreener.com/base/0xpair" }),
    ...over,
  });
  return { partners, notify, announce };
}
function form(over: Record<string, unknown> = {}) {
  const issued = new Date(T0).toISOString(), token = { chain: "base" as const, chainName: "Base", address: TOKEN };
  const m = partnerMessage("Moon Labs", token, WALLET, issued);
  return { chain: "base", token: TOKEN, project: "Moon Labs", website: "https://moon.example", x: "@moonlabs", telegram: "t.me/moonlabs", about: "A community token with a game and weekly buybacks.", contact: "@moonteam", wants: ["badge", "swap"], post: "https://x.com/moonlabs/status/1850000000000000000", wallet: WALLET, issued, message: m.message, signature: SIG, ...over };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("partner applications", () => {
  it("signs a fixed message with the lowercase wallet and token", () => {
    const m = partnerMessage("Moon Labs", { chain: "base", chainName: "Base", address: TOKEN }, WALLET.toUpperCase().replace("0X", "0x"), "2026-10-28T12:00:00.000Z");
    expect(m.message).toBe(`Partner with NIGHTSHIFT\nproject: Moon Labs\ntoken: base:${TOKEN}\nwallet: ${WALLET}\nissued: 2026-10-28T12:00:00.000Z`);
  });

  it("accepts a signed application, checks the token and tells the operators with buttons", async () => {
    const { partners, notify } = make();
    const r = await partners.apply(form(), "1.2.3.4");
    expect(r.status).toBe("pending");
    await settle();
    const app = partners.applications()[0]!;
    expect(app).toMatchObject({ proof: "owner", signer: WALLET, post: "https://x.com/i/status/1850000000000000000", project: { x: "https://x.com/moonlabs", telegram: "https://t.me/moonlabs" } });
    expect(app.market?.symbol).toBe("MOON");
    const [text, buttons] = notify.mock.calls[0] as unknown as [string, { data?: string }[][]];
    expect(text).toContain("Moon Labs");
    expect(text).toContain("signed by the token's owner wallet");
    expect(buttons[0]!.map((b) => b.data)).toEqual([`/partner accept ${r.id}`, `/partner decline ${r.id}`]);
  });

  it("refuses a bad signature, a stale or changed message, and a bad post link", async () => {
    await expect(make({ verifyEvm: async () => false }).partners.apply(form(), "ip")).rejects.toMatchObject({ code: "bad_signature" });
    await expect(make().partners.apply(form({ issued: new Date(T0 - 11 * 60_000).toISOString() }), "ip")).rejects.toMatchObject({ code: "stale" });
    await expect(make().partners.apply(form({ project: "Other Name" }), "ip")).rejects.toMatchObject({ code: "bad_message" });
    await expect(make().partners.apply(form({ post: "https://moon.example/blog" }), "ip")).rejects.toMatchObject({ code: "bad_post" });
    expect(() => postLink("https://t.me/moonlabs/42")).not.toThrow();
  });

  it("tells the operators once when an application fails, so the project can be helped", async () => {
    const { partners, notify } = make({ verifyEvm: async () => false });
    await expect(partners.apply(form(), "ip")).rejects.toMatchObject({ code: "bad_signature" });
    await expect(partners.apply(form(), "ip")).rejects.toMatchObject({ code: "bad_signature" });
    expect(notify).toHaveBeenCalledTimes(1);
    const [text] = notify.mock.calls[0] as unknown as [string];
    expect(text).toContain("Partner application failed");
    expect(text).toContain("Moon Labs on Base");
    expect(text).toContain("does not match the wallet");
    expect(partners.applications()).toHaveLength(0);
  });

  it("lets the operators register a project whose form did not save, once per token", async () => {
    const { partners, notify } = make();
    const app = partners.addByHand({ project: "Sovrn One", chain: "robinhood", token: "0x7f7e9b8e9f754c3076e514852552019CB571461b", website: "https://sovrn.one", x: "@SovrnIMD", telegram: "t.me/frensofsolomon", post: "https://x.com/SovrnIMD/status/2115617189474779465?s=19", note: "posted on X, the form did not save" });
    expect(app).toMatchObject({ status: "pending", proof: "unsigned", signer: null, ipHash: "operators", post: "https://x.com/i/status/2115617189474779465", token: { chain: "robinhood", address: "0x7f7e9b8e9f754c3076e514852552019cb571461b" } });
    expect(app.note).toBe("Added by hand: posted on X, the form did not save");
    await settle();
    const [text, buttons] = notify.mock.calls[0] as unknown as [string, unknown[][]];
    expect(text).toContain("Sovrn One");
    expect(text).toContain("Added by hand");
    expect(buttons).toHaveLength(2);
    expect(() => partners.addByHand({ project: "Sovrn One", chain: "robinhood", token: "0x7f7e9b8e9f754c3076e514852552019cb571461b" })).toThrow(PartnerError);
  });

  it("checks an EVM signature on the token's own chain", async () => {
    const verifyEvm = vi.fn(async () => true);
    await make({ verifyEvm }).partners.apply(form(), "ip");
    expect(verifyEvm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("token: base:") }), "base");
  });

  it("keeps one open application per token and limits each address to five a day", async () => {
    const { partners } = make();
    await partners.apply(form(), "ip");
    await expect(partners.apply(form({ post: "https://x.com/moonlabs/status/1850000000000000001" }), "ip")).rejects.toMatchObject({ code: "pending" });
    for (let i = 2; i <= 5; i++) await partners.apply(form({ token: `0x${String(i).repeat(40)}`, message: partnerMessage("Moon Labs", { chain: "base", chainName: "Base", address: `0x${String(i).repeat(40)}` }, WALLET, new Date(T0).toISOString()).message, post: `https://x.com/moonlabs/status/185000000000000000${i}` }), "ip");
    await expect(partners.apply(form({ token: `0x${"9".repeat(40)}`, message: partnerMessage("Moon Labs", { chain: "base", chainName: "Base", address: `0x${"9".repeat(40)}` }, WALLET, new Date(T0).toISOString()).message, post: "https://x.com/moonlabs/status/1850000000000000009" }), "ip")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("checks a Solana wallet's ed25519 signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const address = base58(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
    expect(unbase58(address)?.length).toBe(32);
    const message = "Partner with NIGHTSHIFT\nproject: Sol Labs";
    const signature = sign(null, Buffer.from(message), privateKey);
    expect(verifySolanaSignature(address, message, signature.toString("base64"))).toBe(true);
    expect(verifySolanaSignature(address, message, base58(signature))).toBe(true);
    expect(verifySolanaSignature(address, `${message}!`, signature.toString("base64"))).toBe(false);
  });

  it("takes another chain's token without a signature, marked for a check by hand", async () => {
    const { partners } = make();
    await partners.apply({ ...form(), chain: "other", chainName: "Sui", token: "0x2::sui::SUI", signature: undefined, message: undefined }, "ip");
    expect(partners.applications()[0]).toMatchObject({ proof: "unsigned", signer: null, token: { chain: "other", chainName: "Sui" } });
  });

  it("announces an accepted partner, drafts the X post and lists only public fields", async () => {
    const { partners, announce } = make();
    const { id } = await partners.apply(form(), "ip"); await settle();
    const r = await partners.decide(id, "accept");
    expect(r.announced).toBe(true);
    expect(r.xDraft).toContain("@moonlabs");
    expect((announce.mock.calls[0] as unknown as [string])[0]).toContain("NEW NIGHTSHIFT PARTNER");
    const [listed] = partners.list();
    expect(listed).toMatchObject({ name: "Moon Labs", symbol: "MOON", image: "https://img.example/moon.png" });
    expect(listed).not.toHaveProperty("contact");
    expect(listed).not.toHaveProperty("ipHash");
    await expect(partners.apply(form({ post: "https://x.com/moonlabs/status/1850000000000000007" }), "other-ip")).rejects.toMatchObject({ code: "already_partner" });
    await expect(partners.decide(id, "decline")).rejects.toBeInstanceOf(PartnerError);
  });

  it("answers the operators' /partner command and its buttons", async () => {
    const { partners } = make();
    const { id } = await partners.apply(form(), "ip"); await settle();
    expect((await partners.command([])).text).toContain("1 partner application waiting");
    const done = await partners.command(["accept", id]);
    expect(done.text).toContain("is a partner now");
    expect(done.buttons?.[0]?.[0]?.url).toContain("x.com/intent/post");
  });
});

describe("partner routes", () => {
  function call(partners: Partners, method: string, path: string, body: Record<string, unknown> = {}, admin = false) {
    let status = 0, payload: unknown;
    const req = { method, url: path, headers: {}, socket: { remoteAddress: "1.2.3.4" } } as unknown as IncomingMessage;
    const res = { setHeader() {} } as unknown as ServerResponse;
    return partnerRoutes(req, res, path.split("?")[0]!, { partners, isAdmin: () => admin, body: async () => body, json: (_r, s, b) => { status = s; payload = b; } }).then((handled) => ({ handled, status, payload: payload as Record<string, unknown> }));
  }
  it("serves the list and the form, and keeps decisions for the operators", async () => {
    const { partners } = make();
    expect((await call(partners, "GET", "/api/partners")).payload).toMatchObject({ partners: [] });
    const applied = await call(partners, "POST", "/api/partners/apply", form());
    expect(applied.status).toBe(201);
    const id = (applied.payload as { id: string }).id;
    expect((await call(partners, "GET", `/api/partners/status/${id}`)).payload).toMatchObject({ status: "pending" });
    expect((await call(partners, "POST", `/api/partners/${id}/decide`, { decision: "accept" })).status).toBe(401);
    expect((await call(partners, "POST", `/api/partners/${id}/decide`, { decision: "accept" }, true)).payload).toMatchObject({ status: "accepted" });
    expect(((await call(partners, "GET", "/api/partners")).payload.partners as Application[]).length).toBe(1);
    expect((await call(partners, "GET", "/api/other")).handled).toBe(false);
  });
});
