import { createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { lockOf } from "./sol-chain.js";
import { fromPairs, launchpadOf } from "./sol-discover.js";
import type { ImdFile, ImdJob, ImdPort } from "./sol-imd.js";
import { encodeAbiParameters } from "viem";
import { NATIVE_SOL, RELAY_DEPOSITORY, SOLANA_RELAY_CHAIN } from "./sol-fees.js";
import {
  actText, checkMeta, checkOptions, cleanText, type ConfigView, DBC_PROGRAM, devLock, priceFromSqrt, proxyRpc, readVerdict, safetyChecks, siteLabel,
  type SolChain, SolInputError, SolLaunchpad, type SolSettings, swarmBody, swarmEta, type SwarmPick, termsProblems, WSOL,
} from "./sol-launch.js";
import { grind, MintKeys } from "./sol-mints.js";
import { encodeCall, imdCalls, RH_IMD, type RelayPayPort, type RelayPayQuote, type RelayStatus } from "./sol-relay.js";
import { LIGHTHOUSE, launchMetadata, launchTxProblem, walletSigned } from "./sol-tx.js";

const CONFIG = "628VVs4Y3QSD3J6GnXncY9UQkdumy1CdZRGuibtaCDBa";
const CUSTOM = "3rByufzjNhxy7JUg4C2BzCdZC5TYEdsDEz7onUVoDEp3";
const PARTNER = "6FsYW1KM2WURB7G7SB8BXhNq7vZjyvqbyu7dPRmWMHQU";
const POOL = "C2LmaBmAJ74wtuwKoNj7Y29grqFnqtsjLVQpcmSPYYs8";
const VAULT = "2wvUcq9KrGo6AuvKcNQxUHHtFyzk15o4U2TCZhcc7ari";
const SIG = "5".repeat(88);
const PAY = `0x${"ab".repeat(32)}`;
const JOB = "0b6f1c2e-4a3d-4e5f-8a9b-0c1d2e3f4a5b";
const PNG = `data:image/png;base64,${Buffer.from("png bytes").toString("base64")}`;
const SUPPLY = 1_000_000_000_000_000n; // 1B with 6 decimals
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const NONCE_VALUE = "9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxxMcD3JY3A";

const creatorKp = Keypair.generate();
const CREATOR = creatorKp.publicKey.toBase58();
const nonceKp = Keypair.generate();

const cfg: ConfigView = {
  config: CONFIG, feeClaimer: PARTNER, leftoverReceiver: PARTNER, quoteMint: WSOL, threshold: 85_000_000_000n, tokenDecimal: 6, supply: SUPPLY, tokenUpdateAuthority: 1,
  creatorFeePct: 50, partnerLockedPct: 50, creatorLockedPct: 50, partnerLpPct: 0, creatorLpPct: 0, migrationOption: 1, cliffFeeNumerator: 500_000_000n, poolCreationFee: 40_000_000n,
  devLocked: 0n, devCliffSecs: 0, devPeriods: 0, devPeriodSecs: 0,
};
// the creator's own config: 70% locked, 180 days after graduation, then daily over 365 days
const custom: ConfigView = { ...cfg, config: CUSTOM, devLocked: (SUPPLY * 7n) / 10n, devCliffSecs: 180 * 86_400, devPeriods: 365, devPeriodSecs: 86_400 };
const pool = { pool: POOL, config: CONFIG, creator: CREATOR, baseMint: "", baseVault: VAULT, quoteReserve: 42_500_000_000n, sqrtPrice: 2n ** 64n, migrated: false, activationPoint: 0 };

function fakeChain(over: Partial<SolChain> = {}) {
  const sent: string[] = [];
  const chain: SolChain = {
    poolOf: async (c, m) => (sent.length ? { ...pool, config: c, baseMint: m } : null),
    pools: async (a) => a.map(() => pool),
    config: async (c) => (c === CONFIG ? cfg : c === CUSTOM ? custom : c === PARTNER ? { ...cfg, feeClaimer: CREATOR } : null),
    mint: async () => ({ mintAuthority: null, freezeAuthority: null, supply: SUPPLY, decimals: 6 }),
    holders: async () => null,
    nonce: async (a) => (a === nonceKp.publicKey.toBase58() ? { authority: CREATOR, value: NONCE_VALUE } : null),
    simulate: async () => ({ ok: true, why: null }),
    send: async (b64) => { sent.push(b64); return SIG; },
    solUsd: async () => 100,
    ...over,
  };
  return { chain, sent };
}
const settings = (o: Partial<SolSettings> = {}): (() => SolSettings) => () => ({ network: "mainnet", rpc: "http://rpc", config: CONFIG, partner: PARTNER, ...o });

/** IMD, faked: the free check, the payment proof, and a job whose state and files a test sets. */
function fakeImd() {
  const s = { checked: [] as unknown[], blockers: [] as string[], paidBody: null as string | null, job: { state: "executing", nodes: [] as ImdJob["nodes"], site: null as string | null }, files: [] as ImdFile[], verdict: '{"launch": true, "reason": "Looks normal."}' };
  const port: ImdPort = {
    check: async (b) => { s.checked.push(b); return { blockers: s.blockers, plan: ["Research and write the report"] }; },
    paid: async (_c, tx, body) => (tx === PAY && body === s.paidBody ? { ok: true, payer: "0x1111111111111111111111111111111111111111" } : { ok: false, why: "That payment is not IMD's job for this launch." }),
    intake: async () => ({ state: "admitted", reason: null, job: JOB }),
    job: async () => s.job,
    files: async () => s.files,
    text: async () => s.verdict,
  };
  return { port, s };
}

const dir = () => mkdtempSync(join(tmpdir(), "sol-"));
const make = (o: { chain?: SolChain; s?: () => SolSettings; imd?: ImdPort | null } = {}) => {
  const d = dir();
  return new SolLaunchpad(o.chain ?? fakeChain().chain, o.s ?? settings(), d, "https://site.test", o.imd ?? null, new MintKeys(d, "", 0));
};
const STD = { feeBps: 100, startMcapUsd: 5_000, graduateMcapUsd: 75_000, sniper: "standard" };
const input = { name: "Night Frog", symbol: "nfrog", description: "gm", website: "https://frog.test", twitter: "https://x.com/frog", telegram: "https://t.me/frog", image: PNG, creator: CREATOR, options: STD };

/** A launch transaction the way the page builds one: compute budget, the first buy's SOL wrap and token account, Meteora's pool creation. */
function launchTx(mint: string, o: { config?: string; nonce?: string | null; extra?: TransactionInstruction[]; first?: TransactionInstruction[]; uri?: string } = {}) {
  const tx = new Transaction();
  const me = creatorKp.publicKey, m = new PublicKey(mint);
  for (const x of o.first ?? []) tx.add(x);
  if (o.nonce) tx.add(SystemProgram.nonceAdvance({ noncePubkey: nonceKp.publicKey, authorizedPubkey: me }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(DBC_PROGRAM), data: createPoolData("Night Frog", "NFROG", o.uri ?? `https://site.test/api/sol/meta/${mint}.json`), keys: [{ pubkey: new PublicKey(o.config ?? CONFIG), isSigner: false, isWritable: false }, { pubkey: m, isSigner: true, isWritable: true }, { pubkey: me, isSigner: true, isWritable: true }] }));
  tx.add(new TransactionInstruction({ programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), data: Buffer.from([1]), keys: [{ pubkey: me, isSigner: true, isWritable: true }, { pubkey: m, isSigner: false, isWritable: false }] }));
  tx.add(SystemProgram.transfer({ fromPubkey: me, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
  for (const x of o.extra ?? []) tx.add(x);
  tx.feePayer = me;
  tx.recentBlockhash = o.nonce ?? BLOCKHASH;
  tx.partialSign(creatorKp);
  return tx;
}
/** Meteora's pool creation data: the SPL-token discriminator, then name, ticker and metadata link as borsh strings. */
function createPoolData(name: string, symbol: string, uri: string) {
  const str = (x: string) => { const b = Buffer.from(x); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
  return Buffer.concat([Buffer.from([140, 85, 215, 176, 102, 54, 104, 79]), str(name), str(symbol), str(uri)]);
}
const b64 = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
/** The creator's wallet signing a short text, the way Phantom's signMessage does (ed25519). */
const walletSign = (kp: Keypair, text: string) => sign(null, Buffer.from(text), createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" })).toString("base64");

describe("token details and the curve", () => {
  it("checks names, tickers, links and the logo, and strips spoofing characters", () => {
    const { meta, image } = checkMeta(input);
    expect(meta.symbol).toBe("NFROG");
    expect(image && "bytes" in image && image.ext).toBe("png");
    expect(() => checkMeta({ ...input, symbol: "X" })).toThrow(SolInputError);
    expect(() => checkMeta({ ...input, twitter: "https://evil.test/frog" })).toThrow(/x\.com/);
    expect(() => checkMeta({ ...input, website: "http://plain.test" })).toThrow(/https/);
    expect(() => checkMeta({ ...input, image: "data:image/svg+xml;base64,PHN2Zz4=" })).toThrow(/webp, png/);
    expect(() => checkMeta({ ...input, image: `data:image/png;base64,${Buffer.alloc(170_000).toString("base64")}` })).toThrow(/160 KB/);
    expect(() => checkMeta({ ...input, image: "", imageUrl: "" })).toThrow(/logo/);
    // with the swarm drawing the logo, none is needed yet
    expect(checkMeta({ ...input, image: "" }, true).image).toBeNull();
    // a right-to-left override would show "PIRATE" reversed
    expect(checkMeta({ ...input, name: "Night‮Frog​" }).meta.name).toBe("NightFrog");
    expect(cleanText("‮ETARIP")).toBe("ETARIP");
  });

  it("takes any market caps and Meteora fee within the limits", () => {
    expect(checkOptions({ feeBps: 25, startMcapUsd: 2_500, graduateMcapUsd: 2_000_000, sniper: "strong" })).toEqual({ feeBps: 25, startMcapUsd: 2_500, graduateMcapUsd: 2_000_000, sniper: "strong" });
    expect(() => checkOptions({ ...STD, feeBps: 150 })).toThrow(/Meteora's/);
    expect(() => checkOptions({ ...STD, startMcapUsd: 500 })).toThrow(/starting/);
    expect(() => checkOptions({ ...STD, graduateMcapUsd: 8_000 })).toThrow(/graduation/);
    expect(() => checkOptions({ ...STD, startMcapUsd: 50_000, graduateMcapUsd: 60_000 })).toThrow(/twice/);
  });
});

describe("the IMD swarm job", () => {
  const l = { mint: "Fr0gMint1111111111111111111111111111111imd", name: "Night Frog", symbol: "NFROG", description: "gm", website: "", twitter: "https://x.com/frog", telegram: "", image: "", creator: CREATOR, dev: { pct: 70, cliffDays: 180, vestDays: 365 }, logoIdea: "a green frog in a hoodie" };

  it("is one job of the picked steps, bound to the token's address", () => {
    const all = swarmBody(l, ["review", "logo", "banner", "website"], "https://site.test");
    expect(all.steps.map((s) => s.skill)).toEqual(["research-report", "token-logo", "create-image", "build-website"]);
    expect(all.objective).toContain(`mint ${l.mint}`);
    expect(all.objective).toContain("70%");
    expect(all).toMatchObject({ shape: "chain", github: false, minCitations: 3, ipfs: siteLabel("NFROG", l.mint) });
    expect(JSON.stringify(all.steps[1])).toContain("a green frog in a hoodie");
    const site = swarmBody(l, ["website"], "https://site.test");
    expect(site.steps).toHaveLength(1);
    expect(site).not.toHaveProperty("minCitations");
    expect(swarmBody(l, ["review"], "https://site.test")).not.toHaveProperty("ipfs");
    expect(siteLabel("NFROG", l.mint)).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/);
  });

  it("reads the review's verdict, strictly or loosely", () => {
    expect(readVerdict('{"launch": false, "reason": "Copies the Bonk logo."}')).toEqual({ launch: false, reason: "Copies the Bonk logo." });
    expect(readVerdict('Here it is: {"launch": true, "reason": "fine"')).toEqual({ launch: true, reason: "fine" });
    expect(readVerdict("no verdict here")).toBeNull();
  });
});

describe("the creator's signed launch", () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const expectOk = { creator: CREATOR, mint, config: CONFIG, nonce: null };

  it("is exactly a launch: Meteora's pool, the first buy's steps, the creator's signature", () => {
    expect(launchTxProblem(launchTx(mint), expectOk)).toBeNull();
    const n = launchTx(mint, { nonce: NONCE_VALUE });
    expect(launchTxProblem(n, { ...expectOk, nonce: { account: nonceKp.publicKey.toBase58(), value: NONCE_VALUE } })).toBeNull();
  });

  it("takes the Lighthouse checks Phantom adds to what it signs (seen 2026-11-15)", () => {
    const lh = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: creatorKp.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3]) });
    expect(launchTxProblem(launchTx(mint, { extra: [lh] }), expectOk)).toBeNull();
  });

  it("refuses anything NIGHTSHIFT's signature for the address could be misused in", () => {
    const m = new PublicKey(mint);
    // the address created outside Meteora
    expect(launchTxProblem(launchTx(mint, { extra: [SystemProgram.createAccount({ fromPubkey: creatorKp.publicKey, newAccountPubkey: m, lamports: 1, space: 82, programId: SystemProgram.programId })] }), expectOk)).toMatch(/outside Meteora/);
    // an unknown program
    expect(launchTxProblem(launchTx(mint, { extra: [new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })] }), expectOk)).toMatch(/not part of a launch/);
    // another signer
    const other = Keypair.generate();
    expect(launchTxProblem(launchTx(mint, { extra: [SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: creatorKp.publicKey, lamports: 1 })] }), expectOk)).toMatch(/signed by the creator/);
    // another config
    expect(launchTxProblem(launchTx(mint, { config: CUSTOM }), expectOk)).toMatch(/does not create the token/);
    // signed by someone else, or changed after signing
    const forged = launchTx(mint);
    forged.signatures.find((x) => x.publicKey.equals(creatorKp.publicKey))!.signature = Buffer.alloc(64, 7);
    expect(launchTxProblem(forged, expectOk)).toMatch(/does not match/);
    const changed = launchTx(mint);
    changed.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
    expect(launchTxProblem(changed, expectOk)).toMatch(/does not match/);
    // a waiting launch must use its own nonce, at its current value
    const nonce = { account: nonceKp.publicKey.toBase58(), value: NONCE_VALUE };
    expect(launchTxProblem(launchTx(mint), { ...expectOk, nonce })).toMatch(/nonce/);
    expect(launchTxProblem(launchTx(mint, { nonce: BLOCKHASH }), { ...expectOk, nonce })).toMatch(/old nonce/);
  });

  it("checks the creator's signed decisions", () => {
    const t = actText("cancel", mint);
    expect(walletSigned(CREATOR, t, walletSign(creatorKp, t))).toBe(true);
    expect(walletSigned(CREATOR, actText("release", mint), walletSign(creatorKp, t))).toBe(false);
    expect(walletSigned(CREATOR, t, walletSign(Keypair.generate(), t))).toBe(false);
  });
});

