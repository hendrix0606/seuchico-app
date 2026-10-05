import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedEvents = new Set([
  "chat_message",
  "order_status",
  "courier_assigned",
]);

type PushRequest = {
  order_id?: unknown;
  event_type?: unknown;
};

type Profile = {
  id: string;
  full_name: string;
  role: "client" | "courier" | "admin";
  is_active: boolean;
};

type Order = {
  id: string;
  order_number: number;
  user_id: string;
  assigned_courier_id: string | null;
  status: string;
  updated_at: string;
};

type PushToken = {
  user_id: string;
  expo_push_token: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = readPublicKey();
    const secretKey = readSecretKey();

    if (!supabaseUrl || !publicKey || !secretKey) {
      console.error("Supabase server configuration is missing.");
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } =
      await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "INVALID_SESSION" }, 401);
    }

    const body = (await request.json()) as PushRequest;
    if (
      typeof body.order_id !== "string" ||
      !isUuid(body.order_id) ||
      typeof body.event_type !== "string" ||
      !allowedEvents.has(body.event_type)
    ) {
      return json({ error: "INVALID_PUSH_REQUEST" }, 400);
    }

    const actorId = authData.user.id;
    const [{ data: profile }, { data: order }] = await Promise.all([
      adminClient
        .from("profiles")
        .select("id, full_name, role, is_active")
        .eq("id", actorId)
        .single(),
      adminClient
        .from("orders")
        .select(
          "id, order_number, user_id, assigned_courier_id, status, updated_at",
        )
        .eq("id", body.order_id)
        .single(),
    ]);

    if (!profile || !(profile as Profile).is_active) {
      return json({ error: "ACTIVE_PROFILE_REQUIRED" }, 403);
    }
    if (!order) return json({ error: "ORDER_NOT_FOUND" }, 404);

    const actor = profile as Profile;
    const currentOrder = order as Order;
    const event = await authorizeAndBuildEvent(
      adminClient,
      actor,
      currentOrder,
      body.event_type,
    );

    if (!event) return json({ error: "EVENT_NOT_ALLOWED" }, 403);

    const { error: eventError } = await adminClient
      .from("push_notification_events")
      .insert({
        event_key: event.eventKey,
        order_id: currentOrder.id,
        event_type: body.event_type,
        actor_id: actor.id,
      });

    if (eventError?.code === "23505") {
      return json({ ok: true, already_sent: true, sent: 0 });
    }
    if (eventError) throw eventError;

    if (event.recipientIds.length === 0) {
      await markEventSent(adminClient, event.eventKey);
      return json({ ok: true, sent: 0 });
    }

    const { data: tokens, error: tokensError } = await adminClient
      .from("push_tokens")
      .select("user_id, expo_push_token")
      .in("user_id", event.recipientIds)
      .eq("is_active", true);

    if (tokensError) throw tokensError;
    const activeTokens = (tokens ?? []) as PushToken[];

    if (activeTokens.length === 0) {
      await markEventSent(adminClient, event.eventKey);
      return json({ ok: true, sent: 0, no_registered_devices: true });
    }

    const notifications = activeTokens.map((item) => ({
      to: item.expo_push_token,
      title: event.title,
      body: event.body,
      sound: "default",
      channelId: "seuchico",
      priority: "high",
      data: {
        route:
          body.event_type === "chat_message"
            ? "/chat"
            : item.user_id === currentOrder.assigned_courier_id
              ? "/entregador"
              : "/pedidos",
        order_id: currentOrder.id,
        event_type: body.event_type,
      },
    }));

    const expoHeaders: Record<string, string> = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };
    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (expoAccessToken) {
      expoHeaders.Authorization = `Bearer ${expoAccessToken}`;
    }

    const expoResponse = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: expoHeaders,
        body: JSON.stringify(notifications),
      },
    );

    if (!expoResponse.ok) {
      await removePendingEvent(adminClient, event.eventKey);
      console.error("Expo Push API returned", expoResponse.status);
      return json({ error: "PUSH_PROVIDER_ERROR" }, 502);
    }

    const result = await expoResponse.json();
    const tickets = Array.isArray(result?.data) ? result.data : [];
    const invalidTokens = activeTokens
      .filter((_, index) =>
        tickets[index]?.details?.error === "DeviceNotRegistered"
      )
      .map((item) => item.expo_push_token);

    if (invalidTokens.length > 0) {
      await adminClient
        .from("push_tokens")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("expo_push_token", invalidTokens);
    }

    await markEventSent(adminClient, event.eventKey);
    return json({
      ok: true,
      sent: activeTokens.length - invalidTokens.length,
      deactivated: invalidTokens.length,
    });
  } catch (error) {
    console.error(
      "Unexpected push error:",
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    return json({ error: "UNEXPECTED_PUSH_ERROR" }, 500);
  }
});

