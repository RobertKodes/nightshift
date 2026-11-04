import { memo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { C } from "../theme";

/** The night behind every screen: a deep navy field, a violet glow low on the left, and faint orbit rings. */
export const Backdrop = memo(function Backdrop({ glow = 0.55 }: { glow?: number }) {
  const { width: w, height: h } = useWindowDimensions();
  const cx = w * 0.92, cy = h * 0.06;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id="low" cx={w * 0.2} cy={h * 1.02} rx={w * 1.1} ry={h * 0.55} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={C.glow} stopOpacity={glow} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="high" cx={cx} cy={cy} rx={w * 0.9} ry={w * 0.9} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#2a3b12" stopOpacity={0.22} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={C.bg} />
        <Rect x={0} y={0} width={w} height={h} fill="url(#high)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#low)" />
        {[0.55, 0.85, 1.2, 1.6].map((r, i) => (
          <Circle key={i} cx={cx} cy={cy} r={w * r} stroke="#8c7cff" strokeOpacity={0.055 - i * 0.008} strokeWidth={1} fill="none" />
        ))}
      </Svg>
    </View>
  );
});
