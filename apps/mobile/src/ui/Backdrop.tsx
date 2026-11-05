import { memo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, G, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { C } from "../theme";
import { FROG_CELLS } from "./icons";

/**
 * The night behind every screen, as on the website: flat ink, a faint 24px lime grid, a green glow,
 * and the pixel Pepe as a big silhouette in the corner.
 */
export const Backdrop = memo(function Backdrop({ glow = 0.55, frog = true }: { glow?: number; frog?: boolean }) {
  const { width: w, height: h } = useWindowDimensions();
  const fs = Math.min(w * 0.72, 300);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        <Defs>
          <Pattern id="grid" width={24} height={24} patternUnits="userSpaceOnUse">
            <Path d="M24 0H0V24" stroke={C.lime} strokeOpacity={0.045} strokeWidth={1} fill="none" />
          </Pattern>
          <RadialGradient id="low" cx={w * 0.15} cy={h * 1.02} rx={w * 1.1} ry={h * 0.5} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={C.glow} stopOpacity={glow} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="high" cx={w * 0.95} cy={0} rx={w * 0.9} ry={w * 0.9} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#2b4a12" stopOpacity={0.3} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={C.bg} />
        <Rect x={0} y={0} width={w} height={h} fill="url(#grid)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#high)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#low)" />
        {frog && (
          <G transform={`translate(${w - fs * 0.78} ${h * 0.08}) scale(${fs / 16})`} opacity={0.035}>
            {FROG_CELLS.body.map(([x, y, cw, ch], i) => <Rect key={i} x={x} y={y} width={cw} height={ch} fill={C.lime} />)}
          </G>
        )}
      </Svg>
    </View>
  );
});
