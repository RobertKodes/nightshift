import { randomUUID } from "node:crypto";
import { type Brain, type Company, DEFAULT_POLICY, aiSpentToday, fromUsdc, usdc } from "@nightshift/core";
import type { Ledger } from "@nightshift/ledger";
import type { ChatRequest, ChatResult } from "@nightshift/llm";
import { type Requirement, signPayment } from "@nightshift/x402";
import type { LocalAccount } from "viem";

/**
 * The CEO's strong model, paid by its own company. Each answer is bought over x402 from an
 * OpenAI-compatible gateway (BlockRun by default) with the company's own USDC on Base and booked as
 * the company's expense, so NIGHTSHIFT never fronts the bill. A call is paid only when the challenge
 * asks for USDC on Base, and never for more than the call cap, what is left of the owner's AI limit
 * for the day, or the USDC the company may spend. Anything else: no brain this shift, the free model thinks.
 */
export interface BrainDeps {
  /** The gateway's chat completions URL. */
  url: string;
  model: string;
  chainId: number;
  usdc: `0x${string}`;
  account: (c: Company) => LocalAccount;
  /** USDC the company may spend now (its books and its wallet, whichever is less). */
  spendable: (c: Company) => Promise<bigint>;
  ledger: Ledger;
  live: boolean;
  /** USD at most for one answer. */
  maxCallUsd?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
/** Below this, not even a short answer fits: the free model thinks instead. */
const MIN_USDC = usdc(0.01);

type Paid = NonNullable<ReturnType<Brain["paid"]>>;
type Challenge = { x402Version?: number; accepts?: Record<string, unknown>[]; resource?: unknown };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string | null): Record<string, unknown> | null => { try { return s ? JSON.parse(Buffer.from(s, "base64").toString("utf8")) : null; } catch { return null; } };
const same = (a: unknown, b: string) => String(a ?? "").toLowerCase() === b.toLowerCase();

/** The one requirement we would sign: exact USDC on our chain, to a real address, within the cap. */
export function pickRequirement(ch: Challenge, chainId: number, asset: string, cap: bigint): Requirement | null {
  for (const a of ch.accepts ?? []) {
    const extra = a.extra as { name?: unknown; version?: unknown } | undefined;
    let amount: bigint;
    try { amount = BigInt(String(a.amount ?? a.maxAmountRequired)); } catch { continue; }
    if (a.scheme !== "exact" || !same(a.network, `eip155:${chainId}`) || !same(a.asset, asset)) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(a.payTo)) || amount <= 0n || amount > cap) continue;
    if (typeof extra?.name !== "string" || typeof extra?.version !== "string") continue;
    return { scheme: "exact", network: `eip155:${chainId}`, asset: asset as `0x${string}`, amount: amount.toString(), payTo: a.payTo as `0x${string}`, maxTimeoutSeconds: Math.min(600, Number(a.maxTimeoutSeconds) || 300), extra: { name: extra.name, version: extra.version } };
  }
  return null;
}

/** "CEO thinking" entries booked before the model went unnamed carried its name in brackets: shown without it. */
export const unnamedModel = (memo: string): string => memo.replace(/^CEO thinking \(.*\)$/, "CEO thinking");

export function companyBrain(d: BrainDeps): (c: Company) => Promise<Brain | null> {
  const now = d.now ?? Date.now;
  const http = d.fetch ?? fetch;
  return async (c) => {
    if (!d.live || c.sim) return null;
    const daily = c.policy.aiDailyUsd ?? DEFAULT_POLICY.aiDailyUsd ?? 0;
    if (!(daily > 0)) return null;
    const held = await d.spendable(c).catch(() => 0n);
    const left = usdc(daily) - aiSpentToday(c, now());
    let cap = usdc(d.maxCallUsd ?? 0.1);
    for (const x of [left, held]) if (x < cap) cap = x;
    if (cap < MIN_USDC) return null;
    let paid: Paid | null = null;

    const chat = async (req: ChatRequest): Promise<ChatResult> => {
      const t0 = now();
      const body = JSON.stringify({ model: req.model, messages: req.messages, temperature: req.temperature, max_tokens: req.maxTokens ?? 1200 });
      const headers = { "content-type": "application/json", accept: "application/json" };
      const first = await http(d.url, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
      if (first.status !== 402) throw new Error(`the AI gateway answered ${first.status} before payment`);
      const ch = ((await first.json().catch(() => null)) as Challenge | null) ?? (unb64(first.headers.get("payment-required")) as Challenge | null) ?? {};
      const req402 = pickRequirement(ch, d.chainId, d.usdc, cap);
      if (!req402) throw new Error(`the AI gateway asked for more than this company may spend on one answer ($${fromUsdc(cap).toFixed(3)}), or not in USDC on Base`);
      const signed = await signPayment(d.account(c), req402);
      const payment = { ...signed, ...(ch.resource ? { resource: ch.resource } : {}) };
      const res = await http(d.url, { method: "POST", headers: { ...headers, "PAYMENT-SIGNATURE": b64(payment), "X-PAYMENT": b64(payment) }, body, signal: AbortSignal.timeout(120_000) });
      const settled = unb64(res.headers.get("payment-response") ?? res.headers.get("x-payment-response"));
      const tx = typeof settled?.transaction === "string" ? settled.transaction : null;
      const json = (await res.json().catch(() => null)) as { model?: string; choices?: { message?: ChatResult["message"]; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
      // booked when the gateway settled it, or answered: either way the company paid for it
      if (tx || res.ok) {
        const value = BigInt(req402.amount);
        await d.ledger.post({
          id: `ai:${tx ?? randomUUID()}`, at: new Date(now()), kind: "ai", memo: "CEO thinking",
          ref: tx ? { chainTx: tx } : undefined,
          postings: [
            { account: `co:${c.id}:usdc`, asset: "USDC", amount: -value },
            { account: "ext:ai-gateway", asset: "USDC", amount: value },
          ],
        });
        (c.aiSpend ??= []).push({ at: now(), usdc: value, tx });
        c.aiSpentUsdc = (c.aiSpentUsdc ?? 0n) + value;
        c.aiSpend = c.aiSpend.filter((x) => now() - x.at < TWO_DAYS);
        paid = { usdc: value, tx, via: new URL(d.url).host };
      }
      const message = json?.choices?.[0]?.message;
      if (!res.ok || !message) throw new Error(`the AI gateway answered ${res.status} after payment`);
      return {
        message, finishReason: json?.choices?.[0]?.finish_reason ?? null, requestedModel: req.model, servedModel: json?.model ?? req.model,
        provider: new URL(d.url).host, usage: { prompt: json?.usage?.prompt_tokens ?? 0, completion: json?.usage?.completion_tokens ?? 0 },
        costUsd: paid ? fromUsdc(paid.usdc) : 0, costSource: "provider", latencyMs: now() - t0, attempts: 1, swap: null,
      };
    };
    return { model: d.model, paid: () => paid, llm: { chat } };
  };
}
