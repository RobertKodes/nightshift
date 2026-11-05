import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { C } from "../theme";

/**
 * The protocol's block: a flat panel, a hairline border, a corner tick top-left (lime when `tick`) and
 * a dimmer one bottom-right, the way the website draws its terminal blocks. `pixel` adds the offset
 * block shadow the primary buttons carry.
 */
export function Frame({ children, style, fill = C.panel, stroke = C.line, tick = false, tickColor = C.lime, gradient, strokeWidth = 1, padding = 16, pixel, radius = 2 }: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; fill?: string; stroke?: string; tick?: boolean; tickColor?: string;
  /** kept for callers of the old frame: the block takes the second colour */
  gradient?: [string, string]; strokeWidth?: number; padding?: number; pixel?: string; radius?: number;
  /** the old cut corner: ignored, the protocol uses corner ticks */
  cut?: number;
}) {
  const box = (
    <View style={[{ padding, backgroundColor: gradient ? gradient[1] : fill, borderColor: stroke, borderWidth: strokeWidth, borderRadius: radius }, style]}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", left: -strokeWidth, top: -strokeWidth, width: 10, height: 10, borderLeftWidth: 2, borderTopWidth: 2, borderColor: tick ? tickColor : stroke }} />
      <View pointerEvents="none" style={{ position: "absolute", right: -strokeWidth, bottom: -strokeWidth, width: 10, height: 10, borderRightWidth: 2, borderBottomWidth: 2, borderColor: tick ? C.lineHi : stroke }} />
    </View>
  );
  if (!pixel) return box;
  return (
    <View>
      <View pointerEvents="none" style={{ position: "absolute", left: 3, top: 3, right: -3, bottom: -3, backgroundColor: pixel, borderRadius: radius }} />
      {box}
    </View>
  );
}