describe("a launch without the swarm", () => {
  it("is sent at once with NIGHTSHIFT's signature for the address, and listed", async () => {
    const { chain, sent } = fakeChain();
    const pad = make({ chain });
    const r = await pad.prepare(input);
    expect(r.swarm).toBeNull();
    expect(r.uri).toBe(`https://site.test/api/sol/meta/${r.mint}.json`);
    expect(pad.meta(r.mint)).toMatchObject({ name: "Night Frog", symbol: "NFROG", image: r.image, extensions: { launchpad: `https://site.test/launchpad/sol/${r.mint}` } });
    expect(pad.one(r.mint)).toBeNull();
    const l = await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG });
    expect(l).toMatchObject({ status: "live", signature: SIG, pool: POOL, mcapSol: 1_000_000, progress: 0.5 });
    expect(l).not.toHaveProperty("held");
    // both signatures are on what was sent, and the address key is gone
    expect(Transaction.from(Buffer.from(sent[0]!, "base64")).verifySignatures(true)).toBe(true);
    expect(pad.mints.keypair(r.mint)).toBeNull();
    expect(pad.list().map((x) => x.mint)).toEqual([r.mint]);
  });

  it("on the creator's own config shows the locked 70%", async () => {
    const pad = make();
    const r = await pad.prepare(input);
    const l = await pad.signed(r.mint, { tx: b64(launchTx(r.mint, { config: CUSTOM })), config: CUSTOM });
    expect(l.dev).toEqual({ pct: 70, cliffDays: 180, vestDays: 365 });
    expect(l.checks.find((c) => c.key === "devlock")?.says).toMatch(/70% is the creator's/);
  });

  it("is refused on a config that pays someone else, when closed, or when Solana would fail it", async () => {
    const pad = make();
    const r = await pad.prepare(input);
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint, { config: PARTNER })), config: PARTNER })).rejects.toThrow(/another wallet/);
    await expect(make({ s: settings({ partner: null }) }).prepare(input)).rejects.toThrow(/not open/);
    const failing = make({ chain: fakeChain({ simulate: async () => ({ ok: false, why: "insufficient lamports" }) }).chain });
    const f = await failing.prepare(input);
    await expect(failing.signed(f.mint, { tx: b64(launchTx(f.mint)), config: CONFIG })).rejects.toThrow(/insufficient lamports/);
  });
});

