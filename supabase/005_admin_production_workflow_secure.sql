-- SeuChico - Etapa 8
-- Painel administrativo, producao, atribuicao de entregador e historico seguro.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

begin;

alter table public.orders
  add column if not exists assigned_courier_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists production_notes text;

alter table public.orders
  drop constraint if exists orders_production_notes_length_check;

alter table public.orders
  add constraint orders_production_notes_length_check
  check (production_notes is null or char_length(production_notes) <= 1000);

create index if not exists orders_assigned_courier_status_idx
  on public.orders (assigned_courier_id, status, created_at desc)
  where assigned_courier_id is not null;

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_status_history_from_status_check check (
    from_status is null or from_status in (
      'awaiting_payment', 'paid', 'in_production', 'ready_for_delivery',
      'out_for_delivery', 'delivered', 'cancelled'
    )
  ),
  constraint order_status_history_to_status_check check (
    to_status in (
      'awaiting_payment', 'paid', 'in_production', 'ready_for_delivery',
      'out_for_delivery', 'delivered', 'cancelled'
    )
  ),
  constraint order_status_history_note_length_check check (
    note is null or char_length(note) <= 1000
  )
);

create index if not exists order_status_history_order_created_idx
  on public.order_status_history (order_id, created_at desc);

alter table public.order_status_history enable row level security;

create or replace function public.is_active_courier()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'courier'::public.user_role
      and is_active = true
  );
$$;

revoke all on function public.is_active_courier() from public, anon;
grant execute on function public.is_active_courier() to authenticated;

drop policy if exists "Users can view own orders" on public.orders;
drop policy if exists "Users admins and couriers can view orders" on public.orders;

create policy "Users admins and couriers can view orders"
on public.orders
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (
    assigned_courier_id = (select auth.uid())
    and (select public.is_active_courier())
  )
);

drop policy if exists "Users can view permitted order history"
  on public.order_status_history;

create policy "Users can view permitted order history"
on public.order_status_history
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where public.orders.id = order_status_history.order_id
  )
);

revoke all on table public.order_status_history from public, anon, authenticated;
grant select on table public.order_status_history to authenticated;

-- O aplicativo administrativo altera pedidos somente pelas funcoes seguras abaixo.
revoke update, delete on table public.orders from authenticated;
grant select on table public.orders to authenticated;

drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Admins can delete orders" on public.orders;

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history (
      order_id,
      from_status,
      to_status,
      changed_by,
      note
    )
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      nullif(
        btrim(coalesce(current_setting('seuchico.status_note', true), '')),
        ''
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_order_status_change() from public, anon, authenticated;

drop trigger if exists orders_log_status_change on public.orders;
create trigger orders_log_status_change
after update of status on public.orders
for each row execute function public.log_order_status_change();

create or replace function public.admin_assign_order_courier(
  p_order_id uuid,
  p_courier_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  assigned_courier_id uuid,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_courier public.profiles%rowtype;
  v_assigned_at timestamptz;
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

  if v_order.status not in (
    'paid', 'in_production', 'ready_for_delivery', 'out_for_delivery'
  ) then
    raise exception 'ORDER_CANNOT_ASSIGN_COURIER';
  end if;

  select * into v_courier
  from public.profiles
  where id = p_courier_id
    and role = 'courier'::public.user_role
    and is_active = true;

  if not found then
    raise exception 'ACTIVE_COURIER_REQUIRED';
  end if;

  v_assigned_at := now();

  update public.orders
  set
    assigned_courier_id = v_courier.id,
    assigned_at = v_assigned_at,
    production_notes = coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      production_notes
    ),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, v_courier.id, v_assigned_at;
end;
$$;

revoke all on function public.admin_assign_order_courier(uuid, uuid, text)
  from public, anon;
grant execute on function public.admin_assign_order_courier(uuid, uuid, text)
  to authenticated;

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

  if v_order.payment_status <> 'paid' then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if not (
    (v_order.status = 'paid' and p_next_status = 'in_production')
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

-- Registra o estado atual dos pedidos existentes sem duplicar em reexecucoes.
insert into public.order_status_history (
  order_id,
  from_status,
  to_status,
  changed_by,
  note
)
select
  orders.id,
  null,
  orders.status,
  null,
  'Estado inicial importado na Etapa 8.'
from public.orders
where not exists (
  select 1
  from public.order_status_history
  where order_status_history.order_id = orders.id
);

commit;
