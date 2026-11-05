import { ScrollView, Text, View } from "react-native";
import { call } from "../../../api/client";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { C, F, S, clock, partOfDay, when } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { Frame } from "../../../ui/Frame";
import { Body, Caps, Dim, Frog, H1, Header, Mono, Section, Serif, Stat } from "../../../ui/kit";

type Swarm = { swarm: { available: boolean; agentsOnline: number; jobsDoneLastDay: number; completionRate: number; totalJobs: number } };
type League = { season: { n: number; endsAt: number }; paper: boolean; standings: { id: string; name: string; returnPct: number; trades: number; house?: boolean }[] };
type Crew = { events: { at: number; crew: string; summary: string | null; status: string }[] };

/** The station tonight, to look at: the swarm at work, the paper-money league, the frogs, your crew's hours. Nothing to buy here. */
export default function Night() {
  const { desk } = useDesk();
  const swarm = useData<Swarm>("night:swarm", () => call<Swarm>("GET", "/api/v1/swarm/stats"));
  const league = useData<League>("night:league", () => call<League>("GET", "/api/league"));
  const crew = useData<Crew>("night:crew", () => call<Crew>("GET", "/api/crews/activity"));
  const shifts = (desk?.companies ?? []).reduce((a, c) => a + c.cycle, 0);
  const next = (desk?.companies ?? []).map((c) => c.nextShiftAt).filter((x): x is number => !!x && x > Date.now()).sort((a, b) => a - b)[0];
  const s = swarm.data?.swarm;
  const top = (league.data?.standings ?? []).slice(0, 6);

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glow={0.85} />
      <Header title="The night" />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 48 }}>
        <Caps style={{ color: C.lime }}>{clock(Date.now())} · station time</Caps>
        <H1 style={{ marginTop: 8 }}>The station <Serif style={{ fontSize: 33 }}>{partOfDay()}</Serif></H1>

        <Section>Your crew</Section>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Stat label="Shifts" value={String(shifts)} tone="lime" />
          <Stat label="Next shift" value={next ? clock(next) : "—"} />
          <Stat label="Companies" value={String(desk?.companies.length ?? 0)} />
        </View>

        <Section>The IMD swarm</Section>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Stat label="Online" value={s ? s.agentsOnline.toLocaleString("en-US") : "…"} tone="violet" />
          <Stat label="Jobs, 24 h" value={s ? String(s.jobsDoneLastDay) : "…"} />
          <Stat label="Finished" value={s ? `${Math.round(s.completionRate * 100)}%` : "…"} />
        </View>
        <Dim style={{ marginTop: 8, fontSize: 13 }}>The agents your companies hire for research, products and sites. {s ? `${s.totalJobs.toLocaleString("en-US")} jobs so far.` : ""}</Dim>

        <Section right={league.data ? <Mono style={{ fontSize: 12.5 }}>season {league.data.season.n} · paper money</Mono> : undefined}>The Night League</Section>
        <Frame tick padding={0}>
          {top.length === 0 ? <Dim style={{ padding: 16 }}>The standings load here.</Dim> : top.map((r, i) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: i === top.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
              <Text style={{ fontFamily: F.monoBold, color: i === 0 ? C.lime : C.faint, width: 22 }}>{i + 1}</Text>
              <Frog seed={r.id} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.ui, color: C.ink, fontSize: 15 }} numberOfLines={1}>{r.name}</Text>
                <Mono style={{ fontSize: 11.5, color: C.faint }}>{r.trades} trades{r.house ? " · house agent" : ""}</Mono>
              </View>
              <Mono style={{ color: r.returnPct >= 0 ? C.lime : C.coral, fontSize: 14 }}>{r.returnPct >= 0 ? "+" : ""}{r.returnPct.toFixed(1)}%</Mono>
            </View>
          ))}
        </Frame>
        <Dim style={{ marginTop: 8, fontSize: 13 }}>Trading agents compete with paper money at real prices. Nothing is bet or bought.</Dim>

        <Section>The frogs</Section>
        <Frame tick>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {["night-1", "night-2", "night-3", "night-4", "night-5", "night-6", "night-7", "night-8"].map((k) => <Frog key={k} seed={k} size={64} />)}
          </View>
          <Body style={{ color: C.dim, fontSize: 14.5, marginTop: 12 }}>The NIGHT FROGS crew the station: 500 of them, on Ethereum. Each company on your desk gets one as its face.</Body>
        </Frame>

        <Section>On the station</Section>
        {(crew.data?.events ?? []).slice(0, 8).map((e, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Mono style={{ width: 46, fontSize: 12.5, color: C.faint }}>{when(e.at)}</Mono>
            <View style={{ flex: 1 }}>
              <Caps style={{ fontSize: 10.5, color: C.violetHi }}>{e.crew}</Caps>
              <Body style={{ fontSize: 14, lineHeight: 20 }} numberOfLines={2}>{e.summary ?? e.status}</Body>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
