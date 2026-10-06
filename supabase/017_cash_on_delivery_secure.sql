-- SeuChico - Etapa 17
-- Pagamento em dinheiro na entrega.
--   * O admin habilita a opcao e define o valor maximo por pedido.
--   * O cliente escolhe "dinheiro" no pedido e informa, se quiser, o troco.
--   * O admin aceita o pedido (ele vai para producao sem estar pago).
--   * O entregador confirma a entrega e o recebimento: so entao o pedido vira
--     "paid" e entra na receita.
-- Execute uma unica vez no SQL Editor do Supabase.
-- Tudo roda em uma transacao: se algo falhar, nada e aplicado.

begin;

-- 0. Seguranca: este arquivo assume que payment_provider e payment_status sao
--    colunas de texto. Se forem enum, para aqui sem alterar nada.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in ('payment_provider', 'payment_status')
      and data_type not in ('text', 'character varying')
  ) then
    raise exception 'ENUM_COLUMN_DETECTED: payment_provider/payment_status nao sao texto. Envie o resultado ao desenvolvedor antes de continuar.';
  end if;
end
$$;

-- 1. Regras de valores permitidos. Remove somente os checks simples de lista
--    ("payment_status = ANY (...)" e "payment_provider = ANY (...)") e recria
--    com os novos valores. Outras regras do pedido nao sao tocadas.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '^CHECK \(+payment_(status|provider)(::text)? = ANY'
  loop
    execute format('alter table public.orders drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.orders
  drop constraint if exists orders_payment_provider_check;
alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('stripe', 'pix', 'cash'));

alter table public.orders
  drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (
    payment_status in (
      'pending', 'creating', 'processing', 'paid', 'failed',
      'cancelled', 'refunded', 'on_delivery'
    )
  );

-- 2. Dados do dinheiro no pedido.
alter table public.orders
  add column if not exists cash_change_for_cents integer,
  add column if not exists cash_received_at timestamptz,
  add column if not exists cash_received_by uuid
    references public.profiles(id) on delete set null;

comment on column public.orders.cash_change_for_cents is
  'Valor com que o cliente pretende pagar em dinheiro (para calcular o troco).';

alter table public.orders
  drop constraint if exists orders_cash_change_check;
alter table public.orders
  add constraint orders_cash_change_check
  check (
    cash_change_for_cents is null
    or (
      cash_change_for_cents >= total_cents
      and cash_change_for_cents <= 1000000
    )
  );

-- 3. Configuracao do admin (mesmo padrao do PIX).
create table if not exists public.cash_settings (
  id smallint primary key check (id = 1),
  is_enabled boolean not null default false,
  max_order_cents integer not null default 30000
    check (max_order_cents between 100 and 10000000),
  instructions text
    check (char_length(coalesce(instructions, '')) <= 500),
  updated_at timestamptz not null default now()
);

insert into public.cash_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.cash_settings enable row level security;

drop policy if exists "Authenticated users can view cash settings" on public.cash_settings;
create policy "Authenticated users can view cash settings"
on public.cash_settings for select to authenticated
using (true);

drop policy if exists "Admins can update cash settings" on public.cash_settings;
create policy "Admins can update cash settings"
on public.cash_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

revoke all on table public.cash_settings from public, anon, authenticated;
grant select on table public.cash_settings to authenticated;
grant update on table public.cash_settings to authenticated;

drop trigger if exists set_cash_settings_updated_at on public.cash_settings;
create trigger set_cash_settings_updated_at
before update on public.cash_settings
for each row execute function public.set_updated_at();

-- 4. O cliente escolhe pagar em dinheiro na entrega.
create or replace function public.choose_cash_payment(
  p_order_id uuid,
  p_change_for_cents integer default null
)
returns table (order_id uuid, payment_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_settings public.cash_settings%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'client' and is_active = true
  ) then
    raise exception 'CLIENT_ACCOUNT_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'awaiting_payment'
    or v_order.payment_status not in ('pending', 'failed', 'cancelled', 'on_delivery')
  then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT';
  end if;

  select * into v_settings from public.cash_settings where id = 1;
  if not found or not v_settings.is_enabled then
    raise exception 'CASH_NOT_ENABLED';
  end if;

  if v_order.total_cents > v_settings.max_order_cents then
    raise exception 'CASH_LIMIT_EXCEEDED';
  end if;

  if p_change_for_cents is not null
    and (p_change_for_cents < v_order.total_cents or p_change_for_cents > 1000000)
  then
    raise exception 'INVALID_CHANGE_AMOUNT';
  end if;

  update public.orders
  set
    payment_provider = 'cash',
    payment_status = 'on_delivery',
    cash_change_for_cents = p_change_for_cents,
    payment_updated_at = now(),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, 'on_delivery'::text;
