import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useDesk } from "../../lib/desk";
import { C } from "../../theme";

/** nightshift://company/<id>, from a notification: that company, on the Live tab. */
export default function OpenCompany() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setFocus } = useDesk();
  useEffect(() => {
    if (id) setFocus(id);
    router.replace("/live");
  }, [id, setFocus]);
  return <View style={{ flex: 1, backgroundColor: C.bg }} />;
}
