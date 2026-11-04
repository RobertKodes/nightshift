import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, S } from "../theme";
import { Frame } from "./Frame";
import { Icon, type IconName } from "./icons";

// ---- words

type TP = { children?: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean; onLongPress?: () => void; adjustsFontSizeToFit?: boolean; minimumFontScale?: number };
export const H1 = ({ children, style }: TP) => <Text style={[t.h1, style]}>{children}</Text>;
/** The one word that sings: Instrument Serif, italic. */
export const Serif = ({ children, style }: TP) => <Text style={[t.serif, style]}>{children}</Text>;
export const Title = ({ children, style, numberOfLines }: TP) => <Text style={[t.title, style]} numberOfLines={numberOfLines}>{children}</Text>;
export const Body = ({ children, style, numberOfLines, selectable, onLongPress }: TP) => <Text style={[t.body, style]} numberOfLines={numberOfLines} selectable={selectable} onLongPress={onLongPress}>{children}</Text>;
export const Dim = ({ children, style, numberOfLines }: TP) => <Text style={[t.dim, style]} numberOfLines={numberOfLines}>{children}</Text>;
export const Mono = ({ children, style, numberOfLines }: TP) => <Text style={[t.mono, style]} numberOfLines={numberOfLines}>{children}</Text>;
/** Small spaced capitals: SPENT TODAY, CYCLE 14. */
export const Caps = ({ children, style, ...rest }: TP) => <Text style={[t.caps, style]} {...rest}>{children}</Text>;

/** ■ LIVE SHIFT FEED: a violet square and spaced capitals. */
export function Section({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", marginTop: 26, marginBottom: 12 }, style]}>
      <View style={{ width: 9, height: 9, backgroundColor: C.violet, marginRight: 12 }} />
      <Caps style={{ color: C.dim, letterSpacing: 3.2, flex: 1 }}>{children}</Caps>
      {right}
    </View>
  );
}

// ---- marks

/** A square outlined tag: 1 APPROVAL, SALE, IMD'S FREE CHECK. */
export function Tag({ children, color = C.coral, filled = false, style }: { children: ReactNode; color?: string; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ borderWidth: 1, borderColor: color, backgroundColor: filled ? color : "transparent", paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" }, style]}>
      <Text style={[t.caps, { color: filled ? C.limeInk : color, fontSize: 11.5, letterSpacing: 1.6 }]}>{children}</Text>
    </View>
  );
}

/** A rounded outline pill: ● LIVE · BASE, ACTIVE, STEP 1 OF 1, a company's short name. */
export function Pill({ children, dot, onPress, style, raw }: { children: ReactNode; dot?: string; onPress?: () => void; style?: StyleProp<ViewStyle>; raw?: boolean }) {
  const body = (
    <View style={[{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.lineHi, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6, backgroundColor: "rgba(13,11,32,0.6)" }, style]}>
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, marginRight: 8 }} />}
      <Text style={[t.caps, { color: C.dim, fontSize: 12, letterSpacing: 2.2 }, raw && { textTransform: "none", letterSpacing: 0.4, fontSize: 13 }]} numberOfLines={1}>{children}</Text>
      {onPress && <View style={{ marginLeft: 4, marginRight: -4 }}><Icon name="down" size={14} color={C.faint} /></View>}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={8}>{body}</Pressable> : body;
}

