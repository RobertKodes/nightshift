import { Stack } from "expo-router";
import { C } from "../../../theme";

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: "slide_from_right" }} />;
}
