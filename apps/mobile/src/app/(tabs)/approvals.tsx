import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useDesk } from "../../lib/desk";
import { C, F, S, ago, usd } from "../../theme";
import { Backdrop } from "../../ui/Backdrop";
import { Frame } from "../../ui/Frame";
import { Icon } from "../../ui/icons";
import { Body, Caps, Dim, Empty, Frog, Header, Mono, Offline, Section, Tag } from "../../ui/kit";

/** Every spend held for the owner, across the companies, newest first. */
export default function Approvals() {
  const { waiting, offline, at, refresh, desk } = useDesk();
  const [pulling, setPulling] = useState(false);
  const total = waiting.reduce((a, w) => a + w.costUsd, 0);
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Approvals" back={false} right={waiting.length > 0 ? <Tag>{waiting.length} waiting</Tag> : undefined} />
      <ScrollView
        contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={pulling} tintColor={C.violet} colors={[C.violet]} progressBackgroundColor={C.panel} onRefresh={async () => { setPulling(true); await refresh(); setPulling(false); }} />}
      >
        {offline && <Offline at={at} />}
        {waiting.length === 0 ? (
          <Empty
            title="Nothing waits for you"
            body={desk?.companies.length
              ? "Your companies spend on their own up to the limits you set. Anything over a company's approve-over limit stops here and on your lock screen, and waits for your fingerprint."
              : "When a company you found wants to spend more than you allow by hand, it stops here and waits for your fingerprint."}
          />
        ) : (
          <>
            <Section style={{ marginTop: 4 }} right={<Mono style={{ fontSize: 13 }}>{usd(total)} in all</Mono>}>Waiting for you</Section>
            <View style={{ gap: 12 }}>
              {waiting.map((w) => (
                <Pressable key={`${w.company.id}:${w.id}`} onPress={() => router.push(`/approve/${w.company.id}/${w.id}`)} accessibilityRole="button" accessibilityLabel={`${w.company.name}: ${w.title}, ${usd(w.costUsd)}`}>
                  {({ pressed }) => (
                    <Frame tick tickColor={C.coral} style={{ opacity: pressed ? 0.85 : 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Frog seed={w.company.id} size={40} />
                        <View style={{ flex: 1 }}>
                          <Caps style={{ fontSize: 11, color: C.dim }} numberOfLines={1}>{w.company.name}</Caps>
                          <Mono style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>cycle {w.cycle} · {ago(w.at)} ago</Mono>
                        </View>
                        <Text style={{ fontFamily: F.monoBold, fontSize: 20, color: C.ink }}>{usd(w.costUsd)}</Text>
                      </View>
                      <Body style={{ marginTop: 12, fontSize: 16 }} numberOfLines={3}>{w.market ? `Buy "${w.market.product}" from ${w.market.company}` : w.title}</Body>
                      <Dim style={{ marginTop: 6, fontSize: 13.5 }} numberOfLines={2}>{w.why}</Dim>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                        <Mono style={{ color: C.coral, fontSize: 12.5 }}>over the {usd(w.company.policy.approvalOverUsd).replace(".00", "")} limit</Mono>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontFamily: F.uiSemi, color: C.lime, fontSize: 14.5 }}>Review</Text>
                          <Icon name="next" size={16} color={C.lime} />
                        </View>
                      </View>
                    </Frame>
                  )}
                </Pressable>
              ))}
            </View>
            <Dim style={{ marginTop: 16, fontSize: 13 }}>An approval is signed by this phone's key after your fingerprint, for the price shown. Declining spends nothing.</Dim>
          </>
        )}
      </ScrollView>
    </View>
  );
}