export function Dot({ color = C.lime, size = 8 }: { color?: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** A thin bar: spend against budget. `extra`: a second, amber stretch (what this approval would add). */
export function Bar({ value, max, extra = 0, color = C.lime, height = 5, style }: { value: number; max: number; extra?: number; color?: string; height?: number; style?: StyleProp<ViewStyle> }) {
  const f = (v: number) => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0))}%` as const;
  return (
    <View style={[{ height, backgroundColor: "#1c1938", flexDirection: "row", overflow: "hidden" }, style]}>
      <View style={{ width: f(value), backgroundColor: color }} />
      {extra > 0 && <View style={{ width: f(Math.min(extra, Math.max(0, max - value))), backgroundColor: C.amber }} />}
    </View>
  );
}

/** A number on a tile: REVENUE $148.00. */
export function Stat({ label, value, tone = "ink", sub, style }: { label: string; value: string; tone?: "ink" | "lime" | "coral" | "violet"; sub?: string; style?: StyleProp<ViewStyle> }) {
  const color = tone === "lime" ? C.lime : tone === "coral" ? C.coral : tone === "violet" ? C.violetHi : C.ink;
  return (
    <Frame tick padding={12} style={[{ flex: 1, minWidth: 0 }, style]}>
      <Caps style={{ fontSize: 10.5, color: C.faint, letterSpacing: 1.4 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Caps>
      <Text style={[t.num, { color, marginTop: 6 }]} numberOfLines={1} adjustsFontSizeToFit>{value}{sub ? <Text style={{ fontSize: 13, color: C.faint }}> {sub}</Text> : null}</Text>
    </Frame>
  );
}

// ---- controls

type BtnKind = "lime" | "violet" | "ghost" | "danger" | "dangerSolid";
/** A cut-corner button. Pressing it ticks the phone; while `busy` it waits and does not take another press. */
export function Button({ children, onPress, kind = "ghost", icon, busy, disabled, style, big, small, caps }: {
  children: ReactNode; onPress?: () => void | Promise<void>; kind?: BtnKind; icon?: IconName; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; big?: boolean; small?: boolean; caps?: boolean;
}) {
  const look = {
    lime: { fill: C.lime, stroke: C.lime, ink: C.limeInk, gradient: undefined },
    violet: { fill: C.violetDeep, stroke: C.violetHi, ink: "#fff", gradient: ["#5b3cf5", "#7f62ff"] as [string, string] },
    ghost: { fill: "#131030", stroke: C.lineHi, ink: C.ink, gradient: undefined },
    danger: { fill: C.coralDeep, stroke: "#7c2a3a", ink: C.coral, gradient: undefined },
    dangerSolid: { fill: C.coral, stroke: C.coral, ink: "#1a0508", gradient: undefined },
  }[kind];
  const off = disabled || busy;
  return (
    <Pressable
      onPress={async () => { if (off || !onPress) return; void Haptics.selectionAsync().catch(() => {}); await onPress(); }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.8 : 1, transform: [{ scale: pressed && !off ? 0.985 : 1 }] }, style]}
      accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }}
    >
      <Frame fill={look.fill} stroke={look.stroke} gradient={look.gradient} padding={0} cut={small ? 8 : 10} style={{ minHeight: big ? 56 : small ? 40 : 46, justifyContent: "center", paddingHorizontal: small ? 12 : 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: small ? 7 : 10 }}>
          {busy ? <ActivityIndicator size="small" color={look.ink} /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={look.ink} stroke={2.2} /> : null}
          <Text style={[caps ? t.capsBtn : t.btn, { color: look.ink }, small && { fontSize: 14.5 }]} numberOfLines={1}>{children}</Text>
        </View>
      </Frame>
    </Pressable>
  );
}

/** A plain text link-button: "Set price", "edit". */
export function Link({ children, onPress, color = C.dim, style }: { children: ReactNode; onPress: () => void; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text onPress={onPress} suppressHighlighting style={[t.body, { color, fontSize: 14.5 }, style]}>{children}</Text>;
}

/** One choice of a few: 6 h · 12 h · 24 h, 7 days · 30 days · All time. */
export function Segmented<T extends string | number>({ options, value, onChange, small }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} style={{ flex: small ? 0 : 1 }} onPress={() => { void Haptics.selectionAsync().catch(() => {}); onChange(o.value); }} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Frame fill={on ? C.lime : "#100e26"} stroke={on ? C.lime : C.lineHi} padding={0} cut={9} style={{ height: small ? 40 : 46, justifyContent: "center", paddingHorizontal: small ? 14 : 8 }}>
              <Text style={[t.btn, { color: on ? C.limeInk : C.ink, textAlign: "center", fontSize: small ? 14.5 : 15.5 }]}>{o.label}</Text>
            </Frame>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The big lime switch. */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => { Animated.timing(x, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start(); }, [value, x]);
  return (
    <Pressable onPress={() => { if (disabled) return; void Haptics.selectionAsync().catch(() => {}); onChange(!value); }} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} hitSlop={8} style={{ opacity: disabled ? 0.5 : 1 }}>
      <Animated.View style={{ width: 56, height: 32, borderRadius: 16, padding: 4, backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: ["#24203f", C.lime] }) }}>
        <Animated.View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: [C.faint, "#0b0b0b"] }), borderWidth: 2, borderColor: x.interpolate({ inputRange: [0, 1], outputRange: [C.faint, "#0b0b0b"] }), transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 24] }) }] }} />
      </Animated.View>
    </Pressable>
  );
}

/** A money slider with the diamond thumb: steps snap, the phone ticks on each one. */
export function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const state = useRef({ w: 0, startX: 0, last: value });
  state.current.w = w;
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const snap = (x: number) => { const v = min + Math.round(((Math.max(0, Math.min(state.current.w, x)) / Math.max(1, state.current.w)) * (max - min)) / step) * step; return Math.round(v * 100) / 100; };
  const set = (v: number) => { if (v !== state.current.last) { state.current.last = v; void Haptics.selectionAsync().catch(() => {}); onChange(v); } };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { state.current.startX = e.nativeEvent.locationX; set(snap(e.nativeEvent.locationX)); },
    onPanResponderMove: (_e, g) => set(snap(state.current.startX + g.dx)),
  })).current;
  state.current.last = value;
  return (
    <View style={{ height: 40, justifyContent: "center" }} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value }}>
      <View style={{ height: 4, backgroundColor: "#1c1938" }}>
        <View style={{ width: `${frac * 100}%`, height: 4, backgroundColor: C.lime, shadowColor: C.lime, shadowOpacity: 0.8, shadowRadius: 6, elevation: 3 }} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: Math.max(0, frac * w - 14), width: 28, height: 28, transform: [{ rotate: "45deg" }], backgroundColor: "#f3f1ff", borderWidth: 4, borderColor: "#304a12" }} />
    </View>
  );
}

// ---- pieces of screens

/** A company's face: one of the NIGHT FROGS, the same one every time for the same company. */
const FROGS = [
  require("../../assets/frogs/frog-002.png"), require("../../assets/frogs/frog-077.png"), require("../../assets/frogs/frog-078.png"), require("../../assets/frogs/frog-079.png"),
  require("../../assets/frogs/frog-080.png"), require("../../assets/frogs/frog-081.png"), require("../../assets/frogs/frog-082.png"), require("../../assets/frogs/frog-083.png"),
  require("../../assets/frogs/frog-084.png"), require("../../assets/frogs/frog-112.png"), require("../../assets/frogs/frog-113.png"), require("../../assets/frogs/frog-131.png"),
  require("../../assets/frogs/frog-187.png"), require("../../assets/frogs/frog-224.png"), require("../../assets/frogs/frog-500.png"), require("../../assets/frogs/frog-001.png"),
];
export function Frog({ seed, size = 48, dim }: { seed: string; size?: number; dim?: boolean }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <View style={{ width: size, height: size, borderWidth: 1, borderColor: C.lineHi, backgroundColor: C.inset, opacity: dim ? 0.55 : 1 }}>
      <Image source={FROGS[h % FROGS.length]} style={{ width: size - 2, height: size - 2 }} />
    </View>
  );
}

/** The bar on top of a pushed screen: back, a title, something on the right. */
export function Header({ title, right, back = true, onBack }: { title: string; right?: ReactNode; back?: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: S.gutter, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
      {back && (
        <Pressable onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))} hitSlop={14} style={{ marginRight: 14, marginLeft: -4 }} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={24} color={C.ink} />
        </Pressable>
      )}
      <Text style={[t.title, { flex: 1, fontSize: 19 }]} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

/** Shown over a screen showing what was kept on the phone. */
export function Offline({ at }: { at: number | null }) {
  return (
    <View style={{ backgroundColor: "#2a2108", borderColor: "#5d4712", borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12 }}>
      <Text style={[t.caps, { color: C.amber, fontSize: 11 }]}>Offline · showing what this phone kept{at ? ` from ${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</Text>
    </View>
  );
}

