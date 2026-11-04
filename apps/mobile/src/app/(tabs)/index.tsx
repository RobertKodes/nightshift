import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DeskCompany } from "../../api/types";
import { useDesk } from "../../lib/desk";
import { useSession } from "../../lib/session";
import { C, F, S, clock, partOfDay, short, usd } from "../../theme";
import { Backdrop } from "../../ui/Backdrop";
import { Frame } from "../../ui/Frame";
import { Icon } from "../../ui/icons";
import { Bar, Body, Button, Caps, Dim, Dot, Empty, Frog, H1, Loading, Mono, Offline, Pill, Problem, Section, Serif, Tag, Title } from "../../ui/kit";


/** The owner desk: every company, what each is doing, what waits for the owner. */
export default function DeskScreen() {
  const { desk, offline, at, error, refresh, setFocus, waiting } = useDesk();
  const { address } = useSession();
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const companies = desk?.companies ?? [];
  const spent = companies.reduce((a, c) => a + (c.todayUsd ?? 0), 0);
  const budget = companies.filter((c) => c.status === "active").reduce((a, c) => a + c.policy.dailyBudgetUsd, 0);
  const rev7 = companies.reduce((a, c) => a + c.stats.revenue7dUsd, 0);
  const open = (c: DeskCompany) => { setFocus(c.id); router.navigate("/live"); };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: S.gutter, paddingBottom: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Icon name="moon" size={24} color={C.violetHi} />
        <Text style={{ fontFamily: F.uiSemi, color: C.ink, fontSize: 15, letterSpacing: 7, marginLeft: 12, flex: 1 }}>NIGHTSHIFT</Text>
        <Pill dot={desk?.mode === "live" ? C.lime : C.amber}>{desk ? (desk.mode === "live" ? "Live · Base" : "Simulation") : "…"}</Pill>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={pulling} tintColor={C.violet} colors={[C.violet]} progressBackgroundColor={C.panel} onRefresh={async () => { setPulling(true); await refresh(); setPulling(false); }} />}
      >
        {offline && <Offline at={at} />}
        {error && !desk && <Problem text={error} retry={() => void refresh()} />}
        <Section style={{ marginTop: 8 }} right={desk ? <Mono style={{ fontSize: 12.5, color: C.faint }}>{companies.length} {companies.length === 1 ? "company" : "companies"}</Mono> : undefined}>Owner desk</Section>
        <H1>Your companies <Serif style={{ fontSize: 33 }}>{partOfDay()}</Serif></H1>

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18, gap: 12 }}>
          <Pill raw>{short(address)}</Pill>
          <View style={{ flex: 1 }} />
          <Button kind="lime" small icon="plus" onPress={() => router.push("/found")}>Found a company</Button>
        </View>

        {!desk ? <Loading /> : (
          <>
            <Frame tick padding={0} style={{ marginTop: 18, flexDirection: "row" }}>
              <Cell label="Spent today" value={usd(spent)} sub={budget ? `/$${Math.round(budget)}` : undefined} />
              <Cell label="Revenue 7d" value={usd(rev7)} lime border />
              <Cell label="Waiting" value={String(waiting.length)} coral={waiting.length > 0} hand={waiting.length > 0} border onPress={waiting.length ? () => router.navigate("/approvals") : undefined} />
            </Frame>

            <View style={{ marginTop: 18, gap: 14 }}>
              {companies.length === 0 && (
                <Empty title="No companies yet" body="Write one sentence: what it sells and to whom. Its AI CEO picks the products, orders the work from the IMD swarm and sells, within the limits you set." action={<Button kind="violet" caps onPress={() => router.push("/found")}>Found your first company</Button>} />
              )}
              {companies.map((c) => <CompanyCard key={c.id} c={c} onPress={() => open(c)} />)}
            </View>

            {(desk.archived?.length ?? 0) > 0 && (
              <Pressable onPress={() => router.navigate("/more/archived")} style={{ marginTop: 18 }}>
                <Dim>{desk.archived.length} deleted {desk.archived.length === 1 ? "company" : "companies"} · restore</Dim>
              </Pressable>
            )}
            <Caps style={{ color: C.ghost, fontSize: 11, textAlign: "right", marginTop: 16 }}>{offline ? "offline copy" : at ? `updated ${clock(at)}` : ""}</Caps>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Cell({ label, value, sub, lime, coral, hand, border, onPress }: { label: string; value: string; sub?: string; lime?: boolean; coral?: boolean; hand?: boolean; border?: boolean; onPress?: () => void }) {
  const body = (
    <View style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 14, borderLeftWidth: border ? 1 : 0, borderLeftColor: C.line }}>
      <Caps style={{ fontSize: 11, letterSpacing: 1.8 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Caps>
      <Text style={{ fontFamily: F.monoBold, fontSize: 21, color: coral ? C.coral : lime ? C.lime : C.ink, marginTop: 8 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}{sub && <Text style={{ fontSize: 13, color: C.faint, fontFamily: F.mono }}> {sub}</Text>}{hand && <Text style={{ fontSize: 18 }}> ✋</Text>}
      </Text>
    </View>
  );
  return onPress ? <Pressable style={{ flex: 1 }} onPress={onPress}>{body}</Pressable> : body;
}

/** One company on the desk: status, what it is doing or waiting on, today's spend, revenue and P&L. */
function CompanyCard({ c, onPress }: { c: DeskCompany; onPress: () => void }) {
  const paused = c.status === "paused";
  const w = c.waiting[0];
  if (paused) {
    return (
      <Pressable onPress={onPress}>
        <Frame tick tickColor={C.lineHi} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Frog seed={c.id} size={52} dim />
          <View style={{ flex: 1 }}>
            <Title style={{ color: C.dim }}>{c.name}</Title>
            <Dim numberOfLines={2}>Paused by the owner. No shifts, no spending.</Dim>
          </View>
          <Pill dot={C.faint}>Paused</Pill>
        </Frame>
      </Pressable>
    );
  }
  const block = w
    ? { label: "Waiting for the owner", color: C.violetHi, text: `${w.title}${w.market ? ` · buy "${w.market.product}"` : ""} · ${usd(w.costUsd)}, over your ${usd(c.policy.approvalOverUsd).replace(".00", "")} limit` }
    : c.working
      ? { label: "At work", color: C.lime, text: `${c.working.title}${c.working.activity ? ` · ${c.working.activity}` : ""}` }
      : c.rest
        ? { label: c.rest.why === "budget" ? "Resting: today's budget is spent" : "Resting: nothing new worth paying for", color: C.amber, text: `Until ${clock(c.rest.until)}. Run a shift to wake it now.` }
        : c.nextShiftAt
          ? { label: "Next shift", color: C.faint, text: `${clock(c.nextShiftAt)}${c.last ? ` · last: ${c.last.title}` : ""}` }
          : { label: "Autopilot off", color: C.faint, text: "Shifts run only when you press Run shift." };
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.waiting.length ? `${c.waiting.length} waiting for approval` : "active"}`}>
      {({ pressed }) => (
        <Frame tick style={{ opacity: pressed ? 0.85 : 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Frog seed={c.id} size={56} />
            <View style={{ flex: 1 }}>
              <Title numberOfLines={1}>{c.name}</Title>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
                <Dot />
                <Caps style={{ color: C.dim, letterSpacing: 2 }}>Active</Caps>
                <Mono style={{ color: C.faint, fontSize: 13 }}>· cycle {c.cycle}{c.sim ? " · sim" : ""}</Mono>
              </View>
            </View>
            {c.waiting.length > 0 && <Tag>{c.waiting.length} approval{c.waiting.length > 1 ? "s" : ""}</Tag>}
          </View>

          <View style={{ backgroundColor: C.inset, borderLeftWidth: 2, borderLeftColor: C.violet, padding: 13, marginTop: 14 }}>
            <Caps style={{ color: block.color, fontSize: 11, letterSpacing: 2.6 }}>{block.label}</Caps>
            <Body style={{ marginTop: 6, fontSize: 15.5 }} numberOfLines={3}>{block.text}</Body>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
            <Caps>Spent today</Caps>
            <Mono style={{ color: C.ink }}>{usd(c.todayUsd)} <Text style={{ color: C.faint }}>/ {usd(c.policy.dailyBudgetUsd).replace(".00", "")}</Text></Mono>
          </View>
          <Bar value={c.todayUsd} max={c.policy.dailyBudgetUsd} style={{ marginTop: 8 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
            <Mono style={{ color: C.faint }}>REV <Text style={{ color: C.ink, fontFamily: F.monoMed }}>{usd(c.pnl.revenueUsd)}</Text></Mono>
            <Mono style={{ color: C.faint }}>P&L <Text style={{ color: c.pnl.profitUsd >= 0 ? C.lime : C.coral, fontFamily: F.monoMed }}>{usd(c.pnl.profitUsd, true)}</Text></Mono>
          </View>
        </Frame>
      )}
    </Pressable>
  );
}
