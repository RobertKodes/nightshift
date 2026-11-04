import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { BASE, currentToken, api } from "../../../api/client";
import type { BooksView } from "../../../api/types";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, usd, when } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanyPill } from "../../../ui/CompanyPicker";
import { Frame } from "../../../ui/Frame";
import { Icon } from "../../../ui/icons";
import { Body, Caps, Dim, Empty, Header, Loading, Mono, Offline, Problem, Section, Segmented } from "../../../ui/kit";

type Span = 7 | 30 | "all";

/** The company's books: what came in and went out, by day, and every ledger line. */
export default function Books() {
  const { focus } = useDesk();
  const { toast } = useSession();
  const [span, setSpan] = useState<Span>(7);
  const id = focus?.id ?? null;
  const b = useData<BooksView>(id ? `books:${id}:${span}` : null, () => api.books(id!, span));
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (!focus) return;
    setSharing(true);
    try {
      const r = await fetch(`${BASE}/api/companies/${encodeURIComponent(focus.id)}/books.csv`, { headers: { Authorization: `Bearer ${currentToken()}` } });
      if (!r.ok) throw new Error(`The books could not be fetched (${r.status}).`);
      const f = new File(Paths.cache, `${focus.slug}-books.csv`);
      if (f.exists) f.delete();
      f.create();
      f.write(await r.text());
      await Sharing.shareAsync(f.uri, { mimeType: "text/csv", dialogTitle: `${focus.name} books`, UTI: "public.comma-separated-values-text" });
    } catch (e) { toast((e as Error).message); } finally { setSharing(false); }
  };

  if (!focus) return <View style={{ flex: 1 }}><Backdrop /><Header title="Books" back={false} /><View style={{ padding: S.gutter }}><Empty title="No books yet" body="A company's sales, swarm orders and profit show here." /></View></View>;
  const d = b.data;
  const t = d?.totals;
  const max = Math.max(1, ...(d?.byDay ?? []).flatMap((x) => [x.revenueUsd, x.spendUsd]));
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Books" back={false} right={<CompanyPill />} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Segmented small options={[{ value: 7 as Span, label: "7 days" }, { value: 30 as Span, label: "30 days" }, { value: "all" as Span, label: "All time" }]} value={span} onChange={setSpan} />
          <Pressable onPress={share} disabled={sharing} accessibilityLabel="Share the books as CSV">
            <Frame fill="#100e26" stroke={C.lineHi} padding={0} cut={9} style={{ height: 40, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6, opacity: sharing ? 0.5 : 1 }}>
              <Icon name="share" size={17} color={C.ink} /><Text style={{ fontFamily: F.uiSemi, color: C.ink, fontSize: 14.5 }}>CSV</Text>
            </Frame>
          </Pressable>
        </View>
        {b.offline && <View style={{ marginTop: 14 }}><Offline at={b.at} /></View>}
        {b.error && <View style={{ marginTop: 14 }}><Problem text={b.error} retry={() => void b.refresh()} /></View>}

        {!d || !t ? <Loading /> : (
          <>
            <Frame tick style={{ marginTop: 16 }}>
              <Row label="Sales to people and agents" value={usd(t.salesUsd)} color={C.lime} />
              <Row label="Sold to other companies" value={usd(t.b2bSoldUsd, true)} color={C.lime} />
              <Row label={`Paid the IMD swarm · ${t.swarmImd.toFixed(1)} IMD`} value={usd(-t.swarmUsd)} />
              <Row label="Bought from other companies" value={usd(-t.b2bBoughtUsd)} />
              {t.aiUsd > 0 && <Row label="The CEO's strong model" value={usd(-t.aiUsd)} />}
              <View style={{ height: 1, backgroundColor: C.lineHi, marginVertical: 12 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontFamily: F.uiSemi, fontSize: 19 }}>Profit</Body>
                <Text style={{ fontFamily: F.monoBold, fontSize: 30, color: t.profitUsd >= 0 ? C.lime : C.coral }}>{usd(t.profitUsd, true)}</Text>
              </View>
              <Mono style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>IMD at today's {usd(d.imdUsd)} · funded {t.fundedImd.toFixed(1)} IMD{t.withdrawnUsd ? ` · withdrawn ${usd(t.withdrawnUsd)}` : ""}</Mono>
            </Frame>

            <Section right={<View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Legend color={C.lime} label="Revenue" /><Legend color={C.violet} label="Spend" /></View>}>Revenue vs spend</Section>
            <Frame tick padding={14}>
              <Chart days={d.byDay} max={max} />
            </Frame>

            <Section>Ledger</Section>
            {d.lines.length === 0 ? <Dim>No money has moved in this period.</Dim> : d.lines.map((l, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Mono style={{ width: 46, fontSize: 12.5, color: C.faint }}>{when(l.at)}</Mono>
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 12, color: C.faint }}>{l.kind}</Mono>
                  <Body style={{ fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>{l.memo || l.kind.replace(/_/g, " ")}</Body>
                </View>
                <Mono style={{ fontSize: 13.5, color: l.amount >= 0 ? C.lime : C.ink }}>{l.amount >= 0 ? "+" : "-"}{Math.abs(l.amount).toFixed(2)} {l.asset}</Mono>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, color = C.ink }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 }}>
      <Body style={{ fontSize: 15, color: C.dim, flex: 1 }} numberOfLines={1}>{label}</Body>
      <Mono style={{ fontSize: 15, color }}>{value}</Mono>
    </View>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 8, height: 8, backgroundColor: color }} /><Caps style={{ fontSize: 11 }}>{label}</Caps></View>
);

/** Two bars a day: revenue in lime, spend in violet. */
function Chart({ days, max }: { days: BooksView["byDay"]; max: number }) {
  const [w, setW] = useState(0);
  const h = 150;
  const n = days.length || 1;
  const slot = w / n, bw = Math.max(3, Math.min(18, slot * 0.32));
  const label = (day: string) => (n <= 7 ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" }) : day.slice(8));
  const every = n <= 7 ? 1 : Math.ceil(n / 6);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={h}>
          {days.map((d, i) => {
            const x = i * slot + slot / 2;
            const rh = (d.revenueUsd / max) * (h - 8), sh = (d.spendUsd / max) * (h - 8);
            return [
              <Rect key={`r${i}`} x={x - bw - 1} y={h - rh} width={bw} height={Math.max(rh, d.revenueUsd ? 2 : 0)} fill={C.lime} />,
              <Rect key={`s${i}`} x={x + 1} y={h - sh} width={bw * 0.85} height={Math.max(sh, d.spendUsd ? 2 : 0)} fill={C.violet} />,
            ];
          })}
        </Svg>
      )}
      <View style={{ flexDirection: "row", marginTop: 6 }}>
        {days.map((d, i) => <Mono key={d.day} style={{ width: slot || 1, textAlign: "center", fontSize: 11, color: C.faint }}>{i % every === 0 ? label(d.day) : ""}</Mono>)}
      </View>
    </View>
  );
}
