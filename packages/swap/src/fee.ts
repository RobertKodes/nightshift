import { isEvmAddress } from "./addr.js";

/** NIGHTSHIFT's fee is at most 1% whatever the setting says. */
export const MAX_FEE_BPS = 100;
export const DEFAULT_FEE_BPS = 25;
export const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export type FeeDecision = {
  /** The NIGHTSHIFT fee every quote in this answer is asked with, in basis points of the input. */
  bps: number;
  waived: boolean;
  /** holder: signed in with a NIGHT FROG or Night Watcher; sign-in: the wallet holds one but this session is not it. */
  reason: "holder" | "sign-in" | "standard" | "off";
  note: string;
  /** The wallet asked about holds a NIGHT FROG or Night Watcher (public onchain fact). */
  holds: boolean;
  /** The signed-in wallet, lowercase, or null. */
  signedIn: string | null;
};

/**
 * Who pays NIGHTSHIFT's swap fee. A quote is only a request, and anyone may ask one for a holder's address and
 * sign it from another wallet, so the waiver follows the signed-in session (the wallet proved by its signature),
 * never an address in the request. It then covers every chain that holder swaps from.
 */
export function decideFee(o: { baseBps: number; session: string | null; sessionHolds: boolean; wallet?: string | null; walletHolds?: boolean }): FeeDecision {
  const base = Math.min(MAX_FEE_BPS, Math.max(0, Math.floor(Number.isFinite(o.baseBps) ? o.baseBps : 0)));
  const signedIn = o.session ? o.session.toLowerCase() : null;
  const holds = Boolean(o.wallet ? o.walletHolds : o.sessionHolds);
  if (base === 0) return { bps: 0, waived: false, reason: "off", note: "No NIGHTSHIFT fee on swaps.", holds, signedIn };
  if (signedIn && o.sessionHolds) return { bps: 0, waived: true, reason: "holder", note: "No NIGHTSHIFT fee: you hold a NIGHT FROG, a Night Watcher or 5M+ $SHIFT.", holds: true, signedIn };
  if (holds && o.wallet && o.wallet.toLowerCase() !== signedIn) return { bps: base, waived: false, reason: "sign-in", note: `This wallet holds a NIGHT FROG, a Night Watcher or 5M+ $SHIFT: sign in with it and the NIGHTSHIFT fee (${pct(base)}) is waived.`, holds, signedIn };
  return { bps: base, waived: false, reason: "standard", note: `NIGHTSHIFT fee ${pct(base)}. Holders of a NIGHT FROG, a Night Watcher or 5M+ $SHIFT pay none.`, holds, signedIn };
}

export type Provider = "lifi" | "relay";
export type ProviderFeeConfig = { lifiIntegrator: string; feeWallet: string };

/**
 * The fee one provider's quote is asked with: LI.FI collects only for an integrator registered on portal.li.fi
 * with a fee wallet (it refuses the quote otherwise, error 1011); Relay needs an EVM claim address.
 */
export function providerFee(p: Provider, d: FeeDecision, cfg: ProviderFeeConfig): { bps: number; off?: string } {
  if (d.bps <= 0) return { bps: 0 };
  if (p === "lifi" && !cfg.lifiIntegrator.trim()) return { bps: 0, off: "not collected on LI.FI routes yet (integration not registered)" };
  if (p === "relay" && !isEvmAddress(cfg.feeWallet)) return { bps: 0, off: "not collected on Relay routes (no fee wallet set)" };
  return { bps: d.bps };
}
