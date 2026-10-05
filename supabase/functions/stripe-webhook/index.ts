import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signature = request.headers.get("Stripe-Signature");

  if (
    !stripeSecretKey ||
    !webhookSecret ||
    !supabaseUrl ||
    !serviceRoleKey ||
    !signature
  ) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey);
  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Assinatura Stripe invalida.", safeMessage(error));
    return new Response("Invalid signature", { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: knownEvent } = await supabaseAdmin
      .from("stripe_webhook_events")
      .select("processed_at")
      .eq("stripe_event_id", event.id)
      .maybeSingle();

    if (knownEvent?.processed_at) {
      return Response.json({ received: true, duplicate: true });
    }

    if (!knownEvent) {
      const { error: insertError } = await supabaseAdmin
        .from("stripe_webhook_events")
        .insert({
          stripe_event_id: event.id,
          event_type: event.type,
          livemode: event.livemode,
        });

      if (insertError && insertError.code !== "23505") throw insertError;
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      await processCheckoutEvent(
        event.type,
        event.data.object as Stripe.Checkout.Session,
        supabaseAdmin,
      );
    }

    const { error: processedError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("stripe_event_id", event.id);

    if (processedError) throw processedError;

    return Response.json({ received: true });
  } catch (error) {
    const message = safeMessage(error);
    console.error("Falha ao processar webhook Stripe.", message);

    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ last_error: message })
      .eq("stripe_event_id", event.id);

    return new Response("Webhook processing failed", { status: 500 });
  }
});

async function processCheckoutEvent(
  eventType: string,
  session: Stripe.Checkout.Session,
  supabaseAdmin: ReturnType<typeof createClient>,
) {
  const orderId = session.metadata?.order_id;

  if (!orderId) throw new Error("ORDER_METADATA_MISSING");

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("id, status, payment_status, total_cents, paid_at")
    .eq("id", orderId)
    .single();

  if (orderError || !order) throw new Error("ORDER_NOT_FOUND");

  if (
    typeof session.amount_total === "number" &&
    session.amount_total !== order.total_cents
  ) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }

  if (session.currency && session.currency.toLowerCase() !== "brl") {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const now = new Date().toISOString();
  const paymentSucceeded =
    eventType === "checkout.session.async_payment_succeeded" ||
    (eventType === "checkout.session.completed" &&
      session.payment_status === "paid");

  if (paymentSucceeded) {
    const nextOrderStatus = ["awaiting_payment", "paid"].includes(order.status)
      ? "paid"
      : order.status;

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        payment_provider: "stripe",
        status: nextOrderStatus,
        payment_status: "paid",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        payment_updated_at: now,
        paid_at: order.paid_at ?? now,
      })
      .eq("id", orderId);

    if (error) throw error;

    // Se havia um comprovante PIX aguardando análise, o cartão confirmado
    // passa a ser a fonte definitiva do pagamento.
    await supabaseAdmin
      .from("pix_payment_submissions")
      .update({
        status: "rejected",
        admin_note: "Pedido pago por cartão antes da análise do comprovante PIX.",
        reviewed_at: now,
      })
      .eq("order_id", orderId)
      .eq("status", "pending");
    return;
  }

  if (eventType === "checkout.session.completed") {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        payment_provider: "stripe",
        payment_status: "processing",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        payment_updated_at: now,
      })
      .eq("id", orderId)
      .eq("stripe_checkout_session_id", session.id)
      .neq("payment_status", "paid");

    if (error) throw error;
    return;
  }

  const finalPaymentStatus =
    eventType === "checkout.session.expired" ? "cancelled" : "failed";

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      payment_provider: "stripe",
      payment_status: finalPaymentStatus,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      payment_updated_at: now,
    })
    .eq("id", orderId)
    .eq("stripe_checkout_session_id", session.id)
    .neq("payment_status", "paid");

  if (error) throw error;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_ERROR";
}