/** The engine's own words when something did not work, with a way to try again. */
export function Problem({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <Frame stroke="#5c2433" fill="#160913" style={{ marginBottom: 12 }}>
      <Body style={{ color: "#ffb3bd", fontSize: 14.5 }}>{text}</Body>
      {retry && <Link onPress={retry} color={C.coral} style={{ marginTop: 8 }}>Try again</Link>}
    </Frame>
  );
}

/** EXAMPLE DATA, NOTHING YET: the small mono line at the foot of a list. */
export function Foot({ children }: { children: ReactNode }) {
  return <Caps style={{ color: C.ghost, fontSize: 11, textAlign: "right", marginTop: 14 }}>{children}</Caps>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Frame tick style={{ alignItems: "flex-start", gap: 8, paddingVertical: 22 }}>
      <Title>{title}</Title>
      <Dim>{body}</Dim>
      {action && <View style={{ marginTop: 8, alignSelf: "stretch" }}>{action}</View>}
    </Frame>
  );
}

export function Loading() {
  return <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={C.violet} /></View>;
}

export const t = StyleSheet.create({
  h1: { fontFamily: F.uiBold, fontSize: 30, lineHeight: 36, color: C.ink, letterSpacing: -0.4 },
  serif: { fontFamily: F.serif, color: C.ink, fontWeight: "normal" },
  title: { fontFamily: F.uiSemi, fontSize: 19, lineHeight: 24, color: C.ink },
  body: { fontFamily: F.uiReg, fontSize: 16, lineHeight: 23, color: C.ink },
  dim: { fontFamily: F.uiReg, fontSize: 14.5, lineHeight: 21, color: C.faint },
  mono: { fontFamily: F.mono, fontSize: 14, color: C.dim },
  caps: { fontFamily: F.monoMed, fontSize: 12, letterSpacing: 2.4, textTransform: "uppercase", color: C.faint },
  num: { fontFamily: F.monoBold, fontSize: 21, color: C.ink, letterSpacing: -0.3 },
  btn: { fontFamily: F.uiSemi, fontSize: 16, letterSpacing: 0.1 },
  capsBtn: { fontFamily: F.monoBold, fontSize: 15, letterSpacing: 4, textTransform: "uppercase" },
});
