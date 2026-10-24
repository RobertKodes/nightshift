import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { publicName } from "./names.js";

/**
 * Player names, saved on the signed-in wallet: one name across every game, whatever link a player
 * came in by. Each name belongs to one wallet, so two players never show up under the same name.
 * The same rules as every public name apply (names.ts).
 */
const file = () => join(config.dataDir, "players.json");
let names: Record<string, { name: string; at: number }> | null = null;

function all(): Record<string, { name: string; at: number }> {
  if (names) return names;
  try { names = existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as typeof names) : {}; } catch { names = {}; }
  return names!;
}

/** The name this wallet saved, if any. */
export function savedName(wallet?: string | null): string | null {
  return wallet ? all()[wallet.toLowerCase()]?.name ?? null : null;
}

export class NameError extends Error {}

/** Saves the wallet's name: checked like every public name, and free (no other wallet has it). */
export function saveName(wallet: string, raw: unknown, now = Date.now()): string {
  const name = publicName(raw, { max: 18 });
  if (!name) throw new NameError("Pick a name with letters or numbers (up to 18), not one that reads as NIGHTSHIFT, IMD or staff.");
  const w = wallet.toLowerCase(), key = name.toLowerCase();
  const taken = Object.entries(all()).find(([x, v]) => x !== w && v.name.toLowerCase() === key);
  if (taken) throw new NameError(`"${name}" is taken by another player. Pick another.`);
  all()[w] = { name, at: now };
  writeAtomic(file(), JSON.stringify(all()), { mode: 0o600 });
  return name;
}

/** For tests: forget the cache so the next read comes from disk. */
export function resetPlayers(): void { names = null; }
