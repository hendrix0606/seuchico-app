import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OrderRecord = {
  id: string;
  order_number: number;
  user_id: string;
  status: string;
  payment_status: string;
  payment_attempt: number;
  stripe_checkout_session_id: string | null;
  unit_price_cents: number;
  delivery_fee_cents: number;
  quantity: number;
  total_cents: number;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    console.error("Stripe ou Supabase secrets ausentes.");
    return json({ error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const authorization = request.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  const accessToken = authorization.slice("Bearer ".length);
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (userError || !user) {
    return json({ error: "INVALID_SESSION" }, 401);
  }

  let body: { order_id?: unknown; return_url?: unknown };

  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  if (typeof body.order_id !== "string") {
    return json({ error: "INVALID_ORDER_ID" }, 400);
  }

  const returnUrl = validateReturnUrl(body.return_url);

  if (!returnUrl) {
    return json({ error: "INVALID_RETURN_URL" }, 400);
  }

  const { data: orderData, error: orderError } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, user_id, status, payment_status, payment_attempt, stripe_checkout_session_id, unit_price_cents, delivery_fee_cents, quantity, total_cents",
    )
    .eq("id", body.order_id)
    .eq("user_id", user.id)
    .single();

  if (orderError || !orderData) {
    return json({ error: "ORDER_NOT_FOUND" }, 404);
  }

  const order = orderData as OrderRecord;

  if (order.status === "paid" || order.payment_status === "paid") {
    return json({ already_paid: true }, 200);
  }

  if (order.status !== "awaiting_payment") {
    return json({ error: "ORDER_CANNOT_BE_PAID" }, 409);
  }

  // O cliente pode voltar ao cartão depois de um comprovante PIX recusado.
  // Registrar o provedor aqui mantém o financeiro e o webhook consistentes.
  const { error: providerError } = await supabaseAdmin
    .from("orders")
    .update({ payment_provider: "stripe" })
    .eq("id", order.id)
    .eq("user_id", user.id)
    .neq("payment_status", "paid");

  if (providerError) {
    return json({ error: "PAYMENT_PROVIDER_NOT_UPDATED" }, 500);
  }

  const stripe = new Stripe(stripeSecretKey);

  if (order.stripe_checkout_session_id) {
    try {
      const previousSession = await stripe.checkout.sessions.retrieve(
        order.stripe_checkout_session_id,
      );

      if (previousSession.payment_status === "paid") {
        return json({ already_paid: true }, 200);
      }

      if (previousSession.status === "open" && previousSession.url) {
        return json({ checkout_url: previousSession.url }, 200);
      }
    } catch (error) {
      console.warn("Sessao Stripe anterior indisponivel.", safeMessage(error));
    }
  }

  const currentAttempt = Number(order.payment_attempt ?? 0);
  const nextAttempt = currentAttempt + 1;
  const now = new Date().toISOString();

  const { data: claimedOrder, error: claimError } = await supabaseAdmin
    .from("orders")
    .update({
      payment_provider: "stripe",
      payment_attempt: nextAttempt,
      payment_status: "creating",
      payment_updated_at: now,
    })
    .eq("id", order.id)
    .eq("user_id", user.id)
    .eq("payment_attempt", currentAttempt)
    .neq("payment_status", "paid")
    .select("id")
    .maybeSingle();

  if (claimError || !claimedOrder) {
    return json({ error: "PAYMENT_ALREADY_STARTING" }, 409);
  }

  try {
    const orderLabel = String(order.order_number).padStart(5, "0");
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: order.quantity,
        price_data: {
          currency: "brl",
          unit_amount: order.unit_price_cents,
          product_data: {
            name: `Ingresso personalizado - Pedido #${orderLabel}`,
            description: `${order.quantity} ingresso(s) fisico(s) personalizado(s)`,
          },
        },
      },
    ];

    if (order.delivery_fee_cents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: order.delivery_fee_cents,
          product_data: { name: "Entrega SeuChico" },
        },
      });
    }

    const metadata = {
      order_id: order.id,
      order_number: String(order.order_number),
      user_id: user.id,
    };

    const checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        locale: "pt-BR",
        customer_email: user.email ?? undefined,
        line_items: lineItems,
        metadata,
        payment_intent_data: { metadata },
        success_url: appendQuery(
          returnUrl,
          "payment=success&session_id={CHECKOUT_SESSION_ID}",
        ),
        cancel_url: appendQuery(returnUrl, "payment=cancelled"),
      },
      { idempotencyKey: `seuchico:${order.id}:${nextAttempt}` },
    );

    if (!checkoutSession.url) {
      throw new Error("CHECKOUT_URL_NOT_CREATED");
    }

    const { error: saveError } = await supabaseAdmin
      .from("orders")
      .update({
        stripe_checkout_session_id: checkoutSession.id,
        payment_status:
          checkoutSession.payment_status === "paid" ? "paid" : "pending",
        payment_updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("payment_attempt", nextAttempt);

    if (saveError) {
      try {
        await stripe.checkout.sessions.expire(checkoutSession.id);
      } catch (expireError) {
        console.error("Falha ao expirar sessao nao registrada.", safeMessage(expireError));
      }
      throw saveError;
    }

    return json({ checkout_url: checkoutSession.url }, 200);
  } catch (error) {
    console.error("Falha ao criar Stripe Checkout.", safeMessage(error));

    await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "failed",
        payment_updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("payment_attempt", nextAttempt)
      .neq("payment_status", "paid");

    return json({ error: "CHECKOUT_CREATION_FAILED" }, 500);
  }
});

function validateReturnUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;

  try {
    const url = new URL(value);
    const isLocalWeb =
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol);
    const isExpoDevelopment = ["exp:", "exps:"].includes(url.protocol);
    const isSeuChicoApp = url.protocol === "seuchico:";

    const configuredAppUrl = Deno.env.get("APP_URL");
    const isConfiguredWeb = configuredAppUrl
      ? url.origin === new URL(configuredAppUrl).origin
      : false;

    return isLocalWeb || isExpoDevelopment || isSeuChicoApp || isConfiguredWeb
      ? value
      : null;
  } catch {
    return null;
  }
}

function appendQuery(url: string, query: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function json(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_ERROR";
}
