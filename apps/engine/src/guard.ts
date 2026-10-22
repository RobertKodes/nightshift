import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, erc20Abi, formatUnits, parseAbi } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { ESCROW, TOKENS } from "./escrow.js";

/**
 * The Guard: every 5 minutes it reads the settings of the contracts that hold or route money and the game
 * escrow's solvency, and tells the operators the moment something changes. It only reads; it never sends a
 * transaction. A changed owner, keeper, signer or renderer, a paused escrow, or an escrow holding less than it
 * owes the players is said once, when it happens (and again when it is back to normal).
 */
type Watch = { label: string; address: Address; reads: string[] };
export const WATCHED: Watch[] = [
  { label: "FeeSplitter", address: "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44", reads: ["owner", "keeper", "rewards"] },
  { label: "GameEscrow", address: ESCROW, reads: ["signer"] },
  { label: "NIGHT WATCHERS forge", address: "0xbdff33cffc3f617f808a6de012a2574dbf69d819", reads: ["owner", "renderer", "skin"] },
];

/** What a stake-holding match owes back: both stakes once joined, the creator's alone while open. */
type Saved = { stake: string; token: "IMD" | "SHIFT"; openedAt?: number; joinedAt?: number; playerB?: string; closed?: unknown; refused?: string };
export function owedBy(challenges: Saved[]): Record<"IMD" | "SHIFT", bigint> {
  const out = { IMD: 0n, SHIFT: 0n };
  for (const c of challenges) {
    if (!c.openedAt || c.closed) continue;
    out[c.token] += BigInt(c.stake) * (c.playerB && c.joinedAt ? 2n : 1n);
  }
  return out;
}

/** The settings that moved since the last look: `label.read: old → new`. */
export function changed(before: Record<string, string>, now: Record<string, string>): string[] {
  return Object.keys(now).filter((k) => k in before && before[k] !== now[k]).map((k) => `${k}: ${before[k]} → ${now[k]}`);
}

const file = () => join(config.dataDir, "guard.json");
type State = { roles: Record<string, string>; flags: Record<string, boolean> };
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : { roles: {}, flags: {} }; } catch { return { roles: {}, flags: {} }; } };

export function startGuard(alert: (text: string, topic: string) => Promise<boolean>): void {
  const tick = async () => {
    const st = load();
    // 1. who controls what
    const roles: Record<string, string> = {};
    for (const w of WATCHED) for (const fn of w.reads) {
      const v: unknown = await eth.readContract({ address: w.address, abi: parseAbi([`function ${fn}() view returns (address)`]), functionName: fn as never }).catch(() => null);
      if (typeof v === "string") roles[`${w.label}.${fn}`] = v.toLowerCase();
    }
    const paused = await eth.readContract({ address: ESCROW, abi: parseAbi(["function paused() view returns (bool)"]), functionName: "paused" }).catch(() => null);
    for (const line of changed(st.roles, roles)) await alert(`🛡 Guard: ${line}. If this was not you, check it now.`, `guard-${line.split(":")[0]}`);
    // 2. the escrow: paused, and holding at least what it owes
    const flags: Record<string, boolean> = { ...st.flags };
    const say = async (key: string, on: boolean, bad: string, good: string) => { if (on !== Boolean(st.flags[key])) await alert(on ? bad : good, `guard-${key}`); flags[key] = on; };
    if (paused !== null) await say("paused", paused, "🛡 Guard: GameEscrow is PAUSED. Staked games cannot open or settle.", "🛡 Guard: GameEscrow is running again.");
    const saved = (() => { try { return JSON.parse(readFileSync(join(config.dataDir, "escrow.json"), "utf8")).challenges as Saved[]; } catch { return null; } })();
    if (saved) {
      const owed = owedBy(saved);
      for (const t of ["SHIFT", "IMD"] as const) {
        const bal = await eth.readContract({ address: TOKENS[t], abi: erc20Abi, functionName: "balanceOf", args: [ESCROW] }).catch(() => null);
        if (bal === null) continue;
        await say(`short-${t}`, bal < owed[t], `🛡 Guard: GameEscrow holds ${formatUnits(bal, 18)} ${t} but owes players ${formatUnits(owed[t], 18)} ${t}. Check it now.`, `🛡 Guard: GameEscrow covers every ${t} stake again.`);
      }
    }
    writeAtomic(file(), JSON.stringify({ roles: { ...st.roles, ...roles }, flags }, null, 2));
  };
  setInterval(() => void tick().catch((e) => console.error("guard", (e as Error).message)), 5 * 60_000);
  void tick().catch(() => {});
}