async function authorizeAndBuildEvent(
  adminClient: ReturnType<typeof createClient>,
  actor: Profile,
  order: Order,
  eventType: string,
) {
  const orderLabel = `#${String(order.order_number).padStart(5, "0")}`;

  if (eventType === "chat_message") {
    const isClient = actor.role === "client" && order.user_id === actor.id;
    const isCourier =
      actor.role === "courier" && order.assigned_courier_id === actor.id;
    if ((!isClient && !isCourier) || !order.assigned_courier_id) return null;

    const { data: latestMessage } = await adminClient
      .from("order_messages")
      .select("id, sender_id")
      .eq("order_id", order.id)
      .eq("sender_id", actor.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .single();

    if (!latestMessage) return null;
    const recipientId = isClient
      ? order.assigned_courier_id
      : order.user_id;

    return {
      eventKey: `chat:${latestMessage.id}`,
      recipientIds: [recipientId],
      title: `Nova mensagem do pedido ${orderLabel}`,
      body: `${actor.full_name} enviou uma nova mensagem.`,
    };
  }

  if (eventType === "courier_assigned") {
    if (actor.role !== "admin" || !order.assigned_courier_id) return null;
    return {
      eventKey: `assigned:${order.id}:${order.assigned_courier_id}:${order.updated_at}`,
      recipientIds: [order.assigned_courier_id],
      title: "Nova entrega atribuída",
      body: `O pedido ${orderLabel} foi atribuído a você.`,
    };
  }

  const courierConfirmingDelivery =
    actor.role === "courier" &&
    order.assigned_courier_id === actor.id &&
    order.status === "delivered";
  if (actor.role !== "admin" && !courierConfirmingDelivery) return null;

  return {
    eventKey: `status:${order.id}:${order.status}:${order.updated_at}`,
    recipientIds: [order.user_id, order.assigned_courier_id]
      .filter((value): value is string => Boolean(value))
      .filter((value) => value !== actor.id),
    title: `Pedido ${orderLabel} atualizado`,
    body: statusMessage(order.status),
  };
}

function statusMessage(status: string) {
  const labels: Record<string, string> = {
    paid: "Pagamento confirmado.",
    in_production: "Seus ingressos entraram em produção.",
    ready_for_delivery: "Seu pedido está pronto para entrega.",
    out_for_delivery: "Seu pedido saiu para entrega.",
    delivered: "A entrega foi confirmada.",
    cancelled: "O pedido foi cancelado.",
  };
  return labels[status] ?? "O status do seu pedido foi atualizado.";
}

async function markEventSent(
  adminClient: ReturnType<typeof createClient>,
  eventKey: string,
) {
  await adminClient
    .from("push_notification_events")
    .update({ sent_at: new Date().toISOString() })
    .eq("event_key", eventKey);
}

async function removePendingEvent(
  adminClient: ReturnType<typeof createClient>,
  eventKey: string,
) {
  await adminClient
    .from("push_notification_events")
    .delete()
    .eq("event_key", eventKey)
    .is("sent_at", null);
}

function readPublicKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  return readDefaultJsonKey("SUPABASE_PUBLISHABLE_KEYS");
}

function readSecretKey() {
  const current = readDefaultJsonKey("SUPABASE_SECRET_KEYS");
  if (current) return current;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function readDefaultJsonKey(name: string) {
  const value = Deno.env.get(name);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
