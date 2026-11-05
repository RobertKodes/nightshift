import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, DEMO_REFUSAL, api, isDemo } from "../../../api/client";
import { keyProblem, signApproval } from "../../../lib/deviceKey";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, clock, usd } from "../../../theme";
import { Frame } from "../../../ui/Frame";
import { Icon } from "../../../ui/icons";
import { Bar, Body, Button, Caps, Dim, Mono, Problem, Section, Serif, Tag, Title } from "../../../ui/kit";

/**
 * A held spend, for the owner to decide: what, why, the price it was held at, and today's budget
 * after it. Approve asks for the fingerprint, then the phone's key signs this exact approval;
 * Decline is one tap. The price signed is the price shown: if it changed, the engine says so.
 */
export default function Approve() {
  const { companyId, taskId } = useLocalSearchParams<{ companyId: string; taskId: string }>();
  const { desk, refresh } = useDesk();
  const { toast } = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rekey, setRekey] = useState(false);
  const [looked, setLooked] = useState(false);

  const company = desk?.companies.find((c) => c.id === companyId) ?? null;
  const w = company?.waiting.find((x) => x.id === taskId) ?? null;
  // opened from a notification before the desk had it: ask the engine once more
  useEffect(() => { if (!w && !looked) { setLooked(true); void refresh(); } }, [w, looked, refresh]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const decided = async (text: string) => { toast(text); await refresh(); close(); };

  const approve = async () => {
    if (!company || !w) return;
    if (isDemo()) { setErr(`${DEMO_REFUSAL} In your own companies this asks for your fingerprint, and the phone's key signs the approval.`); return; }
    setErr(null); setRekey(false); setBusy("approve");
    try {
      const sig = await signApproval({ companyId: company.id, taskId: w.id, costUsd: w.costUsd, company: company.name });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await api.approve(company.id, w.id, sig);
      await decided(`Approved ${usd(w.costUsd)}. The order goes in now.`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : keyProblem(e);
      if (msg) { setErr(msg); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); }
      if (msg && /fingerprints changed|not registered/i.test(msg)) setRekey(true);
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally { setBusy(null); }
  };
  const decline = async () => {
    if (!company || !w) return;
    setErr(null); setBusy("decline");
    try { await api.reject(company.id, w.id); await decided("Declined. Nothing was spent."); }
    catch (e) { setErr((e as Error).message); if (e instanceof ApiError && e.status === 409) await refresh(); }
    finally { setBusy(null); }
  };

  const after = (company?.todayUsd ?? 0) + (w?.costUsd ?? 0);
  const budget = company?.policy.dailyBudgetUsd ?? 0;
  const imdUsd = desk?.imdUsd ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Pressable style={{ flex: 1, minHeight: 90, backgroundColor: C.scrim }} onPress={close} accessibilityLabel="Close" />
      <View style={{ backgroundColor: "#080d09", borderTopWidth: 1, borderTopColor: C.lineHi, maxHeight: "88%" }}>
        <View style={{ alignSelf: "center", width: 48, height: 4, borderRadius: 2, backgroundColor: C.lineHi, marginTop: 12 }} />
        <ScrollView contentContainerStyle={{ padding: S.gutter + 2, paddingBottom: 18 }}>
          {!company || !w ? (
            <View style={{ paddingVertical: 24, gap: 12 }}>
              <Title>{looked && desk ? "Nothing waits here any more" : "Looking it up…"}</Title>
              <Dim>{looked && desk ? "It was approved or declined already, maybe on the website or another phone." : "One moment."}</Dim>
              <Button onPress={close}>Close</Button>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 10, flexWrap: "wrap" }}>
                <Tag>✋ Waiting for your approval</Tag>
                <Mono style={{ fontSize: 12, color: C.faint }}>cycle {w.cycle} · {clock(w.at)}</Mono>
              </View>
              <Title style={{ fontSize: 25, lineHeight: 31, marginTop: 14 }}>{w.title}</Title>
              <Dim style={{ marginTop: 6 }}>{company.name} · {w.market ? `the NIGHTSHIFT market · ${w.market.company}` : "IMD swarm"}</Dim>

              <Frame tick style={{ marginTop: 18 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View>
                    <Caps>Cost</Caps>
                    <Mono style={{ marginTop: 10, color: C.dim }}>{w.imd ? `${w.imd} IMD × ${usd(imdUsd)}` : w.market ? `${w.market.product}` : "one order"}</Mono>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: F.monoBold, fontSize: 34, color: C.ink }}>{usd(w.costUsd)}</Text>
                    <Mono style={{ color: C.coral, marginTop: 2 }}>over your {usd(company.policy.approvalOverUsd).replace(".00", "")} limit</Mono>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: C.line, marginVertical: 14 }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Caps>Today after this</Caps>
                  <Mono style={{ color: after > budget ? C.coral : C.ink }}>{usd(after)} <Text style={{ color: C.faint }}>/ {usd(budget).replace(".00", "")}</Text></Mono>
                </View>
                <Bar value={company.todayUsd} extra={w.costUsd} max={budget} style={{ marginTop: 10 }} height={6} />
                {after > budget && <Dim style={{ color: C.amber, fontSize: 13, marginTop: 8 }}>This goes past today's budget, so the engine will wait for tomorrow's. Raise the budget in Limits to buy it today.</Dim>}
              </Frame>

              <Section>Why the CEO wants it</Section>
              <View style={{ borderLeftWidth: 2, borderLeftColor: C.lime, paddingLeft: 14 }}>
                <Serif style={{ fontSize: 22, lineHeight: 29, color: C.ink, fontFamily: F.ui, letterSpacing: -0.3 }}>“{w.why}”</Serif>
              </View>
              {w.market && <Mono style={{ marginTop: 12, fontSize: 12.5, color: C.faint }}>MARKET FIRST · {usd(w.costUsd)} here instead of the swarm at ~{usd(w.market.swarmUsd)}</Mono>}
              {w.reason && !w.market && <Mono style={{ marginTop: 12, fontSize: 12.5, color: C.faint }}>{w.reason}</Mono>}

              <View style={{ marginTop: 22, alignItems: "center", borderRadius: 2, borderWidth: 1, borderColor: C.lineHi, backgroundColor: "#0a120c", paddingVertical: 20, paddingHorizontal: 16 }}>
                <Body style={{ fontFamily: F.uiSemi, fontSize: 18, textAlign: "center" }}>Approve {usd(w.costUsd)} for {company.name}</Body>
                <Dim style={{ marginTop: 4 }}>Signed by this phone's key · valid 120 s</Dim>
                <View style={{ marginVertical: 16 }}><Icon name="fingerprint" size={48} color={C.lime} stroke={1.6} /></View>
                <Dim>Touch the fingerprint sensor</Dim>
              </View>

              {err && <View style={{ marginTop: 14 }}><Problem text={err} /></View>}
              {rekey && <Button style={{ marginTop: 4 }} onPress={() => { close(); router.navigate("/more/settings"); }}>Register this phone again</Button>}
            </>
          )}
        </ScrollView>
        {company && w && (
          // the decision stays in reach, whatever the length of the why
          <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: S.gutter + 2, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: "#080d09" }}>
            <Button style={{ flex: 0.75 }} kind="danger" busy={busy === "decline"} disabled={!!busy} onPress={decline}>Decline</Button>
            <Button style={{ flex: 1.25 }} kind="lime" busy={busy === "approve"} disabled={!!busy} onPress={approve}>Approve with fingerprint</Button>
          </View>
        )}
      </View>
    </View>
  );
}
