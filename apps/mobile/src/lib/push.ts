import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";
import { api } from "../api/client";

/**
 * Notes from the engine on the lock screen, over Firebase. Approvals get a loud channel of their own
 * and two buttons: Review opens the approval (the fingerprint is asked there, never in the shade),
 * Decline opens the app and declines. A note carries ids only; it never approves anything itself.
 */

export async function setUpNotes(): Promise<void> {
  Notifications.setNotificationHandler({
    // in the app, a note shows as a banner too: an approval should never be missed
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("approvals", {
    name: "Approvals", description: "A company is holding a spend for you", importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 220, 120, 220], lightColor: "#b8ff3d", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, enableVibrate: true, showBadge: true,
  });
  await Notifications.setNotificationChannelAsync("activity", {
    name: "Sales and deliveries", description: "Sales, finished work and warnings", importance: Notifications.AndroidImportance.DEFAULT, lightColor: "#7b61ff", showBadge: false,
  });
  await Notifications.setNotificationCategoryAsync("approval", [
    { identifier: "review", buttonTitle: "Review", options: { opensAppToForeground: true } },
    { identifier: "decline", buttonTitle: "Decline", options: { opensAppToForeground: true, isDestructive: true } },
  ]);
}

/** Asks once (Android 13+ asks the owner); returns the FCM token, or null without permission or without Firebase in this build. */
export async function pushToken(ask = true): Promise<string | null> {
  const cur = await Notifications.getPermissionsAsync();
  let ok = cur.granted;
  if (!ok && ask && cur.canAskAgain) ok = (await Notifications.requestPermissionsAsync()).granted;
  if (!ok) return null;
  try { const t = await Notifications.getDevicePushTokenAsync(); return typeof t.data === "string" ? t.data : null; } catch { return null; }
}

export async function notesAllowed(): Promise<boolean> { return (await Notifications.getPermissionsAsync()).granted; }

type NoteData = { url?: string; kind?: string; companyId?: string; taskId?: string };

/** Where a tapped note goes. Decline declines (and says so); everything else only opens a screen. */
async function handle(r: Notifications.NotificationResponse, toast: (text: string) => void): Promise<void> {
  const d = (r.notification.request.content.data ?? {}) as NoteData;
  if (!d.companyId) return;
  if (r.actionIdentifier === "decline" && d.taskId) {
    try { await api.reject(d.companyId, d.taskId); toast("Declined. Nothing was spent."); }
    catch (e) { toast((e as Error).message); }
    await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => {});
    router.push(`/company/${d.companyId}`);
    return;
  }
  if (d.kind === "approval" && d.taskId) router.push(`/approve/${d.companyId}/${d.taskId}`);
  else router.push(`/company/${d.companyId}`);
}

/** Follows taps on notes, including the one that opened the app. Returns the unsubscribe. */
export function followNotes(toast: (text: string) => void): () => void {
  let seen = "";
  const go = (r: Notifications.NotificationResponse | null) => {
    if (!r) return;
    const key = `${r.notification.request.identifier}:${r.actionIdentifier}`;
    if (key === seen) return;
    seen = key;
    void handle(r, toast);
  };
  void Notifications.getLastNotificationResponseAsync().then(go);
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}
