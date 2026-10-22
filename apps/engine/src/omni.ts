import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Read-only status of a pump.fun coin for the Omni launchpad (docs/launchpad/OMNI.md, 5): its mint's authorities, its
 * bonding curve (graduated or not, how much of the curve is sold) and, after graduation, its canonical PumpSwap pool
 * and the pool's price. Public Solana JSON-RPC only; no key, no signing, nothing stored. The account layouts were
 * read from real mainnet accounts on 2026-10-22 (see src/fixtures/omni): the curve is 166 bytes, the PumpSwap pool 301.
 */
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL = "So11111111111111111111111111111111111111112";
const CURVE_DISC = "17b7f83760d8ac60";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
export function b58encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) { s = ALPHABET[Number(n % 58n)]! + s; n /= 58n; }
  for (const x of b) { if (x === 0) s = "1" + s; else break; }
  return s;
}
export const isSolAddress = (s: string) => { try { return b58decode(s).length === 32 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); } catch { return false; } };

const P = 2n ** 255n - 19n;
const D = (-121665n * modPow(121666n, P - 2n, P)) % P;
function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m; if (b < 0n) b += m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
/** Whether 32 bytes decode to a point on the ed25519 curve (a program derived address must not). */
export function onCurve(b: Uint8Array): boolean {
  const c = Uint8Array.from(b); c[31]! &= 0x7f;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(c[i]!);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const num = (y2 - 1n + P) % P, den = (D * y2 + 1n) % P;
  const x2 = (num * modPow(den, P - 2n, P)) % P;
  return x2 === 0n || modPow(x2, (P - 1n) / 2n, P) === 1n;
}
/** findProgramAddress: the first bump from 255 down whose hash is off the curve. */
export function pda(seeds: Uint8Array[], program: string): string {
  const prog = b58decode(program);
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Uint8Array.of(bump)); h.update(prog); h.update("ProgramDerivedAddress");
    const out = Uint8Array.from(h.digest());
    if (!onCurve(out)) return b58encode(out);
  }
  throw new Error("no bump");
}
const utf8 = (s: string) => new TextEncoder().encode(s);
export const curveOf = (mint: string) => pda([utf8("bonding-curve"), b58decode(mint)], PUMP_PROGRAM);
/** The canonical PumpSwap pool the Pump program's migrate instruction creates (index 0, creator = pump's pool-authority PDA, quote = wrapped SOL). */
export function poolOf(mint: string): string {
  const creator = pda([utf8("pool-authority"), b58decode(mint)], PUMP_PROGRAM);
  return pda([utf8("pool"), Uint8Array.of(0, 0), b58decode(creator), b58decode(mint), b58decode(WSOL)], PUMPSWAP_PROGRAM);
}

export type Curve = { virtualTokens: bigint; virtualSol: bigint; realTokens: bigint; realSol: bigint; supply: bigint; complete: boolean; creator: string };
/** The pump.fun bonding curve account: 8-byte discriminator, five u64, bool complete at offset 48, creator at 49. */
export function decodeCurve(data: Uint8Array): Curve | null {
  if (data.length < 81) return null;
  if (Buffer.from(data.subarray(0, 8)).toString("hex") !== CURVE_DISC) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { virtualTokens: v.getBigUint64(8, true), virtualSol: v.getBigUint64(16, true), realTokens: v.getBigUint64(24, true), realSol: v.getBigUint64(32, true), supply: v.getBigUint64(40, true), complete: data[48] === 1, creator: b58encode(data.subarray(49, 81)) };
}
export type Pool = { creator: string; baseMint: string; quoteMint: string; lpMint: string; baseVault: string; quoteVault: string };
/** The PumpSwap pool account: 8-byte discriminator, bump u8, index u16, then six 32-byte keys. */
export function decodePool(data: Uint8Array): Pool | null {
  if (data.length < 11 + 32 * 6) return null;
  const k = (i: number) => b58encode(data.subarray(11 + 32 * i, 43 + 32 * i));
  return { creator: k(0), baseMint: k(1), quoteMint: k(2), lpMint: k(3), baseVault: k(4), quoteVault: k(5) };
}

export type SolRpc = (method: string, params: unknown[]) => Promise<unknown>;
type RawAcct = { owner: string; data: [string, string] | { parsed?: { info?: Record<string, unknown> } } } | null;

export type PumpStatus = {
  mint: string;
  at: number;
  /** The mint's authorities: pump.fun coins have both null (checked on mainnet 2026-10-22). */
  token: { exists: boolean; program: string | null; decimals: number | null; supply: string | null; mintAuthority: string | null; freezeAuthority: string | null; revoked: boolean };
  curve: { address: string; found: boolean; graduated: boolean; percentSold: number | null; priceSol: number | null; creator: string | null; virtualSol: string | null; realSol: string | null };
  pool: { address: string; found: boolean; baseVault: string | null; quoteVault: string | null; lpSupply: string | null; lpBurned: boolean | null; baseReserve: number | null; quoteReserveSol: number | null; priceSol: number | null; liquiditySol: number | null } | null;
  /** The venue to trade on right now. */
  venue: "curve" | "pumpswap" | "none";
  priceSol: number | null;
  notes: string[];
};

const bytesOf = (a: RawAcct): Uint8Array | null => (a && Array.isArray(a.data) ? new Uint8Array(Buffer.from(a.data[0], "base64")) : null);
const infoOf = (a: RawAcct): Record<string, unknown> | null => (a && !Array.isArray(a.data) ? a.data.parsed?.info ?? null : null);
const TOKEN_DEC = 6, SOL_DEC = 9;
/** The initial real token reserves of a pump.fun curve (793,100,000 coins): percent sold = 1 - real / initial. */
const INITIAL_REAL_TOKENS = 793_100_000_000_000n;

