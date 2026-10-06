-- SeuChico - Etapa 19
-- Dinheiro na entrega: acerto de caixa do entregador e recusa de pagamento.
--
--  1. Acerto de caixa: o dinheiro recebido pelo entregador fica como saldo a
--     repassar. O admin registra repasses (parciais ou totais, nunca acima do
--     saldo). O entregador ve apenas o proprio saldo.
--  2. Recusa: se o cliente se recusa a pagar na porta, o entregador registra o
--     motivo e o pedido e cancelado. O cliente fica 90 dias sem poder escolher
--     "dinheiro" (volta sozinho depois disso).
--
-- Execute uma unica vez no SQL Editor do Supabase, depois do 017.
-- Tudo roda em uma transacao: se algo falhar, nada e aplicado.

begin;

-- 1. Dados da recusa no pedido.
alter table public.orders
  add column if not exists cash_refused_at timestamptz,
  add column if not exists cash_refusal_note text;

alter table public.orders
  drop constraint if exists orders_cash_refusal_note_check;
alter table public.orders
  add constraint orders_cash_refusal_note_check
  check (char_length(coalesce(cash_refusal_note, '')) <= 500);

create index if not exists orders_cash_refused_user_idx
  on public.orders (user_id, cash_refused_at)
  where cash_refused_at is not null;

-- 2. Repasses do entregador a empresa.
create table if not exists public.courier_cash_settlements (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  note text check (char_length(coalesce(note, '')) <= 300),
  settled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists courier_cash_settlements_courier_idx
  on public.courier_cash_settlements (courier_id, created_at desc);

alter table public.courier_cash_settlements enable row level security;

drop policy if exists "Couriers and admins view cash settlements" on public.courier_cash_settlements;
create policy "Couriers and admins view cash settlements"
on public.courier_cash_settlements for select to authenticated
using (
  courier_id = (select auth.uid())
  or (select public.is_admin())
);

revoke all on table public.courier_cash_settlements
  from public, anon, authenticated;
grant select on table public.courier_cash_settlements to authenticated;

-- 3. Saldos. O admin ve todos os entregadores; o entregador ve so o proprio.
--    Recebido = soma dos pedidos em dinheiro que o entregador confirmou.
create or replace function public.courier_cash_balances()
returns table (
  courier_id uuid,
  courier_name text,
  received_cents bigint,
  settled_cents bigint,
  balance_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();

  if not v_is_admin and not public.is_active_courier() then
    raise exception 'COURIER_OR_ADMIN_REQUIRED';
  end if;

  return query
  with received as (
    select o.cash_received_by as cid, sum(o.total_cents)::bigint as total
    from public.orders o
    where o.payment_provider = 'cash'
      and o.cash_received_by is not null
    group by o.cash_received_by
  ),
  settled as (
    select s.courier_id as cid, sum(s.amount_cents)::bigint as total
    from public.courier_cash_settlements s
    group by s.courier_id
  ),
  ids as (
    select r.cid from received r
    union
    select s.cid from settled s
  )
  select
    i.cid,
    coalesce(p.full_name, 'Entregador removido'),
    coalesce(r.total, 0),
    coalesce(s.total, 0),
    coalesce(r.total, 0) - coalesce(s.total, 0)
  from ids i
  left join received r on r.cid = i.cid
  left join settled s on s.cid = i.cid
  left join public.profiles p on p.id = i.cid
  where v_is_admin or i.cid = v_user_id
  order by 5 desc;
end;
$$;

revoke all on function public.courier_cash_balances() from public, anon;
grant execute on function public.courier_cash_balances() to authenticated;

-- 4. Admin registra um repasse (nunca acima do saldo do entregador).
create or replace function public.admin_register_cash_settlement(
  p_courier_id uuid,
  p_amount_cents integer,
  p_note text default null
)
returns table (settlement_id uuid, new_balance_cents bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_balance bigint;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_courier_id and role = 'courier'::public.user_role
  ) then
    raise exception 'COURIER_NOT_FOUND';
  end if;

  -- Evita dois repasses simultaneos passarem do saldo.
  perform pg_advisory_xact_lock(hashtext('cash_settlement:' || p_courier_id::text));

  select
    coalesce((
      select sum(o.total_cents)
      from public.orders o
      where o.payment_provider = 'cash'
        and o.cash_received_by = p_courier_id
    ), 0)
    - coalesce((
      select sum(s.amount_cents)
      from public.courier_cash_settlements s
      where s.courier_id = p_courier_id
    ), 0)
  into v_balance;

  if p_amount_cents > v_balance then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;

  insert into public.courier_cash_settlements (
    courier_id, amount_cents, note, settled_by
  )
  values (p_courier_id, p_amount_cents, v_note, auth.uid())
  returning id into v_id;

  return query select v_id, v_balance - p_amount_cents;
end;
$$;

revoke all on function public.admin_register_cash_settlement(uuid, integer, text)
  from public, anon;
grant execute on function public.admin_register_cash_settlement(uuid, integer, text)
  to authenticated;

-- 5. Entregador: o cliente recusou pagar. O pedido e cancelado.
create or replace function public.courier_report_cash_refusal(
  p_order_id uuid,
  p_note text
)
returns table (order_id uuid, current_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id
      and role = 'courier'::public.user_role
      and is_active = true
  ) then
    raise exception 'ACTIVE_COURIER_REQUIRED';
  end if;

  if char_length(v_note) < 3 then
    raise exception 'NOTE_REQUIRED';
  end if;

  if char_length(v_note) > 500 then
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

  if not (
    v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery'
  ) then
    raise exception 'NOT_CASH_ON_DELIVERY';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    'Cliente recusou pagar em dinheiro: ' || v_note,
    true
  );

  update public.orders
  set
    status = 'cancelled',
    payment_status = 'cancelled',
    payment_updated_at = now(),
    cash_refused_at = now(),
    cash_refusal_note = v_note,
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, 'cancelled'::text;
end;
$$;

revoke all on function public.courier_report_cash_refusal(uuid, text)
  from public, anon;
grant execute on function public.courier_report_cash_refusal(uuid, text)
  to authenticated;

-- 6. Cliente: quem recusou pagar fica 90 dias sem escolher dinheiro.
--    (Recria choose_cash_payment do 017 com a nova verificacao.)
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

  if exists (
    select 1
    from public.orders o
    where o.user_id = v_user_id
      and o.cash_refused_at is not null
      and o.cash_refused_at > now() - interval '90 days'
  ) then
    raise exception 'CASH_BLOCKED_AFTER_REFUSAL';
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

commit;
