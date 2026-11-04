import { type ReactNode, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDesk } from "../lib/desk";
import { C, S, usd } from "../theme";
import { Caps, Dim, Dot, Frog, Mono, Pill, Tag, Title } from "./kit";

/** Wraps whatever opens the company list (a pill, a title): the Live, Books and More tabs follow the pick. */
export function CompanySwitch({ children }: { children: (open: (() => void) | undefined) => ReactNode }) {
  const { focus, desk, setFocus } = useDesk();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const many = (desk?.companies.length ?? 0) > 1;
  return (
    <>
      {children(many ? () => setOpen(true) : undefined)}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: C.scrim }} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={{ backgroundColor: "#0b0a1d", borderTopWidth: 1, borderTopColor: C.lineHi, paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: insets.bottom + 18, maxHeight: "70%" }}>
          <View style={{ alignSelf: "center", width: 44, height: 4, borderRadius: 2, backgroundColor: C.lineHi, marginBottom: 16 }} />
          <Caps style={{ marginBottom: 10, letterSpacing: 3 }}>Show company</Caps>
          <ScrollView>
            {desk?.companies.map((c) => (
              <Pressable key={c.id} onPress={() => { setFocus(c.id); setOpen(false); }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })}>
                <Frog seed={c.id} size={44} dim={c.status === "paused"} />
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 17, color: c.id === focus?.id ? C.lime : C.ink }} numberOfLines={1}>{c.name}</Title>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Dot color={c.status === "active" ? C.lime : C.faint} size={7} />
                    <Mono style={{ fontSize: 12.5, color: C.faint }}>{c.status} · rev {usd(c.pnl.revenueUsd)}</Mono>
                  </View>
                </View>
                {c.waiting.length > 0 && <Tag>{c.waiting.length}</Tag>}
              </Pressable>
            ))}
          </ScrollView>
          <Dim style={{ marginTop: 12, fontSize: 13 }}>The Live, Books and More tabs follow the company you pick.</Dim>
        </View>
      </Modal>
    </>
  );
}

/** The company pill (TIDEWELL ▾) on the right of a header. */
export function CompanyPill() {
  const { focus } = useDesk();
  if (!focus) return null;
  return <CompanySwitch>{(open) => <Pill onPress={open}>{focus.name.split(/\s+/)[0]!.slice(0, 12)}</Pill>}</CompanySwitch>;
}
