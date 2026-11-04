import * as Device from "expo-device";
import { router } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, DEMO_REFUSAL, api, isDemo, loadToken, refreshIfOld, setDemo, setToken, type StepProof, whenSignedOut } from "../api/client";
import { forgetAll } from "../api/useData";
import { C, F } from "../theme";
import { ensureKey, fingerprint } from "./deviceKey";
import { followNotes, pushToken, setUpNotes } from "./push";
import { useWallet } from "./wallet";

type Status = "loading" | "out" | "in";
interface Session {
  status: Status;
  address: string | null;
  deviceId: string | null;
  /** connect a wallet, sign once: the owner is in and this phone can approve */
  signIn: () => Promise<void>;
  /** look around with example companies, no wallet */
  demo: boolean;
  /** development builds: take a session a test script made (src/app/dev.tsx) */
  adopt: (token: string) => Promise<void>;
  enterDemo: () => void;
  signOut: (everywhere?: boolean) => Promise<void>;
  /** the wallet signs one money-out action; resolves with the proof the engine asks for */
  confirm: (step: { action: "withdraw" | "close" | "delete" | "limits" | "erase" | "device"; companyId?: string; pubKey?: string }) => Promise<StepProof>;
  /** runs an action that may need the wallet's confirmation first: tries, and on 428 confirms and tries again */
  withStep: <T>(step: Parameters<Session["confirm"]>[0], run: (proof?: StepProof) => Promise<T>) => Promise<T>;
  /** register this phone's push token with the engine (asks for notification permission the first time) */
  enablePush: (ask?: boolean) => Promise<boolean>;
  toast: (text: string) => void;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => { const s = useContext(Ctx); if (!s) throw new Error("useSession outside SessionProvider"); return s; };

const phoneName = () => [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").slice(0, 40) || "Android phone";

export function SessionProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [status, setStatus] = useState<Status>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [demo, setDemoState] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  const toast = useCallback((text: string) => {
    setNote(text);
    fade.setValue(0);
    Animated.sequence([Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }), Animated.delay(2600), Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true })]).start(() => setNote(null));
  }, [fade]);

  const out = useCallback(async () => {
    setDemo(false); setDemoState(false);
    await setToken(null);
    await forgetAll();
    setAddress(null);
    setStatus("out");
  }, []);

  useEffect(() => {
    whenSignedOut(() => { void out(); router.replace("/sign-in"); });
    void setUpNotes().catch(() => {});
    void (async () => {
      const t = await loadToken();
      if (!t) return setStatus("out");
      await refreshIfOld();
      try {
        const me = await api.me();
        if (!me.address) return void (await out());
        setAddress(me.address);
        const k = await ensureKey().catch(() => null);
        if (k) setDeviceId(k.id);
        setStatus("in");
      } catch (e) {
        // offline at start: trust the stored session and show what the phone kept
        if ((e as ApiError).offline) { setAddress(t.split(".")[1] ?? null); setStatus("in"); } else await out();
      }
    })();
  }, [out]);

  useEffect(() => (status === "in" && !demo ? followNotes(toast) : undefined), [status, demo, toast]);

  const enablePush = useCallback(async (ask = true) => {
    if (!deviceId) return false;
    const token = await pushToken(ask);
    if (!token) return false;
    await api.updateDevice(deviceId, { fcmToken: token }).catch(() => {});
    return true;
  }, [deviceId]);

  const adopt = useCallback(async (token: string) => {
    if (!__DEV__) return;
    await setToken(token);
    const me = await api.me();
    setAddress(me.address);
    setDeviceId((await ensureKey()).id);
    setStatus("in");
    const push = await pushToken(true);
    if (push) await api.updateDevice((await ensureKey()).id, { fcmToken: push }).catch(() => {});
  }, []);

  const enterDemo = useCallback(() => {
    setDemo(true); setDemoState(true);
    // the example owner's wallet, as the mockups show it
    setAddress("0x7a3f00000000000000000000000000000000091c2"); setDeviceId("demo"); setStatus("in");
  }, []);

  const signIn = useCallback(async () => {
    if (isDemo()) { setDemo(false); setDemoState(false); }
    const addr = await wallet.connect();
    const key = await ensureKey();
    const n = await api.nonce(addr, key.id);
    // the engine wrote this phone's key into the message: the one signature vouches for both
    if (!n.message.includes(`urn:nightshift:device:${key.id}`)) throw new Error("The sign-in message did not name this phone. Try again.");
    const signature = await wallet.sign(n.message);
    const r = await api.verify({ address: addr, nonce: n.nonce, signature, device: { pubKey: key.pubKey, name: phoneName() } });
    await setToken(r.token);
    setAddress(r.address.toLowerCase());
    setDeviceId(r.device?.id ?? key.id);
    setStatus("in");
    // Android 13+: the notification question comes right after sign-in, when it makes sense
    const token = await pushToken(true);
    if (token) await api.updateDevice(r.device?.id ?? key.id, { fcmToken: token }).catch(() => {});
  }, [wallet]);

  const signOut = useCallback(async (everywhere = false) => {
    if (isDemo()) { await out(); router.replace("/sign-in"); return; }
    // this phone stops getting notes first, then the session ends
    if (deviceId) await api.removeDevice(deviceId).catch(() => {});
    if (everywhere) await api.logoutAll().catch(() => {}); else await api.logout().catch(() => {});
    wallet.disconnect();
    await out();
    router.replace("/sign-in");
  }, [deviceId, wallet, out]);

  const confirm = useCallback(async (step: Parameters<Session["confirm"]>[0]): Promise<StepProof> => {
    if (isDemo()) throw new Error(DEMO_REFUSAL);
    await wallet.connect();
    const s = await api.step(step);
    const signature = await wallet.sign(s.message, address ?? undefined);
    return { nonce: s.nonce, signature };
  }, [wallet, address]);

  const withStep = useCallback(async <T,>(step: Parameters<Session["confirm"]>[0], run: (proof?: StepProof) => Promise<T>): Promise<T> => {
    try { return await run(); } catch (e) {
      if (!(e instanceof ApiError) || !e.stepUp) throw e;
      return run(await confirm(step));
    }
  }, [confirm]);

  const value = useMemo<Session>(() => ({ status, address, deviceId, signIn, demo, enterDemo, adopt, signOut, confirm, withStep, enablePush, toast }), [status, address, deviceId, signIn, demo, enterDemo, adopt, signOut, confirm, withStep, enablePush, toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {note && (
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 18, right: 18, bottom: insets.bottom + 92, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <View style={{ backgroundColor: "#16132f", borderColor: C.lineHi, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16 }}>
            <Text style={{ color: C.ink, fontFamily: F.ui, fontSize: 15 }}>{note}</Text>
          </View>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

export { fingerprint };
