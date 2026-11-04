import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ApiError, api } from "../../../api/client";
import type { Policy } from "../../../api/types";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, usd } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanyPill } from "../../../ui/CompanyPicker";
import { Frame } from "../../../ui/Frame";
import { Button, Dim, Header, Problem, Section, Segmented, Slider, Title, Toggle } from "../../../ui/kit";

const RAISES: (keyof Policy)[] = ["dailyBudgetUsd", "approvalOverUsd", "marketDailyUsd", "marketMaxUsd", "aiDailyUsd"];

/** The company's money rules. Lowering is instant; raising asks for the fingerprint, then the wallet. */
export default function Limits() {
  const { focus, refresh } = useDesk();
  const { withStep, toast } = useSession();
  const [p, setP] = useState<Policy | null>(focus?.policy ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setP(focus?.policy ?? null); }, [focus?.id]);
  if (!focus || !p) return <View style={{ flex: 1 }}><Backdrop /><Header title="Limits" /></View>;
  const was = focus.policy;
  const raised = RAISES.some((k) => Number(p[k] ?? 0) > Number(was[k] ?? 0));
  const changed = JSON.stringify(p) !== JSON.stringify(was);
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP((x) => (x ? { ...x, [k]: v } : x));

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      if (raised) {
        const bio = await LocalAuthentication.authenticateAsync({ promptMessage: `Raise the limits of ${focus.name}`, cancelLabel: "Cancel", disableDeviceFallback: false, biometricsSecurityLevel: "strong" } as LocalAuthentication.LocalAuthenticationOptions);
        if (!bio.success) { setBusy(false); return; }
      }
      await withStep({ action: "limits", companyId: focus.id }, (proof) => api.policy(focus.id, p, proof));
      toast(raised ? "Limits raised. The next shift uses them." : "Limits saved.");
      await refresh();
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Limits" right={<CompanyPill />} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}>
        <Section style={{ marginTop: 4 }}>Money rules</Section>
        <Rule label="Daily budget" value={usd(p.dailyBudgetUsd)} hint="Spending stops for the day once this is reached.">
          <Slider value={p.dailyBudgetUsd} min={0} max={Math.max(200, was.dailyBudgetUsd)} step={1} onChange={(v) => set("dailyBudgetUsd", v)} />
        </Rule>
        <Rule label="Approve anything over" value={usd(p.approvalOverUsd)} hint="A single action above this waits for your fingerprint. 0: everything waits.">
          <Slider value={p.approvalOverUsd} min={0} max={Math.max(50, was.approvalOverUsd)} step={0.5} onChange={(v) => set("approvalOverUsd", v)} />
        </Rule>

        <Section>Shifts</Section>
        <Segmented options={[{ value: 360, label: "6 h" }, { value: 720, label: "12 h" }, { value: 1440, label: "24 h" }]} value={p.shiftMinutes} onChange={(v) => set("shiftMinutes", v)} />
        {![360, 720, 1440].includes(was.shiftMinutes) && <Dim style={{ marginTop: 8 }}>Now every {Math.round(was.shiftMinutes / 6) / 10} hours.</Dim>}
        <Line title="Autopilot" sub="Run shifts on their own. Off = only when you press run."><Toggle value={p.autopilot} onChange={(v) => set("autopilot", v)} /></Line>

        <Section>The market</Section>
        <Line title="Market first" sub="Before paying the swarm for research, buy a relevant, cheaper product another company sells."><Toggle value={p.marketBuy ?? true} onChange={(v) => set("marketBuy", v)} /></Line>
        {(p.marketBuy ?? true) && (
          <>
            <Rule label="Market spend a day" value={usd(p.marketDailyUsd ?? 5)} hint="USDC it may spend on the market in 24 hours.">
              <Slider value={p.marketDailyUsd ?? 5} min={0} max={Math.max(50, was.marketDailyUsd ?? 5)} step={1} onChange={(v) => set("marketDailyUsd", v)} />
            </Rule>
            <Rule label="At most per product" value={usd(p.marketMaxUsd ?? 3)} hint="The most it pays for one product.">
              <Slider value={p.marketMaxUsd ?? 3} min={0} max={Math.max(25, was.marketMaxUsd ?? 3)} step={0.5} onChange={(v) => set("marketMaxUsd", v)} />
            </Rule>
          </>
        )}

        <Section>The CEO's thinking</Section>
        <Rule label="Strong model a day" value={usd(p.aiDailyUsd ?? 0.5)} hint="Paid from the company's own USDC. A shift's thought costs about two cents; 0 keeps it on the free model.">
          <Slider value={p.aiDailyUsd ?? 0.5} min={0} max={Math.max(2, was.aiDailyUsd ?? 0.5)} step={0.1} onChange={(v) => set("aiDailyUsd", v)} />
        </Rule>

        {err && <Problem text={err} />}
        <Frame fill="transparent" stroke="transparent" padding={0} style={{ marginTop: 8 }}>
          <Button kind={raised ? "violet" : "lime"} big disabled={!changed} busy={busy} icon={raised ? "fingerprint" : "check"} onPress={save}>{raised ? "Raise with fingerprint + wallet" : "Save limits"}</Button>
        </Frame>
        {raised && <Dim style={{ marginTop: 10, fontSize: 13 }}>Raising a limit lets the company spend more without asking, so it needs your fingerprint and your wallet's signature.</Dim>}
      </ScrollView>
    </View>
  );
}

function Rule({ label, value, hint, children }: { label: string; value: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Title style={{ fontSize: 16.5 }}>{label}</Title>
        <Text style={{ fontFamily: F.monoBold, color: C.lime, fontSize: 19 }}>{value}</Text>
      </View>
      <View style={{ marginTop: 4 }}>{children}</View>
      <Dim style={{ fontSize: 13.5 }}>{hint}</Dim>
    </View>
  );
}

function Line({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, gap: 14 }}>
      <View style={{ flex: 1 }}><Title style={{ fontSize: 16.5 }}>{title}</Title><Dim style={{ fontSize: 13.5 }}>{sub}</Dim></View>
      {children}
    </View>
  );
}
