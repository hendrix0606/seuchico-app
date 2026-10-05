import { useEffect, useState } from "react";
import { useAuth } from "../context/auth-context";
import { supabase } from "../lib/supabase";

export function useOrderChatUnread(orderIds: string[]) {
  const { session } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const orderIdsKey = [...new Set(orderIds)].sort().join(",");

  useEffect(() => {
    const userId = session?.user.id;
    const ids = orderIdsKey ? orderIdsKey.split(",") : [];
    let isMounted = true;

    const loadCounts = async () => {
      if (!userId || ids.length === 0) {
        if (isMounted) setCounts({});
        return;
      }

      const { data, error } = await supabase
        .from("order_messages")
        .select("order_id, sender_id")
        .in("order_id", ids)
        .is("read_at", null)
        .neq("sender_id", userId);

      if (!isMounted || error) return;

      const nextCounts: Record<string, number> = {};
      for (const message of data ?? []) {
        const orderId = String(message.order_id);
        nextCounts[orderId] = (nextCounts[orderId] ?? 0) + 1;
      }
      setCounts(nextCounts);
    };

    void loadCounts();

    if (!userId || ids.length === 0) {
      return () => {
        isMounted = false;
      };
    }

    const channel = supabase
      .channel(`order-chat-unread-${userId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_messages" },
        () => void loadCounts(),
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [orderIdsKey, session?.user.id]);

  return counts;
}
