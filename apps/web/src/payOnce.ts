/** Hidden same-origin payer. Prices and paths come from the server's own advertisements. */

export const PAY_PAGE_PATH = "/pay-x7k2";

/** Fixed-price house tools the owner pays once. Order is the order on the page. */
export const PAY_OFFER_IDS = [
  "imd-feed",
  "gas-now",
  "token-price",
  "name-resolve",
  "payment-verify",
  "wallet-check",
  "tx-explain",
  "x402-seller-check",
  "watchtower-check",
] as const;

export type PayOfferId = (typeof PAY_OFFER_IDS)[number];

/** The example URL must be the cheap call named for that offer, not another route that shares a catalog id. */
const FAMILY: Record<PayOfferId, RegExp> = {
  "imd-feed": /^\/api\/v1\/imd\/launches(?:\?|$)/,
  "gas-now": /^\/api\/v1\/gas-now(?:\?|$)/,
  "token-price": /^\/api\/v1\/token-price\?/,
  "name-resolve": /^\/api\/v1\/name-resolve\?/,
  "payment-verify": /^\/api\/v1\/payment-verify\?/,
  "wallet-check": /^\/api\/v1\/wallet-check\?/,
  "tx-explain": /^\/api\/v1\/tx-explain\?/,
  "x402-seller-check": /^\/api\/v1\/x402-seller-check\?/,
  "watchtower-check": /^\/api\/v1\/watchtower\/check\//,
};

export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

export type AdvertisedOffer = {
  id: string;
  name: string;
  priceUsd: number;
  example: string;
  route: string;
  priceIsMinimum?: boolean;
};

export type ServiceCatalog = {
  network: string;
  payTo: string | null;
  offers: AdvertisedOffer[];
};

export type X402Endpoint = {
  path: string;
  method: string;
  price: string;
  priceIsMinimum?: boolean;
};

export type X402Document = {
  chainId?: number;
  resources?: string[];
  endpoints?: X402Endpoint[];
};

export type PayTarget = {
  id: PayOfferId;
  name: string;
  /** Price text from /.well-known/x402.json, unchanged. */
  price: string;
  /** USDC base units (6 decimals), the same number on both advertisements. */
  amount: string;
  /** Path and query to GET on this origin. */
  path: string;
  payTo: `0x${string}`;
};

export type PaymentRequirement = {
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

/** USDC base units from a decimal price. Rejects anything that is not a positive 6-decimal amount. */
export function usdcUnits(price: string | number): bigint | null {
  const raw = typeof price === "number" ? price.toString() : price.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > 6) return null;
  const units = BigInt(whole || "0") * 1_000_000n + BigInt((frac || "0").padEnd(6, "0"));
  return units > 0n ? units : null;
}

