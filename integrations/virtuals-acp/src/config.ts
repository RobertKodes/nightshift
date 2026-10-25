// Everything a human must provide from OUTSIDE this repo is read from env here.
// No secret is stored in code; you set the values in your own environment.
export interface AcpConfig {
  /** Name of the offering you registered on the ACP Service Registry (must match exactly). */
  offeringName: string;
  /** Budget the provider asks for per job, in USDC. */
  priceUsd: number;
  /** NIGHTSHIFT API base. */
  nightshiftBase: string;
  /** Wallet details from app.virtuals.io (Signers tab). Only provider.ts needs them, not the tests. */
  walletAddress?: string;
  walletId?: string;
  signerPrivateKey?: string;
  builderCode?: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AcpConfig {
  return {
    offeringName: env.NIGHTSHIFT_ACP_OFFERING ?? "Token Verdict Preview",
    priceUsd: Number(env.NIGHTSHIFT_ACP_PRICE_USD ?? "0.01"),
    nightshiftBase: env.NIGHTSHIFT_BASE ?? "https://getnightshift.tech",
    walletAddress: env.ACP_WALLET_ADDRESS,
    walletId: env.ACP_WALLET_ID,
    signerPrivateKey: env.ACP_SIGNER_PRIVATE_KEY,
    builderCode: env.ACP_BUILDER_CODE,
  };
}
