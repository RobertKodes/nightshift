import { type Company, type Product, type Recipe, orderPrompt, qualityProblems, sampleDelivery } from "@nightshift/core";
import type { ChatMessage, LlmClient } from "@nightshift/llm";

/**
 * The writer of made-for-you files: one buyer's answers in, one checked file out, on the free model.
 * A file that fails its checks is written again with the problems named; a busy model is waited for
 * and asked again. When it still cannot be written, the answer is "not now" and nothing is sold:
 * a file is only ever paid for after it exists and has passed.
 */
export interface Writer { llm: Pick<LlmClient, "chat">; model: string }
export type Written = { ok: true; text: string; model: string; tries: number } | { ok: false; problems: string[]; tries: number; busy: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The file itself, when the model wrapped it in a code fence or said a line before it. */
function unwrap(text: string): string {
  let t = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.search(/^#\s+\S/m);
  return start > 0 && start < 300 ? t.slice(start).trim() : t;
}

const footer = (c: Pick<Company, "name">, r: Recipe, day: string) => `\n\n---\n\n_Made for you by ${c.name}, an AI-run company on NIGHTSHIFT, on ${day}. An AI model wrote it from your own answers; read it through and check anything you rely on. ${r.limits}_\n`;

export async function writeOrder(w: Writer | null, recipe: Recipe, input: Record<string, string>, c: Pick<Company, "name" | "audience" | "mission">, opts: { tries?: number; pauseMs?: number; sim?: boolean; now?: () => number } = {}): Promise<Written> {
  const day = new Date((opts.now ?? Date.now)()).toISOString().slice(0, 10);
  if (!w) {
    // the simulator without a model key: a labelled stand-in, so the demo still delivers a file. Never in live mode.
    if (opts.sim) return { ok: true, text: sampleDelivery(recipe, input) + footer(c, recipe, day), model: "none (simulation sample)", tries: 0 };
    return { ok: false, problems: ["no model is available to write it right now"], tries: 0, busy: true };
  }
  const tries = Math.max(1, opts.tries ?? 3), pause = opts.pauseMs ?? 2500;
  const messages: ChatMessage[] = [
    { role: "system", content: `${recipe.system}\nThe shop that sells this serves: ${c.audience}. Write in plain English unless the buyer's own text is in another language; then write in theirs.` },
    { role: "user", content: orderPrompt(recipe, input, c) },
  ];
  let problems: string[] = [], busy = false;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await w.llm.chat({ model: w.model, messages, temperature: 0.4 + i * 0.15, maxTokens: recipe.maxTokens });
      busy = false;
      const text = unwrap(r.message.content ?? "");
      problems = qualityProblems(recipe, input, text, { finish: r.finishReason });
      if (!problems.length) return { ok: true, text: text + footer(c, recipe, day), model: r.servedModel, tries: i + 1 };
      // written again with what was wrong, never patched by hand
      messages.splice(2, messages.length - 2, { role: "assistant", content: text.slice(0, 6000) }, { role: "user", content: `That file cannot be delivered: ${problems.join("; ")}. Write the whole file again, fixing exactly that, in the same format.` });
    } catch (e) {
      busy = true;
      problems = [`the model did not answer (${String((e as Error).message).slice(0, 100)})`];
      if (i < tries - 1) await sleep(pause * (i + 1));
    }
  }
  return { ok: false, problems, tries, busy };
}

/** What a buyer may see of their own file before paying: its sections and its first lines, never all of it. */
export function orderPreview(text: string): { outline: string[]; opening: string; words: number } {
  const body = text.split("\n---\n")[0]!;
  const heads = body.split("\n").filter((l) => /^#{1,3}\s+\S/.test(l)).map((l) => l.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim());
  const plain = body.split("\n").filter((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^\|?\s*[-:| ]+\|?\s*$/.test(l)).map((l) => l.replace(/^\s*(?:>\s*)+/, "").replace(/[*_`|]+/g, " ")).join(" ").replace(/\s+/g, " ").trim();
  const cap = Math.min(520, Math.floor(plain.length * 0.18));
  const opening = plain.length > cap ? `${plain.slice(0, cap).replace(/\s+\S*$/, "")}…` : plain;
  return { outline: heads.slice(0, 12), opening, words: body.split(/\s+/).filter(Boolean).length };
}

/** The product's own page as Markdown: what it is, what the buyer fills in, how it works, its limits, and a sample. The market's free preview reads it. */
export function customListing(c: Company, p: Product, r: Recipe, sample: string | null, days: number): string {
  const price = (Number(p.priceUsdc) / 1e6).toFixed(2);
  return `# ${p.name}

_${p.pitch}_

> Made for you by ${c.name}, an AI-run company on NIGHTSHIFT. An AI model writes your file from your own answers when you order, and it is checked before you pay.

## What you get

${r.delivers}

## What you fill in

${r.fields.map((f) => `- ${f.label}${f.required ? "" : " (optional)"}`).join("\n")}

## How it works

1. Fill in the short form. Nothing is charged.
2. Your file is written (about a minute) and checked. You see its sections and its first lines.
3. Pay $${price} in USDC on Base only once it is ready. A file that fails its checks is never sold.
4. Download it as Markdown. The link works for 7 days.

## What it does not do

${r.limits}

## Your answers

They are sent to an AI model to write your file and are not kept afterwards. The finished file is kept ${days} days so you can download it again, then deleted. Leave out addresses, phone numbers and ID numbers: the file does not need them.
${sample ? `
## Sample

_Made from a made-up example, not from a customer._

${sample.split("\n---\n")[0]!.replace(/^# /gm, "### ").replace(/^## /gm, "#### ").trim()}
` : ""}`;
}
