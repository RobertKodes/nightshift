import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ApiError, api } from "../../../api/client";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { S } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { Frame } from "../../../ui/Frame";
import { Button, Dim, Empty, Frog, Header, Mono, Title } from "../../../ui/kit";

/** Companies the owner deleted: each can come back, paused, with its products and books. */
export default function Archived() {
  const { desk, refresh, setFocus } = useDesk();
  const { toast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const list = desk?.archived ?? [];
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Deleted companies" />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40, gap: 12 }}>
        {list.length === 0 && <Empty title="Nothing deleted" body="A company you delete shows here, and can come back." />}
        {list.map((c) => (
          <Frame key={c.id} tick>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Frog seed={c.id} size={44} dim />
              <View style={{ flex: 1 }}>
                <Title style={{ fontSize: 17 }} numberOfLines={1}>{c.name}</Title>
                <Mono style={{ fontSize: 12.5 }}>deleted {new Date(c.archivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {c.products} products · {c.sales} sales</Mono>
              </View>
            </View>
            <Dim style={{ marginTop: 10 }} numberOfLines={2}>{c.mission}</Dim>
            <Button style={{ marginTop: 12 }} icon="restore" busy={busy === c.id} disabled={!!busy} onPress={async () => {
              setBusy(c.id);
              try { const r = await api.restore(c.id); await refresh(); setFocus(r.id); toast(`${c.name} is back, paused. Resume it when you are ready.`); }
              catch (e) { toast((e as ApiError).message); } finally { setBusy(null); }
            }}>Restore</Button>
          </Frame>
        ))}
      </ScrollView>
    </View>
  );
}
