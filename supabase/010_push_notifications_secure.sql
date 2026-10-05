-- SeuChico - Etapa 11
-- Registro seguro de aparelhos para notificacoes push.
-- Execute este arquivo no SQL Editor do Supabase.

begin;

create table if not exists public.push_tokens (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  device_name text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_token_check check (
    char_length(expo_push_token) between 20 and 255
    and expo_push_token ~ '^(Expo|Exponent)PushToken\[[^]]+\]$'
  ),
  constraint push_tokens_platform_check check (
    platform in ('android', 'ios')
  ),
  constraint push_tokens_device_name_check check (
    device_name is null or char_length(device_name) <= 120
  )
);

create index if not exists push_tokens_user_active_idx
  on public.push_tokens (user_id, is_active, last_seen_at desc);

alter table public.push_tokens enable row level security;

drop policy if exists "Users can view own push tokens"
  on public.push_tokens;

create policy "Users can view own push tokens"
on public.push_tokens
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.push_tokens
  from public, anon, authenticated;
grant select on table public.push_tokens to authenticated;

create table if not exists public.push_notification_events (
  event_key text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_notification_events_key_check check (
    char_length(event_key) between 6 and 300
  ),
  constraint push_notification_events_type_check check (
    event_type in ('chat_message', 'order_status', 'courier_assigned')
  )
);

create index if not exists push_notification_events_order_idx
  on public.push_notification_events (order_id, created_at desc);

alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events
  from public, anon, authenticated;

create or replace function public.register_push_token(
  p_expo_push_token text,
  p_platform text,
  p_device_name text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text := btrim(coalesce(p_expo_push_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_device_name text := nullif(btrim(coalesce(p_device_name, '')), '');
  v_id bigint;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and is_active = true
  ) then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if char_length(v_token) not between 20 and 255
     or v_token !~ '^(Expo|Exponent)PushToken\[[^]]+\]$' then
    raise exception 'INVALID_EXPO_PUSH_TOKEN';
  end if;

  if v_platform not in ('android', 'ios') then
    raise exception 'INVALID_PUSH_PLATFORM';
  end if;

  if char_length(coalesce(v_device_name, '')) > 120 then
    raise exception 'DEVICE_NAME_TOO_LONG';
  end if;

  insert into public.push_tokens (
    user_id,
    expo_push_token,
    platform,
    device_name,
    is_active,
    last_seen_at,
    updated_at
  )
  values (
    v_user_id,
    v_token,
    v_platform,
    v_device_name,
    true,
    now(),
    now()
  )
  on conflict (expo_push_token) do update
  set
    user_id = excluded.user_id,
    platform = excluded.platform,
    device_name = excluded.device_name,
    is_active = true,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_token(text, text, text)
  from public, anon;
grant execute on function public.register_push_token(text, text, text)
  to authenticated;

create or replace function public.deactivate_my_push_tokens()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    return 0;
  end if;

  update public.push_tokens
  set
    is_active = false,
    updated_at = now()
  where user_id = v_user_id
    and is_active = true;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.deactivate_my_push_tokens()
  from public, anon;
grant execute on function public.deactivate_my_push_tokens()
  to authenticated;

commit;

select 'ETAPA_11_PUSH_NOTIFICATIONS_OK' as resultado;
