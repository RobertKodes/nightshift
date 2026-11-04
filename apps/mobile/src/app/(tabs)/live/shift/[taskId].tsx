import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ScrollView, Text, View } from "react-native";
import { api } from "../../../../api/client";
import type { Flight, FlightSpan } from "../../../../api/types";
import { useData } from "../../../../api/useData";
import { useDesk } from "../../../../lib/desk";
import { C, F, S, clock, usd } from "../../../../theme";
import { Backdrop } from "../../../../ui/Backdrop";
import { statusOf } from "../../../../ui/feed";
import { Frame } from "../../../../ui/Frame";
import { Bar, Body, Caps, Dim, Header, Link, Loading, Mono, Offline, Problem, Section, Serif, Tag, Title } from "../../../../ui/kit";

const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1)} h`);
const flat = (spans: FlightSpan[], depth = 0): { s: FlightSpan; depth: number }[] => spans.flatMap((s) => [{ s, depth }, ...flat(s.children ?? [], depth + 1)]);

/** One shift's flight record: why the CEO chose it, what it saw, each step with timings, the money, and whether it paid off. */
export default function FlightScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { focus } = useDesk();
  const id = focus?.id ?? "";
  const f = useData<Flight>(id && taskId ? `flight:${id}:${taskId}` : null, () => api.flight(id, taskId!));
  const d = f.data;
  const st = d ? statusOf(d.status) : null;
  const spans = d ? flat(d.trace).slice(0, 60) : [];
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title={d ? `Shift ${d.cycle}` : "Flight record"} right={st && <Tag color={st.color}>{st.label}</Tag>} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}>
        {f.offline && <Offline at={f.at} />}
        {f.error && <Problem text={f.error} retry={() => void f.refresh()} />}
        {!d ? <Loading /> : (
          <>
            <Caps style={{ color: C.violetHi }}>{d.kind.replace(/_/g, " ")} · {clock(d.createdAt)} · {dur(d.durationMs)}</Caps>
            <Title style={{ fontSize: 24, lineHeight: 30, marginTop: 8 }}>{d.title}</Title>
            {d.error && <Problem text={d.error} />}

            <Section>Why the CEO chose it</Section>
            <View style={{ borderLeftWidth: 2, borderLeftColor: C.violet, paddingLeft: 14 }}>
              <Serif style={{ fontSize: 21, lineHeight: 27 }}>“{d.why}”</Serif>
            </View>
            {d.mind && (
              <Mono style={{ marginTop: 10, fontSize: 12.5, color: C.faint }}>
                {d.mind.by === "owner" ? "Ordered by you" : d.mind.by === "model" ? "Chosen by the CEO's model" : "Chosen by the playbook"} · saw {d.mind.saw.visits7d} visits 7d · {d.mind.saw.sales7d} sales · {d.mind.saw.liveProducts} live products{d.mind.saw.direction ? " · your direction" : ""}
              </Mono>
            )}

            {d.plan.length > 0 && (
              <>
                <Section right={<Mono style={{ fontSize: 12.5 }}>{d.steps.done}/{d.steps.total}</Mono>}>Plan</Section>
                <Frame tick>
                  {d.plan.map((p, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: i === d.plan.length - 1 ? 0 : 10 }}>
                      <Text style={{ fontFamily: F.monoBold, color: i < d.steps.done ? C.lime : C.faint, width: 22 }}>{i < d.steps.done ? "✓" : `${i + 1}`}</Text>
                      <Body style={{ flex: 1, fontSize: 15, color: i < d.steps.done ? C.ink : C.dim }}>{p}</Body>
                    </View>
                  ))}
                  {d.steps.total > 0 && <Bar value={d.steps.done} max={d.steps.total} style={{ marginTop: 14 }} />}
                </Frame>
              </>
            )}

            {spans.length > 0 && (
              <>
                <Section>Timeline</Section>
                <Frame tick>
                  {spans.map(({ s, depth }, i) => (
                    <View key={s.id} style={{ flexDirection: "row", gap: 10, marginLeft: depth * 12, marginBottom: i === spans.length - 1 ? 0 : 11 }}>
                      <View style={{ width: 8, height: 8, marginTop: 6, backgroundColor: s.status === "error" ? C.coral : s.status === "running" ? C.amber : C.lime, transform: [{ rotate: "45deg" }] }} />
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5 }}>{s.name}</Body>
                        <Mono style={{ fontSize: 12, color: C.faint }}>{clock(s.startedAt)}{s.endedAt ? ` · ${dur(s.endedAt - s.startedAt)}` : " · running"}{s.costUsd ? ` · ${usd(s.costUsd)}` : ""}</Mono>
                        {s.attrs.error && <Dim style={{ color: C.coral, fontSize: 13 }}>{s.attrs.error}</Dim>}
                      </View>
                    </View>
                  ))}
                </Frame>
              </>
            )}

            {d.market && (
              <>
                <Section>Market first</Section>
                <Frame tick>
                  <Body style={{ fontSize: 15 }}>{d.market.decision}</Body>
                  {d.market.candidates.slice(0, 5).map((m, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 10 }}>
                      <Dim style={{ flex: 1 }} numberOfLines={1}>{m.name} · {m.company}</Dim>
                      <Mono style={{ fontSize: 12.5 }}>{usd(m.priceUsd)} · {m.score.toFixed(2)} · {m.verdict}</Mono>
                    </View>
                  ))}
                </Frame>
              </>
            )}

            <Section>Money</Section>
            <Frame tick>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Caps>Cost</Caps>
                <Mono style={{ color: C.ink, fontFamily: F.monoBold, fontSize: 16 }}>{d.money.costImd ? `${d.money.costImd.toFixed(2)} IMD · ` : ""}{usd(d.money.costUsd + (d.money.costUsdc ?? 0))}</Mono>
              </View>
              {d.money.ledger.slice(0, 8).map((l) => (
                <View key={l.id} style={{ marginTop: 12 }}>
                  <Mono style={{ fontSize: 12, color: C.faint }}>{l.kind} · {clock(l.at)}</Mono>
                  {l.legs.filter((x) => x.account.includes(":")).slice(0, 3).map((x, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Dim style={{ fontSize: 13 }} numberOfLines={1}>{x.account.split(":").slice(-1)[0]}</Dim>
                      <Mono style={{ fontSize: 13, color: x.amount >= 0 ? C.lime : C.ink }}>{x.amount >= 0 ? "+" : ""}{x.amount.toFixed(x.asset === "IMD" ? 2 : 2)} {x.asset}</Mono>
                    </View>
                  ))}
                </View>
              ))}
            </Frame>

            {d.payback && (
              <>
                <Section>Did it pay off</Section>
                <Frame tick>
                  {d.payback.kind === "product" ? (
                    <>
                      <Body style={{ fontSize: 15 }}>{d.payback.name}: {d.payback.sales} sale{d.payback.sales === 1 ? "" : "s"}, {usd(d.payback.revenueUsd)} against {usd(d.payback.costUsd)}.</Body>
                      <Bar value={d.payback.revenueUsd} max={Math.max(d.payback.costUsd, 0.01)} style={{ marginTop: 10 }} />
                      <Mono style={{ marginTop: 8, color: (d.payback.ratio ?? 0) >= 1 ? C.lime : C.dim }}>{d.payback.ratio === null ? "Not on sale yet" : (d.payback.ratio >= 1 ? "Paid for itself · " : "") + `${(d.payback.ratio * 100).toFixed(0)}% of its cost back`}</Mono>
                    </>
                  ) : <Body style={{ fontSize: 15 }}>The site: {d.payback.visits} visits since, for {usd(d.payback.costUsd)}.</Body>}
                </Frame>
              </>
            )}

            <Section>Receipts</Section>
            <Frame tick style={{ gap: 8 }}>
              {d.receipts.orderId && <Mono style={{ fontSize: 12.5 }} numberOfLines={1}>IMD order {d.receipts.orderId}</Mono>}
              {d.receipts.jobUrl && <Link onPress={() => void WebBrowser.openBrowserAsync(d.receipts.jobUrl!)} color={C.violetHi}>The swarm's job on IMD →</Link>}
              {d.receipts.txUrl && <Link onPress={() => void WebBrowser.openBrowserAsync(d.receipts.txUrl!)} color={C.violetHi}>The payment on chain →</Link>}
              {d.receipts.siteUrl && <Link onPress={() => void WebBrowser.openBrowserAsync(d.receipts.siteUrl!)} color={C.violetHi}>The site it built →</Link>}
              {!d.receipts.orderId && !d.receipts.jobUrl && !d.receipts.txUrl && <Dim>No receipts: nothing was bought this shift.</Dim>}
            </Frame>
          </>
        )}
      </ScrollView>
    </View>
  );
}
