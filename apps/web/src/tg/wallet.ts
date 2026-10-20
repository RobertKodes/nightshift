import { createWalletClient, custom, getAddress } from "viem";
import { api, setBearer } from "../api";
import { checkSignIn } from "../session";
import { chooseWallet } from "../wallet";
import { type Me, tg } from "./api";

/**
 * Links the player's own wallet to their Telegram profile with the site's sign-in message
 * (EIP-4361, the same nonce, the same checks before signing), so staked duels and the website know
 * the same player. The wallet only signs a message: nothing is sent, nothing is held for anyone.
 * The session comes back as a cookie and, for Telegram Web (a framed page gets no cookie), as a
 * token kept in this page's memory only.
 */
export async function linkWallet(): Promise<Me> {
  const eth = await chooseWallet({ ask: true });
  const wallet = createWalletClient({ transport: custom(eth as never) });
  const [acct] = await wallet.requestAddresses();
  if (!acct) throw new Error("No account selected.");
  const address = getAddress(acct);
  const { nonce, message } = await api.nonce(address);
  checkSignIn(message, address, nonce, import.meta.env.DEV ? null : location);
  const signature = await wallet.signMessage({ account: address, message });
  const me = await tg<Me>("wallet", { address, nonce, signature });
  if (me.session) setBearer(me.session);
  return me;
}

/** Unlinks the wallet from the profile and ends this page's session. */
export async function unlinkWallet(): Promise<Me> {
  const me = await tg<Me>("wallet", { unlink: true });
  await api.logout().catch(() => {});
  setBearer(null);
  return me;
}
