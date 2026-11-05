import { deriveDbcPoolAddress, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { cleanText, type ConfigView, DBC_PROGRAM, type Holder, METAPLEX, type MintView, type PoolView, type SolChain, WSOL } from "./sol-launch.js";

/**
 * The live Solana reads for the launchpad, through Meteora's DBC SDK. The free public RPC answers at
 * most 10 accounts per call and refuses program-wide scans, so pools are read in chunks of 10 and new
 * launches are found from the config key's own signatures, not with getProgramAccounts.
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
    async newLaunches(config, since) {
      const sigs = await conn.getSignaturesForAddress(new PublicKey(config), since ? { until: since, limit: 20 } : { limit: 20 });
      const mints: { mint: string; signature: string; at: number }[] = [];
      for (const s of sigs.filter((x) => !x.err).reverse()) {
        const t = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
        if (!t || !(t.meta?.logMessages ?? []).some((l) => /Instruction: InitializeVirtualPoolWith/i.test(l))) continue;
        const keys = t.transaction.message.staticAccountKeys;
        for (let i = 0; i < keys.length; i += 10) {
          const infos = await conn.getMultipleAccountsInfo(keys.slice(i, i + 10));
          const hit = infos.findIndex((inf) => inf?.owner.equals(DBC) && inf.data.length === 424);
          if (hit >= 0) { const p = decodePool(keys[i + hit]!.toBase58(), infos[hit]!.data); if (p && p.config === config) mints.push({ mint: p.baseMint, signature: s.signature, at: (s.blockTime ?? 0) * 1000 }); break; }
        }
      }
      return { newest: sigs[0]?.signature ?? since, mints };
    },
    async onchainMeta(mint) {
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), new PublicKey(METAPLEX).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(METAPLEX));
      const info = await conn.getAccountInfo(pda);
      return info ? parseMetaplex(info.data) : null;
    },
    async paidTo(signature, account) {
      const t = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!t?.meta || t.meta.err) return 0n;
      const keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }).keySegments().flat();
      const i = keys.findIndex((k) => k.toBase58() === account);
      if (i < 0) return 0n;
      const d = BigInt(t.meta.postBalances[i] ?? 0) - BigInt(t.meta.preBalances[i] ?? 0);
      return d > 0n ? d : 0n;
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

/** Name, symbol and uri from a Metaplex metadata account (key, update authority, mint, then three borsh strings). */
export function parseMetaplex(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    let o = 1 + 32 + 32;
    // names from the chain are anyone's: control and bidi characters out, the ticker letters and digits only
    const str = () => { const n = data.readUInt32LE(o); o += 4; const s = cleanText(data.subarray(o, o + n).toString("utf8")).trim(); o += n; return s; };
    const name = str(), symbol = str(), uri = str();
    return name ? { name: name.slice(0, 32), symbol: symbol.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 10), uri: uri.slice(0, 200) } : null;
  } catch { return null; }
}

/** The creator's locked allocation from a config's locked vesting (amount per period x periods + the cliff unlock). */
export function lockOf(v: Record<string, { toString(): string }> | undefined): { devLocked: bigint; devCliffSecs: number; devPeriods: number; devPeriodSecs: number } {
  if (!v) return { devLocked: 0n, devCliffSecs: 0, devPeriods: 0, devPeriodSecs: 0 };
  const n = (k: string) => BigInt(v[k]?.toString() ?? "0");
  const periods = n("numberOfPeriod");
  return { devLocked: n("amountPerPeriod") * periods + n("cliffUnlockAmount"), devCliffSecs: Number(n("cliffDurationFromMigrationTime")), devPeriods: Number(periods), devPeriodSecs: Number(n("frequency")) };
}