describe("a launch with the IMD swarm: paid first, signed when the swarm is done", () => {
  const swarmInput = { ...input, image: "", swarm: ["review", "logo", "website"], logoIdea: "a frog", chainId: 1 };

  async function waiting() {
    const { chain, sent } = fakeChain();
    const imd = fakeImd();
    const pad = make({ chain, imd: imd.port });
    const r = await pad.prepare(swarmInput);
    imd.s.paidBody = r.swarm!.body;
    return { pad, r, imd, sent };
  }
  const complete = (imd: ReturnType<typeof fakeImd>) => {
    imd.s.job = { state: "completed", nodes: [{ key: "research_report", state: "accepted" }, { key: "token_logo", state: "accepted" }, { key: "build_website", state: "accepted" }, { key: "design_critic", state: "accepted" }], site: "https://nfrog.imd.site" };
    imd.s.files = [{ name: "verdict", url: "https://api.imd.fun/artifacts/v", mediaType: "application/json" }, { name: "logo", url: "https://api.imd.fun/artifacts/logo", mediaType: "image/png" }, { name: "report", url: "https://api.imd.fun/artifacts/r", mediaType: "text/markdown" }];
  };

  it("is checked by IMD for free and waits for its payment: no nonce, nothing signed, nothing sent", async () => {
    const { pad, r, imd, sent } = await waiting();
    expect(imd.s.checked).toHaveLength(1);
    expect(r.swarm).toMatchObject({ chainId: 1, blockers: [], plan: ["Research and write the report"] });
    expect(JSON.parse(r.swarm!.body).objective).toContain(r.mint);
    // the launch has its page at once, so the creator can pay and follow it
    expect(pad.one(r.mint)).toMatchObject({ status: "waiting", nonce: null, uri: r.uri, swarm: { state: "unpaid", picks: ["review", "logo", "website"] } });
    // and cannot be signed before the swarm is done
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).rejects.toThrow(/Pay the swarm's job first/);
    expect(sent).toHaveLength(0);
  });

  it("needs the payment that carried its body, follows the job, and is ready (not sent) when it completes", async () => {
    const { pad, r, imd, sent } = await waiting();
    await expect(pad.paid(r.mint, 1, `0x${"cd".repeat(32)}`)).rejects.toThrow(/not IMD's job/);
    expect((await pad.paid(r.mint, 1, PAY)).swarm).toMatchObject({ state: "paid", payTx: PAY });
    imd.s.job = { state: "executing", nodes: [{ key: "research_report", state: "accepted" }, { key: "token_logo", state: "running" }, { key: "build_website", state: "pending" }], site: null };
    await pad.work();
    expect(pad.one(r.mint)?.swarm?.steps.map((s) => s.state)).toEqual(["done", "working", "waiting"]);
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).rejects.toThrow(/still working/);
    expect(pad.waiting().map((x) => x.mint)).toEqual([r.mint]);
    complete(imd);
    await pad.work();
    expect(pad.one(r.mint)).toMatchObject({ status: "ready", swarm: { state: "done", verdict: { launch: true }, site: "https://nfrog.imd.site", logo: "https://api.imd.fun/artifacts/logo" } });
    expect(sent).toHaveLength(0);
    // the work is in the metadata before the creator signs; the creator's own website stays first
    expect(pad.meta(r.mint)).toMatchObject({ image: "https://api.imd.fun/artifacts/logo", extensions: { website: "https://frog.test/" } });
    expect(pad.metaCache(r.mint)).toBe("no-store");
    expect(pad.waiting().map((x) => x.mint)).toEqual([r.mint]);
  });

  it("is signed when ready, on a recent blockhash, checked and sent at once with the address's signature", async () => {
    const { pad, r, imd, sent } = await waiting();
    await pad.paid(r.mint, 1, PAY);
    complete(imd);
    await pad.work();
    // a launch built on a durable nonce is refused now: the steps are named in the refusal
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint, { nonce: NONCE_VALUE })), config: CONFIG })).rejects.toThrow(/its steps: 11111111 > ComputeB > dbcij3LW > ATokenGP > 11111111\)/);
    // its metadata must be NIGHTSHIFT's: the swarm's work is in it
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint, { uri: "https://evil.test/meta.json" })), config: CONFIG })).rejects.toThrow(/metadata to NIGHTSHIFT/);
    // Phantom's Lighthouse checks may sit anywhere, the first step included
    const lh = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: creatorKp.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([9]) });
    const tx = launchTx(r.mint, { first: [lh], extra: [lh] });
    const l = await pad.signed(r.mint, { tx: b64(tx), config: CONFIG });
    expect(l).toMatchObject({ status: "live", signature: SIG, pool: POOL, nonce: null });
    expect(sent).toHaveLength(1);
    expect(Transaction.from(Buffer.from(sent[0]!, "base64")).verifySignatures(true)).toBe(true);
    expect(pad.mints.keypair(r.mint)).toBeNull();
    expect(pad.metaCache(r.mint)).toBe("public, max-age=300");
    expect(await pad.info()).toMatchObject({ counts: { live: 1, reviewed: 1, swarm: 1, waiting: 0 } });
    await expect(pad.signed(r.mint, { tx: b64(tx), config: CONFIG })).rejects.toThrow(/already signed/);
  });

  it("never launches when the review says no, unless the owner overrules it; then the creator signs", async () => {
    const { pad, r, imd, sent } = await waiting();
    await pad.paid(r.mint, 1, PAY);
    imd.s.verdict = '{"launch": false, "reason": "It copies an existing project."}';
    imd.s.files = [{ name: "verdict", url: "https://api.imd.fun/artifacts/v", mediaType: "application/json" }];
    await pad.work();
    expect(pad.one(r.mint)).toMatchObject({ status: "refused", note: expect.stringMatching(/copies an existing project/) });
    await expect(pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).rejects.toThrow(/review said no/);
    await expect(pad.act(r.mint, "release", walletSign(creatorKp, actText("release", r.mint)))).rejects.toThrow(/not waiting/);
    expect((await pad.adminAct(r.mint, "release")).status).toBe("ready");
    expect(sent).toHaveLength(0);
    expect((await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).status).toBe("live");
    expect(sent).toHaveLength(1);
  });

  it("lets the creator launch without the swarm only once the swarm failed (then sign), and cancel any time", async () => {
    const { pad, r, imd, sent } = await waiting();
    await pad.paid(r.mint, 1, PAY);
    const release = walletSign(creatorKp, actText("release", r.mint));
    await pad.work();
    await expect(pad.act(r.mint, "release", release)).rejects.toThrow(/still working/);
    imd.s.job = { state: "failed", nodes: [], site: null };
    await pad.work();
    expect(pad.one(r.mint)?.swarm?.state).toBe("failed");
    await expect(pad.act(r.mint, "release", walletSign(Keypair.generate(), actText("release", r.mint)))).rejects.toThrow(/creator's wallet/);
    expect((await pad.act(r.mint, "release", release)).status).toBe("ready");
    expect((await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).status).toBe("live");
    expect(sent).toHaveLength(1);

    const w = await waiting();
    expect((await w.pad.act(w.r.mint, "cancel", walletSign(creatorKp, actText("cancel", w.r.mint)))).status).toBe("cancelled");
    expect(w.pad.mints.keypair(w.r.mint)).toBeNull();
  });

  it("is signed again after Solana refuses the send", async () => {
    let fail = true;
    const box: { sent: string[] } = { sent: [] };
    const { chain, sent } = fakeChain({ send: async (b64tx) => { if (fail) { fail = false; throw new Error("Blockhash not found"); } box.sent.push(b64tx); return SIG; } });
    box.sent = sent;
    const imd = fakeImd();
    const pad = make({ chain, imd: imd.port });
    const r = await pad.prepare(swarmInput);
    imd.s.paidBody = r.swarm!.body;
    await pad.paid(r.mint, 1, PAY);
    complete(imd);
    await pad.work();
    expect(await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).toMatchObject({ status: "failed", note: expect.stringMatching(/Blockhash not found/) });
    expect((await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG })).status).toBe("live");
    expect(sent).toHaveLength(1);
  });

  it("still sends a launch signed on a durable nonce before v0.377 when its job completes, and makes old unsigned ones payable", async () => {
    const { chain, sent } = fakeChain();
    const imd = fakeImd();
    const d = dir();
    const mints = new MintKeys(d, "", 0);
    const pad = new SolLaunchpad(chain, settings(), d, "https://site.test", imd.port, mints);
    const r = await pad.prepare(swarmInput);
    const r2 = await pad.prepare(swarmInput);
    // what v0.376 stored: a held launch on a nonce, and one left "prepared" when its signing failed
    const store = JSON.parse(readFileSync(join(d, "sol-launches.json"), "utf8"));
    const held = launchTx(r.mint, { nonce: NONCE_VALUE });
    store[r.mint].held = { tx: b64(held), nonce: nonceKp.publicKey.toBase58() };
    store[r.mint].config = CONFIG;
    store[r2.mint].status = "prepared";
    writeFileSync(join(d, "sol-launches.json"), JSON.stringify(store));
    const again = new SolLaunchpad(chain, settings(), d, "https://site.test", imd.port, mints);
    expect(again.one(r.mint)).toMatchObject({ status: "waiting", nonce: nonceKp.publicKey.toBase58() });
    expect(again.one(r2.mint)).toMatchObject({ status: "waiting", swarm: { state: "unpaid" } });
    imd.s.paidBody = r.swarm!.body;
    await again.paid(r.mint, 1, PAY);
    complete(imd);
    await again.work();
    expect(again.one(r.mint)?.status).toBe("live");
    expect(sent).toHaveLength(1);
    expect((await again.act(r2.mint, "cancel", walletSign(creatorKp, actText("cancel", r2.mint)))).status).toBe("cancelled");
  });

  it("is not prepared when IMD's check would refuse the job", async () => {
    const imd = fakeImd();
    imd.s.blockers = ["The ticker is someone else's brand."];
    const pad = make({ imd: imd.port });
    const r = await pad.prepare(swarmInput);
    expect(r.swarm?.blockers).toEqual(["The ticker is someone else's brand."]);
    expect(pad.one(r.mint)).toBeNull();
    await expect(pad.signed(r.mint, { tx: "x" })).rejects.toThrow(/No launch/);
  });
});

