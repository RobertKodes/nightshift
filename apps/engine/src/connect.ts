import { randomBytes, randomUUID } from "node:crypto";
import {
  CHANNELS, CHANNEL_CAPS, CHANNEL_NAME, type Channel, type ChannelKind, type Company, type CompanyStats, type ConnEntry, type Connections, DEFAULT_DAILY, DEFAULT_QUIET,
  POST_LIMIT, type Post, type PostFact, type Product, type Sells, type Task, approvalNeeded, checkAngle, composePost, fromUsdc, onlyFacts, planPosts, postFacts, sellsFrom, sendGate,
  unposted, validQuiet,
} from "@nightshift/core";
import type { Ledger } from "@nightshift/ledger";
import {
  APP_PASSWORD, ApiError, BSKY, type BskySession, DISCORD_HOOK, type Http, bskyBotLabel, bskyLogin, bskyPost, bskyRecord, bskyRefresh, clean, discordBody, discordHook, discordPost,
  mastoApp, mastoAuthorizeUrl, mastoBody, mastoBot, mastoInstance, mastoMe, mastoPost, mastoRevoke, mastoToken, pushedBack, tgBody, tgChannel, tgChatId, tgPost,
} from "./channels.js";
import { GUMROAD_SCOPES, GumroadApi, type GumroadSale, type GumroadToken, bookGumroadSale, draftFields, gumroadAuthorizeUrl, gumroadCents, gumroadDescription, gumroadExchange, pingOk, pingSig, prohibited, syncKey, uploadFile } from "./gumroad.js";

/**
 * Connections: accounts a company's owner made and connected (Gumroad to sell, Bluesky, a Telegram
 * channel, Mastodon and a Discord webhook to post), and what the CEO may do with them. It never
 * creates an account, follows, likes, sends a direct message, replies to anyone or reads anyone
 * else's posts. Posts are about real events from the company's records, end with the AI disclosure,
 * respect each channel's daily cap and the owner's quiet hours, and the first post on a channel (or
 * every post, if the owner asks) waits for the owner. A Gumroad product is made as a draft, and
 * publishing it waits for the owner the first time. Every password, token and webhook is in the
 * vault; the company keeps only what the owner and the public may see.
 */

const DAY = 86_400_000;

/** The vault's names for a company's connection secrets. */
export const SECRET = {
  gumroad: (id: string) => `gumroad:${id}`,
  bluesky: (id: string) => `bsky:${id}`,
  blueskySession: (id: string) => `bsky-session:${id}`,
  mastodon: (id: string) => `mastodon:${id}`,
  mastodonApp: (id: string) => `mastodon-app:${id}`,
  discord: (id: string) => `discord:${id}`,
};

const REVOKE: Record<ChannelKind, string> = {
  bluesky: "Delete its app password in Bluesky → Settings → Privacy and security → App passwords.",
  telegram: "Remove the bot from the channel's admins too, if you like.",
  mastodon: "NIGHTSHIFT's access was revoked on your server.",
  discord: "Delete the webhook in Server Settings → Integrations, if you like.",
};

export interface ConnectDeps {
  vault: { putSecret(name: string, value: string | null): void; getSecret(name: string): string | null; material: string };
  ledger: Ledger;
  /** Calls to the platforms' own hosts (Gumroad, Bluesky, Telegram, Discord). */
  http: Http;
  /** Calls to hosts the owner or an API named (a Mastodon server, upload URLs): public addresses only. */
  open: Http;
  /** Simulation: nothing is checked with a platform and nothing is sent or listed. */
  sim: () => boolean;
  publicUrl: () => string;
  /** NIGHTSHIFT's Gumroad OAuth app, set on /setup. */
  gumroadApp: () => { id: string; secret: string } | null;
  /** The NIGHTSHIFT bot, which posts in owners' Telegram channels. */
  telegram: () => { token: string; bot: string } | null;
  /** The platform's own Telegram chats: never a company's channel. */
  platformChats: () => string[];
  files: { has(c: Company, p: Product): boolean; read(c: Company, p: Product): string | null };
  metrics: (c: Company) => { sales: { at: number; productId: string; usdc: string }[]; visits: number[]; via?: { at: number; ch: string }[] };
  /** Every product on sale on the NIGHTSHIFT market. */
  market: () => { company: string; slug: string; name: string; kind: string; priceUsd: number; sales: number }[];
  /** The company's journal: the owner's alerts read it. */
  note: (c: Company, kind: "note" | "result" | "warning" | "sale", text: string) => void;
  changed: (c: Company) => void;
  now?: () => number;
}

type State = { kind: "gumroad" | "mastodon"; companyId: string; owner: string | null; until: number; instance?: string };
type Fail = Error & { companyId?: string };

