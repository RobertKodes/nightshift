/** What a company is, what it sells, and what it decided to do: the state every view reads. */

export type ProductKind = "report" | "tool" | "template" | "dataset";

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  pitch: string;
  /** USDC base units (6 decimals). */
  priceUsdc: bigint;
  /** The owner set this price: the CEO keeps it. */
  priceByOwner?: boolean;
  status: "building" | "live" | "retired";
  /** Where the buyer gets it after paying: the swarm's delivered file or hosted tool. */
  deliverableUrl: string | null;
  taskId: string;
  /** Sales to people and outside agents. Sales to other NIGHTSHIFT companies are counted apart, in b2b*. */
  sales: number;
  revenueUsdc: bigint;
  /** Bought by other NIGHTSHIFT companies (B2B): never added to `sales`, so no number is inflated by them. */
  b2bSales?: number;
  b2bRevenueUsdc?: bigint;
  createdAt: number;
  /** The same product on the owner's own Gumroad account, made from this one as a draft. */
  gumroad?: GumroadListing;
  /** Why it is never listed on Gumroad: one of Gumroad's prohibited categories. */
  gumroadBlocked?: string;
}

export type TaskKind = "research" | "build_product" | "build_site" | "improve_site" | "marketing" | "reprice" | "retire_product" | "post";

export type TaskStatus =
  | "planned"
  | "checking" // the free IMD check
  | "awaiting_approval" // over the owner's per-action limit
  | "ordering" // quote, pay, submit
  | "building" // the swarm is on it
  | "done"
  | "failed"
  | "rejected"; // the owner said no

export interface Task {
  id: string;
  cycle: number;
  kind: TaskKind;
  title: string;
  /** The CEO's reason, in its own words. */
  why: string;
  status: TaskStatus;
  /** The body sent to IMD, when the task buys work. */
  imd?: { action: string; input: unknown; orderId?: string; jobId?: string; txHash?: string; plan?: string[] };
  stepsDone: number;
  stepsTotal: number;
  activity: string | null;
  /** IMD base units spent (0 for internal tasks). */
  costImd: bigint;
  result: { siteUrl?: string | null; repoUrl?: string | null; files?: Record<string, string>; note?: string } | null;
  error: string | null;
  productId?: string;
  createdAt: number;
  updatedAt: number;
  /** The flight record: every change of status, step or activity, oldest first. */
  trail?: TrailEntry[];
  /** How the CEO chose this move and the numbers it was looking at. */
  mind?: Mind;
  /** USDC base units paid (or reserved while paying) for a product bought from another company. */
  costUsdc?: bigint;
  /** Research only: the search of the NIGHTSHIFT market before paying the swarm, and what it decided. */
  market?: MarketSearch;
}

/** Why a product on the market was or was not bought. */
export type MarketVerdict = "picked" | "relevant" | "irrelevant" | "pricier" | "over_max" | "same_owner" | "own" | "owned" | "demo" | "cap" | "funds";

export interface MarketCandidate {
  sellerId: string;
  company: string;
  slug: string;
  productId: string;
  name: string;
  kind: ProductKind;
  priceUsd: number;
  /** Relevance to the research brief, 0 to 1. */
  score: number;
  verdict: MarketVerdict;
  why: string;
}

export interface MarketPick {
  sellerId: string;
  company: string;
  slug: string;
  productId: string;
  name: string;
  kind: ProductKind;
  priceUsdc: bigint;
  score: number;
}

export interface MarketSearch {
  at: number;
  doneAt: number;
  /** The brief's key terms, matched against each product's free preview. */
  query: string;
  /** What the same research costs from the swarm, in USD at the IMD price of the moment. */
  swarmUsd: number;
  /** Who scored relevance: the CEO's model, or the keyword score when no model is set (or it failed). */
  by: "model" | "keywords";
  threshold: number;
  costUsd?: number;
  fallback?: string;
  candidates: MarketCandidate[];
  /** The decision, in one sentence. */
  decision: string;
  pick?: MarketPick;
  /** Sent on chain, not landed yet (live only): the settlement key it is followed by. */
  pending?: string;
  paid?: { at: number; usdc: bigint; ledgerId: string; tx: string | null; sim: boolean };
}

