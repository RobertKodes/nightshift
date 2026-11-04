import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, api } from "../../../api/client";
import type { ChatAction, ChatLine, ChatView } from "../../../api/types";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, clock, usd } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { Frame } from "../../../ui/Frame";
import { Icon } from "../../../ui/icons";
import { Bar, Body, Button, Caps, Dim, Frog, Header, Link, Mono, Pill, Problem, Segmented, Title } from "../../../ui/kit";

/** The owner steers: a standing direction the CEO reads every shift, and a chat whose buttons do things. */
export default function Steer() {
  const { focus, refresh: refreshDesk, desk } = useDesk();
  const { toast } = useSession();
  const insets = useSafeAreaInsets();
  const chat = useData<ChatView>(focus ? `chat:${focus.id}` : null, () => api.chat(focus!.id));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [direction, setDirection] = useState(focus?.direction ?? "");
  const [savingDir, setSavingDir] = useState(false);
  const [reporting, setReporting] = useState<ChatLine | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { setDirection(focus?.direction ?? ""); }, [focus?.id, focus?.direction]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 60); }, [chat.data?.lines.length]);
  if (!focus) return <View style={{ flex: 1 }}><Backdrop /><Header title="Steer the CEO" /></View>;

  const lines = chat.data?.lines ?? [];
  const brain = chat.data?.brain;
  const imdUsd = desk?.imdUsd ?? 0;

  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    setSending(true);
    chat.set((d) => (d ? { ...d, lines: [...d.lines, { id: `local-${Date.now()}`, at: Date.now(), from: "owner", text: msg }] } : d));
    setText("");
    try { const r = await api.say(focus.id, msg); chat.set((d) => (d ? { ...d, lines: r.lines } : d)); }
    catch (e) { toast((e as ApiError).message); setText(msg); await chat.refresh(); }
    finally { setSending(false); }
  };
  const press = async (line: ChatLine, a: ChatAction) => {
    setActing(a.id);
    try {
      const r = await api.act(focus.id, line.id, a.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await Promise.all([chat.refresh(), refreshDesk()]);
      // an order that lands over the limit goes straight to its approval
      if (r.taskId && /approval/i.test(String((r as { note?: string }).note ?? ""))) router.push(`/approve/${focus.id}/${r.taskId}`);
      else toast(String((r as { note?: string }).note ?? "Done."));
    } catch (e) { toast((e as ApiError).message); } finally { setActing(null); }
  };
  const saveDirection = async () => {
    setSavingDir(true);
    try { await api.direct(focus.id, direction.trim()); toast(direction.trim() ? "The CEO reads this every shift now." : "Direction cleared."); setEditing(false); await refreshDesk(); }
    catch (e) { toast((e as ApiError).message); } finally { setSavingDir(false); }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <Backdrop />
      <Header title="Steer the CEO" right={<Pill>{brain?.strong ? "Strong model" : "Free model"}</Pill>} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: S.gutter, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <Frame stroke={C.limeDim} fill="#0d1206">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Caps style={{ color: C.lime, letterSpacing: 3 }}>Standing direction</Caps>
            {!editing && <Link onPress={() => setEditing(true)} style={{ fontSize: 13 }}><Text style={{ fontFamily: F.mono, color: C.faint }}>{(focus.direction ?? "").length} / 500 · </Text>edit</Link>}
          </View>
          {editing ? (
            <>
              <TextInput value={direction} onChangeText={(v) => setDirection(v.slice(0, 500))} multiline autoFocus placeholder="Focus on UK night-shift nurses. No discounts below $7." placeholderTextColor={C.ghost} style={{ fontFamily: F.uiReg, fontSize: 16, color: C.ink, marginTop: 10, minHeight: 80, textAlignVertical: "top" }} />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, alignItems: "center" }}>
                <Mono style={{ flex: 1, fontSize: 12.5 }}>{direction.length} / 500</Mono>
                <Button onPress={() => { setDirection(focus.direction ?? ""); setEditing(false); }}>Cancel</Button>
                <Button kind="lime" busy={savingDir} onPress={saveDirection}>Save</Button>
              </View>
            </>
          ) : (
            <Body style={{ marginTop: 10, fontSize: 16.5, lineHeight: 24, color: focus.direction ? C.ink : C.faint }}>{focus.direction || "No direction yet. Tell the CEO what to focus on, what to avoid, and how fast to go."}</Body>
          )}
          <Dim style={{ marginTop: 10, fontSize: 13 }}>Read every shift and passed to the swarm with each order.</Dim>
        </Frame>

        {brain && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
              <Caps>Strong model today</Caps>
              <Mono style={{ color: C.ink, fontSize: 13 }}>{usd(brain.spentTodayUsd)} <Text style={{ color: C.faint }}>/ {usd(brain.dailyUsd)}</Text></Mono>
            </View>
            <Bar value={brain.spentTodayUsd} max={Math.max(brain.dailyUsd, 0.01)} color={C.violet} style={{ marginTop: 8 }} />
          </>
        )}

        {chat.error && <View style={{ marginTop: 16 }}><Problem text={chat.error} retry={() => void chat.refresh()} /></View>}
        <View style={{ marginTop: 18, gap: 14 }}>
          {lines.length === 0 && <Dim>Ask the CEO anything: why sales moved, what it plans next, what to build. Its answers come with buttons that do the work.</Dim>}
          {lines.map((l) => l.from === "owner" ? (
            <View key={l.id} style={{ alignSelf: "flex-end", maxWidth: "86%" }}>
              <Frame fill="#17133a" stroke={C.violetDeep} padding={13}><Body style={{ fontSize: 15.5 }}>{l.text}</Body></Frame>
            </View>
          ) : (
            <View key={l.id} style={{ flexDirection: "row", gap: 10, maxWidth: "96%" }}>
              <Frog seed={focus.id} size={36} />
              <View style={{ flex: 1 }}>
                <Pressable onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setReporting(l); }} delayLongPress={350}>
                  <Frame tick padding={14}>
                    <Body style={{ fontSize: 15.5, lineHeight: 22 }}>{l.text}</Body>
                    {(l.actions ?? []).length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                        {l.actions!.map((a, i) => (
                          <Button key={a.id} small kind={i === 0 && !a.state ? "lime" : "ghost"} busy={acting === a.id} disabled={!!acting || a.state === "done"} onPress={() => press(l, a)} style={{ minWidth: 0 }}>
                            {a.state === "done" ? `✓ ${a.note ?? "Done"}`.slice(0, 40) : label(a, imdUsd)}
                          </Button>
                        ))}
                      </View>
                    )}
                  </Frame>
                </Pressable>
                <Mono style={{ fontSize: 12, color: C.ghost, marginTop: 6 }}>{clock(l.at)} · long-press to report</Mono>
              </View>
            </View>
          ))}
          {sending && <Dim style={{ marginLeft: 46 }}>The CEO is thinking…</Dim>}
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: S.gutter, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: "rgba(5,4,14,0.92)" }}>
        <Frame padding={0} style={{ flex: 1, minHeight: 52, justifyContent: "center", paddingHorizontal: 14 }} fill={C.panel} stroke={C.lineHi}>
          <TextInput value={text} onChangeText={setText} placeholder="Tell the CEO…" placeholderTextColor={C.ghost} multiline maxLength={1000} style={{ fontFamily: F.uiReg, fontSize: 16, color: C.ink, maxHeight: 110, paddingVertical: 10 }} />
        </Frame>
        <Pressable onPress={send} disabled={sending || !text.trim()} accessibilityLabel="Send" style={{ opacity: sending || !text.trim() ? 0.5 : 1 }}>
          <Frame fill={C.lime} stroke={C.lime} padding={0} cut={12} style={{ width: 56, height: 52, alignItems: "center", justifyContent: "center" }}>
            <Icon name="send" size={22} color={C.limeInk} stroke={2.4} />
          </Frame>
        </Pressable>
      </View>
      <View style={{ height: insets.bottom > 0 ? 0 : 0 }} />
      <Report line={reporting} onClose={() => setReporting(null)} onSend={async (reason) => {
        if (!reporting) return;
        try { await api.report(focus.id, reporting.id, reason); toast("Reported. Thank you: it is reviewed by a person."); setReporting(null); }
        catch (e) { toast((e as ApiError).message); }
      }} />
    </KeyboardAvoidingView>
  );
}

