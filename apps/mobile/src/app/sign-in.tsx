import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readiness } from "../lib/deviceKey";
import { useSession } from "../lib/session";
import { C, F, S } from "../theme";
import { Backdrop } from "../ui/Backdrop";
import { Frame } from "../ui/Frame";
import { Icon } from "../ui/icons";
import { Body, Button, Caps, Dim, H1, Link, Problem, Serif } from "../ui/kit";

/** The front door: connect the wallet that owns the companies and sign once. */
export default function SignIn() {
  const { signIn, enterDemo } = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bio, setBio] = useState<string>("OK");
  useEffect(() => { void readiness().then(setBio); }, []);

  const go = async () => {
    setErr(null); setBusy(true);
    try { await signIn(); } catch (e) { setErr((e as Error).message || "Sign-in did not finish. Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glow={0.8} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28, paddingHorizontal: S.gutter + 4, flexGrow: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="moon" size={26} color={C.violetHi} />
          <Text style={{ fontFamily: F.uiSemi, color: C.ink, fontSize: 15, letterSpacing: 7 }}>NIGHTSHIFT</Text>
        </View>

        <View style={{ marginTop: 64 }}>
          <Caps style={{ color: C.violetHi, letterSpacing: 3.5 }}>Owner app</Caps>
          <H1 style={{ fontSize: 40, lineHeight: 46, marginTop: 12 }}>Your companies,{"\n"}<Serif style={{ fontSize: 44 }}>from your pocket.</Serif></H1>
          <Body style={{ color: C.dim, marginTop: 18, fontSize: 17, lineHeight: 25 }}>Found AI companies, steer their CEOs, watch every shift live and approve spending with your fingerprint.</Body>
        </View>

        <View style={{ marginTop: 34, gap: 10 }}>
          {[
            ["1", "Connect the wallet that owns your companies"],
            ["2", "Sign once: it proves the wallet is yours and moves no funds"],
            ["3", "This phone can then approve spending with your fingerprint"],
          ].map(([n, text]) => (
            <View key={n} style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              <Frame padding={0} cut={6} fill={C.panelHi} stroke={C.lineHi} style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: F.monoBold, color: C.lime, fontSize: 13 }}>{n}</Text>
              </Frame>
              <Body style={{ flex: 1, fontSize: 15.5, color: C.ink }}>{text}</Body>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, minHeight: 32 }} />
        {bio !== "OK" && (
          <Frame stroke="#5d4712" fill="#1a1508" style={{ marginBottom: 14 }}>
            <Body style={{ color: C.amber, fontSize: 14.5 }}>This phone has no fingerprint or face unlock set up. You can sign in and look around; to approve spending, add one in the phone's settings.</Body>
          </Frame>
        )}
        {err && <Problem text={err} />}
        <Button kind="lime" big icon="bolt" onPress={go} busy={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</Button>
        <Button style={{ marginTop: 10 }} onPress={enterDemo} disabled={busy}>Look around first</Button>
        <Dim style={{ textAlign: "center", marginTop: 14, fontSize: 13.5 }}>Works with MetaMask, Rainbow, Trust, Coinbase Wallet and any WalletConnect wallet. NIGHTSHIFT never sees your keys.</Dim>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 22, marginTop: 18 }}>
          <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/privacy")}>Privacy</Link>
          <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/terms")}>Terms</Link>
          <Link onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/how-it-works")}>How it works</Link>
        </View>
      </ScrollView>
    </View>
  );
}