describe("the swarm paid in SOL, and its work in the token", () => {
  const FEE_WALLET = "0x3322a0b8e8c0b6c4b2b2c2a3c6d8e9f0a1b2c3d4";
  const REQ = `0x${"17".repeat(32)}`;
  const SOLTX = "4".repeat(88);
  const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("logo pixels")]);

  /** Relay through NIGHTSHIFT Swap, faked: a quote of exactly the job (or a tampered one), the built deposit, a status the test sets. */
  function fakePay() {
    const s = { tamper: false, status: { state: "waiting", destTx: null, destChain: null, inTx: null, why: null } as RelayStatus, quotes: 0 };
    const quoteOf = (creator: string, body: string): RelayPayQuote => ({
      requestId: REQ, steps: 1, items: 1, kind: "transaction",
      instructions: [{ programId: RELAY_DEPOSITORY, keys: [{ pubkey: creator, isSigner: true, isWritable: true }], data: "00" }], lookupTables: [],
      sender: creator, recipient: FEE_WALLET, inChain: SOLANA_RELAY_CHAIN, inCurrency: NATIVE_SOL, inLamports: "19950442", inUsd: 1.36,
      outChain: 4663, outCurrency: RH_IMD, outAmount: "500000000000000000", outUsd: 1.24, timeEstimate: 1, orderChain: "robinhood",
      calls: imdCalls(s.tamper ? body.replace("Night Frog", "Other Frog") : body).map((c) => encodeCall({ to: c.to, data: c.data, value: 0n })),
      refunds: [{ chainId: "solana", recipient: creator }, { chainId: "robinhood", recipient: FEE_WALLET }],
    });
    const port: RelayPayPort = {
      quote: async ({ creator, body }) => { s.quotes++; return { quote: quoteOf(creator, body), feeWallet: FEE_WALLET, feeBps: 25 }; },
      build: async () => ({ tx: "AQID", lamports: 19_960_442n, blockhash: BLOCKHASH }),
      status: async () => s.status,
    };
    return { port, s };
  }

  async function waitingPaidInSol(o: { picks?: string[]; image?: string; net?: "mainnet" | "devnet" } = {}) {
    const { chain, sent } = fakeChain();
    const imd = fakeImd();
    const pay = fakePay();
    const d = dir();
    const pad = new SolLaunchpad(chain, settings({ network: o.net ?? "mainnet" }), d, "https://site.test", imd.port, new MintKeys(d, "", 0), pay.port);
    const r = await pad.prepare({ ...input, image: o.image ?? "", swarm: o.picks ?? ["review", "logo", "banner", "website"], logoIdea: "a frog", chainId: 1 });
    imd.s.paidBody = r.swarm!.body;
    return { pad, r, imd, pay, sent, d };
  }

  it("quotes the job in SOL, checked, and follows Relay until the destination transaction carries the job", async () => {
    const { pad, r, imd, pay } = await waitingPaidInSol();
    const q = await pad.relayQuote(r.mint);
    expect(q).toMatchObject({ tx: "AQID", requestId: REQ, lamports: "19960442", quotedLamports: "19950442", usd: 1.36, imd: 0.5, chain: "Robinhood Chain" });
    expect(pad.one(r.mint)?.swarm?.relay).toMatchObject({ state: "quoted", requestId: REQ });
    await expect(pad.relaySent(r.mint, "not a signature")).rejects.toThrow(/signature/);
    pay.s.status = { state: "pending", destTx: null, destChain: null, inTx: SOLTX, why: null };
    expect((await pad.relaySent(r.mint, SOLTX)).swarm).toMatchObject({ state: "unpaid", relay: { state: "sent", solTx: SOLTX } });
    // a second payment is never quoted while the first is on its way
    await expect(pad.relayQuote(r.mint)).rejects.toThrow(/already on its way/);
    // Relay delivered: the job is paid by the transaction Relay names for this request (its executor is the payer)
    pay.s.status = { state: "success", destTx: PAY, destChain: 4663, inTx: SOLTX, why: null };
    const v = await pad.relayCheck(r.mint);
    expect(v.swarm).toMatchObject({ state: "working", payTx: PAY, chainId: 4663, relay: { state: "done", destTx: PAY } });
    expect(imd.s.job.state).toBe("executing");
  });

  it("refuses a quote that is not exactly this launch's job, on devnet, and without the route", async () => {
    const a = await waitingPaidInSol();
    a.pay.s.tamper = true;
    await expect(a.pad.relayQuote(a.r.mint)).rejects.toThrow(/route was refused \(the destination calls are not IMD's job/);
    expect(a.pad.one(a.r.mint)?.swarm?.relay ?? null).toBeNull();
    const dev = await waitingPaidInSol({ net: "devnet" });
    await expect(dev.pad.relayQuote(dev.r.mint)).rejects.toThrow(/mainnet only/);
    // the page offers SOL everywhere and says on devnet that it pays on mainnet only
    expect((await dev.pad.info()).imd.solPay).toBe(true);
    expect((await a.pad.info()).imd).toMatchObject({ solPay: true, eta: { steps: { website: [50, 95] } } });
  });

  it("lets the creator pay again when Relay refunds, and never counts a delivery that did not carry the job", async () => {
    const { pad, r, imd, pay } = await waitingPaidInSol();
    await pad.relayQuote(r.mint);
    pay.s.status = { state: "refunded", destTx: null, destChain: null, inTx: SOLTX, why: "SOLVER_CAPACITY_EXCEEDED" };
    expect((await pad.relaySent(r.mint, SOLTX)).swarm).toMatchObject({ state: "unpaid", relay: { state: "refunded" } });
    await pad.relayQuote(r.mint);
    expect(pay.s.quotes).toBe(2);
    pay.s.status = { state: "pending", destTx: null, destChain: null, inTx: SOLTX, why: null };
    await pad.relaySent(r.mint, SOLTX);
    imd.s.paidBody = "another body";
    pay.s.status = { state: "success", destTx: PAY, destChain: 4663, inTx: SOLTX, why: null };
    const v = await pad.relayCheck(r.mint);
    expect(v.swarm).toMatchObject({ state: "unpaid", payTx: null, relay: { state: "failed", note: expect.stringMatching(/swap wallet/) } });
  });

  it("reads the metadata link the signed launch writes into the token", async () => {
    const imd = fakeImd();
    const pad = make({ imd: imd.port });
    const r = await pad.prepare({ ...input, swarm: ["website"], chainId: 1 });
    expect(launchMetadata(launchTx(r.mint))).toEqual({ name: "Night Frog", symbol: "NFROG", uri: `https://site.test/api/sol/meta/${r.mint}.json` });
    // a launch without the swarm is not held to it
    const plain = await make().prepare(input);
    expect(launchMetadata(new Transaction())).toBeNull();
    expect(plain.uri).toBe(`https://site.test/api/sol/meta/${plain.mint}.json`);
  });

  it("puts the swarm's logo, banner and site into the token before it is sent, served by NIGHTSHIFT", async () => {
    const { pad, r, imd, pay, sent } = await waitingPaidInSol();
    imd.port.image = async (url) => (url.endsWith("/logo") || url.endsWith("/banner") ? { bytes: PNG_BYTES, type: "png" } : null);
    await pad.relayQuote(r.mint);
    pay.s.status = { state: "success", destTx: PAY, destChain: 4663, inTx: SOLTX, why: null };
    await pad.relaySent(r.mint, SOLTX);
    expect(pad.metaCache(r.mint)).toBe("no-store");
    imd.s.job = { state: "completed", nodes: ["research_report", "token_logo", "create_image", "build_website", "design_critic"].map((key) => ({ key, state: "accepted" })), site: "https://nfrog.imd.site" };
    imd.s.files = [{ name: "verdict", url: "https://api.imd.fun/artifacts/v", mediaType: "application/json" }, { name: "report", url: "https://api.imd.fun/artifacts/r", mediaType: "text/markdown" }, { name: "logo", url: "https://api.imd.fun/artifacts/logo", mediaType: "image/png" }, { name: "banner", url: "https://api.imd.fun/artifacts/banner", mediaType: "image/png" }];
    // what the metadata says at the moment the launch is sent
    let atSend: ReturnType<SolLaunchpad["meta"]> = null;
    const send = (pad as unknown as { chain: SolChain }).chain.send;
    (pad as unknown as { chain: SolChain }).chain.send = async (b) => { atSend = pad.meta(r.mint); return send(b); };
    await pad.work();
    // ready: the work is in the token before the creator signs; then it is sent at once
    expect(sent).toHaveLength(0);
    expect(pad.one(r.mint)?.status).toBe("ready");
    await pad.signed(r.mint, { tx: b64(launchTx(r.mint)), config: CONFIG });
    expect(sent).toHaveLength(1);
    const logo = `https://site.test/api/sol/img/${r.mint}-logo.png`, banner = `https://site.test/api/sol/img/${r.mint}-banner.png`;
    // no upload: the swarm's logo is the token's image
    expect(atSend).toMatchObject({ image: logo, extensions: { website: "https://frog.test/", imd_site: "https://nfrog.imd.site", banner, imd_review: "https://api.imd.fun/artifacts/r" }, properties: { files: [{ uri: logo, type: "image/png" }, { uri: banner, type: "image/png" }] } });
    expect(pad.image(`${r.mint}-logo.png`)?.bytes.equals(PNG_BYTES)).toBe(true);
    expect(pad.image(`${r.mint}-banner.png`)?.type).toBe("image/png");
    expect(pad.image(`${r.mint}-other.png`)).toBeNull();
    expect(pad.one(r.mint)).toMatchObject({ status: "live", swarm: { logoHosted: logo, bannerHosted: banner } });
    expect(pad.metaCache(r.mint)).toBe("public, max-age=300");
  });

  it("refuses a web address in the name (Phantom hides those tokens as spam)", () => {
    for (const name of ["first imd.fun sol launch", "Frog x.com", "www.frog", "https://frog"]) expect(() => checkMeta({ ...input, name })).toThrow(/web addresses/);
    expect(checkMeta({ ...input, name: "Night Frog 2.0" }).meta.name).toBe("Night Frog 2.0");
  });

  it("keeps the creator's uploaded logo: the swarm's logo step comes off the job", async () => {
    const d = dir();
    const pad = new SolLaunchpad(fakeChain().chain, settings({ network: "mainnet" }), d, "https://site.test", fakeImd().port, new MintKeys(d, "", 0), fakePay().port);
    const r = await pad.prepare({ ...input, image: PNG, swarm: ["review", "logo", "website"], logoIdea: "a frog", chainId: 1 });
    expect(r.swarm!.body).not.toMatch(/token-logo|artifacts\/logo\.png/);
  });

  it("does not launch a token the swarm left without any logo", async () => {
    const { pad, r, imd, pay, sent } = await waitingPaidInSol({ picks: ["logo"] });
    await pad.relayQuote(r.mint);
    pay.s.status = { state: "success", destTx: PAY, destChain: 4663, inTx: SOLTX, why: null };
    await pad.relaySent(r.mint, SOLTX);
    imd.s.job = { state: "completed", nodes: [{ key: "token_logo", state: "accepted" }], site: null };
    await pad.work();
    expect(sent).toHaveLength(0);
    expect(pad.one(r.mint)?.swarm).toMatchObject({ state: "failed", note: expect.stringMatching(/without the logo/) });
  });

  it("asks the swarm to put the review and the banner on the site, and estimates the time", () => {
    const l = { mint: "Fr0gMint1111111111111111111111111111111imd", name: "Night Frog", symbol: "NFROG", description: "gm", website: "", twitter: "", telegram: "", image: "", creator: CREATOR, dev: null, logoIdea: "" };
    const site = (picks: SwarmPick[]) => JSON.stringify(swarmBody(l, picks, "https://site.test").steps.find((s) => s.skill === "build-website"));
    expect(site(["review", "website"])).toContain("Reviewed by the IMD swarm");
    expect(site(["review", "website"])).not.toContain("banner.png");
    expect(site(["banner", "website"])).toContain("artifacts/banner.png");
    expect(site(["logo", "website"])).toContain("artifacts/logo.png");
    expect(site(["website"])).not.toMatch(/Reviewed|banner\.png/);
    expect(swarmEta(["review", "logo", "banner", "website"])).toEqual({ typical: 65, slow: 163 });
    expect(swarmEta(["logo"])).toEqual({ typical: 4, slow: 15 });
  });
});