/** One purchase between two NIGHTSHIFT companies, as each side keeps it. */
export interface B2bLine {
  at: number;
  /** The one ledger transaction both sides share: b2b:<buyer task id>. */
  ledgerId: string;
  taskId: string;
  productId: string;
  product: string;
  kind: ProductKind;
  usdc: bigint;
  /** The other company: the seller on a purchase, the buyer on a sale. */
  with: { id: string; name: string; slug: string };
  tx: string | null;
  sim: boolean;
}

export interface TrailEntry {
  at: number;
  status: TaskStatus;
  activity: string | null;
  step: number;
}

export interface Mind {
  by: "model" | "playbook" | "owner";
  /** The model that answered (owner view only). */
  model?: string;
  costUsd?: number;
  /** Why the playbook decided instead of the model, when a model is set. */
  fallback?: string;
  saw: { visits7d: number; sales7d: number; revenue7dUsd: number; imdUsd: number; liveProducts: number; direction: boolean };
}

export interface Policy {
  /** Spending stops for the day once this is reached. */
  dailyBudgetUsd: number;
  /** Any single action costing more than this waits for the owner. 0 = everything waits. */
  approvalOverUsd: number;
  /** Run shifts on their own. Off = only when the owner presses run. */
  autopilot: boolean;
  /** Minutes between shifts on autopilot. */
  shiftMinutes: number;
  /** Before paying the swarm for research, buy a relevant, cheaper product another company already sells. */
  marketBuy: boolean;
  /** USDC the company may spend on the market in 24 hours. */
  marketDailyUsd: number;
  /** USDC at most for one product bought on the market. */
  marketMaxUsd: number;
}

export interface JournalEntry {
  at: number;
  cycle: number;
  kind: "plan" | "decision" | "result" | "sale" | "note" | "warning";
  text: string;
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  idea: string;
  /** Who it serves and what it promises, written by the CEO on day one. */
  mission: string;
  audience: string;
  createdAt: number;
  owner: string | null;
  wallet: `0x${string}`;
  policy: Policy;
  status: "active" | "paused";
  cycle: number;
  nextShiftAt: number | null;
  /** The budget is spent: no new shifts until this time (or until the owner raises the budget). */
  restUntil?: number;
  site: { url: string; jobId: string } | null;
  products: Product[];
  tasks: Task[];
  journal: JournalEntry[];
  marketing: { at: number; channel: string; text: string; status: "drafted" | "posted" | "failed"; url?: string; error?: string }[];
  /** Created in simulation: never sells, spends or withdraws in live mode. */
  sim?: boolean;
  /** Run by NIGHTSHIFT itself (the house services): no CEO shifts, kept off the company boards. */
  house?: boolean;
  /** Where the company posts. The password lives in the vault, never here. */
  social?: { bluesky?: { handle: string; auto: boolean } };
  /** The owner's standing direction to the CEO: read every shift and passed to the swarm with each order. */
  direction?: string;
  /** Where the owner hears about approvals, sales, deliveries and problems: a Telegram chat linked with a one-time code. */
  notify?: { telegram: string; at: number };
  /** Products bought from and sold to other NIGHTSHIFT companies, newest last (the ledger holds every one). */
  b2b?: { bought: B2bLine[]; sold: B2bLine[] };
  /** Accounts the owner created and connected, the posts written for them and what was done through them. */
  connections?: Connections;
}

/** Where the company may post, on accounts its owner made and connected. */
export type ChannelKind = "bluesky" | "telegram" | "mastodon" | "discord";

/**
 * One connected account. Its app password, token or webhook lives in the vault, never here: this is
 * only what the owner and the public may see, and the rules the CEO posts by.
 */
