-- SeuChico - Etapa 20
-- Liberacao do bloqueio de dinheiro: o admin pode liberar, antes dos 90 dias,
-- um cliente que recusou pagar em dinheiro (etapa 19).
--
-- O registro da recusa (orders.cash_refused_at / cash_refusal_note) NAO e
-- alterado: a liberacao fica em uma tabela propria, preservando o historico.
-- Um cliente esta bloqueado quando sua recusa mais recente tem menos de 90 dias
-- E e posterior a ultima liberacao.
--
-- Execute uma unica vez no SQL Editor do Supabase, depois do 019.
-- Tudo roda em uma transacao: se algo falhar, nada e aplicado.

begin;

create table if not exists public.cash_block_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  released_by uuid references public.profiles(id) on delete set null,
  note text check (char_length(coalesce(note, '')) <= 300),
  released_at timestamptz not null default now()
);

create index if not exists cash_block_releases_client_idx
  on public.cash_block_releases (client_id, released_at desc);

alter table public.cash_block_releases enable row level security;

drop policy if exists "Admins view cash block releases" on public.cash_block_releases;
create policy "Admins view cash block releases"
on public.cash_block_releases for select to authenticated
using ((select public.is_admin()));

revoke all on table public.cash_block_releases from public, anon, authenticated;
grant select on table public.cash_block_releases to authenticated;

-- Clientes atualmente bloqueados (somente admin).
create or replace function public.admin_cash_blocked_clients()
returns table (
  client_id uuid,
  client_name text,
  client_phone text,
  refused_at timestamptz,
  refusal_note text,
  blocked_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.phone,
    r.refused_at,
    r.note,
    r.refused_at + interval '90 days'
  from public.profiles p
  join lateral (
    select o.cash_refused_at as refused_at, o.cash_refusal_note as note
    from public.orders o
    where o.user_id = p.id
      and o.cash_refused_at is not null
    order by o.cash_refused_at desc
    limit 1
  ) r on true
  where r.refused_at > now() - interval '90 days'
    and r.refused_at > coalesce(
      (select max(b.released_at) from public.cash_block_releases b where b.client_id = p.id),
      '-infinity'::timestamptz
    )
  order by r.refused_at desc;
end;
$$;

revoke all on function public.admin_cash_blocked_clients() from public, anon;
grant execute on function public.admin_cash_blocked_clients() to authenticated;

-- Libera o cliente (registra quem liberou e quando).
create or replace function public.admin_release_cash_block(
  p_client_id uuid,
  p_note text default null
)
returns table (released_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_released_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_client_id and role = 'client'::public.user_role
  ) then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  insert into public.cash_block_releases (client_id, released_by, note)
  values (p_client_id, auth.uid(), v_note)
  returning cash_block_releases.released_at into v_released_at;

  return query select v_released_at;
end;
$$;

revoke all on function public.admin_release_cash_block(uuid, text)
  from public, anon;
grant execute on function public.admin_release_cash_block(uuid, text)
  to authenticated;

-- choose_cash_payment passa a respeitar as liberacoes.
-- (Recria a funcao da etapa 19 com a verificacao atualizada.)
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
      and o.cash_refused_at > coalesce(
        (select max(b.released_at) from public.cash_block_releases b where b.client_id = v_user_id),
        '-infinity'::timestamptz
      )
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
