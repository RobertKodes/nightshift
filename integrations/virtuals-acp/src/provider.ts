// Starts the provider. This is the ONLY file that needs real wallet credentials.
// It will not start until the registration steps in README.md are done.
import { AcpAgent, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import { loadConfig } from "./config.ts";
import { makePaidEntryHandler } from "./paid-entry.ts";
import { x402Signer } from "./x402.ts";
import { makeEntryHandler } from "./handler.ts";

const cfg = loadConfig();
if (!cfg.walletAddress || !cfg.walletId || !cfg.signerPrivateKey) {
  console.error("Missing ACP_WALLET_ADDRESS / ACP_WALLET_ID / ACP_SIGNER_PRIVATE_KEY. See README.md (external steps).");
  process.exit(1);
}
if (cfg.offeringName !== "Token Verdict Preview" && !cfg.x402PrivateKey) throw new Error("Set NIGHTSHIFT_X402_PRIVATE_KEY to a separately funded Base USDC wallet for paid offerings.");
const agent = await AcpAgent.create({
  evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress: cfg.walletAddress as `0x${string}`,
    walletId: cfg.walletId,
    signerPrivateKey: cfg.signerPrivateKey,
    chains: [base],
    builderCode: cfg.builderCode,
  }),
});
const handler = cfg.offeringName === "Token Verdict Preview" ? makeEntryHandler(cfg) : makePaidEntryHandler(cfg, { sign: x402Signer(cfg.x402PrivateKey!) });
agent.on("entry", handler);
await agent.start(() => console.log(`NIGHTSHIFT ACP provider listening (offering "${cfg.offeringName}")`));

// Hydration may end on a chat entry, so resume the saved funded event explicitly.
const resume = () => {
  for (const session of agent.sessions) {
    if (session.status !== "funded" || !session.roles.includes("provider")) continue;
    const funded = session.entries.findLast((entry) => entry.kind === "system" && entry.event.type === "job.funded");
    if (funded) void handler(session, funded).catch((e) => console.error("ACP resume:", (e as Error).message));
  }
};
resume();
setInterval(resume, 60_000);
