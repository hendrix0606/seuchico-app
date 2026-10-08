// Ponte HTTPS entre o Stripe Checkout e o aplicativo.
//
// O Stripe so garante o retorno para enderecos https. Para apps nativos, o
// create-stripe-checkout manda o Stripe voltar para esta funcao, que
// redireciona (302) para o endereco do app (seuchico:// ou exp://).
// Nao recebe nem devolve dados sensiveis: apenas repassa payment e session_id.
Deno.serve((request) => {
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get("to");

  if (!target || target.length > 500) {
    return plain("Endereço de retorno inválido.", 400);
  }

  let destination: URL;

  try {
    destination = new URL(target);
  } catch {
    return plain("Endereço de retorno inválido.", 400);
  }

  // Somente esquemas do proprio app: evita servir de redirecionamento aberto.
  if (!["seuchico:", "exp:", "exps:"].includes(destination.protocol)) {
    return plain("Endereço de retorno não permitido.", 400);
  }

  const payment = incoming.searchParams.get("payment");
  const sessionId = incoming.searchParams.get("session_id");

  if (payment === "success" || payment === "cancelled") {
    destination.searchParams.set("payment", payment);
  }

  if (sessionId && /^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) {
    destination.searchParams.set("session_id", sessionId);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: destination.toString(), "Cache-Control": "no-store" },
  });
});

function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
