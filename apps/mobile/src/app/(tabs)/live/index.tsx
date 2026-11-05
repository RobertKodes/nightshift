import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, api, isDemo } from "../../../api/client";
import { useLive } from "../../../api/live";
import type { CompanyFull, EngineEvent, JournalEntry, TaskView } from "../../../api/types";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, clock, usd } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanySwitch } from "../../../ui/CompanyPicker";
import { FeedLine, ShiftRow } from "../../../ui/feed";
import { Frame } from "../../../ui/Frame";
import { Icon } from "../../../ui/icons";
import { Bar, Body, Button, Caps, Dim, Empty, Frog, Loading, Mono, Offline, Pill, Problem, Section, Stat } from "../../../ui/kit";

/** A company at work: its numbers, today's spend, and the shift as it happens. */
export default function CompanyLive() {
  const { focus, refresh: refreshDesk, desk } = useDesk();
  const id = focus?.id ?? null;
  const insets = useSafeAreaInsets();
  const { toast } = useSession();
  const co = useData<CompanyFull>(id ? `co:${id}` : null, () => api.company(id!));
  const [busy, setBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);

  // events change the screen at once; a company change reloads it, at most every 1.5 s
  const reload = useCallback(() => {
    if (later.current) return;
    later.current = setTimeout(() => { later.current = null; void co.refresh(); void refreshDesk(); }, 1500);
  }, [co, refreshDesk]);
  const onEvent = useCallback((e: EngineEvent) => {
    if (e.type === "journal") co.set((d) => (d ? { ...d, journal: [...d.journal, e.payload as JournalEntry].slice(-150) } : d));
    else if (e.type === "task") co.set((d) => { if (!d) return d; const t = e.payload as TaskView; const i = d.tasks.findIndex((x) => x.id === t.id); const tasks = [...d.tasks]; if (i >= 0) tasks[i] = t; else tasks.push(t); return { ...d, tasks }; });
    if (e.type === "company" || e.type === "sale" || e.type === "approval") reload();
  }, [co, reload]);
  const live = useLive(isDemo() ? null : id, onEvent, () => void co.refresh());

  if (!focus) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 24, paddingHorizontal: S.gutter }}>
        <Backdrop />
        <Empty title="Nothing live yet" body="Found a company and its shifts show here as they happen." action={<Button kind="violet" caps onPress={() => router.push("/found")}>Found a company</Button>} />
      </View>
    );
  }

  const c = co.data;
  const paused = (c?.status ?? focus.status) === "paused";
  const waiting = focus.waiting;
  const act = async (what: string, f: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try { await f(); toast(done); await Promise.all([co.refresh(), refreshDesk()]); } catch (e) { toast((e as ApiError).message); } finally { setBusy(null); }
  };
  const journal = [...(c?.journal ?? [])].reverse().slice(0, 40);
  const shifts = [...(c?.tasks ?? [])].reverse().slice(0, 12);
  const imdUsd = desk?.imdUsd ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: S.gutter, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Pressable onPress={() => router.navigate("/")} hitSlop={14} style={{ marginRight: 12, marginLeft: -4 }} accessibilityLabel="Back to the desk"><Icon name="back" size={24} color={C.ink} /></Pressable>
        <CompanySwitch>{(open) => (
          <Pressable onPress={open} disabled={!open} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontFamily: F.uiSemi, fontSize: 19, color: C.ink, flexShrink: 1 }} numberOfLines={1}>{focus.name}</Text>
            {open && <Icon name="down" size={16} color={C.faint} />}
          </Pressable>
        )}</CompanySwitch>
        <Pill dot={paused ? C.faint : C.lime}>{paused ? "Paused" : "Active"}</Pill>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.gutter, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={pulling} tintColor={C.lime} colors={[C.lime]} progressBackgroundColor={C.panel} onRefresh={async () => { setPulling(true); await Promise.all([co.refresh(), refreshDesk()]); setPulling(false); }} />}
      >
        {co.offline && <Offline at={co.at} />}
        {co.error && <Problem text={co.error} retry={() => void co.refresh()} />}

        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <Frog seed={focus.id} size={64} dim={paused} />
          <View style={{ flex: 1 }}>
            <Caps style={{ color: C.dim, fontSize: 11, letterSpacing: 1.6 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>CEO · cycle {focus.cycle}{focus.nextShiftAt && !paused ? ` · next shift ${clock(focus.nextShiftAt)}` : paused ? " · paused" : ""}</Caps>
            <Body style={{ marginTop: 5, fontSize: 15.5, lineHeight: 21 }} numberOfLines={3}>{focus.mission || focus.idea}</Body>
          </View>
        </View>

        {!c ? <Loading /> : (
          <>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
              <Stat label="Revenue" value={usd(c.pnl.revenueUsd)} tone="lime" />
              <Stat label="Spent" value={usd(c.pnl.spentUsd)} />
              <Stat label="Profit" value={usd(focus.pnl.profitUsd, true)} tone={focus.pnl.profitUsd >= 0 ? "lime" : "coral"} />
              <Stat label="IMD left" value={c.pnl.imdBalance.toFixed(2)} />
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 18, alignItems: "baseline" }}>
              <Caps>Today</Caps>
              <Mono style={{ color: C.ink, fontSize: 13.5 }}>{usd(c.todayUsd)} <Text style={{ color: C.faint }}>/ {usd(c.policy.dailyBudgetUsd).replace(".00", "")} · approve over {usd(c.policy.approvalOverUsd).replace(".00", "")}</Text></Mono>
            </View>
            <Bar value={c.todayUsd} max={c.policy.dailyBudgetUsd} style={{ marginTop: 9 }} height={6} />

            {waiting.length > 0 && (
              <Pressable onPress={() => router.push(`/approve/${focus.id}/${waiting[0]!.id}`)} style={{ marginTop: 18 }}>
                <Frame stroke="#6a2433" fill="#160a0d" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Text style={{ fontSize: 22 }}>✋</Text>
                  <View style={{ flex: 1 }}>
                    <Caps style={{ color: C.coral, fontSize: 11 }}>Waiting for your approval</Caps>
                    <Body style={{ fontSize: 15 }} numberOfLines={2}>{waiting[0]!.title} · {usd(waiting[0]!.costUsd)}</Body>
                  </View>
                  <Icon name="next" size={20} color={C.coral} />
                </Frame>
              </Pressable>
            )}

            <Section right={isDemo() ? <Pill dot={C.amber}>Example</Pill> : <Pill dot={live === "live" ? C.lime : live === "connecting" ? C.amber : C.faint}>{live === "live" ? "Live" : live === "connecting" ? "Joining" : "Off"}</Pill>}>Live shift feed</Section>
            <Frame tick padding={16}>
              {journal.length === 0 ? <Dim>Nothing yet. The first shift writes here as it works.</Dim> : journal.map((j, i) => (
                <FeedLine key={`${j.at}-${i}`} j={j} last={i === journal.length - 1} onPress={j.kind === "note" && j.text.replace(/^\[sim\] /, "").startsWith("Waiting for your approval") && waiting[0] ? () => router.push(`/approve/${focus.id}/${waiting[0]!.id}`) : undefined} />
              ))}
            </Frame>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Button style={{ flex: 1.15 }} icon="play" busy={busy === "shift"} disabled={!!busy} onPress={() => act("shift", () => api.shift(focus.id), "Shift started. Watch the feed.")}>Run shift</Button>
              {paused
                ? <Button style={{ flex: 1 }} icon="play" busy={busy === "resume"} disabled={!!busy} onPress={() => act("resume", () => api.resume(focus.id), "Resumed.")}>Resume</Button>
                : <Button style={{ flex: 1 }} icon="pause" busy={busy === "pause"} disabled={!!busy} onPress={() => act("pause", () => api.pause(focus.id), "Paused: no shifts, no spending.")}>Pause</Button>}
              <Button style={{ flex: 0.9 }} kind="danger" icon="stop" disabled={!!busy} onPress={() => Alert.alert("Stop " + focus.name + "?", "Stopping ends its shifts and sends its funds back to your wallet. You confirm with your wallet next.", [{ text: "Not now", style: "cancel" }, { text: "Continue", style: "destructive", onPress: () => router.navigate("/more/lifecycle") }])}>Stop</Button>
            </View>

            <Section>Shifts</Section>
            <Frame tick padding={0} style={{ paddingHorizontal: 16 }}>
              {shifts.length === 0 ? <Dim style={{ paddingVertical: 14 }}>No shifts yet.</Dim> : shifts.map((t) => <ShiftRow key={t.id} t={t} imdUsd={imdUsd} onPress={() => router.push(`/live/shift/${t.id}`)} />)}
            </Frame>
            <Dim style={{ marginTop: 10, fontSize: 13 }}>Tap a shift for its flight record: what the CEO saw, each step, the money and whether it paid off.</Dim>
          </>
        )}
      </ScrollView>
    </View>
  );
}
