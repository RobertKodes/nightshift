import type { IncomingMessage } from "node:http";
import { type Address, type Hex, createPublicClient, custom, decodeAbiParameters, isErc6492Signature, pad, parseErc6492Signature, recoverAddress, serializeErc6492Signature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { Auth, type ApiKey, MAX_KEYS_PER_OWNER } from "./auth.js";
import { socialLogin, walletConfig } from "./wallet-config.js";

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as unknown as IncomingMessage;

/**
 * Ethereum as a mocked node holding one smart account whose single owner key approves signatures:
 * what its ERC-1271 isValidSignature answers. viem's own check runs unchanged: it sends the
 * ERC-6492 universal validator (deployed or not yet) as an eth_call with (account, hash, signature),
 * and the node answers the validator's one byte.
 */
function node(account: Address, owner: Address, o: { down?: () => boolean } = {}) {
  const calls: string[] = [];
  const client = createPublicClient({
    chain: mainnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        calls.push(method);
        if (o.down?.()) throw new Error("node unreachable");
        if (method === "eth_blockNumber") return "0x1";
        if (method !== "eth_call") throw new Error(`unexpected ${method}`);
        const data = (params as [{ data: Hex }])[0].data;
        const at = data.toLowerCase().lastIndexOf(pad(account).slice(2).toLowerCase());
        if (at < 0) return "0x00";
        const [who, hash, sig] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "bytes" }], `0x${data.slice(at)}`);
        // before its first transaction the account signs as ERC-6492: its factory call wrapped around the owner's signature
        const inner = isErc6492Signature(sig) ? parseErc6492Signature(sig).signature : sig;
        const ok = who.toLowerCase() === account.toLowerCase() && (await recoverAddress({ hash, signature: inner }).catch(() => "0x")).toLowerCase() === owner.toLowerCase();
        return ok ? "0x01" : "0x00";
      },
    }),
  });
  return { client, calls };
}

