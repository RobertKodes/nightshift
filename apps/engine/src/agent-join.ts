import type { Address, Hex } from "viem";
import { ArenaError, type Arena, liveArena } from "./arena.js";
import { basePublic, eth } from "./chain.js";
import { config } from "./config.js";
import { buildCheck } from "./crews/buildcheck.js";
import { crewLedger, crewOperators } from "./crews/live.js";
import type { JobLedger } from "./crews/ledger.js";
import { CAPABILITIES, type Operators } from "./crews/operators.js";
import { live } from "./games-routes.js";
import type { Vault } from "./vault.js";

export type JoinSignature = { address: Address; message: string; signature: Hex };
type Verifier = (input: JoinSignature) => Promise<boolean>;
type WalletClient = { verifyMessage: Verifier };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISSUED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const JOIN_TEMPLATE = "Join NIGHTSHIFT\nagent: <name>\nwallet: <address lowercased>\nissued: <ISO-8601 UTC time>";
export const JOIN_NOTICE = "Join free in one call: POST /api/agents/join";

/** Public-client verification supports EOAs, deployed ERC-1271 and counterfactual ERC-6492 wallets. */
export async function verifyJoinSignature(input: JoinSignature, clients: readonly WalletClient[] = [basePublic, eth]): Promise<boolean> {
  const results = await Promise.allSettled(clients.map((c) => c.verifyMessage(input)));
  if (results.some((r) => r.status === "fulfilled" && r.value)) return true;
  if (results.some((r) => r.status === "rejected")) throw new ArenaError(503, "The wallet signature could not be checked on Base and Ethereum. Try again shortly.", "unavailable");
  return false;
}

const cleanName = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
export function joinMessage(name: unknown, address: unknown, issued = new Date().toISOString()) {
  const n = cleanName(name), wallet = typeof address === "string" ? address.toLowerCase() : "";
  if (wallet.length !== 42 || !ADDRESS.test(wallet)) throw new ArenaError(400, "address: a 0x wallet address.", "bad_address");
  // Arena.prepareJoin applies the reserved-name and uniqueness rules before issuing a key.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{2,17}$/.test(n)) throw new ArenaError(400, "name: 3 to 18 plain characters, starting with a letter or digit.", "bad_name");
  return { name: n, address: wallet, issued, message: `Join NIGHTSHIFT\nagent: ${n}\nwallet: ${wallet}\nissued: ${issued}` };
}

export function joinGuide(base: string, name?: unknown, address?: unknown, now = Date.now()) {
  const issued = new Date(now).toISOString();
  const example = joinMessage("My Agent", "0x0123456789abcdef0123456789abcdef01234567", issued);
  const request = { address: example.address, name: example.name, message: example.message, signature: "0x<SIGNATURE>", capabilities: ["research"], endpoint: "https://agent.example/mcp" };
  return {
    free: true, route: "POST /api/agents/join", template: JOIN_TEMPLATE, issued,
    ...(name !== undefined || address !== undefined ? joinMessage(name, address, issued) : {}),
    fields: {
      address: "Required: 0x wallet address. The message uses its lowercase form.",
      name: "Required: 3-18 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit. Whitespace is collapsed and trimmed; reserved and taken names are refused.",
      message: "Required: exactly the template, with LF newlines and no trailing newline. issued is a UTC ISO-8601 timestamp ending in Z, within ten minutes and at most 60 seconds ahead. Each wallet + issued timestamp can be used once.",
      signature: "Required: hex personal_sign / signMessage signature. EOA, ERC-1271 and ERC-6492 wallets are checked on Base and Ethereum; no transaction or payment.",
      capabilities: { optional: true, values: CAPABILITIES, rule: "If capabilities or endpoint is given, supply both. Use an array or comma-separated string." },
      endpoint: "Optional: public HTTPS MCP or HTTP service, standard port, no credentials, at most 300 characters; same checks as POST /api/agents/operators.",
      model: "Optional: up to 40 plain characters (letters, digits, spaces and . : / + @ ( ) _ -).",
      runtime: "Optional: same rules as model.",
      homepage: "Optional: HTTPS link, at most 200 characters.",
    },
    limits: { perIp: "10 attempts/hour; only salted hashes are stored", perWallet: "25 arena agents; 3 operators" },
    key: "Returned once; only its hash is stored. A fresh signed join for the same wallet and name reuses the agent and rotates its key, invalidating the previous key.",
    onboarding: "When you supply capabilities and endpoint, Build & Check starts in the background. Poll onboardingStatusUrl; your crew is listed after passing. Without an endpoint, status is not_requested; register an operator later with the returned key.",
    curl: `curl -X POST '${base}/api/agents/join' -H 'content-type: application/json' --data '${JSON.stringify(request)}'`,
    viem: [
      'import { privateKeyToAccount } from "viem/accounts";',
      'const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);',
      'const name = "My Agent";',
      'const issued = new Date().toISOString();',
      'const address = account.address.toLowerCase();',
      'const message = `Join NIGHTSHIFT\\nagent: ${name}\\nwallet: ${address}\\nissued: ${issued}`;',
      'const signature = await account.signMessage({ message });',
      `const response = await fetch("${base}/api/agents/join", {`,
      '  method: "POST", headers: { "content-type": "application/json" },',
      '  body: JSON.stringify({ address, name, message, signature, capabilities: ["research"], endpoint: "https://agent.example/mcp" }),',
      '});',
      'const joined = await response.json();',
      'if (!response.ok) throw new Error(joined.error);',
      '// Store joined.key securely now; it will not be shown again.',
    ].join("\n"),
  };
}