describe("launch addresses", () => {
  it("end in the suffix, and their key is held until the token exists", async () => {
    const secret = await grind("a", 50);
    const kp = Keypair.fromSecretKey(Buffer.from(secret, "base64"));
    expect(kp.publicKey.toBase58().endsWith("a")).toBe(true);
    const keys = new MintKeys(dir(), "b", 1);
    await keys.fill();
    expect(keys.readyCount()).toBe(1);
    const mint = keys.take();
    expect(mint.endsWith("b")).toBe(true);
    expect(keys.keypair(mint)?.publicKey.toBase58()).toBe(mint);
    keys.drop(mint);
    expect(keys.keypair(mint)).toBeNull();
  });
});

describe("prices, locks and checks", () => {
  it("reads the price from the Q64.64 sqrt price", () => {
    expect(priceFromSqrt(2n ** 64n, 6)).toBeCloseTo(0.001);
    expect(priceFromSqrt(2n ** 63n, 6)).toBeCloseTo(0.00025);
  });

  it("reads the creator's lock from a config's locked vesting", () => {
    const v = lockOf({ amountPerPeriod: { toString: () => "1917808219178" }, numberOfPeriod: { toString: () => "365" }, cliffUnlockAmount: { toString: () => "0" }, cliffDurationFromMigrationTime: { toString: () => String(180 * 86_400) }, frequency: { toString: () => "86400" } });
    expect(devLock({ ...cfg, ...v })).toEqual({ pct: 70, cliffDays: 180, vestDays: 365 });
    expect(devLock(cfg)).toBeNull();
  });

  it("names what a config gets wrong", () => {
    expect(termsProblems(cfg, PARTNER)).toEqual([]);
    expect(termsProblems({ ...cfg, tokenUpdateAuthority: 0, migrationOption: 0, quoteMint: CONFIG }, PARTNER)).toEqual(["it is not priced in SOL", "its tokens are not frozen", "it does not graduate to DAMM v2"]);
  });

  it("leaves the pool's vault out of the holders and flags concentration", () => {
    const ok = safetyChecks({ mintAuthority: null, freezeAuthority: null, supply: 1000n, decimals: 6 }, [{ account: VAULT, owner: POOL, amount: 900n }, { account: "a", owner: CREATOR, amount: 20n }], pool, 1);
    expect(ok.every((c) => c.ok)).toBe(true);
    const bad = safetyChecks({ mintAuthority: "M1nt", freezeAuthority: "Fr33", supply: 1000n, decimals: 6 }, [{ account: "a", owner: CREATOR, amount: 400n }], pool, 9);
    expect(bad.filter((c) => c.ok === false).map((c) => c.key)).toEqual(["mint", "freeze", "top10", "creator", "serial"]);
  });
});

