import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { ensureKey } from "../lib/deviceKey";
import { useSession } from "../lib/session";
import { C } from "../theme";

/**
 * Development builds only: nightshift://dev logs this phone's key, and nightshift://dev?token=… adopts a
 * session a test script made against a local engine, so sign-in, push and approvals can be tested on the
 * emulator without a wallet app. A release build only goes home.
 */
export default function Dev() {
  const { token, note } = useLocalSearchParams<{ token?: string; note?: string }>();
  const { adopt } = useSession();
  useEffect(() => {
    if (!__DEV__) { router.replace("/"); return; }
    void (async () => {
      const k = await ensureKey();
      console.log(`[dev] device ${k.id} ${k.pubKey}`);
      if (token) await adopt(token);
      // a note shaped like the engine's approval push, to check the channel, icon and buttons
      if (note) await Notifications.scheduleNotificationAsync({
        content: { title: "✋ Tidewell Planner needs your approval", body: "Improve the site: a landing page for night-shift nurses. $7.68 is over the $5 you approve by hand.", categoryIdentifier: "approval", data: { url: "nightshift://approve/demo-tidewell/t14", kind: "approval", companyId: "demo-tidewell", taskId: "t14" } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: "approvals" },
      });
      router.replace("/");
    })().catch((e) => { console.log("[dev] failed", (e as Error).message); router.replace("/"); });
  }, [token, note, adopt]);
  return <View style={{ flex: 1, backgroundColor: C.bg }} />;
}
