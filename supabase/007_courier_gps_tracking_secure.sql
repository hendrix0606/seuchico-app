-- SeuChico - Etapa 9
-- Rastreamento GPS seguro do entregador e confirmacao de entrega.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

begin;

create table if not exists public.delivery_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (
    accuracy_meters is null or accuracy_meters between 0 and 10000
  ),
  heading_degrees double precision check (
    heading_degrees is null or heading_degrees between 0 and 360
  ),
  speed_mps double precision check (
    speed_mps is null or speed_mps between 0 and 120
  ),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.delivery_locations is
  'Ultima localizacao autorizada do entregador. Visivel somente para as pessoas vinculadas ao pedido.';

create index if not exists delivery_locations_courier_updated_idx
  on public.delivery_locations (courier_id, updated_at desc);

alter table public.delivery_locations enable row level security;
alter table public.delivery_locations replica identity full;

drop policy if exists "Authorized users can view delivery location"
  on public.delivery_locations;

create policy "Authorized users can view delivery location"
on public.delivery_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where public.orders.id = delivery_locations.order_id
  )
);

-- Ninguem altera coordenadas diretamente. O envio passa pela funcao segura.
revoke all on table public.delivery_locations
  from public, anon, authenticated;
grant select on table public.delivery_locations to authenticated;

create or replace function public.courier_update_delivery_location(
  p_order_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_heading_degrees double precision default null,
  p_speed_mps double precision default null,
  p_recorded_at timestamptz default now()
)
returns table (
  order_id uuid,
  recorded_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_saved public.delivery_locations%rowtype;
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

  if v_order.status <> 'out_for_delivery' then
    raise exception 'ORDER_NOT_OUT_FOR_DELIVERY';
  end if;

  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or (p_accuracy_meters is not null and p_accuracy_meters not between 0 and 10000)
    or (p_heading_degrees is not null and p_heading_degrees not between 0 and 360)
    or (p_speed_mps is not null and p_speed_mps not between 0 and 120)
  then
    raise exception 'INVALID_LOCATION';
  end if;

  if p_recorded_at is null
    or p_recorded_at < now() - interval '24 hours'
    or p_recorded_at > now() + interval '5 minutes'
  then
    raise exception 'INVALID_LOCATION_TIME';
  end if;

  insert into public.delivery_locations (
    order_id,
    courier_id,
    latitude,
    longitude,
    accuracy_meters,
    heading_degrees,
    speed_mps,
    recorded_at,
    updated_at
  )
  values (
    v_order.id,
    v_user_id,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_heading_degrees,
    p_speed_mps,
    p_recorded_at,
    now()
  )
  on conflict on constraint delivery_locations_pkey do update set
    courier_id = excluded.courier_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters,
    heading_degrees = excluded.heading_degrees,
    speed_mps = excluded.speed_mps,
    recorded_at = excluded.recorded_at,
    updated_at = now()
  returning * into v_saved;

  return query
  select v_saved.order_id, v_saved.recorded_at, v_saved.updated_at;
end;
$$;

revoke all on function public.courier_update_delivery_location(
  uuid, double precision, double precision, double precision,
  double precision, double precision, timestamptz
) from public, anon;

grant execute on function public.courier_update_delivery_location(
  uuid, double precision, double precision, double precision,
  double precision, double precision, timestamptz
) to authenticated;

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

  if v_order.payment_status <> 'paid' then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      'Entrega confirmada pelo entregador.'
    ),
    true
  );

  update public.orders
  set
    status = 'delivered',
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

create or replace function public.clear_finished_delivery_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('delivered', 'cancelled') then
    delete from public.delivery_locations
    where delivery_locations.order_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.clear_finished_delivery_location()
  from public, anon, authenticated;

drop trigger if exists orders_clear_finished_delivery_location
  on public.orders;
create trigger orders_clear_finished_delivery_location
after update of status on public.orders
for each row execute function public.clear_finished_delivery_location();

-- Ativa atualizacoes em tempo real sem falhar em uma segunda execucao.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'delivery_locations'
  ) then
    alter publication supabase_realtime
      add table public.delivery_locations;
  end if;
end
$$;

commit;
