import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "../context/auth-context";
import { registerCurrentDeviceForPush } from "../lib/push-notifications";

type NotificationData = {
  route?: unknown;
  order_id?: unknown;
};

export function PushNotificationsBootstrap() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const registeredUserId = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (
      !session?.user.id ||
      !profile?.is_active ||
      profile.must_change_password
    ) return;
    if (registeredUserId.current === session.user.id) return;

    registeredUserId.current = session.user.id;
    void registerCurrentDeviceForPush().catch(() => {
      registeredUserId.current = null;
    });
  }, [profile?.is_active, profile?.must_change_password, session?.user.id]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const openNotification = (
      response: Notifications.NotificationResponse,
    ) => {
      const data = response.notification.request.content.data as NotificationData;
      const route = typeof data.route === "string" ? data.route : null;
      const orderId =
        typeof data.order_id === "string" ? data.order_id : null;

      if (route === "/chat" && orderId) {
        router.push({ pathname: "/chat", params: { order: orderId } });
      } else if (route === "/entregador") {
        router.push("/entregador");
      } else {
        router.push("/pedidos");
      }
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(openNotification);

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (
        response &&
        Date.now() - response.notification.date < 5 * 60 * 1000
      ) {
        openNotification(response);
      }
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}
