import Svg, { Circle, Path } from "react-native-svg";
import { C } from "../theme";

/** Line icons in the Lucide style (ISC), drawn at 24 and scaled: one stroke weight across the app. */
const P: Record<string, string[]> = {
  desk: ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  approvals: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z", "m9 8 2 2 4-4"],
  live: ["M3 6h18", "M3 12h11", "M3 18h18"],
  books: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M16 13H8", "M16 17H8", "M10 9H8"],
  back: ["m15 18-6-6 6-6"],
  next: ["m9 18 6-6-6-6"],
  down: ["m6 9 6 6 6-6"],
  send: ["M5 12h14", "m12 5 7 7-7 7"],
  share: ["M12 3v12", "m7 8 5-5 5 5", "M5 21h14"],
  plus: ["M12 5v14", "M5 12h14"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  bell: ["M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M12 18h.01"],
  key: ["m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4", "m21 2-9.6 9.6", "M10 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
  flag: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"],
  box: ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12"],
  chat: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  power: ["M12 2v10", "M18.4 6.6a9 9 0 1 1-12.77.04"],
  restore: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
  doc: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"],
  check: ["M20 6 9 17l-5-5"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  bolt: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  fingerprint: ["M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", "M14 13.12c0 2.38 0 6.38-1 8.88", "M17.29 21.02c.12-.6.43-2.3.5-3.02", "M2 12a10 10 0 0 1 18-6", "M2 16h.01", "M21.8 16c.2-2 .131-5.354 0-6", "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2", "M8.65 22c.21-.66.45-1.32.57-2", "M9 6.8a6 6 0 0 1 9 5.2v2"],
  frog: ["M6 10a3 3 0 1 1 4.5-2.6", "M18 10a3 3 0 1 0-4.5-2.6", "M4 13c0 4 3.6 7 8 7s8-3 8-7", "M8.5 15.5c2 1.3 5 1.3 7 0"],
};

export type IconName = keyof typeof P | "more" | "moon" | "play" | "pause" | "stop" | "dot";

export function Icon({ name, size = 22, color = C.dim, stroke = 1.8 }: { name: IconName; size?: number; color?: string; stroke?: number }) {
  if (name === "more") return <Svg width={size} height={size} viewBox="0 0 24 24">{[5, 12, 19].map((x) => <Circle key={x} cx={x} cy={12} r={1.9} stroke={color} strokeWidth={stroke} fill="none" />)}</Svg>;
  if (name === "moon") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill={color} /></Svg>;
  if (name === "play") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M6 3.5v17l14-8.5z" fill={color} /></Svg>;
  if (name === "pause") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M6 4h4v16H6zM14 4h4v16h-4z" fill={color} /></Svg>;
  if (name === "stop") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M5 5h14v14H5z" fill={color} /></Svg>;
  if (name === "dot") return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx={12} cy={12} r={6} fill={color} /></Svg>;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {P[name]!.map((d, i) => <Path key={i} d={d} />)}
      {name === "live" && <Circle cx={19} cy={12} r={2.2} />}
    </Svg>
  );
}
