import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, api } from "../api/client";
import type { CompanyFull } from "../api/types";
import { useDesk } from "../lib/desk";
import { C, F, S, usd } from "../theme";
import { Backdrop } from "../ui/Backdrop";
import { Frame } from "../ui/Frame";
import { Body, Button, Caps, Dim, Frog, H1, Header, Mono, Pill, Problem, Section, Segmented, Serif, Slider, Title, Toggle } from "../ui/kit";

/** One sentence and the money rules: the engine names the company, writes its mission and starts its CEO. */
export default function Found() {
  const { refresh, setFocus, desk } = useDesk();
  const insets = useSafeAreaInsets();
  const [idea, setIdea] = useState("");
  const [budget, setBudget] = useState(10);
  const [over, setOver] = useState(5);
  const [hours, setHours] = useState<6 | 12 | 24>(24);
  const [autopilot, setAutopilot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<CompanyFull | null>(null);
  const len = idea.trim().length;
  const ok = len >= 12 && len <= 1000;

  const found = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.found(idea.trim(), { dailyBudgetUsd: budget, approvalOverUsd: over, shiftMinutes: hours * 60, autopilot });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setFocus(r.id);
      await refresh();
      setMade(await api.company(r.id).catch(() => null));
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };

  if (made) {
    return (
      <View style={{ flex: 1 }}>
        <Backdrop glow={0.9} />
        <Header title="Founded" onBack={() => router.replace("/")} />
        <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: insets.bottom + 30 }}>
          <View style={{ alignItems: "center", marginTop: 12 }}>
            <Frog seed={made.id} size={96} />
            <H1 style={{ textAlign: "center", marginTop: 18 }}>{made.name}</H1>
            <Serif style={{ fontSize: 22, color: C.dim, marginTop: 4 }}>is open for the night.</Serif>
          </View>
          <Frame tick style={{ marginTop: 24 }}>
            <Caps style={{ color: C.lime }}>Its mission</Caps>
            <Body style={{ marginTop: 6 }}>{made.mission}</Body>
            <Caps style={{ color: C.lime, marginTop: 14 }}>Who it serves</Caps>
            <Body style={{ marginTop: 6 }}>{made.audience}</Body>
          </Frame>
          <Frame stroke="#5d4712" fill="#151006" style={{ marginTop: 14 }}>
            <Caps style={{ color: C.amber }}>Before the first shift</Caps>
            <Body style={{ marginTop: 6, color: "#e7dcc4", fontSize: 15 }}>
              {desk?.mode === "live"
                ? "The company has its own wallet. Fund it with IMD and a little ETH from your owner desk on getnightshift.tech; the first shift starts when the funds land. The app shows its balance."
                : "This engine runs a simulation: the company starts with 20 simulated IMD, and its first shift starts on its own."}
            </Body>
          </Frame>
          <Button kind="violet" caps big style={{ marginTop: 22 }} onPress={() => router.replace("/live")}>Watch it work</Button>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Found a company" right={<Pill>Step 1 of 1</Pill>} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <H1 style={{ fontSize: 31, lineHeight: 38 }}>One sentence. <Serif style={{ fontSize: 34 }}>The CEO</Serif> does the rest.</H1>

        <Section>What it sells, and to whom</Section>
        <Frame padding={16}>
          <TextInput
            value={idea}
            onChangeText={(v) => setIdea(v.slice(0, 1000))}
            multiline
            placeholder="A weekly meal-prep planner for night-shift nurses, sold as a printable template."
            placeholderTextColor={C.ghost}
            selectionColor={C.lime}
            cursorColor={C.lime}
            style={{ fontFamily: F.uiReg, fontSize: 17.5, lineHeight: 25, color: C.ink, minHeight: 92, textAlignVertical: "top", padding: 0 }}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
            <Mono style={{ fontSize: 12.5, color: len > 0 && len < 12 ? C.amber : C.faint }}>12–1000 characters</Mono>
            <Mono style={{ fontSize: 12.5, color: C.faint }}>{len} / 1000</Mono>
          </View>
        </Frame>

        <Section>Money rules</Section>
        <Rule label="Daily budget" value={usd(budget).replace(".00", "")} hint="Spending stops for the day once this is reached.">
          <Slider value={budget} min={1} max={100} step={1} onChange={(v) => { setBudget(v); if (over > v) setOver(v); }} />
        </Rule>
        <Rule label="Approve anything over" value={usd(over).replace(".00", "")} hint="A single action above this waits for your fingerprint.">
          <Slider value={over} min={0} max={Math.max(1, budget)} step={0.5} onChange={setOver} />
        </Rule>

        <Section>Shifts</Section>
        <Segmented options={[{ value: 6 as const, label: "6 h" }, { value: 12 as const, label: "12 h" }, { value: 24 as const, label: "24 h" }]} value={hours} onChange={setHours} />
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18, gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Title style={{ fontSize: 17 }}>Autopilot</Title>
            <Dim>Run shifts on their own. Off = only when you press run.</Dim>
          </View>
          <Toggle value={autopilot} onChange={setAutopilot} />
        </View>

        <Frame tick tickColor={C.amber} stroke={C.line} style={{ marginTop: 22 }}>
          <Caps style={{ color: C.amber }}>Before the first shift</Caps>
          <Body style={{ marginTop: 6, color: C.dim, fontSize: 15 }}>
            {desk?.mode === "live" ? "The company gets its own wallet. Fund it with IMD and a little ETH from getnightshift.tech; the first shift starts when the funds land." : "This engine runs a simulation: the company starts with 20 simulated IMD."}
          </Body>
        </Frame>

        {err && <View style={{ marginTop: 16 }}><Problem text={err} /></View>}
        <Button kind="violet" caps big style={{ marginTop: 22 }} disabled={!ok} busy={busy} onPress={found}>Found the company</Button>
        <Text style={{ fontFamily: F.mono, color: C.ghost, fontSize: 11.5, textAlign: "center", marginTop: 12, letterSpacing: 1 }}>You can change every rule later in Limits.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Rule({ label, value, hint, children }: { label: string; value: string; hint: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Title style={{ fontSize: 17 }}>{label}</Title>
        <Text style={{ fontFamily: F.monoBold, color: C.lime, fontSize: 20 }}>{value}</Text>
      </View>
      <View style={{ marginTop: 6 }}>{children}</View>
      <Dim style={{ fontSize: 14 }}>{hint}</Dim>
    </View>
  );
}
