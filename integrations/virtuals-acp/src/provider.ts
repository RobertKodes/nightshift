// Starts the provider. This is the ONLY file that needs real wallet credentials.
// It will not start until the registration steps in README.md are done.
import { AcpAgent, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import { loadConfig } from "./config.ts";
import { makeEntryHandler } from "./handler.ts";

const cfg = loadConfig();
if (!cfg.walletAddress || !cfg.walletId || !cfg.signerPrivateKey) {
  console.error("Missing ACP_WALLET_ADDRESS / ACP_WALLET_ID / ACP_SIGNER_PRIVATE_KEY. See README.md (external steps).");
  process.exit(1);
}
const agent = await AcpAgent.create({
  provider: await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress: cfg.walletAddress as `0x${string}`,
    walletId: cfg.walletId,
    signerPrivateKey: cfg.signerPrivateKey,
    chains: [base],
    builderCode: cfg.builderCode,
  }),
});
agent.on("entry", makeEntryHandler(cfg));
await agent.start(() => console.log(`NIGHTSHIFT ACP provider listening (offering "${cfg.offeringName}")`));
