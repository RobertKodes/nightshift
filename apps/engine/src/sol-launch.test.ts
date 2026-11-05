import { createPrivateKey, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { lockOf } from "./sol-chain.js";
import { fromPairs, launchpadOf } from "./sol-discover.js";
import type { ImdFile, ImdJob, ImdPort } from "./sol-imd.js";
import {
  actText, checkMeta, checkOptions, cleanText, type ConfigView, DBC_PROGRAM, devLock, priceFromSqrt, proxyRpc, readVerdict, safetyChecks, siteLabel,
  type SolChain, SolInputError, SolLaunchpad, type SolSettings, swarmBody, termsProblems, WSOL,
} from "./sol-launch.js";
import { grind, MintKeys } from "./sol-mints.js";
import { launchTxProblem, walletSigned } from "./sol-tx.js";

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
function launchTx(mint: string, o: { config?: string; nonce?: string | null; extra?: TransactionInstruction[] } = {}) {
  const tx = new Transaction();
  const me = creatorKp.publicKey, m = new PublicKey(mint);
  if (o.nonce) tx.add(SystemProgram.nonceAdvance({ noncePubkey: nonceKp.publicKey, authorizedPubkey: me }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(DBC_PROGRAM), data: Buffer.from([1]), keys: [{ pubkey: new PublicKey(o.config ?? CONFIG), isSigner: false, isWritable: false }, { pubkey: m, isSigner: true, isWritable: true }, { pubkey: me, isSigner: true, isWritable: true }] }));
  tx.add(new TransactionInstruction({ programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), data: Buffer.from([1]), keys: [{ pubkey: me, isSigner: true, isWritable: true }, { pubkey: m, isSigner: false, isWritable: false }] }));
  tx.add(SystemProgram.transfer({ fromPubkey: me, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
  for (const x of o.extra ?? []) tx.add(x);
  tx.feePayer = me;
  tx.recentBlockhash = o.nonce ?? BLOCKHASH;
  tx.partialSign(creatorKp);
  return tx;
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

describe("a launch that waits for the IMD swarm", () => {
  const swarmInput = { ...input, image: "", swarm: ["review", "logo", "website"], logoIdea: "a frog", chainId: 1 };
  const NONCE = nonceKp.publicKey.toBase58();

  async function waiting() {
    const { chain, sent } = fakeChain();
    const imd = fakeImd();
    const pad = make({ chain, imd: imd.port });
    const r = await pad.prepare(swarmInput);
    imd.s.paidBody = r.swarm!.body;
    const l = await pad.signed(r.mint, { tx: b64(launchTx(r.mint, { nonce: NONCE_VALUE })), config: CONFIG, nonce: NONCE });
    return { pad, r, l, imd, sent };
  }

  it("is checked by IMD for free, signed now, and nothing is sent", async () => {
    const { r, l, imd, sent } = await waiting();
    expect(imd.s.checked).toHaveLength(1);
    expect(r.swarm).toMatchObject({ chainId: 1, blockers: [], plan: ["Research and write the report"] });
    expect(JSON.parse(r.swarm!.body).objective).toContain(r.mint);
    expect(l).toMatchObject({ status: "waiting", nonce: NONCE, swarm: { state: "unpaid", picks: ["review", "logo", "website"] } });
    expect(sent).toHaveLength(0);
  });

  it("needs the payment that carried its body, then follows the job and launches when it completes", async () => {
    const { pad, r, imd, sent } = await waiting();
    await expect(pad.paid(r.mint, 1, `0x${"cd".repeat(32)}`)).rejects.toThrow(/not IMD's job/);
    expect((await pad.paid(r.mint, 1, PAY)).swarm).toMatchObject({ state: "paid", payTx: PAY });
    imd.s.job = { state: "executing", nodes: [{ key: "research_report", state: "accepted" }, { key: "token_logo", state: "running" }, { key: "build_website", state: "pending" }], site: null };
    await pad.work();
    expect(pad.one(r.mint)?.swarm?.steps.map((s) => s.state)).toEqual(["done", "working", "waiting"]);
    expect(sent).toHaveLength(0);
    expect(pad.waiting().map((x) => x.mint)).toEqual([r.mint]);
    imd.s.job = { state: "completed", nodes: [{ key: "research_report", state: "accepted" }, { key: "token_logo", state: "accepted" }, { key: "build_website", state: "accepted" }, { key: "design_critic", state: "accepted" }], site: "https://nfrog.imd.site" };
    imd.s.files = [{ name: "verdict", url: "https://api.imd.fun/artifacts/v", mediaType: "application/json" }, { name: "logo", url: "https://api.imd.fun/artifacts/logo", mediaType: "image/png" }, { name: "report", url: "https://api.imd.fun/artifacts/r", mediaType: "text/markdown" }];
    await pad.work();
    const l = pad.one(r.mint)!;
    expect(l).toMatchObject({ status: "live", swarm: { state: "done", verdict: { launch: true }, site: "https://nfrog.imd.site", logo: "https://api.imd.fun/artifacts/logo" } });
    expect(sent).toHaveLength(1);
    expect(Transaction.from(Buffer.from(sent[0]!, "base64")).verifySignatures(true)).toBe(true);
    // the token's metadata carries the swarm's logo; the creator's own website stays first
    expect(pad.meta(r.mint)).toMatchObject({ image: "https://api.imd.fun/artifacts/logo", extensions: { website: "https://frog.test/" } });
    expect(await pad.info()).toMatchObject({ counts: { live: 1, reviewed: 1, swarm: 1, waiting: 0 } });
  });

  it("never launches when the review says no, unless the owner overrules it", async () => {
    const { pad, r, imd, sent } = await waiting();
    await pad.paid(r.mint, 1, PAY);
    imd.s.verdict = '{"launch": false, "reason": "It copies an existing project."}';
    imd.s.files = [{ name: "verdict", url: "https://api.imd.fun/artifacts/v", mediaType: "application/json" }];
    await pad.work();
    expect(pad.one(r.mint)).toMatchObject({ status: "refused", note: expect.stringMatching(/copies an existing project/) });
    expect(sent).toHaveLength(0);
    await expect(pad.act(r.mint, "release", walletSign(creatorKp, actText("release", r.mint)))).rejects.toThrow(/not waiting/);
    expect((await pad.adminAct(r.mint, "release")).status).toBe("live");
    expect(sent).toHaveLength(1);
  });

  it("lets the creator launch without the swarm only once the swarm failed, and cancel any time", async () => {
    const { pad, r, imd, sent } = await waiting();
    await pad.paid(r.mint, 1, PAY);
    const release = walletSign(creatorKp, actText("release", r.mint));
    await pad.work();
    await expect(pad.act(r.mint, "release", release)).rejects.toThrow(/still working/);
    imd.s.job = { state: "failed", nodes: [], site: null };
    await pad.work();
    expect(pad.one(r.mint)?.swarm?.state).toBe("failed");
    await expect(pad.act(r.mint, "release", walletSign(Keypair.generate(), actText("release", r.mint)))).rejects.toThrow(/creator's wallet/);
    expect((await pad.act(r.mint, "release", release)).status).toBe("live");
    expect(sent).toHaveLength(1);

    const w = await waiting();
    expect((await w.pad.act(w.r.mint, "cancel", walletSign(creatorKp, actText("cancel", w.r.mint)))).status).toBe("cancelled");
    expect(w.pad.mints.keypair(w.r.mint)).toBeNull();
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