describe("the shared config key", () => {
  it("must claim fees to the partner and match the NIGHTSHIFT terms", async () => {
    const pad = make();
    expect(await pad.verifyConfig(CONFIG, PARTNER)).toMatchObject({ ok: true });
    expect(await pad.verifyConfig(CONFIG, CREATOR)).toMatchObject({ ok: false, why: expect.stringMatching(/another wallet/) });
    expect(await pad.verifyConfig(VAULT, PARTNER)).toMatchObject({ ok: false, why: expect.stringMatching(/No Meteora/) });
  });
});

describe("discovery", () => {
  it("names the launchpad by the mint's suffix", () => {
    expect(launchpadOf("9mWrj77gDZ7w4rwHF6STYXDZmYRMyf39L4go1mXepump", "pumpfun")).toBe("pump.fun");
    expect(launchpadOf("Abcbonk", "raydium")).toBe("LetsBonk");
    expect(launchpadOf("AbcBAGS", "meteora")).toBe("Bags");
    expect(launchpadOf("Abcimd", "meteoradbc")).toBe("IMD · NIGHTSHIFT");
    expect(launchpadOf("Abc", "raydium")).toBeNull();
  });

  it("prices a pump.fun curve from SOL and keeps the deepest pair", () => {
    const m = "GWdS5xTBCvxxHivqgvGR9HaARDZSUzJmJLAHTnKfpump";
    const base = { address: m, name: "Betelgeuse", symbol: "BTL" };
    const d = fromPairs(m, [
      { chainId: "solana", dexId: "pumpfun", url: "u1", baseToken: base, priceNative: "0.00000003", txns: { h24: { buys: 5, sells: 2 } }, volume: { h24: 100 } },
      { chainId: "solana", dexId: "pumpswap", url: "u2", baseToken: base, priceNative: "0.00000005", priceUsd: "0.000005", liquidity: { usd: 9000 }, marketCap: 5000, txns: { h24: { buys: 1, sells: 1 } }, volume: { h24: 50 } },
    ], 100, true);
    expect(d).toMatchObject({ dex: "pumpswap", launchpad: "pump.fun", mcapUsd: 5000, buys24: 6, sells24: 3, vol24: 150, boosted: true, url: "u2" });
    const curve = fromPairs(m, [{ chainId: "solana", dexId: "pumpfun", url: "u1", baseToken: base, priceNative: "0.00000003" }], 100, false);
    expect(curve?.mcapUsd).toBeCloseTo(3000);
  });
});

