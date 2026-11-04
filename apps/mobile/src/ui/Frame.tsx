import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { C, S } from "../theme";

/**
 * The station's panel: a box whose lower right corner is cut, a hairline border, and (on cards) a short
 * violet tick on the top edge. Drawn with SVG so the cut is crisp at any size.
 */
export function Frame({ children, style, fill = C.panel, stroke = C.line, cut = S.chamfer, tick = false, tickColor = C.violet, gradient, strokeWidth = 1, padding = 16 }: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; fill?: string; stroke?: string; cut?: number; tick?: boolean; tickColor?: string;
  /** a vertical fill from one colour to another (the big violet button) */
  gradient?: [string, string]; strokeWidth?: number; padding?: number;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  const { w, h } = size;
  const o = strokeWidth / 2;
  const d = `M${o},${o} H${w - o} V${h - cut} L${w - cut},${h - o} H${o} Z`;
  return (
    <View onLayout={onLayout} style={[{ padding }, style]}>
      {w > 0 && (
        <Svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
          {gradient && (
            <Defs>
              <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={gradient[0]} />
                <Stop offset="1" stopColor={gradient[1]} />
              </LinearGradient>
            </Defs>
          )}
          <Path d={d} fill={gradient ? "url(#g)" : fill} stroke={stroke} strokeWidth={strokeWidth} />
          {tick && <Rect x={22} y={0} width={Math.min(64, w * 0.25)} height={2} fill={tickColor} />}
        </Svg>
      )}
      {children}
    </View>
  );
}
