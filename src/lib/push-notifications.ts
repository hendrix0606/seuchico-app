import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type PushEventType =
  | "chat_message"
  | "order_status"
  | "courier_assigned";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerCurrentDeviceForPush() {
  if (Platform.OS === "web") return { registered: false, reason: "web" };

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("seuchico", {
      name: "Pedidos e entregas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#35CCD0",
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermission.status;

  if (finalStatus !== "granted") {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== "granted") {
    return { registered: false, reason: "permission_denied" };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    return { registered: false, reason: "missing_project_id" };
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc("register_push_token", {
    p_expo_push_token: token.data,
    p_platform: Platform.OS,
    p_device_name: `SeuChico ${Platform.OS}`,
  });

  if (error) throw error;
  return { registered: true, reason: null };
}

export async function notifyOrderEvent(
  orderId: string,
  eventType: PushEventType,
) {
  try {
    const { error } = await supabase.functions.invoke(
      "send-push-notification",
      {
        body: { order_id: orderId, event_type: eventType },
      },
    );

    if (error) {
      console.warn("A ação foi concluída, mas a notificação não foi enviada.");
      return false;
    }

    return true;
  } catch {
    console.warn("A ação foi concluída, mas a notificação não foi enviada.");
    return false;
  }
}

export async function deactivateCurrentUserPushTokens() {
  try {
    await supabase.rpc("deactivate_my_push_tokens");
  } catch {
    // O encerramento da sessão nunca deve ser bloqueado pela notificação.
  }
}