export function pumpService(rpc: SolRpc, now: () => number = Date.now) {
  const multi = async (keys: string[], encoding: "base64" | "jsonParsed") => {
    const r = (await rpc("getMultipleAccounts", [keys, { encoding }])) as { value?: RawAcct[] };
    return r.value ?? [];
  };
  return {
    async status(mint: string): Promise<{ status: number; body: PumpStatus | { error: string } }> {
      if (!isSolAddress(mint)) return { status: 400, body: { error: "That is not a Solana address." } };
      const curveAddr = curveOf(mint), poolAddr = poolOf(mint);
      const [mintAcct, curveAcct, poolAcct] = await multi([mint, curveAddr, poolAddr], "base64");
      // The mint, parsed (the base64 form of a Token-2022 mint is not needed: ask the node to parse it).
      const [mintParsed] = await multi([mint], "jsonParsed");
      const info = infoOf(mintParsed ?? null);
      const notes: string[] = [];
      const token: PumpStatus["token"] = {
        exists: !!mintAcct, program: mintAcct?.owner ?? null, decimals: typeof info?.decimals === "number" ? info.decimals : null,
        supply: typeof info?.supply === "string" ? info.supply : null,
        mintAuthority: (info?.mintAuthority as string | null | undefined) ?? null, freezeAuthority: (info?.freezeAuthority as string | null | undefined) ?? null, revoked: false,
      };
      token.revoked = token.exists && token.mintAuthority === null && token.freezeAuthority === null;
      if (!token.exists) notes.push("No such mint on Solana.");
      else if (!token.revoked) notes.push("This mint still has a mint or freeze authority: it is not a standard pump.fun coin, and it cannot be locked in a bridge safely.");

      const cd = bytesOf(curveAcct ?? null);
      const c = cd ? decodeCurve(cd) : null;
      const curve: PumpStatus["curve"] = {
        address: curveAddr, found: !!c, graduated: !!c?.complete, creator: c?.creator ?? null,
        percentSold: c ? Math.max(0, Math.min(100, Math.round((1 - Number(c.realTokens) / Number(INITIAL_REAL_TOKENS)) * 10000) / 100)) : null,
        priceSol: c && c.virtualTokens > 0n ? Number(c.virtualSol) / 10 ** SOL_DEC / (Number(c.virtualTokens) / 10 ** TOKEN_DEC) : null,
        virtualSol: c ? c.virtualSol.toString() : null, realSol: c ? c.realSol.toString() : null,
      };
      if (!c && token.exists) notes.push("No pump.fun bonding curve for this mint: it was not created on pump.fun.");

      let pool: PumpStatus["pool"] = null;
      const pd = bytesOf(poolAcct ?? null);
      const p = pd ? decodePool(pd) : null;
      if (c?.complete || p) {
        pool = { address: poolAddr, found: !!p, baseVault: p?.baseVault ?? null, quoteVault: p?.quoteVault ?? null, lpSupply: null, lpBurned: null, baseReserve: null, quoteReserveSol: null, priceSol: null, liquiditySol: null };
        if (p) {
          const [bv, qv, lp] = await multi([p.baseVault, p.quoteVault, p.lpMint], "jsonParsed");
          const amt = (a: RawAcct) => { const t = infoOf(a ?? null)?.tokenAmount as { amount?: string } | undefined; return t?.amount ? BigInt(t.amount) : null; };
          const b = amt(bv ?? null), q = amt(qv ?? null);
          if (b !== null && q !== null && b > 0n) {
            pool.baseReserve = Number(b) / 10 ** TOKEN_DEC; pool.quoteReserveSol = Number(q) / 10 ** SOL_DEC;
            pool.priceSol = pool.quoteReserveSol / pool.baseReserve; pool.liquiditySol = pool.quoteReserveSol * 2;
          }
          const lpInfo = infoOf(lp ?? null);
          if (typeof lpInfo?.supply === "string") { pool.lpSupply = lpInfo.supply; pool.lpBurned = lpInfo.supply === "0"; }
        } else notes.push("The curve is complete but the PumpSwap pool does not exist yet: anyone can call migrate.");
      }
      const venue: PumpStatus["venue"] = pool?.found && pool.priceSol !== null ? "pumpswap" : c && !c.complete ? "curve" : "none";
      const priceSol = venue === "pumpswap" ? pool!.priceSol : venue === "curve" ? curve.priceSol : null;
      return { status: 200, body: { mint, at: now(), token, curve, pool, venue, priceSol, notes } };
    },
  };
}

export const liveSolRpc = (url = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"): SolRpc => async (method, params) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`solana rpc answered ${r.status}`);
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "solana rpc error");
  return j.result;
};

type Context = { json(res: ServerResponse, status: number, body: unknown): void; limited(req: IncomingMessage, key: string, n: number, ms: number): boolean; url: URL };
/** GET /api/omni/pump?mint=: read-only status of a pump.fun coin. */
export async function omniRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context, svc = pumpService(liveSolRpc())): Promise<boolean> {
  if (p !== "/api/omni/pump" || req.method !== "GET") return false;
  if (ctx.limited(req, "omni-pump", 30, 60_000)) return ctx.json(res, 429, { error: "Slow down a little." }), true;
  try {
    const r = await svc.status(ctx.url.searchParams.get("mint") ?? "");
    ctx.json(res, r.status, r.body);
  } catch (e) {
    ctx.json(res, 502, { error: `Solana did not answer: ${String((e as Error).message ?? e).slice(0, 160)}` });
  }
  return true;
}
