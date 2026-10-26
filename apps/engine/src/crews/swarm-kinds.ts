export const SWARM_KINDS = ["website", "research", "audit", "contract", "tests", "review", "frontend", "image", "logo"] as const;
export type SwarmKind = typeof SWARM_KINDS[number];
export type SwarmInput = { commit?: string | null; chain?: string | null; address?: string | null; name?: string | null; style?: string | null };
export const SWARM_PITCH = "Use when an agent needs work an LLM call cannot do alone: hire the IMD swarm, 1,000+ AI agents on Claude Code and Codex, to build a website, write a sourced research report, audit Solidity with 4 specialists and a judge, or build contracts, tests, frontends and images. Submissions are verified; receipts on Ethereum. Pay USDC on Base, no IMD needed. Get a free checked quote first. If a job fails, the desk records a refund owed.";
export const SWARM_SKILLS: Record<SwarmKind, string> = { website: "build-website", research: "research-report", audit: "audit", contract: "build-contract-project", tests: "write-foundry-tests", review: "adversarial-review", frontend: "frontend-for-contract", image: "create-image", logo: "token-logo" };
export const SWARM_OUTPUTS: Record<SwarmKind, string> = {
  website: "A static website, with the delivered files and site link when hosted.", research: "A sourced Markdown report, requesting at least five citations.",
  audit: "A Solidity audit by four specialists and a judge, with findings and source references.", contract: "Solidity source, Foundry tests and README; no deployment.",
  tests: "Foundry tests for the pinned public repository commit.", review: "An adversarial review of the public repository, with findings and fixes.",
  frontend: "A frontend for the verified Ethereum or Base contract.", image: "An image from the prompt, in the delivered artifacts.", logo: "A logo from the name and style, in the delivered artifacts.",
};
const bad = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };

export function publicRepo(raw: string | null): string {
  let url: URL; try { url = new URL(raw ?? ""); } catch { return bad("repo: a public https://github.com/owner/repo URL."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.hash || url.search || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) bad("repo: a public https://github.com/owner/repo URL.");
  return url.href.replace(/\/$/, "");
}

/** Build the exact body sent to IMD's free check and then job.open. */
export function swarmBody(kind: string | null, brief: string | null, repo: string | null, id: string, extra: SwarmInput = {}): { kind: SwarmKind; body: Record<string, unknown> } {
  if (!(SWARM_KINDS as readonly string[]).includes(kind ?? "")) bad(`kind: ${SWARM_KINDS.join(", ")}.`);
  const k = kind as SwarmKind, text = (brief ?? "").trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || text.length > 1500 || (k !== "logo" && text.length < 20)) bad("brief: 20 to 1500 characters (logo uses name and style).");
  const usesRepo = ["audit", "tests", "review"].includes(k);
  if (!usesRepo && repo) bad("repo is only used for audit, tests or review.");
  if (k !== "frontend" && (extra.address || extra.chain)) bad("address and chain are only used for frontend.");
  if (k !== "logo" && (extra.name || extra.style)) bad("name and style are only used for logo.");
  if (!usesRepo && extra.commit) bad("commit is only used for repository work.");
  const repoUrl = usesRepo ? publicRepo(repo) : undefined, commit = extra.commit?.trim();
  if ((k === "tests" && !commit) || (commit && !/^[\da-f]{40}$/i.test(commit))) bad("commit: a full 40-character Git commit hash (required for tests).");
  const source = { repoUrl, ...(commit ? { baseCommit: commit.toLowerCase() } : {}) };
  let body: Record<string, unknown>;
  switch (k) {
    case "website": body = { objective: `Build a static website. ${text} Static, runs in the browser, no wallet, no backend. Clean, fast, works on a phone.`, skill: SWARM_SKILLS[k], ipfs: `ns-swarm-${id.slice(0, 18)}`, github: false }; break;
    case "research": body = { objective: text, skill: SWARM_SKILLS[k], outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }], minCitations: 5, github: false }; break;
    case "audit": body = { objective: `Audit the Solidity contracts in this public repository. ${text} Rank findings by severity with source references and concrete fixes.`, template: "audit", ...source }; break;
    case "contract": body = { objective: `Build a small Solidity contract with Foundry tests and a README. ${text} Deliver source and passing tests; do not deploy or send transactions.`, shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], github: true }; break;
    case "tests": body = { objective: `Write Foundry tests for exactly commit ${commit}. ${text} Do not deploy.`, skill: SWARM_SKILLS[k], ...source, github: true }; break;
    case "review": body = { objective: `Adversarial code review. ${text} Deliver concrete findings with file references and fixes; do not deploy.`, skill: SWARM_SKILLS[k], ...source, github: false }; break;
    case "frontend": {
      if (!/^0x[\da-f]{40}$/i.test(extra.address ?? "") || !["ethereum", "base"].includes(extra.chain ?? "")) bad("frontend requires a contract address and chain: ethereum or base.");
      body = { objective: `Build a frontend for the verified contract ${extra.address!.toLowerCase()} on ${extra.chain}. ${text}`, skill: SWARM_SKILLS[k], chainId: extra.chain === "ethereum" ? 1 : 8453, contractAddress: extra.address!.toLowerCase(), ipfs: `ns-swarm-${id.slice(0, 18)}`, github: false }; break;
    }
    case "image": body = { objective: text, skill: SWARM_SKILLS[k], outputs: [{ name: "image", path: "artifacts/image.png", mediaType: "image/png" }], github: false }; break;
    case "logo": {
      const name = extra.name?.trim() ?? "", style = extra.style?.trim() ?? "";
      if (name.length < 1 || name.length > 80 || style.length < 3 || style.length > 300 || /[\u0000-\u001f\u007f]/.test(name + style)) bad("logo requires name (1–80 characters) and style (3–300 characters).");
      body = { objective: `Create a logo for ${name}. Style: ${style}. ${text}`.trim(), skill: SWARM_SKILLS[k], outputs: [{ name: "logo", path: "artifacts/logo.png", mediaType: "image/png" }], github: false }; break;
    }
  }
  return { kind: k, body };
}
