import { type Href, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, short } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanyPill } from "../../../ui/CompanyPicker";
import { Frame } from "../../../ui/Frame";
import { Icon, type IconName } from "../../../ui/icons";
import { Caps, Dim, Frog, Header, Section, Title } from "../../../ui/kit";

/** Everything else: the focused company's products, CEO, limits and lifecycle, then the station and settings. */
export default function More() {
  const { focus, desk } = useDesk();
  const { address } = useSession();
  const go = (h: Href) => router.push(h);
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="More" back={false} right={<CompanyPill />} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}>
        {focus && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <Frog seed={focus.id} size={40} />
              <View style={{ flex: 1 }}>
                <Title style={{ fontSize: 18 }} numberOfLines={1}>{focus.name}</Title>
                <Dim style={{ fontSize: 13 }} numberOfLines={1}>{(() => { const n = focus.products.filter((p) => p.status === "live").length; return `${n} live product${n === 1 ? "" : "s"}`; })()} · cycle {focus.cycle}</Dim>
              </View>
            </View>
            <Frame tick padding={0} style={{ marginTop: 10 }}>
              <Item icon="box" title="Products & sales" sub="Prices, what is on sale, recent sales" onPress={() => go("/more/products")} />
              <Item icon="chat" title="Steer the CEO" sub="Standing direction, chat, order work by hand" onPress={() => go("/more/steer")} />
              <Item icon="sliders" title="Limits" sub="Daily budget, approve over, shifts, autopilot" onPress={() => go("/more/limits")} />
              <Item icon="power" title="Stop, take funds back, delete" sub="Withdraw revenue, stop the company, delete it" onPress={() => go("/more/lifecycle")} last />
            </Frame>
          </>
        )}

        <Section>Station</Section>
        <Frame tick padding={0}>
          <Item icon="moon" title="The night" sub="The station tonight: agents, frogs and the league, to look at" onPress={() => go("/more/night")} />
          {(desk?.archived.length ?? 0) > 0 && <Item icon="restore" title="Deleted companies" sub={`${desk!.archived.length} you can bring back`} onPress={() => go("/more/archived")} />}
          <Item icon="globe" title="getnightshift.tech" sub="The website: how it works, the market, the docs" onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/how-it-works")} last />
        </Frame>

        <Section>You</Section>
        <Frame tick padding={0}>
          <Item icon="phone" title="Settings" sub={`Phones, notifications, sessions, keys · ${short(address)}`} onPress={() => go("/more/settings")} />
          <Item icon="shield" title="Privacy" sub="What NIGHTSHIFT keeps and why" onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/privacy")} />
          <Item icon="doc" title="Terms" sub="The rules for running companies" onPress={() => void WebBrowser.openBrowserAsync("https://getnightshift.tech/terms")} last />
        </Frame>
        <Caps style={{ color: C.ghost, fontSize: 11, textAlign: "center", marginTop: 24 }}>NIGHTSHIFT · always shipping</Caps>
      </ScrollView>
    </View>
  );
}

function Item({ icon, title, sub, onPress, last }: { icon: IconName; title: string; sub: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })} accessibilityRole="button">
      <Icon name={icon} size={22} color={icon === "moon" ? C.violetHi : C.lime} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.uiSemi, color: C.ink, fontSize: 16 }}>{title}</Text>
        <Dim style={{ fontSize: 13 }} numberOfLines={1}>{sub}</Dim>
      </View>
      <Icon name="next" size={18} color={C.faint} />
    </Pressable>
  );
}
