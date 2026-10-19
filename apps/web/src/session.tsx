import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { chooseWallet } from "./wallet";
import { createWalletClient, custom, getAddress } from "viem";
import { api } from "./api";

interface Session { address: string | null; signIn: () => Promise<void>; signOut: () => Promise<void>; busy: boolean; error: string | null }
const Ctx = createContext<Session>({ address: null, signIn: async () => {}, signOut: async () => {}, busy: false, error: null });
export const useSession = () => useContext(Ctx);

/**
 * The wallet signs only a sign-in message for this site, this wallet and this nonce, still fresh: the lines
 * the engine's EIP-4361 builder writes (auth.ts), checked one by one. Anything else is refused unsigned.
 */
function checkSignIn(message: string, address: string, nonce: string, site: { host: string; origin: string } | null, now = Date.now()): void {
  const lines = message.split("\n");
  const field = (k: string) => lines.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2);
  const refuse = (why: string): never => { throw new Error(`Not signed: ${why}. Reload the page and try again.`); };
  // site null: the dev server, which proxies the engine from another port (there host and URI are the engine's)
  if (site && lines[0] !== `${site.host} wants you to sign in with your Ethereum account:`) refuse("the message is for another site");
  if (site && field("URI") !== site.origin) refuse("the message points to another site");
  if ((lines[1] ?? "").toLowerCase() !== address.toLowerCase()) refuse("the message names another wallet");
  if (field("Chain ID") !== "1") refuse("the message is for another chain");
  if (field("Nonce") !== nonce) refuse("the message does not match this sign-in");
  if (!(Date.parse(field("Expiration Time") ?? "") > now)) refuse("the message has expired");
}

/** Sign-in with a wallet: the engine gives a nonce, the wallet signs, the engine sets a session cookie (never shown to the page). */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.me().then((m) => setAddress(m.address)).catch(() => {}); }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const eth = await chooseWallet({ ask: true });
      const wallet = createWalletClient({ transport: custom(eth as never) });
      const [acct] = await wallet.requestAddresses();
      if (!acct) throw new Error("No account selected");
      const addr = getAddress(acct);
      const { nonce, message } = await api.nonce(addr);
      checkSignIn(message, addr, nonce, import.meta.env.DEV ? null : location);
      const signature = await wallet.signMessage({ account: addr, message });
      const r = await api.verify(addr, nonce, signature);
      setAddress(r.address.toLowerCase());
    } catch (e) {
      setError((e as Error).message.split("\n")[0] ?? "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }, []);
  const signOut = useCallback(async () => { await api.logout().catch(() => {}); setAddress(null); }, []);
  return <Ctx.Provider value={{ address, signIn, signOut, busy, error }}>{children}</Ctx.Provider>;
}
