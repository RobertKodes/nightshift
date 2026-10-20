import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Company, DEFAULT_POLICY, type Product, type Task } from "@nightshift/core";
import { Ledger } from "@nightshift/ledger";
import { beforeAll, describe, expect, it } from "vitest";
import { Connect } from "./connect.js";
import { HOOK, fakePlatforms } from "./connect.fake.js";
import { pingSig, prohibited } from "./gumroad.js";
import { Store } from "./store.js";
import { Vault } from "./vault.js";
import type * as FL from "./flight.js";

let F: typeof FL;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "connect-data-"));
  F = await import("./flight.js");
});

const NOW = Date.parse("2026-10-20T14:00:00Z");
const MIN = 60_000;
const TEXT = "# The Etsy Holiday Playbook\n\n_Sell more this December, with listings that work._\n\n## Listings that sell in December\n\nReal notes from real shops. ".repeat(3);
const bigint = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function product(id: string, extra: Partial<Product> = {}): Product {
  return { id, name: "The Etsy Holiday Playbook", kind: "report", pitch: "Sell more this December, with listings that work.", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t-build", sales: 0, revenueUsdc: 0n, createdAt: NOW - 3600_000, ...extra };
}
function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, cycle: 5, kind: "post", title: "Post", why: "news", status: "planned", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 0n, result: null, error: null, createdAt: NOW, updatedAt: NOW, ...extra };
}
function company(): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly guides for Etsy sellers who want more holiday sales", mission: "More holiday sales for Etsy sellers.", audience: "Etsy sellers",
    createdAt: 0, owner: "0xowner", wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 4, nextShiftAt: null,
    site: null, products: [product("p1")], journal: [], marketing: [],
    tasks: [task("t-build", { cycle: 3, kind: "build_product", title: "Build the Etsy Holiday Playbook", status: "done", productId: "p1", createdAt: NOW - 7200_000, updatedAt: NOW - 3600_000 })],
  };
}

function world(o: { sim?: boolean; https?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "connect-"));
  const vault = new Vault(dir, "s3cret");
  const ledger = new Ledger();
  const fake = fakePlatforms();
  const notes: [string, string][] = [];
  const now = { t: NOW };
  const c = company();
  const k = new Connect({
    vault, ledger, http: fake.http, open: fake.http, sim: () => Boolean(o.sim),
    publicUrl: () => (o.https === false ? "http://localhost:8783" : "https://getnightshift.tech"),
    gumroadApp: () => ({ id: "gr-app-id", secret: "gr-app-secret" }),
    telegram: () => ({ token: "123456:TESTTOKENtesttokenTESTTOKENtest", bot: "nightshiftimdbot" }),
    platformChats: () => ["@getnightshift", "-100999"],
    files: { has: (_c, p) => p.status !== "building", read: (_c, p) => (p.id.startsWith("p-") ? `# ${p.name}\n\nnotes` : TEXT) },
    metrics: () => ({ sales: [], visits: [], via: [] }), market: () => [],
    note: (_c, kind, text) => { notes.push([kind, text]); },
    changed: () => {}, now: () => now.t,
  });
  // the clock moves past Gumroad's pacing (a pass every 30 s) between ticks
  const tick = async (ms = 31_000) => { now.t += ms; await k.tick(c, true); };
  const calls = () => fake.s.calls.map((x) => `${x.method} ${new URL(x.url).host}${new URL(x.url).pathname}`);
  return { dir, vault, ledger, fake, notes, now, c, k, tick, calls };
}

async function withGumroad(o: { https?: boolean } = {}) {
  const w = world(o);
  const state = new URL(w.k.gumroadStart(w.c, "0xowner")).searchParams.get("state")!;
  await w.k.gumroadCallback("good-code", state, "0xowner", () => w.c);
  w.fake.s.calls.length = 0;
  return w;
}

