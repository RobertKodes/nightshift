/**
 * A player's name when they never typed one: a short handle that is theirs ("Frog-7F3A", from the
 * signed-in wallet, else from a random id this device keeps), never a name everyone shares.
 */
const DEVICE = "ns-device";
let wallet: string | null = null;
/** The session's wallet, set by the session: handles follow it once signed in. */
export function rememberWallet(address: string | null): void { wallet = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null; }
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id || !/^[0-9a-f]{8}$/.test(id)) { id = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem(DEVICE, id); }
    return id;
  } catch { return "0000"; }
}
export const handleFor = (address?: string | null) => `Frog-${(address ?? wallet)?.slice(2, 6).toUpperCase() ?? deviceId().slice(0, 4).toUpperCase()}`;
/** The old shared default is no name. */
const NO_NAME = /^\s*(night crew)?\s*$/i;
/** What a player plays under: the name they typed, else their handle. */
export const nameOr = (typed: string | null | undefined, address?: string | null) => (typed && !NO_NAME.test(typed) ? typed.trim() : handleFor(address));
/** A name they typed (not empty, not the old default). */
export const typedName = (typed: string | null | undefined) => !!typed && !NO_NAME.test(typed);

/**
 * One player name for every game, kept on this device (the name games each kept before are read
 * once, so nobody loses theirs) and, once signed in, saved on the wallet by the server, which then
 * seats the player under it in every game, whatever link they came in by.
 */
const NAME = "ns-name";
const OLD = ["nk-name", "nc-name", "pb-name", "np-name"];
export function localName(): string | null {
  try {
    const n = localStorage.getItem(NAME) ?? OLD.map((k) => localStorage.getItem(k)).find((x) => typedName(x)) ?? null;
    return typedName(n) ? n!.trim() : null;
  } catch { return null; }
}
const keep = (n: string) => { try { localStorage.setItem(NAME, n); } catch { /* private window */ } };

/** Saves the name: on this device, and on the wallet when signed in (the server's answer is the name kept). */
export async function saveName(raw: string, signedIn: boolean): Promise<string> {
  const n = raw.trim().slice(0, 18);
  if (!n) throw new Error("Type a name first.");
  if (!signedIn) { keep(n); return n; }
  const r = await fetch("/api/player/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) });
  const j = (await r.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!r.ok || !j.name) throw new Error(j.error ?? "The name was not saved.");
  keep(j.name);
  return j.name;
}

/** After sign-in: the wallet's saved name comes to this device; a name typed here before goes to the wallet. */
export async function syncName(): Promise<string | null> {
  try {
    const r = (await (await fetch("/api/player")).json()) as { name: string | null; signedIn: boolean };
    if (r.name) { keep(r.name); return r.name; }
    const here = localName();
    if (r.signedIn && here) return await saveName(here, true).catch(() => here);
    return here;
  } catch { return localName(); }
}

/** Keeps a name typed in a game: on this device at once, and on the wallet too when signed in. */
export function keepName(n: string, signedIn: boolean): void {
  if (!typedName(n)) return;
  keep(n.trim().slice(0, 18));
  if (signedIn) void saveName(n, true).catch(() => { /* taken or refused: the game keeps the typed name */ });
}
