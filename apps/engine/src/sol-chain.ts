import { deriveDbcPoolAddress, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { type ConfigView, DBC_PROGRAM, type Holder, type MintView, type PoolView, type SolChain, WSOL } from "./sol-launch.js";

/**
 * The live Solana reads and sends for the launchpad, through Meteora's DBC SDK. The free public RPC
 * answers at most 10 accounts per call and refuses program-wide scans, so pools are read in chunks of 10.
 */
export function liveSolChain(rpc: string): SolChain {
  const conn = new Connection(rpc, "confirmed");
  const client = new DynamicBondingCurveClient(conn, "confirmed");
  const coder = client.program.coder.accounts;
  const DBC = new PublicKey(DBC_PROGRAM);
  const pk = (k: PublicKey | string) => (typeof k === "string" ? k : k.toBase58());
  // the free public RPC refuses indexed reads (largest holders): asked once, then left to a keyed RPC
  let indexedRefused = false;

  const toPool = (address: string, raw: { poolState: Record<string, any> }): PoolView => {
    const s = raw.poolState;
    return {
      pool: address, config: pk(s.config), creator: pk(s.creator), baseMint: pk(s.baseMint), baseVault: pk(s.baseVault),
      quoteReserve: BigInt(s.quoteReserve.toString()), sqrtPrice: BigInt(s.sqrtPrice.toString()), migrated: Number(s.isMigrated) !== 0,
      activationPoint: Number(s.activationPoint.toString()),
    };
  };
  const decodePool = (address: string, data: Buffer | null | undefined): PoolView | null => {
    if (!data) return null;
    try { return toPool(address, coder.decode("virtualPool", data) as never); } catch { return null; }
  };
  const why = (logs: string[] | null | undefined, err: unknown) =>
    ([...(logs ?? [])].reverse().find((l) => /Error|insufficient|failed/i.test(l)) ?? JSON.stringify(err)).replace(/^Program log: /, "").slice(0, 160);

  return {
    async poolOf(config, mint) {
      const address = deriveDbcPoolAddress(new PublicKey(WSOL), new PublicKey(mint), new PublicKey(config));
      const info = await conn.getAccountInfo(address);
      if (!info || !info.owner.equals(DBC)) return null;
      return decodePool(address.toBase58(), info.data);
    },
    async pools(addresses) {
      const out: (PoolView | null)[] = [];
      for (let i = 0; i < addresses.length; i += 10) {
        const chunk = addresses.slice(i, i + 10);
        const infos = await conn.getMultipleAccountsInfo(chunk.map((a) => new PublicKey(a)));
        infos.forEach((inf, j) => out.push(inf && inf.owner.equals(DBC) ? decodePool(chunk[j]!, inf.data) : null));
      }
      return out;
    },
    async config(config) {
      const c = await client.state.getPoolConfig(config).catch(() => null) as Record<string, any> | null;
      if (!c) return null;
      return {
        config, feeClaimer: pk(c.feeClaimer), leftoverReceiver: pk(c.leftoverReceiver), quoteMint: pk(c.quoteMint), threshold: BigInt(c.migrationQuoteThreshold.toString()),
        tokenDecimal: Number(c.tokenDecimal), supply: BigInt(c.postMigrationTokenSupply?.toString?.() ?? c.preMigrationTokenSupply?.toString?.() ?? "0"),
        tokenUpdateAuthority: Number(c.tokenUpdateAuthority), creatorFeePct: Number(c.creatorTradingFeePercentage),
        partnerLockedPct: Number(c.partnerPermanentLockedLiquidityPercentage), creatorLockedPct: Number(c.creatorPermanentLockedLiquidityPercentage),
        partnerLpPct: Number(c.partnerLiquidityPercentage), creatorLpPct: Number(c.creatorLiquidityPercentage), migrationOption: Number(c.migrationOption),
        cliffFeeNumerator: BigInt(c.poolFees?.baseFee?.cliffFeeNumerator?.toString?.() ?? "0"), poolCreationFee: BigInt(c.poolCreationFee?.toString?.() ?? "0"),
        ...lockOf(c.lockedVestingConfig),
      } satisfies ConfigView;
    },
    async mint(mint) {
      const r = await conn.getParsedAccountInfo(new PublicKey(mint));
      const p = (r.value?.data as { parsed?: { info?: Record<string, any> } } | undefined)?.parsed?.info;
      if (!p) return null;
      return { mintAuthority: p.mintAuthority ?? null, freezeAuthority: p.freezeAuthority ?? null, supply: BigInt(p.supply ?? "0"), decimals: Number(p.decimals ?? 6) } satisfies MintView;
    },
    async holders(mint) {
      if (indexedRefused) return null;
      const r = await conn.getTokenLargestAccounts(new PublicKey(mint)).catch((e: Error) => { if (/personal token|403/.test(e.message)) indexedRefused = true; throw e; });
      const accounts = r.value.slice(0, 12);
      const owners: (string | null)[] = [];
      for (let i = 0; i < accounts.length; i += 10) {
        const infos = await conn.getMultipleParsedAccounts(accounts.slice(i, i + 10).map((a) => a.address));
        for (const inf of infos.value) owners.push(((inf?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed?.info?.owner) ?? null);
      }
      return accounts.map((a, i) => ({ account: a.address.toBase58(), owner: owners[i] ?? null, amount: BigInt(a.amount) })) satisfies Holder[];
    },
    async nonce(account) {
      const n = await conn.getNonce(new PublicKey(account), "confirmed");
      return n ? { authority: n.authorizedPubkey.toBase58(), value: n.nonce } : null;
    },
    async simulate(txB64) {
      const tx = Transaction.from(Buffer.from(txB64, "base64"));
      const r = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, commitment: "confirmed" });
      return r.value.err ? { ok: false, why: why(r.value.logs, r.value.err) } : { ok: true, why: null };
    },
    async send(txB64) {
      const raw = Buffer.from(txB64, "base64");
      const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }).catch((e: Error & { logs?: string[] }) => { throw new Error(why(e.logs, e.message)); });
      // resend every few seconds until it is confirmed, fails, or two minutes pass
      for (let i = 0; i < 60; i++) {
        const s = (await conn.getSignatureStatuses([sig])).value[0];
        if (s?.err) throw new Error(`the transaction failed (${JSON.stringify(s.err).slice(0, 80)})`);
        if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
        if (i % 2 === 1) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Solana did not confirm it in two minutes");
    },
    async solUsd() {
      const j = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`, { signal: AbortSignal.timeout(8_000) }).then((r) => r.json()).catch(() => null) as Record<string, { usdPrice?: number }> | null;
      const v = j?.[WSOL]?.usdPrice;
      if (typeof v === "number" && v > 0) return v;
      const g = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(8_000) }).then((r) => r.json()).catch(() => null) as { solana?: { usd?: number } } | null;
      return g?.solana?.usd ?? null;
    },
  };
}

/** The creator's locked allocation from a config's locked vesting (amount per period x periods + the cliff unlock). */
export function lockOf(v: Record<string, { toString(): string }> | undefined): { devLocked: bigint; devCliffSecs: number; devPeriods: number; devPeriodSecs: number } {
  if (!v) return { devLocked: 0n, devCliffSecs: 0, devPeriods: 0, devPeriodSecs: 0 };
  const n = (k: string) => BigInt(v[k]?.toString() ?? "0");
  const periods = n("numberOfPeriod");
  return { devLocked: n("amountPerPeriod") * periods + n("cliffUnlockAmount"), devCliffSecs: Number(n("cliffDurationFromMigrationTime")), devPeriods: Number(periods), devPeriodSecs: Number(n("frequency")) };
}