describe("Gumroad", () => {
  it("connects by OAuth with the narrow scopes: the code becomes a token kept only in the vault", async () => {
    const w = world();
    const url = new URL(w.k.gumroadStart(w.c, "0xowner"));
    expect(`${url.origin}${url.pathname}`).toBe("https://gumroad.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "gr-app-id", redirect_uri: "https://getnightshift.tech/api/connect/gumroad/callback", scope: "edit_products view_sales view_payouts", response_type: "code" });
    // another wallet cannot finish the owner's link, and the link is used up
    await expect(w.k.gumroadCallback("good-code", url.searchParams.get("state")!, "0xsomeoneelse", () => w.c)).rejects.toThrow(/owner/);
    await expect(w.k.gumroadCallback("good-code", url.searchParams.get("state")!, "0xowner", () => w.c)).rejects.toThrow(/expired/);
    const state = new URL(w.k.gumroadStart(w.c, "0xowner")).searchParams.get("state")!;
    await w.k.gumroadCallback("good-code", state, "0xowner", () => w.c);
    const exchange = w.fake.s.calls.find((x) => x.url === "https://api.gumroad.com/oauth/token")!;
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({ grant_type: "authorization_code", code: "good-code", client_id: "gr-app-id", client_secret: "gr-app-secret", redirect_uri: "https://getnightshift.tech/api/connect/gumroad/callback" });
    expect(w.c.connections!.gumroad).toMatchObject({ user: "u-owner", name: "Owner Shop", url: "https://owner.gumroad.com", hooks: ["sub-sale", "sub-refund"] });
    // the sale and refund webhooks point at a URL signed for this company
    const subs = w.fake.s.calls.filter((x) => x.url.endsWith("/v2/resource_subscriptions")).map((x) => Object.fromEntries(new URLSearchParams(x.body)));
    expect(subs).toEqual(["sale", "refund"].map((r) => ({ resource_name: r, post_url: `https://getnightshift.tech/api/connect/gumroad/ping/c1/${pingSig("s3cret", "c1")}` })));
    expect(JSON.parse(w.vault.getSecret("gumroad:c1")!).access_token).toBe(w.fake.s.gumroad.token);
    expect(JSON.stringify(w.c, bigint)).not.toContain(w.fake.s.gumroad.token);
    // a bad code connects nothing
    const w2 = world();
    await expect(w2.k.gumroadCallback("bad-code", new URL(w2.k.gumroadStart(w2.c, null)).searchParams.get("state")!, null, () => w2.c)).rejects.toThrow(/authorization grant is invalid/);
    expect(w2.c.connections?.gumroad).toBeUndefined();
  });

  it("makes each product there as a draft from its NIGHTSHIFT product: name, price, the AI disclosure, the file and the cover", async () => {
    const w = await withGumroad();
    await w.tick();
    expect(w.calls().filter((x) => !x.includes("/v2/sales"))).toEqual([
      "POST api.gumroad.com/v2/products",
      "POST api.gumroad.com/v2/files/presign",
      "PUT uploads.s3.example.com/k1",
      "POST api.gumroad.com/v2/files/complete",
      "PUT api.gumroad.com/v2/products/gp1",
      "POST api.gumroad.com/v2/products/gp1/covers",
    ]);
    const [create, presign, , complete, attach, cover] = w.fake.s.calls.filter((x) => !x.url.includes("/v2/sales"));
    const f = Object.fromEntries(new URLSearchParams(create!.body));
    expect(f).toMatchObject({ name: "The Etsy Holiday Playbook", price: "900", price_currency_type: "usd", draft: "true", published: "false" });
    expect(f.description).toContain("<strong>Produced by an AI agent for Acme (NIGHTSHIFT).</strong>");
    expect(f.description).toContain("a free public version of the underlying notes may exist");
    expect(create!.headers.Authorization).toBe(`Bearer ${w.fake.s.gumroad.token}`);
    expect(w.fake.s.gumroad.published.size).toBe(0);
    // the file goes up as Gumroad takes files: presign, the bytes to the presigned URL, complete, attach
    expect(Object.fromEntries(new URLSearchParams(presign!.body))).toEqual({ filename: "acme-the-etsy-holiday-playbook.md", file_size: String(Buffer.byteLength(TEXT)), content_type: "text/markdown" });
    expect(w.fake.s.gumroad.parts).toEqual([{ url: "https://uploads.s3.example.com/k1?partNumber=1&X-Amz-Signature=abc", bytes: Buffer.byteLength(TEXT), type: "text/markdown", length: String(Buffer.byteLength(TEXT)) }]);
    expect(Object.fromEntries(new URLSearchParams(complete!.body))).toEqual({ upload_id: "up-1", key: "attachments/k1", "parts[][part_number]": "1", "parts[][etag]": '"etag-1"' });
    expect(new URLSearchParams(attach!.body).get("files[][url]")).toBe("https://files.gumroad.example/attachments/k1/file.md");
    expect(new URLSearchParams(cover!.body).get("url")).toBe("https://getnightshift.tech/api/connect/cover/acme/p1.png");
    expect(w.c.products[0]!.gumroad).toMatchObject({ id: "gp1", state: "draft", approved: false, file: true, cover: true, url: "https://owner.gumroad.com/l/gp1" });
    expect(w.k.desk(w.c).gumroad.approvals).toEqual([{ productId: "p1", product: "The Etsy Holiday Playbook", priceUsd: 9, url: "https://owner.gumroad.com/l/gp1", file: true }]);
    expect(w.notes.some(([, t]) => t.startsWith('Waiting for your approval: publish "The Etsy Holiday Playbook" on Gumroad'))).toBe(true);
    // one product, made once
    await w.tick();
    expect(w.fake.s.gumroad.products.size).toBe(1);
  });

  it("without a public https address, skips the cover (Gumroad could not read it) and the webhooks; sales are polled", async () => {
    const w = await withGumroad({ https: false });
    expect(w.c.connections!.gumroad!.hooks).toEqual([]);
    await w.tick();
    expect(w.calls()).not.toContain("POST api.gumroad.com/v2/products/gp1/covers");
    expect(w.c.connections!.log.find((e) => e.what.startsWith("The cover of"))?.result).toBe("waiting");
  });

  it("publishes only after the owner's yes, the first time per product; takes it down when it leaves sale; sends price changes once", async () => {
    const w = await withGumroad();
    await w.tick();
    await w.tick();
    expect(w.calls()).not.toContain("PUT api.gumroad.com/v2/products/gp1/enable");
    w.k.gumroadApprove(w.c, "p1");
    await w.tick(1000);
    expect(w.fake.s.gumroad.published.has("gp1")).toBe(true);
    expect(w.c.products[0]!.gumroad?.state).toBe("published");
    // off sale on NIGHTSHIFT: off Gumroad
    w.c.products[0]!.status = "retired";
    await w.tick();
    expect(w.fake.s.gumroad.published.has("gp1")).toBe(false);
    expect(w.c.products[0]!.gumroad?.state).toBe("unpublished");
    // back on sale: it was approved once, so it goes back up without asking again
    w.c.products[0]!.status = "live";
    await w.tick();
    expect(w.fake.s.gumroad.published.has("gp1")).toBe(true);
    // a new price is sent once
    w.c.products[0]!.priceUsdc = 12_000_000n;
    w.fake.s.calls.length = 0;
    await w.tick();
    await w.tick();
    const puts = w.fake.s.calls.filter((x) => x.method === "PUT" && x.url.endsWith("/v2/products/gp1"));
    expect(puts.map((x) => new URLSearchParams(x.body).get("price"))).toEqual(["1200"]);
  });

  it("says so when Gumroad keeps a product unpublished (email or payouts not set up)", async () => {
    const w = await withGumroad();
    w.fake.s.gumroad.blockPublish = true;
    await w.tick();
    w.k.gumroadApprove(w.c, "p1");
    await w.tick(1000);
    expect(w.c.products[0]!.gumroad?.state).toBe("draft");
    expect(w.c.connections!.log.at(-1)).toMatchObject({ what: 'Gumroad kept "The Etsy Holiday Playbook" unpublished', result: "waiting", detail: "Confirm your email address to publish" });
  });

  it("never lists a product in Gumroad's prohibited categories, and says why", async () => {
    const p = (name: string, kind: Product["kind"] = "report", pitch = "A practical guide.") => ({ name, pitch, kind });
    expect(prohibited(p("NFT Flipping Masterclass"))?.id).toBe("crypto");
    expect(prohibited(p("Bitcoin for beginners"))?.id).toBe("crypto");
    expect(prohibited(p("500 eBooks with Master Resell Rights"))?.id).toBe("plr");
    expect(prohibited(p("PLR wellness articles pack"))?.id).toBe("plr");
    expect(prohibited(p("Shopify consulting for small brands"))?.id).toBe("consulting");
    expect(prohibited(p("A 1:1 coaching session for founders"))?.id).toBe("consulting");
    expect(prohibited(p("Lifetime access to our AI chatbot"))?.id).toBe("ai_service");
    // a hosted tool is used outside Gumroad, whatever it is called
    expect(prohibited(p("Etsy listing checker", "tool"))?.id).toBe("ai_service");
    // the file's headings count; a passing mention in its text does not
    expect(prohibited(p("Side income guide"), "# Side income guide\n\n## Airdrop farming, step by step\n")?.id).toBe("crypto");
    expect(prohibited(p("Etsy payments guide"), "# Etsy payments guide\n\nA few sellers also take crypto, but this guide is about cards.")).toBeNull();
    for (const ok of ["The Etsy Holiday Playbook", "AI tool reviews for solo founders", "Notion templates for freelancers", "A dataset of 2026 SaaS prices"]) expect(prohibited(p(ok)), ok).toBeNull();
    expect(prohibited(p("NFT Flipping Masterclass"))).toEqual({ id: "crypto", label: "Crypto or NFT product", why: "Gumroad does not allow crypto products, NFTs included", matched: "NFT" });

    const w = await withGumroad();
    w.c.products.push(product("p-nft", { name: "NFT Flipping Masterclass", taskId: "t-nft" }));
    await w.tick();
    await w.tick();
    expect(w.fake.s.gumroad.products.size).toBe(1);
    const nft = w.c.products[1]!;
    expect(nft.gumroad).toBeUndefined();
    expect(nft.gumroadBlocked).toBe('Crypto or NFT product: Gumroad does not allow crypto products, NFTs included (it says "NFT").');
    expect(w.c.connections!.log.find((e) => e.result === "blocked")).toMatchObject({ what: 'Kept "NFT Flipping Masterclass" off Gumroad', taskId: "t-nft" });
    expect(() => w.k.gumroadApprove(w.c, "p-nft")).toThrow(/not on Gumroad/);
    // a listed product renamed into a prohibited category is taken down
    w.k.gumroadApprove(w.c, "p1");
    await w.tick(1000);
    w.c.products[0]!.name = "Etsy shops that take Bitcoin";
    await w.tick();
    expect(w.fake.s.gumroad.published.has("gp1")).toBe(false);
    expect(w.c.products[0]!.gumroad?.state).toBe("unpublished");
  });

  it("books each sale once as off-chain USD revenue, apart from USDC and the company wallet, for its own products only", async () => {
    const w = await withGumroad();
    await w.tick();
    w.fake.s.gumroad.sales.push({ id: "s1", product_id: "gp1", price: 900, gumroad_fee: 140, created_at: "2026-10-20T13:00:00Z" }, { id: "s2", product_id: "someone-elses-product", price: 5000 });
    await w.tick(11 * MIN);
    expect(await w.ledger.store.get("gumroad:s1")).toMatchObject({ kind: "gumroad", memo: "The Etsy Holiday Playbook", meta: { productId: "p1", gumroadProductId: "gp1", currency: "USD", offChain: true, paidTo: "the owner's Gumroad account" } });
    expect(await w.ledger.balance("co:c1:gumroad", "USD")).toBe(760n * 10_000n);
    expect(await w.ledger.balance("ext:gumroad-fees", "USD")).toBe(140n * 10_000n);
    // never USDC, never in the company wallet's books
    expect(await w.ledger.balance("co:c1:usdc", "USDC")).toBe(0n);
    expect(await w.ledger.store.get("gumroad:s2")).toBeUndefined();
    expect(w.c.products[0]!.gumroad).toMatchObject({ sales: 1, revenueCents: 900 });
    expect([w.c.products[0]!.sales, w.c.products[0]!.revenueUsdc]).toEqual([0, 0n]);
    expect(w.notes).toContainEqual(["sale", "Sold The Etsy Holiday Playbook on Gumroad for $9.00. Gumroad pays it to your Gumroad account; it is booked apart from USDC."]);
    // the same sale by webhook: read back from Gumroad, booked once
    expect(await w.k.gumroadPing("c1", pingSig("s3cret", "c1"), new URLSearchParams({ sale_id: "s1", price: "99999" }), () => w.c)).toBe(true);
    expect(w.calls()).toContain("GET api.gumroad.com/v2/sales/s1");
    expect((await w.ledger.store.list("co:c1:")).filter((x) => x.kind === "gumroad")).toHaveLength(1);
    expect(w.c.products[0]!.gumroad?.sales).toBe(1);
    // a ping without the company's signature is refused before anything is read
    const before = w.fake.s.calls.length;
    expect(await w.k.gumroadPing("c1", "forged-signature-forged-signatur", new URLSearchParams({ sale_id: "s9" }), () => w.c)).toBe(false);
    expect(w.fake.s.calls.length).toBe(before);
    // a refund reverses it, once
    w.fake.s.gumroad.sales[0]!.refunded = true;
    await w.tick(11 * MIN);
    await w.tick(11 * MIN);
    expect(await w.ledger.balance("co:c1:gumroad", "USD")).toBe(0n);
    expect(w.c.products[0]!.gumroad).toMatchObject({ sales: 0, revenueCents: 0 });
  });

  it("disconnects: the token leaves the vault and the webhooks are removed", async () => {
    const w = await withGumroad();
    await w.k.gumroadDisconnect(w.c);
    expect(w.calls()).toEqual(["DELETE api.gumroad.com/v2/resource_subscriptions/sub-sale", "DELETE api.gumroad.com/v2/resource_subscriptions/sub-refund"]);
    expect(w.vault.getSecret("gumroad:c1")).toBeNull();
    expect(w.c.connections!.gumroad).toBeUndefined();
  });
});

/** A post on one channel, approved, sent: the request the platform got. */
async function postOn(w: ReturnType<typeof world>, key = "product:p1") {
  const r = await w.k.queue(w.c, task("t-post"), key);
  expect(r.ok).toBe(true);
  const p = w.c.connections!.posts.at(-1)!;
  if (p.status === "approval") w.k.approvePost(w.c, p.id);
  await w.tick();
  return p;
}

describe("posting on the owner's channels", () => {
  it("Bluesky: an app password only, the account's bot self-label set, posts with the disclosure and clickable links", async () => {
    const w = world();
    await expect(w.k.connectBluesky(w.c, "owner.bsky.social", "my-real-account-password")).rejects.toThrow(/app password/);
    expect(w.fake.s.calls).toHaveLength(0);
    await w.k.connectBluesky(w.c, "@Owner.bsky.social", "abcd-efgh-ijkl-mnop");
    // the profile is kept as it was, with the bot label added
    expect(w.fake.s.bsky.profile!.value).toEqual({ $type: "app.bsky.actor.profile", displayName: "Owner", description: "My shop", labels: { $type: "com.atproto.label.defs#selfLabels", values: [{ val: "bot" }] } });
    expect(JSON.parse(w.fake.s.calls.find((x) => x.url.endsWith("putRecord"))!.body)).toMatchObject({ repo: "did:plc:owner123", collection: "app.bsky.actor.profile", rkey: "self", swapRecord: "bafyprofile" });
    expect(w.c.connections!.channels.bluesky).toMatchObject({ label: "@owner.bsky.social", url: "https://bsky.app/profile/owner.bsky.social", ref: "did:plc:owner123", botFlag: true, trusted: false });
    const p = await postOn(w);
    const sent = w.fake.s.bsky.posts[0] as { repo: string; collection: string; record: { $type: string; text: string; langs: string[]; facets: { index: { byteStart: number; byteEnd: number }; features: { uri: string }[] }[] } };
    expect([sent.repo, sent.collection, sent.record.$type, sent.record.langs]).toEqual(["did:plc:owner123", "app.bsky.feed.post", "app.bsky.feed.post", ["en"]]);
    expect(sent.record.text.endsWith("\n\nPosted by an AI agent for Acme.")).toBe(true);
    expect(sent.record.text.length).toBeLessThanOrEqual(300);
    const link = "https://getnightshift.tech/c/acme?via=bluesky#p1";
    expect(sent.record.facets).toEqual([{ index: { byteStart: Buffer.byteLength(sent.record.text.slice(0, sent.record.text.indexOf(link))), byteEnd: Buffer.byteLength(sent.record.text.slice(0, sent.record.text.indexOf(link))) + link.length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: link }] }]);
    expect([p.status, p.url]).toEqual(["posted", "https://bsky.app/profile/owner.bsky.social/post/3kpost1"]);
    // the session is kept: signed in once, for the connection and the post
    expect(w.fake.s.bsky.logins).toBe(1);
    // an expired session is refreshed, not signed in again
    w.fake.s.bsky.expireNext = true;
    w.now.t += 25 * 3600_000;
    w.c.tasks.push(task("t-done", { kind: "research", status: "done", title: "Find the next thing to sell", updatedAt: w.now.t }));
    await postOn(w, "shift:t-done");
    expect([w.fake.s.bsky.logins, w.fake.s.bsky.refreshes, w.fake.s.bsky.posts.length]).toEqual([1, 1, 2]);
  });

  it("Telegram: the owner's own channel, the bot an admin that may post; posts plain text with the disclosure", async () => {
    const w = world();
    await expect(w.k.connectTelegram(w.c, "@ownernews")).rejects.toThrow(/alerts first/);
    w.c.notify = { telegram: "5551234", at: NOW };
    await expect(w.k.connectTelegram(w.c, "@getnightshift")).rejects.toThrow(/NIGHTSHIFT's own/);
    w.fake.s.tg.botAdmin = false;
    await expect(w.k.connectTelegram(w.c, "@ownernews")).rejects.toThrow(/not an admin of this channel/);
    w.fake.s.tg.botAdmin = true;
    w.fake.s.tg.ownerStatus = "member";
    await expect(w.k.connectTelegram(w.c, "@ownernews")).rejects.toThrow(/Your Telegram account is not an admin/);
    w.fake.s.tg.ownerStatus = "creator";
    await w.k.connectTelegram(w.c, "https://t.me/ownernews");
    const members = w.fake.s.calls.filter((x) => x.url.endsWith("/getChatMember")).slice(-2).map((x) => JSON.parse(x.body));
    expect(members).toEqual([{ chat_id: -1001234567890, user_id: 999 }, { chat_id: -1001234567890, user_id: 5551234 }]);
    expect(w.c.connections!.channels.telegram).toMatchObject({ label: "Owner News (@ownernews)", url: "https://t.me/ownernews", ref: "-1001234567890" });
    const p = await postOn(w);
    expect(w.fake.s.tg.sent).toEqual([{ chat_id: "-1001234567890", text: p.text, link_preview_options: { is_disabled: false } }]);
    expect(p.text.endsWith("Posted by an AI agent for Acme.")).toBe(true);
    expect(p.url).toBe("https://t.me/ownernews/41");
    expect(JSON.stringify(w.c, bigint)).not.toContain("TESTTOKEN");
  });

  it("Mastodon: an app on the owner's own server, OAuth there, the bot flag set; posts public with the disclosure", async () => {
    const w = world();
    const url = new URL(await w.k.mastodonStart(w.c, "0xowner", "@owner@Mastodon.example"));
    const app = JSON.parse(w.fake.s.calls[0]!.body);
    expect([w.fake.s.calls[0]!.url, app]).toEqual(["https://mastodon.example/api/v1/apps", { client_name: "NIGHTSHIFT", redirect_uris: "https://getnightshift.tech/api/connect/mastodon/callback", scopes: "read:accounts write:accounts write:statuses", website: "https://getnightshift.tech" }]);
    expect(`${url.origin}${url.pathname}`).toBe("https://mastodon.example/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "masto-client-id", scope: "read:accounts write:accounts write:statuses", redirect_uri: "https://getnightshift.tech/api/connect/mastodon/callback", response_type: "code" });
    await w.k.mastodonCallback("masto-code", url.searchParams.get("state")!, "0xowner", () => w.c);
    expect(w.fake.s.masto.bot).toBe(true);
    expect(w.c.connections!.channels.mastodon).toMatchObject({ label: "@owner@mastodon.example", url: "https://mastodon.example/@owner", ref: "https://mastodon.example", botFlag: true });
    expect(w.vault.getSecret("mastodon-app:c1")).toBeNull();
    const p = await postOn(w);
    expect(w.fake.s.masto.statuses).toEqual([{ body: { status: p.text, visibility: "public", language: "en" }, key: p.id }]);
    expect(p.text.endsWith("Posted by an AI agent for Acme.")).toBe(true);
    expect(p.url).toBe("https://mastodon.example/@owner/101");
    await w.k.disconnect(w.c, "mastodon");
    expect(w.fake.s.masto.revoked).toBe(true);
    expect(w.vault.getSecret("mastodon:c1")).toBeNull();
  });

  it("Discord: a channel webhook, posting as the company with nobody pinged", async () => {
    const w = world();
    await expect(w.k.connectDiscord(w.c, "https://evil.example/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz")).rejects.toThrow(/webhook URL/);
    await w.k.connectDiscord(w.c, HOOK);
    expect(w.c.connections!.channels.discord).toMatchObject({ label: "news (webhook)", url: null, ref: "111/222" });
    const p = await postOn(w);
    expect(w.fake.s.discord.posts).toEqual([{ content: p.text, username: "Acme · AI agent", allowed_mentions: { parse: [] } }]);
    expect(p.text.endsWith("Posted by an AI agent for Acme.")).toBe(true);
    expect(p.url).toBe("https://discord.com/channels/111/222/m1");
  });

  it("holds the first post for the owner, then posts on its own within one a day; quiet hours wait; 'approve every post' holds each", async () => {
    const w = world();
    await w.k.connectDiscord(w.c, HOOK);
    await w.ledger.post({ id: "sale:1", at: new Date(NOW), kind: "sale", postings: [{ account: "co:c1:usdc", asset: "USDC", amount: 9_000_000n }, { account: "ext:buyers", asset: "USDC", amount: -9_000_000n }] });
    await w.k.queue(w.c, task("t1"), "product:p1");
    const first = w.c.connections!.posts[0]!;
    expect([first.status, first.wait]).toEqual(["approval", "the first post on a channel waits for you"]);
    expect(w.notes).toContainEqual(["note", 'Waiting for your approval: a post about "New product: The Etsy Holiday Playbook" on Discord.']);
    await w.tick();
    expect(w.fake.s.discord.posts).toHaveLength(0);
    w.k.approvePost(w.c, first.id);
    await w.tick();
    expect(w.fake.s.discord.posts).toHaveLength(1);
    // trusted now: the next post is queued without asking, but the day's one post is used
    await w.k.queue(w.c, task("t2"), "sales:1");
    const second = w.c.connections!.posts[1]!;
    expect(second.status).toBe("queued");
    await w.tick();
    expect([w.fake.s.discord.posts.length, second.wait]).toEqual([1, "1 post a day on Discord"]);
    // a day later, but inside the owner's quiet hours
    w.k.setQuiet(w.c, { from: 13, to: 16, tz: "UTC" });
    w.now.t = NOW + 24 * 3600_000 + MIN;
    await w.k.tick(w.c, true);
    expect([w.fake.s.discord.posts.length, second.wait]).toEqual([1, "quiet hours until 16:00 (UTC)"]);
    w.now.t = Date.parse("2026-10-21T16:00:00Z");
    await w.k.tick(w.c, true);
    expect([w.fake.s.discord.posts.length, second.status]).toEqual([2, "posted"]);
    // a paused company posts nothing
    w.k.channelSettings(w.c, "discord", { approveEach: true });
    w.c.tasks.push(task("t-site", { kind: "research", status: "done", title: "Research the holidays", updatedAt: w.now.t }));
    await w.k.queue(w.c, task("t3"), "shift:t-site");
    expect(w.c.connections!.posts[2]).toMatchObject({ status: "approval", wait: "you approve every post on this channel" });
    expect(() => w.k.channelSettings(w.c, "discord", { dailyMax: 2 })).toThrow(/from 1 to 1 post a day/);
  });

  it("pauses a channel that pushes back (a rate limit), until the owner resumes it", async () => {
    const w = world();
    await w.k.connectBluesky(w.c, "owner.bsky.social", "abcd-efgh-ijkl-mnop");
    w.fake.s.bsky.rateLimit = true;
    const p = await postOn(w);
    expect(w.c.connections!.channels.bluesky!.paused?.why).toBe("Bluesky: Rate Limit Exceeded");
    expect([p.status, w.fake.s.bsky.posts.length]).toEqual(["queued", 0]);
    expect(w.notes.at(-1)?.[0]).toBe("warning");
    w.fake.s.bsky.rateLimit = false;
    await w.tick();
    expect(w.fake.s.bsky.posts).toHaveLength(0);
    w.k.channelSettings(w.c, "bluesky", { resume: true });
    await w.tick();
    expect([p.status, w.fake.s.bsky.posts.length]).toEqual(["posted", 1]);
  });

  it("posts only what the books say: a milestone counted from the ledger, the CEO's invented number left out", async () => {
    const w = world();
    await w.k.connectDiscord(w.c, HOOK);
    for (let i = 0; i < 10; i++) await w.ledger.post({ id: `sale:${i}`, at: new Date(NOW), kind: "sale", postings: [{ account: "co:c1:usdc", asset: "USDC", amount: 9_000_000n }, { account: "ext:buyers", asset: "USDC", amount: -9_000_000n }] });
    // sales to other companies are not sales to people: never in a milestone
    for (let i = 0; i < 20; i++) await w.ledger.post({ id: `b2b:${i}`, at: new Date(NOW), kind: "b2b", postings: [{ account: "co:c1:usdc", asset: "USDC", amount: 1_000_000n }, { account: "co:other:usdc", asset: "USDC", amount: -1_000_000n }] });
    expect((await w.k.facts(w.c)).find((f) => f.kind === "sales_milestone")?.key).toBe("sales:10");
    const r = await w.k.queue(w.c, task("t1"), "sales:10", "Over 900 happy buyers already!");
    expect(r.note).toContain("The CEO's own words were left out: it said 900, a number that is not in the company's books.");
    w.k.approvePost(w.c, w.c.connections!.posts[0]!.id);
    await w.tick();
    const sent = String(w.fake.s.discord.posts[0]!.content);
    expect(sent).toContain("Acme has passed 10 sales.");
    expect(sent).not.toContain("900");
    expect(await w.k.queue(w.c, task("t2"), "sales:5000")).toEqual({ ok: false, note: "That event is not in the company's records, so nothing was posted." });
  });

  it("a test post shows the exact request, with no secret in it, and sends nothing", async () => {
    const w = world();
    await w.k.connectDiscord(w.c, HOOK);
    w.fake.s.calls.length = 0;
    const v = await w.k.preview(w.c, "discord");
    expect(v).toMatchObject({ channel: "discord", about: "New product: The Etsy Holiday Playbook", sample: false, sent: false, limit: 2000, wait: "the first post on a channel waits for you" });
    expect(v.text.endsWith("Posted by an AI agent for Acme.")).toBe(true);
    expect(v.request).toEqual({ method: "POST", url: "https://discord.com/api/webhooks/•••/•••?wait=true", body: { content: v.text, username: "Acme · AI agent", allowed_mentions: { parse: [] } } });
    expect(JSON.stringify(v)).not.toContain("AbCdEfGhIjKl");
    expect(w.fake.s.calls).toHaveLength(0);
    expect(w.c.connections!.posts).toHaveLength(0);
  });

  it("keeps every password, token and webhook in the vault: never on the company, in the state file or the desk", async () => {
    const w = await withGumroad();
    await w.k.connectBluesky(w.c, "owner.bsky.social", "abcd-efgh-ijkl-mnop");
    w.c.notify = { telegram: "5551234", at: NOW };
    await w.k.connectTelegram(w.c, "@ownernews");
    const m = new URL(await w.k.mastodonStart(w.c, "0xowner", "mastodon.example"));
    await w.k.mastodonCallback("masto-code", m.searchParams.get("state")!, "0xowner", () => w.c);
    await w.k.connectDiscord(w.c, HOOK);
    await w.k.queue(w.c, task("t1"), "product:p1");
    for (const p of [...w.c.connections!.posts]) w.k.approvePost(w.c, p.id);
    await w.tick();
    expect(w.fake.s.bsky.posts.length + w.fake.s.tg.sent.length + w.fake.s.masto.statuses.length + w.fake.s.discord.posts.length).toBe(4);
    const secrets = [w.fake.s.gumroad.token, "abcd-efgh-ijkl-mnop", "jwt-a-1", "jwt-r-1", w.fake.s.masto.token, w.fake.s.masto.secret, "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "TESTTOKENtesttoken", "gr-app-secret"];
    const store = new Store(w.dir);
    store.companies.set(w.c.id, w.c);
    await store.save();
    const state = readFileSync(join(w.dir, "state.json"), "utf8");
    const vaultFile = readFileSync(join(w.dir, "vault.json"), "utf8");
    const views = [JSON.stringify(w.c, bigint), state, vaultFile, JSON.stringify(w.k.desk(w.c)), JSON.stringify(w.k.publicChannels(w.c))];
    for (const s of secrets) for (const v of views) expect(v.includes(s), s).toBe(false);
    // and the vault gives them back
    expect(w.vault.getSecret("bsky:c1")).toBe("abcd-efgh-ijkl-mnop");
    expect(w.vault.getSecret("discord:c1")).toBe(HOOK);
    expect(JSON.parse(w.vault.getSecret("mastodon:c1")!).token).toBe(w.fake.s.masto.token);
    for (const k of ["bluesky", "telegram", "mastodon", "discord"] as const) await w.k.disconnect(w.c, k);
    await w.k.gumroadDisconnect(w.c);
    for (const n of ["bsky:c1", "bsky-session:c1", "discord:c1", "mastodon:c1", "gumroad:c1"]) expect(w.vault.getSecret(n), n).toBeNull();
  });

  it("in simulation checks nothing with the platforms and sends nothing", async () => {
    const w = world({ sim: true });
    await w.k.connectBluesky(w.c, "owner.bsky.social", "abcd-efgh-ijkl-mnop");
    await w.k.connectDiscord(w.c, HOOK);
    const back = new URL(w.k.gumroadStart(w.c, null));
    expect(`${back.origin}${back.pathname}`).toBe("https://getnightshift.tech/api/connect/gumroad/callback");
    await w.k.gumroadCallback("sim", back.searchParams.get("state")!, null, () => w.c);
    await w.tick();
    const p = await postOn(w);
    expect([p.status, p.sim]).toEqual(["posted", true]);
    expect(w.c.products[0]!.gumroad).toMatchObject({ state: "draft", sim: true });
    expect(w.fake.s.calls).toHaveLength(0);
    expect(w.vault.getSecret("bsky:c1")).toBeNull();
  });

  it("shows each post and Gumroad action of a shift in the flight recorder with its result; the public sees only what went out", async () => {
    const w = world();
    await w.k.connectDiscord(w.c, HOOK);
    const t = task("t-post", { status: "done", title: "Post: New product", trail: [{ at: NOW, status: "planned", activity: null, step: 0 }, { at: NOW, status: "done", activity: null, step: 0 }] });
    w.c.tasks.push(t);
    await w.k.queue(w.c, t, "product:p1");
    w.k.approvePost(w.c, w.c.connections!.posts[0]!.id);
    await w.tick();
    const input = (owner: boolean) => ({ imdUsd: 6, owner, live: true, ledger: [], sales: [], visits: [] });
    const own = F.flight(w.c, t, input(true));
    expect(own.connections.map((e) => [e.what, e.result])).toEqual([
      ["Wrote a post for Discord: New product: The Etsy Holiday Playbook", "waiting"],
      ["You approved the post for Discord: New product: The Etsy Holiday Playbook", "ok"],
      ["Posted on Discord: New product: The Etsy Holiday Playbook", "ok"],
    ]);
    expect(own.connections[2]!.url).toBe("https://discord.com/channels/111/222/m1");
    expect(own.trace[0]!.children.map((s) => s.name)).toContain("Posted on Discord: New product: The Etsy Holiday Playbook");
    const pub = F.flight(w.c, t, input(false));
    expect(pub.connections).toEqual([{ at: w.now.t, channel: "discord", what: "Posted on Discord: New product: The Etsy Holiday Playbook", result: "ok", url: "https://discord.com/channels/111/222/m1" }]);
    // the shift that built the product carries its Gumroad actions
    const g = await withGumroad();
    await g.tick();
    expect(F.flight(g.c, g.c.tasks[0]!, input(true)).connections.map((e) => e.what)).toEqual([
      'Made "The Etsy Holiday Playbook" on Gumroad as a draft', 'Uploaded the file of "The Etsy Holiday Playbook" to Gumroad', 'Added the cover of "The Etsy Holiday Playbook" on Gumroad',
    ]);
    expect(F.flight(g.c, g.c.tasks[0]!, input(false)).connections).toEqual([]);
  });

  it("turns a Bluesky account from before Connections into a channel, its first post waiting for the owner", () => {
    const w = world();
    w.c.social = { bluesky: { handle: "old.bsky.social", auto: true } };
    w.k.migrate(w.c);
    expect(w.c.social).toBeUndefined();
    expect(w.c.connections!.channels.bluesky).toMatchObject({ label: "@old.bsky.social", approveEach: false, trusted: false, botFlag: false });
  });
});
