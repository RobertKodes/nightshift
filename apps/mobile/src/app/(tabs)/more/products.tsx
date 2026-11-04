import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, api } from "../../../api/client";
import type { CompanyFull, DeskProduct } from "../../../api/types";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, short, usd, when } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanyPill } from "../../../ui/CompanyPicker";
import { Frame } from "../../../ui/Frame";
import { Body, Button, Caps, Dim, Dot, Empty, Frog, Header, Link, Mono, Section, Stat, Tag, Title } from "../../../ui/kit";

/** What the company sells: each product's sales and price, and the latest sales. */
export default function Products() {
  const { focus, refresh } = useDesk();
  const { toast } = useSession();
  const co = useData<CompanyFull>(focus ? `co:${focus.id}` : null, () => api.company(focus!.id));
  const [pricing, setPricing] = useState<DeskProduct | null>(null);
  if (!focus) return <View style={{ flex: 1 }}><Backdrop /><Header title="Products & sales" /></View>;
  const ps = focus.products;
  const live = ps.filter((p) => p.status === "live");
  const sales = ps.reduce((a, p) => a + p.sales, 0);
  const rev = ps.reduce((a, p) => a + p.revenueUsd, 0);
  const names = new Map(ps.map((p) => [p.id, p.name]));

  const onSale = async (p: DeskProduct, status: "live" | "retired") => {
    try { await api.product(focus.id, p.id, { status }); toast(status === "live" ? `"${p.name}" is back on sale.` : `"${p.name}" is off sale.`); await refresh(); }
    catch (e) { toast((e as ApiError).message); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Products & sales" right={<CompanyPill />} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Stat label="Live" value={String(live.length)} />
          <Stat label="Sales" value={String(sales)} />
          <Stat label="Revenue" value={usd(rev)} tone="lime" />
        </View>

        <View style={{ gap: 12, marginTop: 16 }}>
          {ps.length === 0 && <Empty title="Nothing on sale yet" body="The CEO's first shifts build the first product with the IMD swarm. It goes on sale here once it is packaged." />}
          {ps.map((p) => {
            const tag = p.status === "live" ? { t: "Live", c: C.lime } : p.status === "building" ? { t: "Packaging", c: C.amber } : { t: "Off sale", c: C.faint };
            return (
              <Frame key={p.id} tick>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <Frog seed={p.id} size={52} dim={p.status !== "live"} />
                  <View style={{ flex: 1 }}>
                    <Title style={{ fontSize: 17.5 }} numberOfLines={2}>{p.name}</Title>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <Mono style={{ fontSize: 13 }}>{p.kind}</Mono>
                      <Tag color={tag.c}>{tag.t}</Tag>
                      {p.priceByOwner && <Tag color={C.blue}>Owner price</Tag>}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: F.monoBold, fontSize: 20, color: C.ink }}>{usd(p.priceUsd)}</Text>
                    <Mono style={{ fontSize: 12, color: C.faint }}>price</Mono>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, gap: 14 }}>
                  <Mono style={{ fontSize: 13 }}>SALES <Text style={{ color: C.ink }}>{p.sales}</Text></Mono>
                  <Mono style={{ fontSize: 13 }}>REV <Text style={{ color: C.lime }}>{usd(p.revenueUsd)}</Text></Mono>
                  <View style={{ flex: 1 }} />
                  {p.status === "building" ? <Dim style={{ fontSize: 13.5 }}>On sale when packaged</Dim> : (
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Link onPress={() => setPricing(p)}>Set price</Link>
                      <Dim>·</Dim>
                      {p.status === "live"
                        ? <Link onPress={() => Alert.alert(`Take "${p.name}" off sale?`, "Buyers can no longer buy it. You can put it back later.", [{ text: "Keep it", style: "cancel" }, { text: "Take off sale", style: "destructive", onPress: () => void onSale(p, "retired") }])}>Take off sale</Link>
                        : <Link onPress={() => void onSale(p, "live")}>Put on sale</Link>}
                    </View>
                  )}
                </View>
              </Frame>
            );
          })}
        </View>

        <Section>Recent sales</Section>
        {(co.data?.recentSales ?? []).length === 0 ? <Dim>No sales yet.</Dim> : co.data!.recentSales.slice(0, 15).map((s, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Dot color={s.sim ? C.faint : C.lime} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 15 }} numberOfLines={1}>{names.get(s.productId) ?? "A product"}</Body>
              <Mono style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{when(s.at)} · {short(s.payer)}{s.sim ? " · simulated" : ""}</Mono>
            </View>
            <Mono style={{ color: C.lime, fontSize: 14.5 }}>+{usd(Number(s.usdc) / 1e6)}</Mono>
          </View>
        ))}
      </ScrollView>
      <PriceSheet product={pricing} onClose={() => setPricing(null)} onSave={async (v) => {
        if (!pricing) return;
        try { await api.price(focus.id, pricing.id, v); toast(`"${pricing.name}" now sells for ${usd(v)}.`); setPricing(null); await refresh(); }
        catch (e) { toast((e as ApiError).message); }
      }} />
    </View>
  );
}

function PriceSheet({ product, onClose, onSave }: { product: DeskProduct | null; onClose: () => void; onSave: (v: number) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(v.replace(",", "."));
  const ok = n >= 0.5 && n <= 500;
  return (
    <Modal visible={!!product} transparent animationType="slide" onRequestClose={onClose} onShow={() => setV(product ? product.priceUsd.toFixed(2) : "")} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: C.scrim }} onPress={onClose} />
        <View style={{ backgroundColor: "#0b0a1d", borderTopWidth: 1, borderTopColor: C.lineHi, padding: S.gutter, paddingBottom: insets.bottom + 18 }}>
          <Caps>Set price</Caps>
          <Title style={{ marginTop: 6 }} numberOfLines={2}>{product?.name}</Title>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, borderWidth: 1, borderColor: C.lineHi, backgroundColor: C.panel, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: F.monoBold, color: C.faint, fontSize: 24 }}>$</Text>
            <TextInput value={v} onChangeText={setV} keyboardType="decimal-pad" autoFocus selectTextOnFocus style={{ flex: 1, fontFamily: F.monoBold, color: C.ink, fontSize: 24, paddingVertical: 12, marginLeft: 6 }} />
          </View>
          <Dim style={{ marginTop: 8, fontSize: 13 }}>Between $0.50 and $500. The CEO keeps a price you set.</Dim>
          <Button kind="lime" style={{ marginTop: 16 }} disabled={!ok} busy={busy} onPress={async () => { setBusy(true); await onSave(Math.round(n * 100) / 100); setBusy(false); }}>Save price</Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
