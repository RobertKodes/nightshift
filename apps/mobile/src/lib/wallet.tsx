import "@walletconnect/react-native-compat";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import { AppKit, AppKitProvider, type AppKitNetwork, type Storage, createAppKit, useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "../api/client";

/**
 * The owner's wallet over WalletConnect (Reown AppKit): it connects, signs the sign-in message, and
 * signs again for money-out actions. The Reown project is the site's own, read from the engine
 * (GET /api/wallet-config) so the app and the site stay one project. No swaps, no on-ramp, no
 * buying in the app (Google Play's payments rules).
 */

const mainnet: AppKitNetwork = {
  id: 1, name: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://cloudflare-eth.com"] } }, blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
  chainNamespace: "eip155", caipNetworkId: "eip155:1",
};
const base: AppKitNetwork = {
  id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } }, blockExplorers: { default: { name: "Basescan", url: "https://basescan.org" } },
  chainNamespace: "eip155", caipNetworkId: "eip155:8453",
};

const storage: Storage = {
  async getKeys() { return [...(await AsyncStorage.getAllKeys())].filter((k) => !k.startsWith("ns.")); },
  async getEntries<T = unknown>() {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => !k.startsWith("ns."));
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([k, v]) => [k, v == null ? undefined : JSON.parse(v)] as [string, T]);
  },
  async getItem<T = unknown>(key: string) { const v = await AsyncStorage.getItem(key); return v == null ? undefined : (JSON.parse(v) as T); },
  async setItem<T = unknown>(key: string, value: T) { await AsyncStorage.setItem(key, JSON.stringify(value)); },
  async removeItem(key: string) { await AsyncStorage.removeItem(key); },
};

const PROJECT_KEY = "ns.wc.project";
let kit: ReturnType<typeof createAppKit> | null = null;
function appKit(projectId: string) {
  kit ??= createAppKit({
    projectId,
    networks: [mainnet, base],
    defaultNetwork: mainnet,
    adapters: [new EthersAdapter()],
    storage,
    // Play payments policy: nothing to buy, swap or top up in the app
    features: { swaps: false, onramp: false, socials: false },
    metadata: {
      name: "NIGHTSHIFT",
      description: "Run your AI companies from your phone",
      url: "https://getnightshift.tech",
      icons: ["https://getnightshift.tech/app/icon-192.png"],
      redirect: { native: "nightshift://", universal: "https://getnightshift.tech/app" },
    },
    themeMode: "dark",
    themeVariables: { accent: "#b8ff3d" },
  } as Parameters<typeof createAppKit>[0]);
  return kit;
}

/** Wraps the app once the Reown project is known: from the engine, else the last one this phone saw, else the build's. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(kit ? "ready" : null);
  useEffect(() => {
    if (kit) return;
    let done = false;
    const use = (id: string) => { if (!done && id) { done = true; setProjectId(id); } };
    void AsyncStorage.getItem(PROJECT_KEY).then((saved) => {
      api.walletConfig()
        .then((c) => { if (c.walletConnect) { void AsyncStorage.setItem(PROJECT_KEY, c.walletConnect); use(c.walletConnect); } else use(saved ?? process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? ""); })
        .catch(() => use(saved ?? process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? ""));
    });
  }, []);
  if (!projectId) return null;
  const instance = appKit(projectId === "ready" ? "" : projectId);
  return (
    <AppKitProvider instance={instance}>
      {children}
      {/* the wallet sheet needs a full-screen host above the router's screens */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none"><AppKit /></View>
    </AppKitProvider>
  );
}

const hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The connected wallet: connect, the address, sign a message (EIP-191 personal_sign), disconnect. */
export function useWallet() {
  const { open, disconnect } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { provider } = useProvider();
  const pending = useRef<{ resolve: (a: string) => void; reject: (e: Error) => void } | null>(null);
  useEffect(() => { if (isConnected && address && pending.current) { pending.current.resolve(address); pending.current = null; } }, [isConnected, address]);

  /** Opens the wallet list and resolves with the address once a wallet connects (or rejects after 3 minutes). */
  const connect = (): Promise<string> => {
    if (isConnected && address) return Promise.resolve(address);
    open();
    return new Promise((resolve, reject) => {
      pending.current = { resolve, reject };
      setTimeout(() => { if (pending.current) { pending.current.reject(new Error("No wallet connected.")); pending.current = null; } }, 180_000);
    });
  };

  const sign = async (message: string, as?: string): Promise<string> => {
    if (!provider || !address) throw new Error("Connect your wallet first.");
    if (as && as.toLowerCase() !== address.toLowerCase()) throw new Error(`Your wallet is on ${address.slice(0, 6)}…${address.slice(-4)}. Switch it to the wallet that owns these companies.`);
    const chain = chainId ? (String(chainId).includes(":") ? String(chainId) : `eip155:${chainId}`) : "eip155:1";
    const sig = await provider.request<string>({ method: "personal_sign", params: [hex(message), address] }, chain);
    if (typeof sig !== "string" || !sig.startsWith("0x")) throw new Error("The wallet did not sign.");
    return sig;
  };

  return { address: address ?? null, isConnected: Boolean(isConnected), connect, sign, disconnect: () => disconnect() };
}
