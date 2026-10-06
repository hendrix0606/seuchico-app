-- SeuChico - Etapa 4 (reconstituida)
-- Base de pagamentos Stripe em orders + eventos de webhook.
--
-- Este arquivo NAO existia no repositorio, embora o banco de producao ja
-- tivesse estas estruturas. Foi reconstituido a partir do banco real (colunas,
-- valores padrao, regras e indices consultados no catalogo do Postgres).
--
-- E IDEMPOTENTE: no banco atual nao altera nada (tudo ja existe) e, em um banco
-- novo, recria o que falta. Execute depois do 003 e antes do 005.
--   * As regras de payment_provider e payment_status descritas aqui sao as do
--     inicio do projeto; os arquivos 015 (PIX) e 017 (dinheiro) as ampliam.
--   * So cria uma regra se ela ainda nao existir, para nunca desfazer uma
--     versao mais nova (por exemplo, a que aceita 'cash' e 'on_delivery').
--   * stripe_webhook_events e usada somente pelas Edge Functions (service role).
--     Fica com RLS ligado e sem acesso para anon/authenticated.

begin;

-- 1. Colunas de pagamento no pedido.
alter table public.orders
  add column if not exists payment_provider text not null default 'stripe',
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_attempt integer not null default 0,
  add column if not exists payment_updated_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

-- 2. Regras (somente se ainda nao existirem).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_check'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_check
      check (payment_provider in ('stripe'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (
        payment_status in (
          'pending', 'creating', 'processing', 'paid', 'failed',
          'cancelled', 'refunded'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_attempt_check'
  ) then
    alter table public.orders
      add constraint orders_payment_attempt_check
      check (payment_attempt >= 0);
  end if;
end
$$;

-- 3. Indices.
create index if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);

create unique index if not exists orders_stripe_checkout_session_uidx
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists orders_stripe_payment_intent_uidx
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- 4. Eventos do webhook do Stripe (evita processar o mesmo evento duas vezes).
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events
  from public, anon, authenticated;

commit;