describe("wallet sign-in and API keys", () => {
  it("signs a wallet in and recognises its session, and nobody else's", async () => {
    const auth = new Auth("s3cret", [], () => {});
    const me = privateKeyToAccount(generatePrivateKey());
    const n = auth.nonce();
    const sig = await me.signMessage({ message: n.message(me.address) });
    const token = await auth.verify(me.address, n.nonce, sig);
    expect(auth.owner(req(token))).toBe(me.address.toLowerCase());
    // A nonce works once.
    await expect(auth.verify(me.address, n.nonce, sig)).rejects.toThrow();
    // A tampered or foreign session is nobody.
    expect(auth.owner(req(token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))))).toBeNull();
    expect(new Auth("other", [], () => {}).owner(req(token))).toBeNull();
  });

  it("refuses a signature from another wallet", async () => {
    const me = privateKeyToAccount(generatePrivateKey());
    const auth = new Auth("s3cret", [], () => {}, { chain: node(me.address, me.address).client });
    const thief = privateKeyToAccount(generatePrivateKey());
    const n = auth.nonce();
    const sig = await thief.signMessage({ message: n.message(me.address) });
    await expect(auth.verify(me.address, n.nonce, sig)).rejects.toThrow(/does not match/);
  });

  it("signs a plain wallet in without asking any node", async () => {
    const me = privateKeyToAccount(generatePrivateKey());
    const eth = node(me.address, me.address);
    const auth = new Auth("s3cret", [], () => {}, { chain: eth.client });
    const n = auth.nonce();
    const token = await auth.verify(me.address, n.nonce, await me.signMessage({ message: n.message(me.address) }));
    expect(auth.owner(req(token))).toBe(me.address.toLowerCase());
    expect(eth.calls).toEqual([]);
  });

  it("signs a smart account in through ERC-1271 on Ethereum, and refuses a key that does not own it", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const thief = privateKeyToAccount(generatePrivateKey());
    const account = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe" as Address;
    const eth = node(account, owner.address);
    const auth = new Auth("s3cret", [], () => {}, { chain: eth.client });
    const n = auth.nonce();
    const token = await auth.verify(account, n.nonce, await owner.signMessage({ message: n.message(account) }));
    // the session is the smart account's, not its owner key's
    expect(auth.owner(req(token))).toBe(account.toLowerCase());
    expect(eth.calls).toContain("eth_call");
    const m = auth.nonce();
    await expect(auth.verify(account, m.nonce, await thief.signMessage({ message: m.message(account) }))).rejects.toThrow(/does not match/);
    // one try per nonce, even with the right key afterwards
    await expect(auth.verify(account, m.nonce, await owner.signMessage({ message: m.message(account) }))).rejects.toThrow(/expired/);
  });

  it("signs in a smart account not deployed yet (ERC-6492)", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = "0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff" as Address;
    const eth = node(account, owner.address);
    const auth = new Auth("s3cret", [], () => {}, { chain: eth.client });
    const n = auth.nonce();
    const signature = serializeErc6492Signature({ address: "0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a", data: "0x5fbfb9cf", signature: await owner.signMessage({ message: n.message(account) }) });
    const token = await auth.verify(account, n.nonce, signature);
    expect(auth.owner(req(token))).toBe(account.toLowerCase());
  });

  it("says so when the node cannot be asked, and the same sign-in works once it answers", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe" as Address;
    let down = true;
    const auth = new Auth("s3cret", [], () => {}, { chain: node(account, owner.address, { down: () => down }).client });
    const n = auth.nonce();
    const sig = await owner.signMessage({ message: n.message(account) });
    await expect(auth.verify(account, n.nonce, sig)).rejects.toThrow(/could not be checked/);
    down = false;
    expect(auth.owner(req(await auth.verify(account, n.nonce, sig)))).toBe(account.toLowerCase());
  });

  it("gives the wallet layer the site's exact origin for Reown's domain check", () => {
    expect(walletConfig({ walletConnect: "adbab93f28eb7aa847cbe829b7a530d3", publicUrl: "https://getnightshift.tech", salesChainId: 8453 }, true))
      .toEqual({ walletConnect: "adbab93f28eb7aa847cbe829b7a530d3", site: "https://getnightshift.tech", salesChainId: 8453, social: true });
    expect(walletConfig({ walletConnect: "", publicUrl: "http://localhost:8784", salesChainId: 84532 }, false).walletConnect).toBeNull();
  });

  it("offers email and social sign-in unless /setup or the environment switches it off, /setup first", () => {
    expect(socialLogin({}, {})).toBe(true);
    expect(socialLogin({}, { WALLET_SOCIAL_LOGIN: "0" })).toBe(false);
    expect(socialLogin({ WALLET_SOCIAL_LOGIN: "1" }, { WALLET_SOCIAL_LOGIN: "0" })).toBe(true);
    expect(socialLogin({ WALLET_SOCIAL_LOGIN: "0" }, {})).toBe(false);
  });

  it("mints, recognises and revokes API keys, storing only their hash", () => {
    const keys: ApiKey[] = [];
    const auth = new Auth("s3cret", keys, () => {});
    const { key, record } = auth.createKey("0xABC0000000000000000000000000000000000001", "Claude");
    expect(key.startsWith("nsk_")).toBe(true);
    expect(JSON.stringify(keys)).not.toContain(key);
    expect(auth.owner(req(key))).toBe("0xabc0000000000000000000000000000000000001");
    expect(auth.revokeKey("0xabc0000000000000000000000000000000000001", record.id)).toBe(true);
    expect(auth.owner(req(key))).toBeNull();
  });

  it("caps the keys one wallet holds, and finds keys loaded from the state file", () => {
    const keys: ApiKey[] = [];
    const auth = new Auth("s3cret", keys, () => {});
    const me = "0xabc0000000000000000000000000000000000002";
    const made = Array.from({ length: MAX_KEYS_PER_OWNER }, () => auth.createKey(me, "agent"));
    expect(() => auth.createKey(me, "one more")).toThrow(/revoke one first/);
    expect(auth.createKey("0xabc0000000000000000000000000000000000003", "other").key).toMatch(/^nsk_/); // per wallet, not in all
    expect(auth.revokeKey(me, made[0]!.record.id)).toBe(true);
    expect(auth.createKey(me, "again").key).toMatch(/^nsk_/);
    // after a restart the same records are indexed again, also when they are loaded after the start
    const loaded: ApiKey[] = [];
    const reloaded = new Auth("s3cret", loaded, () => {});
    loaded.push(...keys);
    expect(reloaded.owner(req(made[1]!.key))).toBe(me);
    expect(reloaded.owner(req(made[0]!.key))).toBeNull();
  });
});
