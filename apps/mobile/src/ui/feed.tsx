import { Pressable, Text, View } from "react-native";
import type { JournalEntry, TaskView } from "../api/types";
import { C, F, clock, when } from "../theme";
import { Body, Dim, Mono, Tag } from "./kit";

/** What a log line is, as a tag and a colour on the live feed. */
export function kindOf(j: JournalEntry): { tag: string; color: string } {
  const t = j.text.replace(/^\[sim\] /, "");
  if (j.kind === "note" && t.startsWith("Waiting for your approval")) return { tag: "Waiting for the owner", color: C.coral };
  if (j.kind === "note" && /free check/i.test(t)) return { tag: "IMD's free check", color: C.blue };
  if (j.kind === "note" && t.startsWith("You approved")) return { tag: "Approved", color: C.lime };
  if (j.kind === "note" && t.startsWith("You turned down")) return { tag: "Declined", color: C.faint };
  if (j.kind === "note" && t.startsWith("Market first")) return { tag: "Market first", color: C.blue };
  switch (j.kind) {
    case "decision": return { tag: "The CEO decides", color: C.violetHi };
    case "sale": return { tag: "Sale", color: C.lime };
    case "result": return { tag: "Delivered", color: C.lime };
    case "warning": return { tag: "Warning", color: C.amber };
    case "plan": return { tag: "Plan", color: C.blue };
    default: return { tag: "Note", color: C.faint };
  }
}

/** One line of the live feed: the time, a diamond on the thread, the tag, the words. */
export function FeedLine({ j, last, onPress }: { j: JournalEntry; last?: boolean; onPress?: () => void }) {
  const k = kindOf(j);
  const text = j.text.replace(/^\[sim\] /, "");
  const body = (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Mono style={{ width: 46, fontSize: 13, color: C.faint, marginTop: 2 }}>{when(j.at)}</Mono>
      <View style={{ alignItems: "center", width: 14 }}>
        <View style={{ width: 11, height: 11, backgroundColor: k.color, transform: [{ rotate: "45deg" }], marginTop: 5 }} />
        {!last && <View style={{ width: 1, flex: 1, backgroundColor: C.lineHi, marginTop: 6 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 4 : 20 }}>
        <Tag color={k.color}>{k.tag}</Tag>
        <Body style={{ marginTop: 8, fontSize: 15.5, lineHeight: 22 }} numberOfLines={5}>{text}</Body>
        <Dim style={{ fontSize: 13, marginTop: 3 }}>cycle {j.cycle}{onPress ? " · tap to review" : ""}</Dim>
      </View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

const STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: C.faint }, checking: { label: "Checking", color: C.blue }, awaiting_approval: { label: "Waiting for you", color: C.coral },
  ordering: { label: "Ordering", color: C.violetHi }, building: { label: "Building", color: C.violetHi }, done: { label: "Done", color: C.lime },
  failed: { label: "Failed", color: C.coral }, rejected: { label: "Declined", color: C.faint },
};
export const statusOf = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, " "), color: C.faint };

/** A shift on the list: what it was, how it went, what it cost. Opens its flight record. */
export function ShiftRow({ t, onPress, imdUsd }: { t: TaskView; onPress: () => void; imdUsd: number }) {
  const s = statusOf(t.status);
  const costImd = Number(t.costImd ?? "0") / 1e18;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: "row", alignItems: "center", gap: 12 })}>
      <View style={{ width: 9, height: 9, backgroundColor: s.color, transform: [{ rotate: "45deg" }] }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.ui, color: C.ink, fontSize: 15.5 }} numberOfLines={1}>{t.title}</Text>
        <Mono style={{ fontSize: 12.5, color: C.faint, marginTop: 3 }}>{s.label} · cycle {t.cycle} · {clock(t.updatedAt)}{t.status === "building" || t.status === "ordering" ? ` · ${t.stepsDone}/${t.stepsTotal || "?"} steps` : ""}</Mono>
      </View>
      {costImd > 0 && <Mono style={{ color: C.ink, fontSize: 13.5 }}>{costImd.toFixed(2)} IMD{imdUsd ? <Text style={{ color: C.faint }}>{`\n$${(costImd * imdUsd).toFixed(2)}`}</Text> : null}</Mono>}
    </Pressable>
  );
}
