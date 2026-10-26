// A BOUNDED paid call. It refuses to run unless you give BOTH:
//   --max-usd <number>        the most you accept to pay for this one call
//   NIGHTSHIFT_PRIVATE_KEY    a throwaway wallet key you put in your own env (USDC on Base)
// It always prints the exact price and terms first. If the price is above --max-usd it stops
// before anything is signed. With --dry-run it stops after printing (nothing is signed or sent).
//
// Usage:
//   NIGHTSHIFT_PRIVATE_KEY=0x… node paid.ts --max-usd 0.05 --dry-run
//   NIGHTSHIFT_PRIVATE_KEY=0x… node paid.ts --max-usd 0.05 [url]
// Default url is the $0.01 quick token verdict for USDT.
import { NightshiftClient, NightshiftError, PriceExceedsMaxError } from "../../integrations/nightshift-client/dist/index.js";
import type { PaymentRequirement } from "../../integrations/nightshift-client/dist/index.js";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const maxIdx = args.indexOf("--max-usd");
const maxUsd = maxIdx >= 0 ? Number(args[maxIdx + 1]) : NaN;
const url = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--max-usd")[0]
  ?? "https://getnightshift.tech/api/v1/verdict/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7?depth=quick";
const key = process.env.NIGHTSHIFT_PRIVATE_KEY;

if (!(maxUsd > 0)) { console.error("Refusing to run: pass --max-usd <positive number>."); process.exit(2); }
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) { console.error("Refusing to run: set NIGHTSHIFT_PRIVATE_KEY (0x + 64 hex) in your environment."); process.exit(2); }

// The signer: the official x402 EVM scheme builds the EIP-3009 authorization and signs it locally.
const account = privateKeyToAccount(key as `0x${string}`);
const x402 = new x402Client().register("eip155:8453", new ExactEvmScheme(toClientEvmSigner(account)));
const sign = async (req: PaymentRequirement, ctx: { resource?: unknown; x402Version: number }) => {
  const payload = await x402.createPaymentPayload({ x402Version: ctx.x402Version, resource: ctx.resource, accepts: [req] } as never);
  return encodePaymentSignatureHeader(payload);
};

class Done extends Error {}
const c = new NightshiftClient();
try {
  const t = await c.getTerms(url);
  if (!t) { console.log("That URL is not paywalled; nothing to pay."); throw new Done(); }
  console.log(`Price: $${t.priceUsd}  (max you allowed: $${maxUsd})`);
  console.log("Terms:", JSON.stringify(t.requirement, null, 2));
  console.log("Paying wallet:", account.address);
  if (flag("--dry-run")) { console.log("Dry run: stopping before signing."); throw new Done(); }
  const result = await c.paidGet(url, { maxUsd, sign });
  console.log(JSON.stringify(result, null, 2).slice(0, 2000));
} catch (e) {
  if (e instanceof Done) { /* normal early exit */ }
  else if (e instanceof PriceExceedsMaxError) console.error(`Stopped, nothing signed: ${e.message}`);
  else if (e instanceof NightshiftError) console.error(`NIGHTSHIFT said HTTP ${e.status}: ${e.message}`);
  else throw e;
  if (!(e instanceof Done)) process.exitCode = 1;
}
