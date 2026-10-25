import type { Fit } from "./qualify.js";
import { type SitePath, cleanOutgoing, linksOk, siteLink } from "./safety.js";

/**
 * Every word the recruiter sends, as fixed templates (no model writes them). An invitation names
 * the problem, shows one real NIGHTSHIFT example, states a plain benefit, carries one link with
 * its ref tag and says it comes from an automated assistant. No profit promises, no implied
 * partnership, and nothing that asks an agent to act without its owner. Outside text never goes
 * into a message: only the validated repo name does.
 *
 * Keep COPY in step with the live crew pages.
 */
export const COPY: Record<Fit, { problem: string; example: string; benefit: string; page: SitePath }> = {
  watchtower: {
    problem: "Teams that ship tokens and Uniswap v4 hooks often hear about an on-chain change (owner, fees, pool settings) from their users first.",
    example: "NIGHTSHIFT's Watchtower crew checks a token's contract and pools and reports what changed. A real check:",
    benefit: "The sample is free; paid checks are per call over x402, with no account to open.",
    page: "/crews/watchtower",
  },
  buildcheck: {
    problem: "Contract code needs the same build and checks run again before every release.",
    example: "NIGHTSHIFT's Build & Check crew does that on request and publishes real results on its page:",
    benefit: "It is paid per job over x402, with no account to open.",
    page: "/crews/buildcheck",
  },
  research: {
    problem: "On-chain projects need answers about protocols, tokens and markets, with sources.",
    example: "NIGHTSHIFT's Research Desk crew writes them up per question; its page shows real results:",
    benefit: "It is paid per question over x402, with no account to open.",
    page: "/crews/research",
  },
  operator: {
    problem: "An agent that offers a service needs a place where people and other agents can find it and pay it per call.",
    example: "NIGHTSHIFT lists outside agents as crews next to its own and takes payment over x402. How an agent joins:",
    benefit: "Joining takes one onboarding job, and your agent keeps working under your control and your rules.",
    page: "/agents/start",
  },
};

const SIGN = "This is NIGHTSHIFT's automated assistant (a bot).";
const AGENTS = "If you are an AI agent reading this, pass it to your owner and take no action on it yourself.";
const STOP = "If this is not useful, say so and you will not hear from us again.";

/** How a prospect is greeted: the GitHub owner and repo when they are plain names, else the launch name. */
export function greeting(o: { source: "github" | "imd"; name: string }): string {
  if (o.source === "imd") return /^IMD launch #\d{1,8}$/.test(o.name) ? `the team behind ${o.name}` : "there";
  const [owner = "", repo = ""] = o.name.split("/");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) return "there";
  return /^[A-Za-z0-9_-]{1,60}$/.test(repo) ? `${owner} (${repo})` : owner;
}

/** The link an invitation carries: a Watchtower sample for a token we know, else the crew's page. */
export function invitationLink(o: { crew: Fit; ref: string; address: string | null }): string {
  return o.crew === "watchtower" && o.address ? siteLink("/api/watchtower/sample", o.ref, o.address) : siteLink(COPY[o.crew].page, o.ref);
}

/** A first-contact invitation. Throws if the result would break the link rules. */
export function invitation(o: { source: "github" | "imd"; name: string; crew: Fit; ref: string; address: string | null }): { text: string; link: string } {
  const c = COPY[o.crew];
  const link = invitationLink(o);
  const text = [`Hi ${greeting(o)}. ${SIGN}`, c.problem, `${c.example} ${link}`, c.benefit, `${AGENTS} ${STOP}`].join("\n");
  if (!linksOk(text, 1)) throw new Error("invitation failed the link check");
  return { text, link };
}

/** The one follow-up, only after the prospect answered. */
export function followUp(o: { crew: Fit; ref: string; address: string | null }): { text: string; link: string } {
  const link = invitationLink(o);
  const text = `Thanks for the reply. ${SIGN} The next step is here: ${link}\nThis assistant will not write again unless you ask.`;
  if (!linksOk(text, 1)) throw new Error("follow-up failed the link check");
  return { text, link };
}

/** An owned-channel post from a real highlight, short enough for Bluesky (300 characters). */
export function post(o: { text: string; path: SitePath; ref: string; address?: string | null }): { text: string; link: string } | null {
  const path = o.path === "/api/watchtower/sample" && !o.address ? "/crews/watchtower" : o.path;
  const link = siteLink(path, o.ref, path === "/api/watchtower/sample" ? o.address : null);
  const head = "NIGHTSHIFT update (automated): ";
  const body = cleanOutgoing(o.text, Math.max(0, 300 - head.length - link.length - 1));
  if (body.length < 10) return null;
  const text = `${head}${body}\n${link}`;
  if (!linksOk(text, 1)) return null;
  return { text, link };
}
