-- SeuChico - Correcao da Etapa 9.3
-- Remove a ambiguidade do campo order_id no envio seguro do GPS.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

begin;

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

select pg_notify('pgrst', 'reload schema');

commit;