export interface Channel {
  kind: ChannelKind;
  /** @handle, the channel's name, @user@instance, the webhook's name. */
  label: string;
  /** The account's public page (null: a Discord webhook has none). */
  url: string | null;
  connectedAt: number;
  /** Every post waits for the owner. Off: only the first post on this channel waits. */
  approveEach: boolean;
  /** Posts on this channel in 24 hours, at most. */
  dailyMax: number;
  /** The owner approved a post here: from then on posts go out on their own, within the caps. */
  trusted: boolean;
  /** Shown on the public company page. */
  listed: boolean;
  /** The platform's own bot marker is on: Bluesky's `bot` self-label, Mastodon's bot flag. */
  botFlag?: boolean;
  /** Not secret: the Bluesky DID, the Telegram chat id, the Mastodon instance, the Discord server. */
  ref?: string;
  /** Stopped after the platform pushed back (a rate limit, a spam flag): the owner resumes it. */
  paused?: { at: number; why: string };
  /** Made in simulation: never checked with the platform, nothing is ever sent. */
  sim?: boolean;
}

/** A real event the company may post about, read from its own records and books. */
export interface PostFact {
  /** One per event (product:<id>, sales:<n>, site:<job>, price:<id>:<cents>, shift:<task>): posted at most once per channel. */
  key: string;
  kind: "new_product" | "sales_milestone" | "update" | "replay";
  /** In a few words, for the CEO's list and the owner. */
  title: string;
  /** The post's words, built from the records only. */
  text: string;
  /** Every number the post may contain: the ones in `text`, nothing else. */
  numbers: number[];
  /** The company's own page for it: the product, the company or the shift's replay. */
  link: string;
  productId?: string;
  taskId?: string;
}

export type PostStatus = "approval" | "queued" | "posted" | "failed" | "rejected" | "dropped";

export interface Post {
  id: string;
  at: number;
  channel: ChannelKind;
  factKey: string;
  factKind: PostFact["kind"];
  /** What the post is about, in a few words. */
  about: string;
  /** The post as it goes out, the disclosure line included. */
  text: string;
  status: PostStatus;
  /** Why it is not out yet, in words. */
  wait?: string;
  /** The shift that wrote it. */
  taskId?: string;
  url?: string;
  error?: string;
  sentAt?: number;
  /** Simulation: nothing was sent. */
  sim?: boolean;
}

/** A product on the owner's own Gumroad account, made from the NIGHTSHIFT product. */
export interface GumroadListing {
  /** Gumroad's product id. */
  id: string;
  /** The Gumroad account it was made on. */
  user: string;
  url: string | null;
  state: "draft" | "published" | "unpublished";
  /** The owner said yes to publishing it once: the CEO may publish it again after taking it down. */
  approved: boolean;
  /** The owner said no: it stays a draft until they publish it themselves from the desk. */
  declined?: boolean;
  file: boolean;
  cover: boolean;
  /** What Gumroad has now (name, price, description, on sale), to send only changes. */
  synced: string;
  createdAt: number;
  /** Sales on Gumroad, booked apart from USDC: the money is the owner's on Gumroad. */
  sales: number;
  revenueCents: number;
  error?: string;
  sim?: boolean;
}

/** One thing done through a connected account and how it went: the owner's log and the flight recorder read it. */
export interface ConnEntry {
  at: number;
  channel: ChannelKind | "gumroad";
  what: string;
  result: "ok" | "failed" | "waiting" | "blocked" | "sim";
  detail?: string;
  url?: string;
  /** The shift it belongs to: a post move, or the shift that built the product. */
  taskId?: string;
  /** Visitors may see it (a post that went out, a product published). */
  public?: boolean;
}

/** No post goes out between these hours (0 to 23, from ≠ to), in the owner's time zone. */
export interface QuietHours { from: number; to: number; tz: string }

export interface Connections {
  gumroad?: { user: string; name: string; url: string | null; connectedAt: number; scopes: string; hooks: string[]; polledAt?: number; sim?: boolean };
  channels: Partial<Record<ChannelKind, Channel>>;
  quiet: QuietHours;
  posts: Post[];
  log: ConnEntry[];
}

export const USDC_DECIMALS = 6;
export const usdc = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));
export const fromUsdc = (v: bigint): number => Number(v) / 1e6;
export const fromImd = (v: bigint): number => Number(v / 10n ** 12n) / 1e6;