export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function sameOriginPath(value: string, origin: string): string | null {
  try {
    const u = new URL(value, origin);
    if (u.origin !== origin || u.username || u.password || u.hash) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/** Route template as advertised, with URL encoding undone so `{param}` still matches. */
export function advertisedRoute(route: string, origin: string): string | null {
  try {
    const u = new URL(route, origin);
    if (u.origin !== origin || u.username || u.password) return null;
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}

export function sameRequest(a: string, b: string, origin: string): boolean {
  try {
    const left = new URL(a, origin);
    const right = new URL(b, origin);
    if (left.origin !== origin || right.origin !== origin || left.pathname !== right.pathname) return false;
    const norm = (u: URL) => [...u.searchParams.entries()]
      .sort((x, y) => x[0] === y[0] ? x[1].localeCompare(y[1]) : x[0].localeCompare(y[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return norm(left) === norm(right);
  } catch {
    return false;
  }
}

/**
 * The nine calls, with the price and example the server already publishes.
 * Throws if /api/v1/services and /.well-known/x402.json disagree, or a call is not the expected path.
 */
export function listedPayments(index: ServiceCatalog, doc: X402Document, origin: string): PayTarget[] {
  if (index.network !== "eip155:8453" || doc.chainId !== 8453) {
    throw new Error("These tools are not advertised on Base (8453). Nothing will be signed.");
  }
  if (!index.payTo || !ADDRESS.test(index.payTo)) {
    throw new Error("The service list has no payment address. Nothing will be signed.");
  }
  const payTo = index.payTo as `0x${string}`;
  const resources = new Set((doc.resources ?? []).map((r) => sameOriginPath(r, origin)).filter((p): p is string => p !== null));
  return PAY_OFFER_IDS.map((id) => {
    const offer = index.offers.find((o) => o.id === id);
    if (!offer || offer.priceIsMinimum) throw new Error(`${id} is not a fixed-price offer. Nothing will be signed.`);
    const path = sameOriginPath(offer.example, origin);
    const route = advertisedRoute(offer.route, origin);
    if (!path || !FAMILY[id].test(path)) throw new Error(`${id} is not advertised at its expected path. Nothing will be signed.`);
    if (!route) throw new Error(`${id} has no route. Nothing will be signed.`);
    const endpoint = (doc.endpoints ?? []).find((e) => e.path === route && e.method === "GET" && e.priceIsMinimum !== true);
    if (!endpoint) throw new Error(`${id} is missing from /.well-known/x402.json. Nothing will be signed.`);
    const listed = usdcUnits(offer.priceUsd);
    const advertised = usdcUnits(endpoint.price);
    if (listed === null || advertised === null || listed !== advertised) {
      throw new Error(`${id}: /api/v1/services and /.well-known/x402.json disagree on the price. Nothing will be signed.`);
    }
    if (!resources.has(path)) throw new Error(`${id} example is not in the x402 resource list. Nothing will be signed.`);
    return { id, name: offer.name, price: endpoint.price, amount: advertised.toString(), path, payTo };
  });
}

/** The first requirement, unchanged, once it matches the advertised Base USDC price and URL. */
export function acceptChallenge(body: unknown, target: PayTarget, origin: string): PaymentRequirement {
  const ch = body as { x402Version?: number; accepts?: unknown[]; resource?: { url?: string } } | null;
  const req = ch?.accepts?.[0] as PaymentRequirement | undefined;
  if (ch?.x402Version !== 2 || req?.scheme !== "exact") throw new Error("Invalid x402 v2 payment terms. Nothing will be signed.");
  if (req.network !== "eip155:8453" || String(req.asset).toLowerCase() !== BASE_USDC) throw new Error("This tool must charge USDC on Base (8453). Nothing will be signed.");
  if (typeof req.payTo !== "string" || !ADDRESS.test(req.payTo) || req.payTo.toLowerCase() !== target.payTo.toLowerCase()) {
    throw new Error("The payment recipient does not match /api/v1/services. Nothing will be signed.");
  }
  if (typeof req.amount !== "string" || !/^\d+$/.test(req.amount) || req.amount !== target.amount) {
    throw new Error("The payment amount does not match the advertised price. Nothing will be signed.");
  }
  if (!Number.isSafeInteger(req.maxTimeoutSeconds) || req.maxTimeoutSeconds < 10 || req.maxTimeoutSeconds > 300) {
    throw new Error("Invalid USDC authorization window. Nothing will be signed.");
  }
  if (req.extra?.name !== "USD Coin" || req.extra?.version !== "2") throw new Error("Invalid USDC authorization terms. Nothing will be signed.");
  if (typeof ch?.resource?.url !== "string" || !sameRequest(ch.resource.url, target.path, origin)) {
    throw new Error("The 402 is for a different URL than the one advertised. Nothing will be signed.");
  }
  return req;
}

export function txFromSettlement(body: unknown, paymentResponse: unknown): string | null {
  const tx = (body as { payment?: { tx?: unknown } } | null)?.payment?.tx;
  if (typeof tx === "string" && TX.test(tx)) return tx;
  const alt = (paymentResponse as { transaction?: unknown } | null)?.transaction;
  if (typeof alt === "string" && TX.test(alt)) return alt;
  return null;
}
