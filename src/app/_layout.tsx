import "../../nativewind.css";
import { Stack } from "expo-router";
import { PushNotificationsBootstrap } from "../components/PushNotificationsBootstrap";
import {
  AppearanceProvider,
  useAppearance,
} from "../context/appearance-context";
import { AuthProvider } from "../context/auth-context";

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <AuthProvider>
        <PushNotificationsBootstrap />
        <ThemedStack />
      </AuthProvider>
    </AppearanceProvider>
  );
}

function ThemedStack() {
  const { appearance } = useAppearance();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        contentStyle: { backgroundColor: appearance.background_color },
      }}
    />
  );
}
