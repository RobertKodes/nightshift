import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { chooseWallet } from "./wallet";
import { createWalletClient, custom, getAddress } from "viem";
import { api } from "./api";

interface Session { address: string | null; signIn: () => Promise<void>; signOut: () => Promise<void>; busy: boolean; error: string | null }
const Ctx = createContext<Session>({ address: null, signIn: async () => {}, signOut: async () => {}, busy: false, error: null });
export const useSession = () => useContext(Ctx);

/** Sign-in with a wallet: the engine gives a nonce, the wallet signs, the engine sets a session cookie. */
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