const names = (posts: { channel: ChannelKind }[]) => {
  const l = [...new Set(posts.map((p) => CHANNEL_NAME[p.channel]))];
  return l.length < 2 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`;
};
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export class Connect {
  readonly #states = new Map<string, State>();
  readonly #busy = new Set<string>();
  readonly #gumroadNext = new Map<string, number>();
  readonly #retry = new Map<string, number>();
  readonly #coverTried = new Set<string>();

  constructor(private readonly d: ConnectDeps) {}

  #now(): number { return (this.d.now ?? Date.now)(); }

  /** The company's connections, made on first use. */
  of(c: Company): Connections {
    return (c.connections ??= { channels: {}, quiet: { ...DEFAULT_QUIET }, posts: [], log: [] });
  }

  #log(c: Company, e: Omit<ConnEntry, "at">): ConnEntry {
    const x: ConnEntry = { at: this.#now(), ...e };
    const l = this.of(c).log;
    l.push(x);
    if (l.length > 300) l.splice(0, l.length - 300);
    return x;
  }

  #cb(kind: "gumroad" | "mastodon"): string { return `${this.d.publicUrl()}/api/connect/${kind}/callback`; }

  /** A one-time OAuth state, ten minutes long, tied to the company and the owner who asked. */
  #state(kind: State["kind"], c: Company, owner: string | null, extra: Partial<State> = {}): string {
    for (const [k, v] of this.#states) if (v.until < this.#now()) this.#states.delete(k);
    const s = randomBytes(18).toString("base64url");
    this.#states.set(s, { kind, companyId: c.id, owner, until: this.#now() + 10 * 60_000, ...extra });
    return s;
  }
  #take(state: string, kind: State["kind"]): State | null {
    const s = this.#states.get(state);
    this.#states.delete(state);
    return s && s.kind === kind && s.until >= this.#now() ? s : null;
  }
  /** The callback's company, checked: the state is ours, unused, fresh, and the browser is the owner who started it. */
  #callback(state: string, kind: State["kind"], caller: string | null, find: (id: string) => Company | undefined): { s: State; c: Company; fail: (m: string) => Fail } {
    const s = this.#take(state, kind);
    if (!s) throw new Error("This link has expired. Connect again from the owner desk.");
    const fail = (m: string): Fail => Object.assign(new Error(m), { companyId: s.companyId });
    const c = find(s.companyId);
    if (!c) throw fail("That company is gone.");
    if (s.owner !== caller) throw fail("Sign in as the company's owner, then connect again.");
    return { s, c, fail };
  }
  #secretJson<T>(name: string): T | null {
    const raw = this.d.vault.getSecret(name);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  // ---------------------------------------------------------------- Gumroad

  /** Where the owner goes to let the company use their Gumroad account. In simulation: straight back, connected to nothing real. */
  gumroadStart(c: Company, owner: string | null): string {
    if (this.d.sim()) return `${this.#cb("gumroad")}?${new URLSearchParams({ code: "sim", state: this.#state("gumroad", c, owner) })}`;
    const app = this.d.gumroadApp();
    if (!app) throw new Error("Gumroad is not set up on this engine yet: its operator registers NIGHTSHIFT's Gumroad app on /setup.");
    if (c.sim) throw new Error("A simulated company cannot sell on Gumroad.");
    return gumroadAuthorizeUrl(app.id, this.#cb("gumroad"), this.#state("gumroad", c, owner));
  }

  /** Back from Gumroad with a code: exchanged for a token (into the vault), the account read, its sale webhooks set. */
  async gumroadCallback(code: string, state: string, caller: string | null, find: (id: string) => Company | undefined): Promise<Company> {
    const { c, fail } = this.#callback(state, "gumroad", caller, find);
    const x = this.of(c);
    const now = this.#now();
    if (this.d.sim()) {
      x.gumroad = { user: "sim", name: "Simulated Gumroad account", url: null, connectedAt: now, scopes: GUMROAD_SCOPES, hooks: [], sim: true };
      this.#log(c, { channel: "gumroad", what: "Connected a simulated Gumroad account", result: "sim", detail: "Simulation: nothing is made on Gumroad and nothing sells there." });
      this.d.changed(c);
      return c;
    }
    const app = this.d.gumroadApp();
    if (!app) throw fail("Gumroad is not set up on this engine.");
    let tok: GumroadToken, user: { user_id: string; name?: string; url?: string };
    try {
      tok = await gumroadExchange(this.d.http, app, code, this.#cb("gumroad"));
      user = await new GumroadApi(this.d.http, tok.access_token).user();
    } catch (e) { throw fail(clean((e as Error).message)); }
    this.d.vault.putSecret(SECRET.gumroad(c.id), JSON.stringify(tok));
    // listings made on another Gumroad account are that account's, not this one's
    for (const p of c.products) if (p.gumroad && p.gumroad.user !== String(user.user_id)) delete p.gumroad;
    x.gumroad = { user: String(user.user_id), name: (user.name || "Gumroad account").slice(0, 60), url: user.url ?? null, connectedAt: now, scopes: tok.scope ?? GUMROAD_SCOPES, hooks: [] };
    await this.#hooks(c, new GumroadApi(this.d.http, tok.access_token));
    this.#log(c, { channel: "gumroad", what: `Connected Gumroad: ${x.gumroad.name}`, result: "ok", detail: `Scopes: ${x.gumroad.scopes}. ${x.gumroad.hooks.length ? "Sales arrive by Gumroad's webhook and are checked every 10 minutes." : "Sales are checked every 10 minutes."}` });
    this.d.note(c, "note", `Connected Gumroad (${x.gumroad.name}). New products are made there as drafts; publishing each one waits for you.`);
    this.d.changed(c);
    return c;
  }

  /** Gumroad's sale and refund webhooks, when the engine has a public https address (the poll covers it either way). */
  async #hooks(c: Company, api: GumroadApi): Promise<void> {
    const g = this.of(c).gumroad!;
    const base = this.d.publicUrl();
    if (!base.startsWith("https://")) return;
    const url = `${base}/api/connect/gumroad/ping/${c.id}/${pingSig(this.d.vault.material, c.id)}`;
    for (const r of ["sale", "refund"]) {
      try { g.hooks.push(await api.subscribe(r, url)); } catch (e) { this.#log(c, { channel: "gumroad", what: `Gumroad's ${r} webhook`, result: "failed", detail: clean((e as Error).message) }); }
    }
  }

  #gumroadApi(c: Company): GumroadApi | null {
    const t = this.#secretJson<GumroadToken>(SECRET.gumroad(c.id));
    return t?.access_token ? new GumroadApi(this.d.http, t.access_token) : null;
  }

  async gumroadDisconnect(c: Company): Promise<void> {
    const x = this.of(c);
    const g = x.gumroad;
    if (!g) return;
    const api = this.#gumroadApi(c);
    if (api) for (const h of g.hooks) await api.unsubscribe(h).catch(() => {});
    this.d.vault.putSecret(SECRET.gumroad(c.id), null);
    delete x.gumroad;
    const how = "Revoke NIGHTSHIFT under Gumroad → Settings → Advanced → Applications too. The products made there stay on your account.";
    this.#log(c, { channel: "gumroad", what: `Disconnected Gumroad: ${g.name}`, result: "ok", detail: how });
    this.d.note(c, "note", `Disconnected Gumroad. ${how}`);
    this.d.changed(c);
  }

  /** The owner's yes: the draft may be published, now and again after it is taken down. */
  gumroadApprove(c: Company, productId: string): void {
    const p = c.products.find((x) => x.id === productId);
    const l = p?.gumroad;
    if (!p || !l) throw new Error("That product is not on Gumroad.");
    if (p.gumroadBlocked) throw new Error(`It cannot be published on Gumroad. ${p.gumroadBlocked}`);
    if (p.status !== "live") throw new Error("Put it back on sale first.");
    l.approved = true;
    delete l.declined;
    this.#log(c, { channel: "gumroad", what: `You approved publishing "${p.name}" on Gumroad`, result: "ok", taskId: p.taskId });
    this.d.note(c, "note", `You approved publishing "${p.name}" on Gumroad.`);
    this.#gumroadNext.delete(c.id);
    this.#retry.delete(p.id);
    this.d.changed(c);
  }

  gumroadDecline(c: Company, productId: string): void {
    const p = c.products.find((x) => x.id === productId);
    const l = p?.gumroad;
    if (!p || !l) throw new Error("That product is not on Gumroad.");
    l.declined = true;
    this.#log(c, { channel: "gumroad", what: `You said no to publishing "${p.name}" on Gumroad`, result: "ok", detail: "It stays a draft on your Gumroad account.", taskId: p.taskId });
    this.d.changed(c);
  }

  /**
   * One pass over the products: a live, packaged product gets a Gumroad draft (one a pass), its file
   * and cover; changes of name, price or text are sent; an approved product is published, one taken
   * off sale is unpublished. A product in a prohibited category is never listed, and taken down.
   */
  async #gumroadPass(c: Company): Promise<void> {
    const g = this.of(c).gumroad;
    if (!g) return;
    const api = g.sim ? null : this.#gumroadApi(c);
    if (!g.sim && !api) return;
    const now = this.#now();
    for (const p of c.products) {
      const l = p.gumroad;
      if (l && l.user !== g.user) continue;
      const bad = prohibited(p, this.d.files.read(c, p));
      if (bad) {
        const why = `${bad.label}: ${bad.why} (it says "${bad.matched}").`;
        if (p.gumroadBlocked !== why) {
          p.gumroadBlocked = why;
          this.#log(c, { channel: "gumroad", what: `Kept "${p.name}" off Gumroad`, result: "blocked", detail: why, taskId: p.taskId });
          if (l?.state === "published") await this.#unpublish(c, p, api, "it falls in a category Gumroad prohibits").catch(() => {});
          this.d.changed(c);
        }
        continue;
      }
      if (p.gumroadBlocked) delete p.gumroadBlocked;
      if ((this.#retry.get(p.id) ?? 0) > now) continue;
      try {
        if (!l) {
          if (p.status !== "live" || !this.d.files.has(c, p)) continue;
          await this.#draft(c, p, api);
          return; // one new product a pass: Gumroad allows few creates a minute
        }
        if (!l.file && p.status === "live") await this.#file(c, p, api);
        if (!l.cover && !this.#coverTried.has(p.id)) await this.#cover(c, p, api);
        const want = syncKey(c, p);
        if (l.synced !== want) {
          if (api) await api.update(l.id, { name: p.name, price: gumroadCents(p), description: gumroadDescription(c, p) });
          l.synced = want;
          this.#log(c, { channel: "gumroad", what: `Updated "${p.name}" on Gumroad`, result: api ? "ok" : "sim", detail: `${usd(gumroadCents(p))}; name and description in step with NIGHTSHIFT.`, taskId: p.taskId });
          this.d.changed(c);
        }
        if (p.status === "live" && l.approved && l.file && l.state !== "published") await this.#publish(c, p, api);
        else if (p.status !== "live" && l.state === "published") await this.#unpublish(c, p, api, "it was taken off sale on NIGHTSHIFT");
        delete l.error;
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) { this.#gumroadNext.set(c.id, now + (e.retryAfter ?? 60) * 1000); return; }
        const msg = clean((e as Error).message);
        if (p.gumroad) p.gumroad.error = msg;
        this.#retry.set(p.id, now + 3600_000);
        this.#log(c, { channel: "gumroad", what: `Gumroad, "${p.name}"`, result: "failed", detail: `${msg} Trying again in an hour.`, taskId: p.taskId });
        this.d.changed(c);
      }
    }
  }

  /** The product on Gumroad as a draft, from the NIGHTSHIFT product, then its file and cover. Publishing waits for the owner. */
  async #draft(c: Company, p: Product, api: GumroadApi | null): Promise<void> {
    const g = this.of(c).gumroad!;
    const r = api ? await api.create(draftFields(c, p)) : { product: { id: `sim-${randomUUID()}`, short_url: undefined, published: false }, warning: undefined };
    p.gumroad = { id: String(r.product.id), user: g.user, url: r.product.short_url ?? null, state: "draft", approved: false, file: false, cover: false, synced: syncKey(c, p), createdAt: this.#now(), sales: 0, revenueCents: 0, ...(api ? {} : { sim: true }) };
    // asked for a draft: should Gumroad have published it anyway, it is taken down at once
    if (api && r.product.published) await api.disable(p.gumroad.id).catch(() => {});
    this.#log(c, { channel: "gumroad", what: `Made "${p.name}" on Gumroad as a draft`, result: api ? "ok" : "sim", detail: `${usd(gumroadCents(p))}, not published.${r.warning ? ` Gumroad: ${clean(r.warning)}` : ""}${api ? "" : " Simulation: nothing was made on Gumroad."}`, ...(p.gumroad.url ? { url: p.gumroad.url } : {}), taskId: p.taskId });
    this.d.changed(c);
    await this.#file(c, p, api);
    await this.#cover(c, p, api);
    this.d.note(c, "note", `Waiting for your approval: publish "${p.name}" on Gumroad. It is a draft on your Gumroad account now, made from the NIGHTSHIFT product.`);
  }

  /** The delivered file, uploaded the way Gumroad takes files (presign, PUT the parts, complete) and attached to the product. */
  async #file(c: Company, p: Product, api: GumroadApi | null): Promise<void> {
    const l = p.gumroad!;
    const text = this.d.files.read(c, p);
    if (!text) return;
    const bytes = Buffer.from(text, "utf8");
    if (api) {
      const name = `${c.slug}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "product"}.md`;
      const url = await uploadFile(api, this.d.open, name, bytes, "text/markdown");
      await api.update(l.id, { files: [{ url }] });
    }
    l.file = true;
    this.#log(c, { channel: "gumroad", what: `Uploaded the file of "${p.name}" to Gumroad`, result: api ? "ok" : "sim", detail: `${Math.max(1, Math.ceil(bytes.length / 1024))} KB of Markdown.`, taskId: p.taskId });
    this.d.changed(c);
  }

  /** The cover is the product's own card, which Gumroad reads from the engine's public address. */
  async #cover(c: Company, p: Product, api: GumroadApi | null): Promise<void> {
    const l = p.gumroad!;
    this.#coverTried.add(p.id);
    const base = this.d.publicUrl();
    if (api && !base.startsWith("https://")) {
      this.#log(c, { channel: "gumroad", what: `The cover of "${p.name}"`, result: "waiting", detail: "Gumroad reads the cover from the engine's public https address, which this engine does not have. Add it by hand on Gumroad if you like.", taskId: p.taskId });
      return;
    }
    try {
      if (api) await api.cover(l.id, `${base}/api/connect/cover/${c.slug}/${p.id}.png`);
      l.cover = true;
      this.#log(c, { channel: "gumroad", what: `Added the cover of "${p.name}" on Gumroad`, result: api ? "ok" : "sim", detail: "From the product's own card.", taskId: p.taskId });
    } catch (e) {
      this.#log(c, { channel: "gumroad", what: `The cover of "${p.name}"`, result: "failed", detail: clean((e as Error).message), taskId: p.taskId });
    }
  }

  async #publish(c: Company, p: Product, api: GumroadApi | null): Promise<void> {
    const l = p.gumroad!;
    // checked again at the moment it goes public
    if (prohibited(p, this.d.files.read(c, p))) return;
    const r = api ? await api.enable(l.id) : null;
    if (r && r.product?.published === false) {
      this.#retry.set(p.id, this.#now() + 3600_000);
      this.#log(c, { channel: "gumroad", what: `Gumroad kept "${p.name}" unpublished`, result: "waiting", detail: r.warning ? clean(r.warning) : "Gumroad publishes once your email is confirmed and a payout method is set up.", taskId: p.taskId });
      return;
    }
    l.state = "published";
    if (r?.product?.short_url) l.url = r.product.short_url;
    this.#log(c, { channel: "gumroad", what: `Published "${p.name}" on Gumroad`, result: api ? "ok" : "sim", detail: `${usd(gumroadCents(p))}. Its sales are paid to your Gumroad account.`, ...(l.url ? { url: l.url } : {}), taskId: p.taskId, public: true });
    this.d.note(c, "result", `"${p.name}" is on sale on Gumroad${l.url ? `: ${l.url}` : ""}${api ? "" : " (simulated)"}.`);
    this.d.changed(c);
  }

  async #unpublish(c: Company, p: Product, api: GumroadApi | null, why: string): Promise<void> {
    const l = p.gumroad!;
    if (api) await api.disable(l.id);
    l.state = "unpublished";
    this.#log(c, { channel: "gumroad", what: `Took "${p.name}" off Gumroad`, result: api ? "ok" : "sim", detail: `Because ${why}.`, taskId: p.taskId });
    this.d.changed(c);
  }

  /** Every 10 minutes: the account's sales since its first listing, each sale of this company's own products booked once. */
  async #poll(c: Company): Promise<void> {
    const g = this.of(c).gumroad;
    if (!g || g.sim) return;
    const api = this.#gumroadApi(c);
    if (!api) return;
    g.polledAt = this.#now();
    const mine = new Map(c.products.filter((p) => p.gumroad && p.gumroad.user === g.user && !p.gumroad.sim).map((p) => [p.gumroad!.id, p]));
    if (!mine.size) return;
    const after = new Date(Math.min(...[...mine.values()].map((p) => p.gumroad!.createdAt)) - DAY).toISOString().slice(0, 10);
    let key: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await api.sales(after, key);
      // the owner's other Gumroad products are not this company's revenue
      for (const s of r.sales ?? []) { const p = mine.get(String(s.product_id)); if (p) await this.#book(c, p, s); }
      key = r.next_page_key;
      if (!key) break;
    }
  }

  async #book(c: Company, p: Product, s: GumroadSale): Promise<void> {
    const r = await bookGumroadSale(this.d.ledger, c, p, s);
    const l = p.gumroad!;
    if (r.sale) {
      l.sales += 1;
      l.revenueCents += r.cents;
      this.#log(c, { channel: "gumroad", what: `Sold "${p.name}" on Gumroad`, result: "ok", detail: `${usd(r.cents)}, paid to your Gumroad account; booked apart from USDC.`, taskId: p.taskId });
      this.d.note(c, "sale", `Sold ${p.name} on Gumroad for ${usd(r.cents)}. Gumroad pays it to your Gumroad account; it is booked apart from USDC.`);
    }
    if (r.refund) {
      l.sales = Math.max(0, l.sales - 1);
      l.revenueCents -= r.cents;
      this.#log(c, { channel: "gumroad", what: `Refunded "${p.name}" on Gumroad`, result: "ok", detail: `${usd(r.cents)} back to the buyer.`, taskId: p.taskId });
      this.d.note(c, "note", `A Gumroad sale of ${p.name} was refunded (${usd(r.cents)}).`);
    }
    if (r.sale || r.refund) this.d.changed(c);
  }

  /** A ping from Gumroad: its URL must carry the company's signature, and the sale is read back from Gumroad before anything is booked. */
  async gumroadPing(companyId: string, sig: string, fields: URLSearchParams, find: (id: string) => Company | undefined): Promise<boolean> {
    if (!pingOk(this.d.vault.material, companyId, sig)) return false;
    const c = find(companyId);
    const g = c?.connections?.gumroad;
    if (!c || !g || g.sim) return true;
    const saleId = fields.get("sale_id") ?? "";
    if (!/^[\w=-]{1,80}$/.test(saleId)) return true;
    const api = this.#gumroadApi(c);
    if (!api) return true;
    const s = await api.sale(saleId);
    const p = c.products.find((x) => x.gumroad?.id === String(s.product_id) && x.gumroad.user === g.user);
    if (p) await this.#book(c, p, s);
    return true;
  }

  /** The company was deleted: what it published on Gumroad comes down too (the drafts and the account stay the owner's). */
  async closeDown(c: Company): Promise<void> {
    const g = c.connections?.gumroad;
    if (!g) return;
    const api = g.sim ? null : this.#gumroadApi(c);
    for (const p of c.products) if (p.gumroad?.state === "published" && p.gumroad.user === g.user) await this.#unpublish(c, p, api, "the company was deleted").catch(() => {});
  }

  // ---------------------------------------------------------------- channels

  #channel(c: Company, kind: ChannelKind, v: Pick<Channel, "label" | "url"> & Partial<Channel>): Channel {
    const x = this.of(c);
    const before = x.channels[kind];
    // a channel connected again is a new account: its first post waits for the owner again
    const ch: Channel = { approveEach: before?.approveEach ?? false, dailyMax: before?.dailyMax ?? DEFAULT_DAILY, listed: before?.listed ?? true, ...v, kind, label: v.label.slice(0, 80), connectedAt: this.#now(), trusted: false };
    this.#drop(c, kind, "the channel was connected again");
    x.channels[kind] = ch;
    return ch;
  }

  #connected(c: Company, ch: Channel, detail: string): Channel {
    this.#log(c, { channel: ch.kind, what: `Connected ${CHANNEL_NAME[ch.kind]}: ${ch.label}`, result: ch.sim ? "sim" : "ok", detail });
    this.d.note(c, "note", `Connected ${CHANNEL_NAME[ch.kind]} ${ch.label}${ch.sim ? " (simulated)" : ""}. ${ch.approveEach ? "Every post waits for you." : "The first post waits for you; after that, posts go out on their own within the caps."}`);
    this.d.changed(c);
    return ch;
  }

  /** Posts waiting on a channel that changed hands or went away never go out. */
  #drop(c: Company, kind: ChannelKind, why: string): void {
    for (const p of this.of(c).posts) if (p.channel === kind && (p.status === "approval" || p.status === "queued")) { p.status = "dropped"; p.wait = why; }
  }

  /** Bluesky: the handle and an app password (checked with Bluesky, kept in the vault), and the account's `bot` self-label set. */
  async connectBluesky(c: Company, handle: string, appPassword: string): Promise<Channel> {
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{1,252}$/.test(h) || !h.includes(".")) throw new Error("Give your Bluesky handle, e.g. you.bsky.social.");
    const pw = appPassword.trim();
    if (!APP_PASSWORD.test(pw)) throw new Error("Use an app password (xxxx-xxxx-xxxx-xxxx) from Bluesky → Settings → Privacy and security → App passwords. Never your account password.");
    if (this.d.sim()) return this.#connected(c, this.#channel(c, "bluesky", { label: `@${h}`, url: `https://bsky.app/profile/${h}`, botFlag: true, sim: true }), "Simulation: not checked with Bluesky, and nothing is posted.");
    const s = await bskyLogin(this.d.http, h, pw);
    await bskyBotLabel(this.d.http, s);
    this.d.vault.putSecret(SECRET.bluesky(c.id), pw);
    this.d.vault.putSecret(SECRET.blueskySession(c.id), JSON.stringify(s));
    delete c.social;
    return this.#connected(c, this.#channel(c, "bluesky", { label: `@${s.handle}`, url: `https://bsky.app/profile/${s.handle}`, ref: s.did, botFlag: true }), "The account carries Bluesky's bot label now.");
  }

  /**
   * A Telegram channel the owner made, with the NIGHTSHIFT bot as an admin that may post. The owner's
   * Telegram account (known from their alerts link) must be an admin of it too, so nobody connects
   * someone else's channel.
   */
  async connectTelegram(c: Company, chat: string): Promise<Channel> {
    const t = this.d.telegram();
    if (!t && !this.d.sim()) throw new Error("Telegram channels need the NIGHTSHIFT bot, which is not set up on this engine.");
    const id = tgChatId(chat);
    const platform = this.d.platformChats().map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (platform.includes(id.toLowerCase())) throw new Error("That is one of NIGHTSHIFT's own chats.");
    if (this.d.sim()) return this.#connected(c, this.#channel(c, "telegram", { label: id, url: id.startsWith("@") ? `https://t.me/${id.slice(1)}` : null, sim: true }), "Simulation: not checked with Telegram, and nothing is posted.");
    const owner = c.notify?.telegram;
    if (!owner || !/^\d+$/.test(owner)) throw new Error("Turn on Telegram alerts first (the Alerts tab), in a private chat with the bot: that is how NIGHTSHIFT checks the channel is yours.");
    const ch = await tgChannel(this.d.http, t!.token, id, owner);
    if (platform.includes(ch.id) || (ch.username && platform.includes(`@${ch.username.toLowerCase()}`))) throw new Error("That is one of NIGHTSHIFT's own chats.");
    return this.#connected(c, this.#channel(c, "telegram", { label: ch.username ? `${ch.title} (@${ch.username})` : ch.title, url: ch.username ? `https://t.me/${ch.username}` : null, ref: ch.id }), `@${t!.bot} is an admin there that may post, and so are you.`);
  }

  /** Mastodon: NIGHTSHIFT registers an app on the owner's own server, then the owner says yes there (OAuth). */
  async mastodonStart(c: Company, owner: string | null, instance: string): Promise<string> {
    const inst = mastoInstance(instance);
    if (this.d.sim()) return `${this.#cb("mastodon")}?${new URLSearchParams({ code: "sim", state: this.#state("mastodon", c, owner, { instance: inst }) })}`;
    const app = await mastoApp(this.d.open, inst, this.#cb("mastodon"), this.d.publicUrl());
    this.d.vault.putSecret(SECRET.mastodonApp(c.id), JSON.stringify({ inst, ...app }));
    return mastoAuthorizeUrl(inst, app.client_id, this.#cb("mastodon"), this.#state("mastodon", c, owner, { instance: inst }));
  }

  async mastodonCallback(code: string, state: string, caller: string | null, find: (id: string) => Company | undefined): Promise<Company> {
    const { s, c, fail } = this.#callback(state, "mastodon", caller, find);
    const inst = s.instance!;
    const host = new URL(inst).host;
    if (this.d.sim()) {
      this.#connected(c, this.#channel(c, "mastodon", { label: `@${c.slug}@${host}`, url: inst, ref: inst, botFlag: true, sim: true }), "Simulation: not checked with Mastodon, and nothing is posted.");
      return c;
    }
    const app = this.#secretJson<{ inst: string; client_id: string; client_secret: string }>(SECRET.mastodonApp(c.id));
    if (!app || app.inst !== inst) throw fail("Start again from the owner desk.");
    let token: string, me: { acct: string; url: string };
    try {
      token = await mastoToken(this.d.open, inst, app, code, this.#cb("mastodon"));
      me = await mastoMe(this.d.open, inst, token);
      await mastoBot(this.d.open, inst, token);
    } catch (e) { throw fail(clean((e as Error).message)); }
    this.d.vault.putSecret(SECRET.mastodon(c.id), JSON.stringify({ inst, token, client_id: app.client_id, client_secret: app.client_secret }));
    this.d.vault.putSecret(SECRET.mastodonApp(c.id), null);
    this.#connected(c, this.#channel(c, "mastodon", { label: `@${me.acct.includes("@") ? me.acct : `${me.acct}@${host}`}`, url: me.url, ref: inst, botFlag: true }), "The account is marked as automated (a bot) now.");
    return c;
  }

  /** A Discord channel's webhook URL (checked with Discord, kept in the vault: the URL is the secret). */
  async connectDiscord(c: Company, url: string): Promise<Channel> {
    const u = url.trim();
    if (!DISCORD_HOOK.test(u)) throw new Error("Paste a channel webhook URL: Server Settings → Integrations → Webhooks → Copy Webhook URL.");
    if (this.d.sim()) return this.#connected(c, this.#channel(c, "discord", { label: "Discord webhook", url: null, sim: true }), "Simulation: not checked with Discord, and nothing is posted.");
    const h = await discordHook(this.d.http, u);
    this.d.vault.putSecret(SECRET.discord(c.id), u);
    return this.#connected(c, this.#channel(c, "discord", { label: h.name ? `${h.name} (webhook)` : "Discord webhook", url: null, ref: h.guildId ? `${h.guildId}/${h.channelId}` : h.channelId }), "It posts as the company and never pings anyone.");
  }

  async disconnect(c: Company, kind: ChannelKind): Promise<void> {
    const x = this.of(c);
    const ch = x.channels[kind];
    if (!ch) return;
    if (kind === "mastodon") {
      const m = this.#secretJson<{ inst: string; token: string; client_id: string; client_secret: string }>(SECRET.mastodon(c.id));
      if (m) await mastoRevoke(this.d.open, m.inst, m, m.token).catch(() => {});
    }
    const keys = kind === "bluesky" ? [SECRET.bluesky(c.id), SECRET.blueskySession(c.id)] : kind === "mastodon" ? [SECRET.mastodon(c.id), SECRET.mastodonApp(c.id)] : kind === "discord" ? [SECRET.discord(c.id)] : [];
    for (const k of keys) if (this.d.vault.getSecret(k) !== null) this.d.vault.putSecret(k, null);
    delete x.channels[kind];
    this.#drop(c, kind, "the channel was disconnected");
    this.#log(c, { channel: kind, what: `Disconnected ${CHANNEL_NAME[kind]}: ${ch.label}`, result: "ok", detail: REVOKE[kind] });
    this.d.note(c, "note", `Disconnected ${CHANNEL_NAME[kind]}. ${REVOKE[kind]}`);
    this.d.changed(c);
  }

  /** The owner's rules for one channel: approve every post, posts a day (up to the platform's safe maximum), on the public page, resume. */
  channelSettings(c: Company, kind: ChannelKind, p: Record<string, unknown>): Channel {
    const ch = this.of(c).channels[kind];
    if (!ch) throw new Error(`Connect ${CHANNEL_NAME[kind]} first.`);
    if (p.approveEach !== undefined) ch.approveEach = p.approveEach === true;
    if (p.dailyMax !== undefined) {
      const n = Number(p.dailyMax), max = CHANNEL_CAPS[kind].max;
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${CHANNEL_NAME[kind]}: from 1 to ${max} post${max === 1 ? "" : "s"} a day.`);
      ch.dailyMax = n;
    }
    if (p.listed !== undefined) ch.listed = p.listed === true;
    if (p.resume === true && ch.paused) {
      delete ch.paused;
      this.#log(c, { channel: kind, what: `You resumed posting on ${CHANNEL_NAME[kind]}`, result: "ok" });
    }
    this.d.changed(c);
    return ch;
  }

  setQuiet(c: Company, q: Record<string, unknown>): void {
    this.of(c).quiet = validQuiet(q);
    this.d.changed(c);
  }

  // ---------------------------------------------------------------- posts

  /** The real events the company may post about, counted from its records and its ledger. */
  async facts(c: Company): Promise<PostFact[]> {
    const tx = await this.d.ledger.store.list(`co:${c.id}:`);
    const sales = tx.filter((x) => (x.kind === "sale" || x.kind === "sale_sim") && x.postings.some((p) => p.account === `co:${c.id}:usdc` && p.amount > 0n)).length;
    const gumroad = tx.filter((x) => x.kind === "gumroad").length - tx.filter((x) => x.kind === "gumroad_refund").length;
    return postFacts(c, { sales, gumroad }, this.d.publicUrl(), this.#now());
  }

  /** The post move: one real event, by its key, written for every connected channel that has not carried it. */
  async queue(c: Company, t: Task, key: string, angle?: string): Promise<{ ok: boolean; note: string }> {
    const f = (await this.facts(c)).find((x) => x.key === key);
    if (!f) return { ok: false, note: "That event is not in the company's records, so nothing was posted." };
    const a = checkAngle(angle, f);
    const posts = planPosts(c, f, a.ok ? a.text : null, this.#now(), randomUUID, t.id).filter((p) => onlyFacts(p.text, f, c.name));
    if (!posts.length) return { ok: false, note: `No connected channel can carry "${f.title}" now: each one already did, or has posts waiting.` };
    const x = this.of(c);
    x.posts.push(...posts);
    if (x.posts.length > 200) x.posts.splice(0, x.posts.length - 200);
    for (const p of posts) this.#log(c, { channel: p.channel, what: `Wrote a post for ${CHANNEL_NAME[p.channel]}: ${f.title}`, result: "waiting", detail: p.wait ? `Waiting for you: ${p.wait}.` : "Queued: it goes out within the daily cap, outside quiet hours.", taskId: t.id });
    const ask = posts.filter((p) => p.status === "approval");
    if (ask.length) this.d.note(c, "note", `Waiting for your approval: a post about "${f.title}" on ${names(ask)}.`);
    this.d.changed(c);
    return { ok: true, note: `Wrote a post about "${f.title}" for ${names(posts)}.${ask.length ? ` ${names(ask)}: waiting for your approval.` : ""}${a.ok ? "" : ` The CEO's own words were left out: ${a.why}.`}` };
  }

  approvePost(c: Company, id: string): Post {
    const x = this.of(c);
    const p = x.posts.find((y) => y.id === id);
    if (!p || p.status !== "approval") throw new Error("No post waits for you with that id.");
    const ch = x.channels[p.channel];
    if (!ch) throw new Error(`${CHANNEL_NAME[p.channel]} is not connected any more.`);
    p.status = "queued";
    delete p.wait;
    ch.trusted = true;
    this.#log(c, { channel: p.channel, what: `You approved the post for ${CHANNEL_NAME[p.channel]}: ${p.about}`, result: "ok", taskId: p.taskId });
    this.d.note(c, "note", `You approved a post on ${CHANNEL_NAME[p.channel]}: ${p.about}.`);
    this.d.changed(c);
    return p;
  }

  rejectPost(c: Company, id: string): Post {
    const p = this.of(c).posts.find((y) => y.id === id);
    if (!p || p.status !== "approval") throw new Error("No post waits for you with that id.");
    p.status = "rejected";
    delete p.wait;
    this.#log(c, { channel: p.channel, what: `You turned down the post for ${CHANNEL_NAME[p.channel]}: ${p.about}`, result: "ok", taskId: p.taskId });
    this.d.changed(c);
    return p;
  }

  /** The next post per channel, if the rules let it out now; otherwise it says what it waits for. */
  async #sendDue(c: Company): Promise<void> {
    const x = this.of(c);
    const now = this.#now();
    for (const p of x.posts) {
      if (p.status !== "queued" || now - p.at <= 3 * DAY) continue;
      p.status = "dropped";
      p.wait = "too old: more than 3 days in the queue";
      this.#log(c, { channel: p.channel, what: `Dropped a post for ${CHANNEL_NAME[p.channel]}: ${p.about}`, result: "ok", detail: "More than 3 days old; news that old is not posted.", taskId: p.taskId });
      this.d.changed(c);
    }
    for (const kind of CHANNELS) {
      const ch = x.channels[kind];
      const p = ch && x.posts.find((y) => y.channel === kind && y.status === "queued");
      if (!ch || !p) continue;
      const g = sendGate(ch, x.posts, x.quiet, now);
      if (!g.go) { if (p.wait !== g.why) { p.wait = g.why; this.d.changed(c); } continue; }
      await this.#deliver(c, ch, p);
    }
  }

  async #deliver(c: Company, ch: Channel, p: Post): Promise<void> {
    const sim = this.d.sim() || Boolean(ch.sim);
    const name = CHANNEL_NAME[ch.kind];
    try {
      const url = sim ? null : await this.#send(c, ch, p);
      p.status = "posted";
      p.sentAt = this.#now();
      delete p.wait;
      delete p.error;
      if (url) p.url = url;
      if (sim) p.sim = true;
      this.#log(c, { channel: ch.kind, what: `Posted on ${name}: ${p.about}`, result: sim ? "sim" : "ok", ...(url ? { url } : {}), ...(sim ? { detail: "Simulation: nothing was sent." } : {}), taskId: p.taskId, public: true });
      if (!sim) this.d.note(c, "result", `Posted on ${name}: ${url ?? p.about}`);
    } catch (e) {
      const msg = clean((e as Error).message);
      if (pushedBack(e)) {
        ch.paused = { at: this.#now(), why: msg };
        p.wait = `${name} paused itself: ${msg}`;
        this.#log(c, { channel: ch.kind, what: `${name} pushed back, posting paused`, result: "failed", detail: msg, taskId: p.taskId });
        this.d.note(c, "warning", `${name} pushed back (${msg}), so posting there is paused. Resume it from Connections when you are ready.`);
      } else {
        p.status = "failed";
        p.error = msg;
        this.#log(c, { channel: ch.kind, what: `A post on ${name} failed: ${p.about}`, result: "failed", detail: msg, taskId: p.taskId });
        this.d.note(c, "warning", `A post on ${name} failed: ${msg}`);
      }
    }
    this.d.changed(c);
  }

  /** One post out on its platform; the post's public link when there is one. */
  async #send(c: Company, ch: Channel, p: Post): Promise<string | null> {
    if (ch.kind === "bluesky") {
      return this.#bsky(c, async (s) => {
        if (!ch.botFlag) { await bskyBotLabel(this.d.http, s); ch.botFlag = true; }
        return bskyPost(this.d.http, s, p.text);
      });
    }
    if (ch.kind === "telegram") {
      const t = this.d.telegram();
      if (!t || !ch.ref) throw new Error("The NIGHTSHIFT bot is not set up on this engine.");
      const id = await tgPost(this.d.http, t.token, ch.ref, p.text);
      return ch.url ? `${ch.url}/${id}` : null;
    }
    if (ch.kind === "mastodon") {
      const m = this.#secretJson<{ inst: string; token: string }>(SECRET.mastodon(c.id));
      if (!m) throw new Error("Connect Mastodon again.");
      return mastoPost(this.d.open, m.inst, m.token, p.text, p.id);
    }
    const hook = this.d.vault.getSecret(SECRET.discord(c.id));
    if (!hook) throw new Error("Connect Discord again.");
    const r = await discordPost(this.d.http, hook, c.name, p.text);
    const [guild, chan] = (ch.ref ?? "").split("/");
    return guild && chan ? `https://discord.com/channels/${guild}/${chan}/${r.id}` : null;
  }

  /** A Bluesky call on the kept session: refreshed when it expired, signed in again with the app password only when that fails. */
  async #bsky<T>(c: Company, fn: (s: BskySession) => Promise<T>): Promise<T> {
    const save = (s: BskySession) => { this.d.vault.putSecret(SECRET.blueskySession(c.id), JSON.stringify(s)); return s; };
    const login = async () => {
      const pw = this.d.vault.getSecret(SECRET.bluesky(c.id));
      const ch = this.of(c).channels.bluesky;
      if (!pw || !ch) throw new Error("Connect Bluesky again.");
      return save(await bskyLogin(this.d.http, ch.label.replace(/^@/, ""), pw));
    };
    let s = this.#secretJson<BskySession>(SECRET.blueskySession(c.id)) ?? await login();
    try { return await fn(s); } catch (e) {
      if (!(e instanceof ApiError && (e.code === "ExpiredToken" || e.code === "InvalidToken" || e.status === 401))) throw e;
    }
    try { s = save(await bskyRefresh(this.d.http, s.refreshJwt)); } catch { s = await login(); }
    return fn(s);
  }

  /** A test post: the post the channel would get now, and the exact request, with nothing sent and secrets left out. */
  async preview(c: Company, kind: ChannelKind) {
    const x = this.of(c);
    const ch = x.channels[kind];
    if (!ch) throw new Error(`Connect ${CHANNEL_NAME[kind]} first.`);
    const facts = await this.facts(c);
    const real = facts.find((f) => !x.posts.some((p) => p.channel === kind && p.factKey === f.key)) ?? facts[0];
    const f: PostFact = real ?? { key: "sample", kind: "update", title: "A sample (no real event to post right now)", text: `${c.name} is an AI company on NIGHTSHIFT: an AI CEO runs it and the IMD agent swarm builds what it sells.`, numbers: [], link: `${this.d.publicUrl()}/c/${c.slug}` };
    const text = composePost(c.name, f, kind, null);
    const g = sendGate(ch, x.posts, x.quiet, this.#now());
    this.#log(c, { channel: kind, what: `Test post for ${CHANNEL_NAME[kind]}: ${f.title}`, result: "ok", detail: "A dry run: previewed, nothing was sent." });
    this.d.changed(c);
    return { channel: kind, about: f.title, sample: !real, text, chars: text.length, limit: POST_LIMIT[kind], request: this.#shape(c, ch, text), wait: approvalNeeded(ch) ?? (g.go ? null : g.why), sent: false as const };
  }

  #shape(c: Company, ch: Channel, text: string): { method: string; url: string; body: unknown } {
    if (ch.kind === "bluesky") return { method: "POST", url: `${BSKY}/com.atproto.repo.createRecord`, body: { repo: ch.ref ?? "did:plc:…", collection: "app.bsky.feed.post", record: bskyRecord(text, this.#now()) } };
    if (ch.kind === "telegram") return { method: "POST", url: "https://api.telegram.org/bot•••/sendMessage", body: tgBody(ch.ref ?? ch.label, text) };
    if (ch.kind === "mastodon") return { method: "POST", url: `${ch.ref ?? "https://your.server"}/api/v1/statuses`, body: mastoBody(text) };
    return { method: "POST", url: "https://discord.com/api/webhooks/•••/•••?wait=true", body: discordBody(c.name, text) };
  }

  // ---------------------------------------------------------------- what the CEO, the owner and the public see

  async sells(c: Company): Promise<Sells> {
    const m = this.d.metrics(c);
    return sellsFrom(c, { sales: m.sales, ledger: await this.d.ledger.store.list(`co:${c.id}:`), visits: m.visits, via: m.via ?? [], market: this.d.market() }, this.#now());
  }

  /** For the CEO each shift: what sells, the channels it may post on and the real events not posted yet. */
  async context(c: Company): Promise<Partial<CompanyStats>> {
    const out: Partial<CompanyStats> = { sells: await this.sells(c) };
    const open = CHANNELS.map((k) => c.connections?.channels[k]).filter((ch): ch is Channel => Boolean(ch && !ch.paused));
    if (open.length) {
      out.channels = open.map((ch) => `${CHANNEL_NAME[ch.kind]} ${ch.label.replace(/[^\p{L}\p{N} @._()-]/gu, "").slice(0, 60)}`);
      out.postable = unposted(c, await this.facts(c));
    }
    return out;
  }

  /** Posts out, Gumroad in step, sales read: every tick. An inactive (paused) company still has its Gumroad sales read. */
  async tick(c: Company, active: boolean): Promise<void> {
    const x = c.connections;
    if (!x || this.#busy.has(c.id)) return;
    this.#busy.add(c.id);
    try {
      const now = this.#now();
      if (active) await this.#sendDue(c);
      if (x.gumroad && active && now >= (this.#gumroadNext.get(c.id) ?? 0)) {
        this.#gumroadNext.set(c.id, now + 30_000);
        await this.#gumroadPass(c);
      }
      if (x.gumroad && !x.gumroad.sim && now - (x.gumroad.polledAt ?? 0) >= 10 * 60_000) {
        await this.#poll(c).catch((e) => {
          if (x.gumroad) x.gumroad.polledAt = now;
          this.#log(c, { channel: "gumroad", what: "Reading Gumroad sales", result: "failed", detail: `${clean((e as Error).message)} Trying again in 10 minutes.` });
        });
      }
    } finally {
      this.#busy.delete(c.id);
    }
  }

  /** A Bluesky account connected before Connections (handle and auto) becomes a channel; its app password stays where it was in the vault. */
  migrate(c: Company): void {
    const b = c.social?.bluesky;
    if (!b) return;
    const x = this.of(c);
    x.channels.bluesky ??= { kind: "bluesky", label: `@${b.handle}`, url: `https://bsky.app/profile/${b.handle}`, connectedAt: this.#now(), approveEach: !b.auto, dailyMax: DEFAULT_DAILY, trusted: false, listed: true, botFlag: false };
    delete c.social;
  }

  /** The owner desk's Connections tab. */
  desk(c: Company) {
    const x = c.connections;
    const now = this.#now();
    const posts = x?.posts ?? [];
    const tg = this.d.telegram();
    const g = x?.gumroad;
    const post = (p: Post) => ({ id: p.id, channel: p.channel, about: p.about, text: p.text, status: p.status, wait: p.wait ?? null, at: p.at, sentAt: p.sentAt ?? null, url: p.url ?? null, error: p.error ?? null, sim: Boolean(p.sim), taskId: p.taskId ?? null });
    return {
      sim: this.d.sim(),
      gumroad: {
        available: this.d.sim() || Boolean(this.d.gumroadApp()),
        account: g ? { name: g.name, url: g.url, connectedAt: g.connectedAt, scopes: g.scopes, webhooks: g.hooks.length > 0, polledAt: g.polledAt ?? null, sim: Boolean(g.sim) } : null,
        listings: c.products.filter((p) => p.gumroad || p.gumroadBlocked).map((p) => ({
          productId: p.id, product: p.name, priceUsd: fromUsdc(p.priceUsdc), onSale: p.status === "live", taskId: p.taskId,
          state: p.gumroad?.state ?? null, url: p.gumroad?.url ?? null, approved: Boolean(p.gumroad?.approved), declined: Boolean(p.gumroad?.declined),
          file: Boolean(p.gumroad?.file), cover: Boolean(p.gumroad?.cover), sales: p.gumroad?.sales ?? 0, revenueUsd: (p.gumroad?.revenueCents ?? 0) / 100,
          blocked: p.gumroadBlocked ?? null, error: p.gumroad?.error ?? null, sim: Boolean(p.gumroad?.sim),
        })),
        next: g ? c.products.filter((p) => p.status === "live" && !p.gumroad && !p.gumroadBlocked && this.d.files.has(c, p)).length : 0,
        approvals: c.products.filter((p) => p.gumroad && p.status === "live" && p.gumroad.state !== "published" && !p.gumroad.approved && !p.gumroad.declined && !p.gumroadBlocked).map((p) => ({ productId: p.id, product: p.name, priceUsd: fromUsdc(p.priceUsdc), url: p.gumroad!.url, file: p.gumroad!.file })),
        redirect: this.#cb("gumroad"),
      },
      channels: CHANNELS.map((kind) => {
        const ch = x?.channels[kind];
        const last = [...(x?.log ?? [])].reverse().find((e) => e.channel === kind);
        return {
          kind, name: CHANNEL_NAME[kind], max: CHANNEL_CAPS[kind].max, limit: POST_LIMIT[kind],
          available: kind !== "telegram" || this.d.sim() || Boolean(tg), bot: kind === "telegram" ? (tg?.bot ?? null) : null,
          account: ch ? {
            label: ch.label, url: ch.url, connectedAt: ch.connectedAt, approveEach: ch.approveEach, dailyMax: ch.dailyMax, trusted: ch.trusted, listed: ch.listed, botFlag: Boolean(ch.botFlag),
            paused: ch.paused ?? null, sim: Boolean(ch.sim), today: posts.filter((p) => p.channel === kind && p.status === "posted" && p.sentAt !== undefined && now - p.sentAt < DAY).length,
          } : null,
          last: last ?? null,
        };
      }),
      quiet: x?.quiet ?? DEFAULT_QUIET,
      approvals: posts.filter((p) => p.status === "approval").map(post),
      queued: posts.filter((p) => p.status === "queued").map(post),
      recent: posts.filter((p) => p.status !== "approval" && p.status !== "queued").slice(-12).reverse().map(post),
      log: (x?.log ?? []).slice(-40).reverse(),
      mastodonRedirect: this.#cb("mastodon"),
      alertsLinked: Boolean(c.notify?.telegram && /^\d+$/.test(c.notify.telegram)),
    };
  }

  /** The company's accounts the owner chose to show on its public page. */
  publicChannels(c: Company): { kind: string; name: string; label: string; url: string; sim: boolean }[] {
    const x = c.connections;
    if (!x) return [];
    // a simulated channel was never checked with its platform: only a simulation engine lists it
    const out = CHANNELS.map((k) => x.channels[k]).filter((ch): ch is Channel => Boolean(ch?.listed && ch.url && (!ch.sim || this.d.sim()))).map((ch) => ({ kind: ch.kind as string, name: CHANNEL_NAME[ch.kind], label: ch.label, url: ch.url!, sim: Boolean(ch.sim) }));
    if (x.gumroad?.url && c.products.some((p) => p.gumroad?.state === "published")) out.push({ kind: "gumroad", name: "Gumroad", label: x.gumroad.name, url: x.gumroad.url, sim: Boolean(x.gumroad.sim) });
    return out;
  }
}
