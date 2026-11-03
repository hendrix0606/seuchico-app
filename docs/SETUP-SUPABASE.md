# Configurar o Supabase do SeuChico

Passo a passo para criar um projeto Supabase novo e deixar o app funcionando.

## 1. Banco de dados

1. Crie um projeto em [supabase.com/dashboard](https://supabase.com/dashboard).
2. Abra **SQL Editor → New query**, cole o conteúdo de [`supabase/setup_completo.sql`](../supabase/setup_completo.sql) e clique em **Run**. Ele reúne as migrações `001` a `020` na ordem e também cria os buckets de armazenamento.
3. Em **Project Settings → API**, copie a *Project URL* e a chave *anon/publishable* para o `.env` do app.

## 2. Edge Functions

Com o Supabase CLI (`npx supabase login`), publique a partir da raiz do projeto:

```bash
npx supabase functions deploy admin-manage-user --project-ref <ref> --use-api
npx supabase functions deploy compute-delivery-route --project-ref <ref> --use-api
npx supabase functions deploy create-stripe-checkout --project-ref <ref> --use-api
npx supabase functions deploy send-push-notification --project-ref <ref> --use-api
npx supabase functions deploy stripe-return --project-ref <ref> --use-api
npx supabase functions deploy stripe-webhook --project-ref <ref> --use-api
```

O arquivo `supabase/config.toml` define o `verify_jwt` de cada função. `stripe-webhook` e `stripe-return` ficam **sem** verificação de JWT, porque são chamadas pelo Stripe e pelo navegador.

## 3. Segredos das funções

Em **Edge Functions → Secrets** (ou `npx supabase secrets set`):

| Segredo | Uso |
|---|---|
| `STRIPE_SECRET_KEY` | Pagamento por cartão (`sk_test_...` em testes) |
| `STRIPE_WEBHOOK_SECRET` | Assinatura do webhook (`whsec_...`) |
| `OPENROUTESERVICE_API_KEY` | Cálculo de rota do entregador |
| `EXPO_ACCESS_TOKEN` | Opcional, notificações push |
| `APP_URL` | Opcional, endereço web do app |

## 4. Stripe

No painel do Stripe (modo Test), crie um webhook apontando para:

```
https://<ref>.supabase.co/functions/v1/stripe-webhook
```

Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` e `checkout.session.expired`. Copie o *Signing secret* para `STRIPE_WEBHOOK_SECRET`. Cartão de teste: `4242 4242 4242 4242`, validade futura e qualquer CVC.

O retorno do pagamento volta ao app pela função `stripe-return`, que redireciona de uma página HTTPS para `seuchico://` (ou `exp://` no Expo Go).

## 5. Login

Em **Authentication → URL Configuration**, adicione em *Redirect URLs*:

- `seuchico://**`
- `exp://**`
- `http://localhost:3000/**`
- `http://localhost:8081/**`

Defina a *Site URL* com o endereço real do app quando houver um.

## 6. Primeiro administrador

Crie uma conta pelo app e promova-a no SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

## Mapa interno (opcional)

Por padrão o app não usa mapa interno: mostra distância, previsão e um botão que abre o trajeto no Google Maps do aparelho. Para ativar o mapa interno é preciso uma chave do *Maps SDK for Android* (exige faturamento) e as variáveis `GOOGLE_MAPS_API_KEY` e `EXPO_PUBLIC_NATIVE_MAP=true` no EAS.
