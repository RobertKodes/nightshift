import "@walletconnect/react-native-compat";
import { Inter_400Regular, Inter_500Medium } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono";
import { Silkscreen_400Regular } from "@expo-google-fonts/silkscreen";
import { SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts } from "expo-font";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DeskProvider } from "../lib/desk";
import { SessionProvider, useSession } from "../lib/session";
import { WalletProvider } from "../lib/wallet";
import { C } from "../theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});
void SystemUI.setBackgroundColorAsync(C.bg).catch(() => {});

/** Signed out: only the sign-in screen. Signed in: never the sign-in screen. */
function Gate() {
  const { status } = useSession();
  const seg = useSegments();
  useEffect(() => { if (status !== "loading") void SplashScreen.hideAsync().catch(() => {}); }, [status]);
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const onSignIn = seg[0] === "sign-in";
  if (__DEV__ && seg[0] === "dev") return <Stack screenOptions={{ headerShown: false }} />;
  if (status === "out" && !onSignIn) return <Redirect href="/sign-in" />;
  if (status === "in" && onSignIn) return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: "slide_from_right" }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
      <Stack.Screen name="found" />
      <Stack.Screen name="approve/[companyId]/[taskId]" options={{ presentation: "transparentModal", animation: "slide_from_bottom", contentStyle: { backgroundColor: "transparent" } }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fonts] = useFonts({
    Inter_400Regular, Inter_500Medium, Silkscreen_400Regular,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
    SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
  });
  if (!fonts) return null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <WalletProvider>
          <SessionProvider>
            <DeskProvider>
              <Gate />
            </DeskProvider>
          </SessionProvider>
        </WalletProvider>
      </SafeAreaProvider>
    </View>
  );
}