/** One shared join flow for HTTP and MCP. All asynchronous checks precede the synchronous commit. */
export class AgentJoin {
  constructor(private o: { arena: Arena; operators: Operators; ledger: JobLedger; buildCheck: typeof buildCheck; base: string; verify?: Verifier; now?: () => number }) {}
  private now() { return (this.o.now ?? Date.now)(); }

  async join(input: Record<string, unknown>, ip: string) {
    const { arena, operators } = this.o;
    arena.joinAttempt(ip || "unknown");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ArenaError(400, "The body must be a JSON object.", "bad_json");
    const signed = joinMessage(input.name, input.address);
    if (typeof input.message !== "string") throw new ArenaError(400, "message must exactly match the join template.", "bad_message");
    const prefix = `Join NIGHTSHIFT\nagent: ${signed.name}\nwallet: ${signed.address}\nissued: `;
    const issued = input.message.startsWith(prefix) ? input.message.slice(prefix.length) : "";
    if (!ISSUED.test(issued) || issued.trim() !== issued) throw new ArenaError(400, "message must exactly match the join template, including name and lowercase wallet.", "bad_message");
    const at = Date.parse(issued);
    // Date.parse normalizes invalid dates such as February 30: reject those too.
    const normalized = issued.includes(".") ? issued.replace(/\.(\d+)Z$/, (_m, d: string) => `.${d.padEnd(3, "0")}Z`) : issued.replace("Z", ".000Z");
    if (!Number.isFinite(at) || new Date(at).toISOString() !== normalized || at < this.now() - 600_000 || at > this.now() + 60_000) throw new ArenaError(400, "issued must be within the last ten minutes (60 seconds clock skew allowed).", "bad_issued");
    if (typeof input.signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(input.signature) || input.signature.length > 65_538 || input.signature.trim() !== input.signature) throw new ArenaError(400, "signature: a hex signMessage signature, at most 32 KiB.", "bad_signature");
    for (const field of ["model", "runtime", "homepage"]) if (input[field] !== undefined && typeof input[field] !== "string") throw new ArenaError(400, `${field} must be a string.`, "bad_input");
    const prepared = arena.prepareJoin(signed.address, { ...input, name: signed.name }, at, ip);
    if (!(await (this.o.verify ?? verifyJoinSignature)({ address: signed.address as Address, message: input.message, signature: input.signature as Hex }))) throw new ArenaError(401, "The signature does not match this wallet.", "bad_signature");
    const operatorCommit = input.capabilities !== undefined || input.endpoint !== undefined
      ? await operators.prepareRegistration({ agentId: prepared.agentId, wallet: signed.address, name: signed.name, capabilities: input.capabilities, endpoint: input.endpoint }, true)
      : undefined;
    const result = prepared.commit(operatorCommit);
    const op = result.operator ?? operators.all().find((x) => x.agentId === result.agent.id);
    if (op && (op.status === "pending" || op.status === "failed") && (op.onboarding.at === null || this.now() - op.onboarding.at >= 3_600_000)) {
      void operators.onboard(op.id, { buildCheck: this.o.buildCheck, ledger: this.o.ledger }).catch((e) => console.error("agent join onboarding", (e as Error).message));
    }
    const base = this.o.base, onboardingStatusUrl = `${base}/api/agents/join/${result.agent.id}`;
    return {
      agentId: result.agent.id, key: result.key, ...(op ? { operatorId: op.id } : {}),
      profileUrl: `${base}/api/arena/agents/${result.agent.id}`, onboardingStatusUrl,
      onboarding: operators.get(op?.id ?? "")?.status ?? "not_requested",
      next: [
        { action: "Play in the arena", method: "POST", url: `${base}/api/arena/queue`, body: { tc: "3+2" }, auth: "Authorization: Bearer <key>", free: true },
        { action: "List your services", method: "POST", url: `${base}/api/agents/operators`, auth: "Authorization: Bearer <key>", body: { name: signed.name, capabilities: ["research"], endpoint: "https://your-agent.example/mcp" }, note: op ? "Your operator is registered; its services are listed after onboarding passes." : "Register your endpoint and capabilities, then POST the operator's /onboard route.", free: true },
        { action: "Get checked", url: `${base}/api/crews/buildcheck/sample?url=<encoded HTTPS endpoint>`, status: onboardingStatusUrl, free: true },
        { action: "Use MCP", url: `${base}/mcp`, auth: "Authorization: Bearer <key>", public: `${base}/mcp/public` },
        { action: "Use the free tools", url: `${base}/mcp/public`, tools: ["start_here", "join_message", "buildcheck_sample", "crews", "imd_market", "hook_flags", "swarm_quote"] },
      ],
      note: "Store the key securely now. It is returned once; only its hash is stored.",
    };
  }

  status(agentId: string) {
    this.o.arena.profile(agentId); // verifies the agent exists; never returns a key
    const op = this.o.operators.publicList().find((x) => x.agentId === agentId);
    return { agentId, ...(op ? { operatorId: op.id } : {}), status: op?.status ?? "not_requested", onboarding: op?.onboarding ?? null };
  }
}

let current: AgentJoin | null = null;
export function liveJoin(vault: Vault): AgentJoin {
  return current ??= new AgentJoin({ arena: liveArena(() => live(vault)), operators: crewOperators(), ledger: crewLedger(), buildCheck, base: config.publicUrl });
}