function label(a: ChatAction, imdUsd: number): string {
  switch (a.type) {
    case "order": return `${a.kind === "research" ? "Order research" : a.kind === "build_product" ? "Build it" : a.kind === "build_site" ? "Build the site" : "Improve the site"}${imdUsd ? ` · ~${usd(0.5 * imdUsd)}` : ""}`;
    case "todo": return "Add to-do";
    case "buy": return `Buy · ${usd(a.priceUsd)}`;
    case "post": return "Mark as posted";
    case "connect": return `Connect ${a.to}`;
    default: return "Do it";
  }
}

const REASONS = ["Offensive", "Harmful or dangerous", "Wrong or misleading", "Something else"] as const;
/** Report a CEO answer: the AI content rule. */
function Report({ line, onClose, onSend }: { line: ChatLine | null; onClose: () => void; onSend: (reason: string) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [why, setWhy] = useState<(typeof REASONS)[number]>("Offensive");
  const [more, setMore] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={!!line} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: C.scrim }} onPress={onClose} />
        <View style={{ backgroundColor: "#0b0a1d", borderTopWidth: 1, borderTopColor: C.lineHi, padding: S.gutter, paddingBottom: insets.bottom + 18 }}>
          <Caps style={{ color: C.coral }}>Report this answer</Caps>
          <Title style={{ marginTop: 6, fontSize: 17 }} numberOfLines={3}>{line?.text}</Title>
          <View style={{ marginTop: 14, gap: 8 }}>
            <Segmented small options={REASONS.slice(0, 2).map((r) => ({ value: r, label: r }))} value={why} onChange={setWhy} />
            <Segmented small options={REASONS.slice(2).map((r) => ({ value: r, label: r }))} value={why} onChange={setWhy} />
          </View>
          <TextInput value={more} onChangeText={setMore} placeholder="Anything to add (optional)" placeholderTextColor={C.ghost} maxLength={240} style={{ fontFamily: F.uiReg, fontSize: 15, color: C.ink, borderWidth: 1, borderColor: C.lineHi, padding: 12, marginTop: 12, backgroundColor: C.panel }} />
          <Button kind="dangerSolid" style={{ marginTop: 14 }} busy={busy} onPress={async () => { setBusy(true); await onSend(`${why}${more.trim() ? `: ${more.trim()}` : ""}`); setBusy(false); setMore(""); }}>Send report</Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
