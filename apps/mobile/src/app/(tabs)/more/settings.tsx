import * as Application from "expo-application";
import * as LocalAuthentication from "expo-local-authentication";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { ApiError, BASE, api } from "../../../api/client";
import type { ApiKeyView, DeviceView } from "../../../api/types";
import { useData } from "../../../api/useData";
import { replaceKey } from "../../../lib/deviceKey";
import { notesAllowed } from "../../../lib/push";
import { useSession } from "../../../lib/session";
import { C, F, S, ago, short } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { Frame } from "../../../ui/Frame";
import { Icon } from "../../../ui/icons";
import { Body, Button, Caps, Dim, Header, Link, Mono, Problem, Section, Title, Toggle } from "../../../ui/kit";

const KINDS: { k: keyof DeviceView["prefs"]; title: string; sub: string }[] = [
  { k: "approval", title: "Approvals", sub: "A company holds a spend for you" },
  { k: "sale", title: "Sales", sub: "Something sold, to a person or an agent" },
  { k: "result", title: "Deliveries", sub: "The swarm finished a piece of work" },
  { k: "warning", title: "Warnings", sub: "Something went wrong or needs a look" },
];

/** This phone, the owner's other phones, notifications, sessions, API keys, and deleting the account. */
export default function Settings() {
  const { address, deviceId, signOut, enablePush, confirm, withStep, toast } = useSession();
  const devices = useData<DeviceView[]>("devices", () => api.devices());
  const keys = useData<ApiKeyView[]>("keys", () => api.keys());
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void notesAllowed().then(setAllowed); }, []);
  const me = devices.data?.find((d) => d.id === deviceId) ?? null;
  const others = (devices.data ?? []).filter((d) => d.id !== deviceId);

  const pref = async (k: keyof DeviceView["prefs"], v: boolean) => {
    if (!me) return;
    devices.set((list) => list?.map((d) => (d.id === me.id ? { ...d, prefs: { ...d.prefs, [k]: v } } : d)) ?? list);
    try { await api.updateDevice(me.id, { prefs: { [k]: v } }); } catch (e) { toast((e as ApiError).message); await devices.refresh(); }
  };
  const turnOn = async () => {
    setBusy("push");
    const ok = await enablePush(true);
    setAllowed(await notesAllowed());
    if (!ok) toast((await notesAllowed()) ? "Notifications are allowed, but this build has no Firebase set up yet." : "Notifications are off for NIGHTSHIFT in Android settings.");
    await devices.refresh();
    setBusy(null);
  };
  const rekey = async () => {
    setErr(null); setBusy("rekey");
    try {
      const old = deviceId;
      const k = await replaceKey();
      const proof = await confirm({ action: "device", pubKey: k.pubKey });
      await api.addDevice({ pubKey: k.pubKey, name: me?.name }, proof);
      if (old && old !== k.id) await api.removeDevice(old).catch(() => {});
      toast("This phone has a new approval key. Sign out and in once to use it everywhere.");
      await devices.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const erase = async () => {
    const bio = await LocalAuthentication.authenticateAsync({ promptMessage: "Delete your NIGHTSHIFT account" });
    if (!bio.success) return;
    setErr(null); setBusy("erase");
    try {
      await withStep({ action: "erase" }, (p) => api.deleteAccount(p));
      toast("Your account is deleted.");
      await signOut();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 48 }}>
        {err && <Problem text={err} />}
        <Section style={{ marginTop: 4 }}>This phone</Section>
        <Frame tick>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Icon name="phone" size={24} color={C.lime} />
            <View style={{ flex: 1 }}>
              <Title style={{ fontSize: 17 }}>{me?.name ?? "This phone"}</Title>
              <Mono style={{ fontSize: 12.5, color: C.faint }}>key {deviceId ?? "…"} · signed in as {short(address)}</Mono>
            </View>
          </View>
          <Body style={{ color: C.dim, fontSize: 14, marginTop: 10 }}>Approvals from this phone are signed by a key in its secure hardware, after your fingerprint. The key never leaves the phone.</Body>
          <Link onPress={() => Alert.alert("Make a new approval key?", "Use this when the phone says its fingerprints changed. Your wallet signs once to vouch for the new key.", [{ text: "Not now", style: "cancel" }, { text: "Make a new key", onPress: () => void rekey() }])} color={C.violetHi} style={{ marginTop: 10 }}>{busy === "rekey" ? "Making a new key…" : "Make a new approval key"}</Link>
        </Frame>

        <Section>Notifications</Section>
        <Frame tick padding={0}>
          {!allowed || !me?.push ? (
            <View style={{ padding: 16, gap: 12 }}>
              <Body style={{ fontSize: 15, color: C.dim }}>{allowed === false ? "Notifications are off for NIGHTSHIFT. Turn them on to hear about approvals on your lock screen." : "This phone is not getting notes yet."}</Body>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button kind="lime" icon="bell" busy={busy === "push"} onPress={turnOn} style={{ flex: 1 }}>Turn on notifications</Button>
                {allowed === false && <Button onPress={() => void Linking.openSettings()}>Android settings</Button>}
              </View>
            </View>
          ) : KINDS.map((x, i) => (
            <View key={x.k} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: i === KINDS.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
              <View style={{ flex: 1 }}><Text style={{ fontFamily: F.uiSemi, color: C.ink, fontSize: 16 }}>{x.title}</Text><Dim style={{ fontSize: 13 }}>{x.sub}</Dim></View>
              <Toggle value={me.prefs[x.k]} onChange={(v) => void pref(x.k, v)} />
            </View>
          ))}
        </Frame>

        {others.length > 0 && (
          <>
            <Section>Your other phones</Section>
            <Frame tick padding={0}>
              {others.map((d, i) => (
                <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: i === others.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
                  <View style={{ flex: 1 }}><Text style={{ fontFamily: F.ui, color: C.ink, fontSize: 15.5 }}>{d.name}</Text><Mono style={{ fontSize: 12, color: C.faint }}>key {d.id} · seen {ago(d.lastSeenAt)} ago</Mono></View>
                  <Link color={C.coral} onPress={() => Alert.alert(`Remove ${d.name}?`, "Its key stops approving anything and it gets no more notes. Lost a phone? Also sign out everywhere below.", [{ text: "Keep", style: "cancel" }, { text: "Remove", style: "destructive", onPress: async () => { await api.removeDevice(d.id).catch((e: Error) => toast(e.message)); await devices.refresh(); } }])}>Remove</Link>
                </View>
              ))}
            </Frame>
          </>
        )}

        <Section>Sessions</Section>
        <Frame tick style={{ gap: 10 }}>
          <Button icon="logout" onPress={() => void signOut(false)}>Sign out of this phone</Button>
          <Button kind="danger" icon="shield" onPress={() => Alert.alert("Sign out everywhere?", "Every session of this wallet ends now: this phone, other phones and the website.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out everywhere", style: "destructive", onPress: () => void signOut(true) }])}>Sign out everywhere</Button>
          <Dim style={{ fontSize: 13 }}>Lost this phone? From another device, sign out everywhere and remove the phone: its key stops working at once.</Dim>
        </Frame>

        <Section>API keys</Section>
        <Frame tick padding={keys.data?.length ? 0 : 16}>
          {(keys.data ?? []).length === 0 ? <Dim>No API keys. Keys let an AI assistant (Claude, Cursor) run your companies over MCP; you make them on the website.</Dim> : keys.data!.map((k, i) => (
            <View key={k.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: i === keys.data!.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
              <Icon name="key" size={18} color={k.spend ? C.amber : C.faint} />
              <View style={{ flex: 1 }}><Text style={{ fontFamily: F.ui, color: C.ink, fontSize: 15.5 }}>{k.label}</Text><Mono style={{ fontSize: 12, color: C.faint }}>{k.id}… · {k.spend ? "can spend" : "no spending"} · used {k.lastUsedAt ? `${ago(k.lastUsedAt)} ago` : "never"}</Mono></View>
              <Link color={C.coral} onPress={() => Alert.alert(`Revoke "${k.label}"?`, "Anything using this key stops working at once.", [{ text: "Keep", style: "cancel" }, { text: "Revoke", style: "destructive", onPress: async () => { await api.revokeKey(k.id).catch((e: Error) => toast(e.message)); await keys.refresh(); } }])}>Revoke</Link>
            </View>
          ))}
        </Frame>

        <Section>Account</Section>
        <Frame tick stroke="#4a1d2b" style={{ gap: 10 }}>
          <Body style={{ color: C.dim, fontSize: 14.5 }}>Deleting your account removes your API keys, phones, sessions, player name and alert links. Stop and delete your companies first: stopping sends their funds back to your wallet.</Body>
          <Button kind="danger" icon="trash" busy={busy === "erase"} onPress={() => Alert.alert("Delete your NIGHTSHIFT account?", "This cannot be undone. Your fingerprint and your wallet's signature confirm it.", [{ text: "Cancel", style: "cancel" }, { text: "Delete account", style: "destructive", onPress: () => void erase() }])}>Delete account</Button>
        </Frame>

        <View style={{ marginTop: 26, alignItems: "center", gap: 6 }}>
          <Caps style={{ fontSize: 11 }}>NIGHTSHIFT {Application.nativeApplicationVersion ?? ""} ({Application.nativeBuildVersion ?? ""})</Caps>
          <Mono style={{ fontSize: 11.5, color: C.ghost }}>{BASE.replace(/^https?:\/\//, "")}</Mono>
          <View style={{ flexDirection: "row", gap: 18, marginTop: 6 }}>
            <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/privacy")}>Privacy</Link>
            <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/terms")}>Terms</Link>
            <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/security")}>Security</Link>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
