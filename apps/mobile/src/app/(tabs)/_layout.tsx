import type { ComponentProps } from "react";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDesk } from "../../lib/desk";
import { useSession } from "../../lib/session";
import { C, F } from "../../theme";
import { Icon, type IconName } from "../../ui/icons";

/** What the router hands a custom tab bar. */
type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Desk", icon: "desk" },
  approvals: { label: "Approvals", icon: "approvals" },
  live: { label: "Live", icon: "live" },
  books: { label: "Books", icon: "books" },
  more: { label: "More", icon: "more" },
};

/** The five tabs along the bottom: Desk, Approvals (with what waits), Live, Books, More. */
function Bar({ state, emitter, navigateToTab }: BarProps) {
  const insets = useSafeAreaInsets();
  const { waiting } = useDesk();
  const { demo, signOut } = useSession();
  return (
    <View>
      {demo && (
        <Pressable onPress={() => void signOut()} style={{ backgroundColor: "#1a1508", borderTopWidth: 1, borderTopColor: "#5d4712", paddingVertical: 9, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }} accessibilityRole="button">
          <Text style={{ fontFamily: F.monoMed, color: C.amber, fontSize: 11.5, letterSpacing: 2, flex: 1 }}>DEMO · EXAMPLE DATA</Text>
          <Text style={{ fontFamily: F.uiSemi, color: C.lime, fontSize: 14 }}>Sign in with your wallet →</Text>
        </Pressable>
      )}
    <View style={{ flexDirection: "row", backgroundColor: "#08071a", borderTopWidth: 1, borderTopColor: C.line, paddingBottom: Math.max(insets.bottom, 10), paddingTop: 10 }}>
      {state.routes.map((r, i) => {
        const tab = TABS[r.name];
        if (!tab) return null;
        const on = state.index === i;
        const badge = r.name === "approvals" ? waiting.length : 0;
        return (
          <Pressable
            key={r.key}
            style={{ flex: 1, alignItems: "center", gap: 5 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} waiting` : tab.label}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              // a press on the open tab goes back to its first screen (the stack inside listens for it)
              const ev = emitter.emit({ type: "tabPress", target: r.key, canPreventDefault: true });
              if (!on && !ev.defaultPrevented) navigateToTab(r.key);
            }}
          >
            <View>
              <Icon name={tab.icon} size={24} color={on ? C.lime : C.faint} stroke={on ? 2 : 1.7} />
              {badge > 0 && (
                <View style={{ position: "absolute", top: -9, right: -13, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.coral, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, borderWidth: 2, borderColor: "#08071a" }}>
                  <Text style={{ color: "#fff", fontFamily: F.uiBold, fontSize: 11 }}>{badge > 9 ? "9+" : badge}</Text>
                </View>
              )}
            </View>
            <Text style={{ fontFamily: on ? F.uiSemi : F.ui, fontSize: 12.5, color: on ? C.ink : C.faint }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <Bar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="approvals" />
      <Tabs.Screen name="live" />
      <Tabs.Screen name="books" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