describe("the RPC proxy", () => {
  it("forwards reads and sends, refuses scans", async () => {
    const seen: unknown[] = [];
    const send = async (b: unknown) => { seen.push(b); return { jsonrpc: "2.0", id: (b as { id: unknown }).id, result: { context: { slot: 1 }, value: "ok" } }; };
    await proxyRpc("http://rpc", { jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [] }, send);
    expect(seen).toHaveLength(1);
    await expect(proxyRpc("http://rpc", { jsonrpc: "2.0", id: 2, method: "getProgramAccounts", params: [] }, send)).rejects.toThrow(/not available/);
    await expect(proxyRpc("http://rpc", { method: "getSlot" }, send)).rejects.toThrow(/JSON-RPC/);
    await expect(proxyRpc("http://rpc", Array.from({ length: 11 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" })), send)).rejects.toThrow(/1 to 10/);
  });

  it("splits getMultipleAccounts into calls of 10 and joins the answers in order", async () => {
    const send = async (b: unknown) => { const keys = (b as { params: string[][] }).params[0]!; return { jsonrpc: "2.0", id: 7, result: { context: { slot: 5 }, value: keys.map((k) => ({ k })) } }; };
    const keys = Array.from({ length: 23 }, (_, i) => `k${i}`);
    const r = await proxyRpc("http://rpc", { jsonrpc: "2.0", id: 7, method: "getMultipleAccounts", params: [keys, { encoding: "base64" }] }, send) as { result: { value: { k: string }[] } };
    expect(r.result.value.map((v) => v.k)).toEqual(keys);
  });
});

