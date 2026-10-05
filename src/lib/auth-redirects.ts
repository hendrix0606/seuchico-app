import * as Linking from "expo-linking";
import { Platform } from "react-native";

export function passwordRecoveryRedirectUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/nova-senha`;
  }

  return Linking.createURL("/nova-senha", { scheme: "seuchico" });
}