end;
$$;

revoke all on function public.choose_cash_payment(uuid, integer)
  from public, anon;
grant execute on function public.choose_cash_payment(uuid, integer)
  to authenticated;

-- 5. Admin: pedidos em dinheiro podem iniciar a producao sem estar pagos.
--    O admin NAO marca como entregue um pedido em dinheiro a receber: quem
--    confirma entrega e recebimento e o entregador.
create or replace function public.admin_transition_order(
  p_order_id uuid,
  p_next_status text,
  p_note text default null
)
returns table (
  order_id uuid,
  previous_status text,
  current_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_is_cash_pending boolean;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  v_is_cash_pending := v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery';

  if v_order.payment_status <> 'paid' and not v_is_cash_pending then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if not (
    (v_order.status = 'paid' and p_next_status = 'in_production')
    or (
      v_is_cash_pending
      and v_order.status = 'awaiting_payment'
      and p_next_status = 'in_production'
    )
    or (
      v_order.status = 'in_production'
      and p_next_status = 'ready_for_delivery'
    )
    or (
      v_order.status = 'ready_for_delivery'
      and p_next_status = 'out_for_delivery'
    )
    or (
      v_order.status = 'out_for_delivery'
      and p_next_status = 'delivered'
    )
  ) then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  if v_is_cash_pending and p_next_status = 'delivered' then
    raise exception 'CASH_RECEIPT_REQUIRED';
  end if;

  if p_next_status = 'out_for_delivery'
    and not exists (
      select 1
      from public.profiles
      where id = v_order.assigned_courier_id
        and role = 'courier'::public.user_role
        and is_active = true
    )
  then
    raise exception 'COURIER_REQUIRED';
  end if;

  perform set_config(
    'seuchico.status_note',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), ''),
    true
  );

  update public.orders
  set
    status = p_next_status,
    production_notes = coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      production_notes
    ),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, v_order.status, p_next_status;
end;
$$;

revoke all on function public.admin_transition_order(uuid, text, text)
  from public, anon;
grant execute on function public.admin_transition_order(uuid, text, text)
  to authenticated;

-- 6. Entregador: confirmar a entrega de um pedido em dinheiro tambem confirma
--    o recebimento. O pedido passa a "paid" e entra na receita.
create or replace function public.courier_confirm_delivery(
  p_order_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  previous_status text,
  current_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_is_cash_pending boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'courier'::public.user_role
      and is_active = true
  ) then
    raise exception 'ACTIVE_COURIER_REQUIRED';
  end if;

  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.assigned_courier_id is distinct from v_user_id then
    raise exception 'COURIER_NOT_ASSIGNED';
  end if;

  v_is_cash_pending := v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery';

  if v_order.payment_status <> 'paid' and not v_is_cash_pending then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      case
        when v_is_cash_pending then 'Entrega confirmada e pagamento em dinheiro recebido pelo entregador.'
        else 'Entrega confirmada pelo entregador.'
      end
    ),
    true
  );

  update public.orders
  set
    status = 'delivered',
    payment_status = case when v_is_cash_pending then 'paid' else payment_status end,
    paid_at = case when v_is_cash_pending then now() else paid_at end,
    payment_updated_at = case when v_is_cash_pending then now() else payment_updated_at end,
    cash_received_at = case when v_is_cash_pending then now() else cash_received_at end,
    cash_received_by = case when v_is_cash_pending then v_user_id else cash_received_by end,
    production_notes = coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      production_notes
    ),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, v_order.status, 'delivered'::text;
end;
$$;

revoke all on function public.courier_confirm_delivery(uuid, text)
  from public, anon;
grant execute on function public.courier_confirm_delivery(uuid, text)
  to authenticated;

commit;
