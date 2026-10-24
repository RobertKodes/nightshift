import type { LlmClient } from "@nightshift/llm";
import type { Mind } from "./swarm-mind.js";

/**
 * BRIEF DOCTOR: a request checked before anyone pays 0.5 IMD for it. IMD's own free check says what it
 * would build, which facts the request states and which it leaves to guesswork; SWARM MIND finds work
 * the swarm already did on it (sometimes nothing new needs buying); the model rewrites the request so
 * the missing facts are said, in the style of requests the swarm finished, and IMD checks it again.
 */
export type BriefKind = "website" | "research" | "audit" | "logo";
export const KINDS: Record<BriefKind, { label: string; body: (objective: string) => Record<string, unknown> }> = {
  website: { label: "A website", body: (objective) => ({ objective, skill: "build-website" }) },
  research: { label: "A research report", body: (objective) => ({ objective, skill: "research-report" }) },
  audit: { label: "A security audit", body: (objective) => ({ objective, template: "audit" }) },
  logo: { label: "A token logo", body: (objective) => ({ objective, skill: "token-logo" }) },
};

/** The kind of job a request reads as, when its author did not say. */
export function kindOf(objective: string): BriefKind {
  const s = objective.toLowerCase();
  if (/\b(audit|vulnerab|exploit|reentranc|security review)/.test(s)) return "audit";
  if (/\b(logo|icon|mascot)\b/.test(s)) return "logo";
  if (/\b(website|landing page|web page|site|dashboard|frontend|web app)\b/.test(s)) return "website";
  return "research";
}

type Fact = { id: string; label: string; state: string; assumed?: string; example?: string };
export type Check = { kind: string; plan: string[]; facts: Fact[]; blockers: string[]; suggestions: string[] };
export type Diagnosis = {
  kind: BriefKind;
  before: Check;
  after: Check | null;
  improved: string | null;
  questions: string[];
  similar: { title: string; kinds: string[]; at: number; url: string }[];
};

/** IMD's free check, read into plain lines. */
export function readCheck(j: Record<string, unknown>): Check {
  const say = (x: unknown) => (typeof x === "string" ? x : String((x as { detail?: string; message?: string })?.detail ?? (x as { message?: string })?.message ?? JSON.stringify(x)));
  return {
    kind: String(j.kind ?? "other"),
    plan: (Array.isArray(j.plan) ? j.plan : []).map((p) => String((p as { title?: string })?.title ?? p)),
    facts: (Array.isArray(j.facts) ? j.facts : []).filter((f) => (f as Fact).state !== "not_applicable") as Fact[],
    blockers: (Array.isArray(j.blockers) ? j.blockers : []).map(say),
    suggestions: (Array.isArray(j.suggestions) ? j.suggestions : []).map(say),
  };
}

const DOCTOR = `You improve requests for the IMD agent swarm before the buyer pays for them. Rewrite the request so every fact IMD marks missing or unknown is stated plainly, keeping the buyer's intent and every detail they gave. Where only the buyer can know a fact, do not invent it: list it under QUESTIONS. Learn the shape from the finished requests shown. Answer exactly:
REQUEST:
<the improved request, under 1400 characters>
QUESTIONS:
- <one per line, at most 4; "none" when nothing is left to ask>`;

export interface DoctorDeps {
  check: (body: { action: string; input: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  mind: Mind | null;
  llm: Pick<LlmClient, "chat"> | null;
  model: string;
}

export async function diagnose(objective: string, kind: BriefKind | null, d: DoctorDeps): Promise<Diagnosis> {
  const k = kind ?? kindOf(objective);
  const before = readCheck(await d.check({ action: "job.open", input: KINDS[k].body(objective) }));
  const found = d.mind ? d.mind.search(objective, 6) : [];
  const similar = found.slice(0, 5).map((w) => ({ title: w.title, kinds: w.kinds, at: w.at, url: w.url }));
  const open = before.facts.filter((f) => f.state !== "stated");
  if (!d.llm || (!open.length && !before.blockers.length && !before.suggestions.length)) return { kind: k, before, after: null, improved: null, questions: [], similar };
  const examples = found.filter((w) => w.passage).slice(0, 2).map((w, i) => `Finished request ${i + 1}: ${w.passage}`).join("\n\n");
  const facts = open.map((f) => `- ${f.label}: ${f.state}${f.assumed ? ` (IMD would assume: ${f.assumed})` : ""}${f.example ? ` (${f.example})` : ""}`).join("\n");
  const r = await d.llm.chat({ model: d.model, temperature: 0.3, maxTokens: 1200, messages: [
    { role: "system", content: DOCTOR },
    { role: "user", content: `Kind: ${KINDS[k].label}\nRequest:\n${objective}\n\nIMD's check:\n${facts || "- every fact stated"}\n${[...before.blockers, ...before.suggestions].map((s) => `- ${s}`).join("\n")}\n\n${examples}` },
  ] }).catch(() => null);
  const out = (r?.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const improved = /REQUEST:\s*([\s\S]*?)(?:\n\s*QUESTIONS:|$)/i.exec(out)?.[1]?.trim().slice(0, 1500) || null;
  const questions = (/QUESTIONS:\s*([\s\S]*)$/i.exec(out)?.[1] ?? "").split("\n").map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter((l) => l && !/^none\.?$/i.test(l)).slice(0, 4);
  const after = improved ? readCheck(await d.check({ action: "job.open", input: KINDS[k].body(improved) }).catch(() => ({}))) : null;
  return { kind: k, before, after, improved, questions, similar };
}
