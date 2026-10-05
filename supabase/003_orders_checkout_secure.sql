-- SeuChico - Etapa 6
-- Checkout, endereco de entrega e pedidos com calculo de preco no servidor.
-- Regra inicial: R$ 3,00 por ingresso + R$ 15,00 de entrega.

create table if not exists public.pricing_settings (
  id smallint primary key check (id = 1),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into public.pricing_settings (id, unit_price_cents, delivery_fee_cents)
values (1, 300, 1500)
on conflict (id) do update set
  unit_price_cents = excluded.unit_price_cents,
  delivery_fee_cents = excluded.delivery_fee_cents,
  updated_at = now();

alter table public.ticket_drafts
  drop constraint if exists ticket_drafts_status_check;

alter table public.ticket_drafts
  add constraint ticket_drafts_status_check
  check (status in ('draft', 'ordered'));

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  draft_id uuid not null unique references public.ticket_drafts(id) on delete restrict,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 5000),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  subtotal_cents integer generated always as (unit_price_cents * quantity) stored,
  total_cents integer generated always as (
    (unit_price_cents * quantity) + delivery_fee_cents
  ) stored,
  status text not null default 'awaiting_payment' check (
    status in (
      'awaiting_payment',
      'paid',
      'in_production',
      'ready_for_delivery',
      'out_for_delivery',
      'delivered',
      'cancelled'
    )
  ),
  delivery_recipient text not null,
  delivery_phone text not null,
  delivery_zip_code text not null,
  delivery_street text not null,
  delivery_number text not null,
  delivery_complement text,
  delivery_neighborhood text not null,
  delivery_city text not null,
  delivery_state text not null,
  delivery_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create index if not exists orders_status_created_idx
  on public.orders (status, created_at desc);

alter table public.pricing_settings enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Authenticated users can view pricing" on public.pricing_settings;
create policy "Authenticated users can view pricing"
on public.pricing_settings
for select
to authenticated
using (true);

drop policy if exists "Admins can update pricing" on public.pricing_settings;
create policy "Admins can update pricing"
on public.pricing_settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can view own orders" on public.orders;
create policy "Users can view own orders"
on public.orders
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
on public.orders
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete orders" on public.orders;
create policy "Admins can delete orders"
on public.orders
for delete
to authenticated
using (public.is_admin());

drop policy if exists "Users can update own drafts" on public.ticket_drafts;
create policy "Users can update own drafts"
on public.ticket_drafts
for update
to authenticated
using (
  (user_id = auth.uid() and status = 'draft')
  or public.is_admin()
)
with check (
  (user_id = auth.uid() and status = 'draft')
  or public.is_admin()
);

revoke all on public.pricing_settings from anon, authenticated;
revoke all on public.orders from anon, authenticated;

grant select on public.pricing_settings to authenticated;
grant update on public.pricing_settings to authenticated;

grant select on public.orders to authenticated;
grant update, delete on public.orders to authenticated;

drop trigger if exists set_pricing_settings_updated_at on public.pricing_settings;
create trigger set_pricing_settings_updated_at
before update on public.pricing_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.create_order_from_draft(
  p_draft_id uuid,
  p_recipient text,
  p_phone text,
  p_zip_code text,
  p_street text,
  p_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_reference text
)
returns table (order_id uuid, created_order_number bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_draft record;
  v_pricing record;
  v_order record;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select role, is_active
  into v_profile
  from public.profiles
  where id = v_user_id;

  if not found or not v_profile.is_active or v_profile.role <> 'client' then
    raise exception 'CLIENT_ACCOUNT_REQUIRED';
  end if;

  if char_length(btrim(coalesce(p_recipient, ''))) not between 2 and 100 then
    raise exception 'INVALID_RECIPIENT';
  end if;

  if coalesce(p_phone, '') !~ '^[0-9]{10,11}$' then
    raise exception 'INVALID_PHONE';
  end if;

  if coalesce(p_zip_code, '') !~ '^[0-9]{8}$' then
    raise exception 'INVALID_ZIP_CODE';
  end if;

  if char_length(btrim(coalesce(p_street, ''))) not between 2 and 160
    or char_length(btrim(coalesce(p_number, ''))) not between 1 and 20
    or char_length(btrim(coalesce(p_neighborhood, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
    or upper(btrim(coalesce(p_state, ''))) !~ '^[A-Z]{2}$'
  then
    raise exception 'INVALID_ADDRESS';
  end if;

  if char_length(coalesce(p_complement, '')) > 120
    or char_length(coalesce(p_reference, '')) > 200
  then
    raise exception 'ADDRESS_TEXT_TOO_LONG';
  end if;

  select id, quantity, status
  into v_draft
  from public.ticket_drafts
  where id = p_draft_id
    and user_id = v_user_id;

  if not found then
    raise exception 'DRAFT_NOT_FOUND';
  end if;

  select id, order_number
  into v_order
  from public.orders
  where draft_id = p_draft_id
    and user_id = v_user_id;

  if found then
    return query select v_order.id, v_order.order_number;
    return;
  end if;

  if v_draft.status <> 'draft' then
    raise exception 'DRAFT_ALREADY_ORDERED';
  end if;

  select unit_price_cents, delivery_fee_cents
  into v_pricing
  from public.pricing_settings
  where id = 1;

  if not found then
    raise exception 'PRICING_NOT_CONFIGURED';
  end if;

  insert into public.orders (
    user_id,
    draft_id,
    unit_price_cents,
    quantity,
    delivery_fee_cents,
    delivery_recipient,
    delivery_phone,
    delivery_zip_code,
    delivery_street,
    delivery_number,
    delivery_complement,
    delivery_neighborhood,
    delivery_city,
    delivery_state,
    delivery_reference
  )
  values (
    v_user_id,
    v_draft.id,
    v_pricing.unit_price_cents,
    v_draft.quantity,
    v_pricing.delivery_fee_cents,
    btrim(p_recipient),
    p_phone,
    p_zip_code,
    btrim(p_street),
    btrim(p_number),
    nullif(btrim(coalesce(p_complement, '')), ''),
    btrim(p_neighborhood),
    btrim(p_city),
    upper(btrim(p_state)),
    nullif(btrim(coalesce(p_reference, '')), '')
  )
  returning id, order_number into v_order;

  update public.ticket_drafts
  set status = 'ordered', updated_at = now()
  where id = v_draft.id;

  return query select v_order.id, v_order.order_number;
end;
$$;

revoke all on function public.create_order_from_draft(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon;

grant execute on function public.create_order_from_draft(
  uuid, text, text, text, text, text, text, text, text, text, text
) to authenticated;
