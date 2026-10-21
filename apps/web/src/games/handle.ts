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
