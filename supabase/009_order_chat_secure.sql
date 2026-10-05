-- SeuChico - Etapa 10
-- Chat em tempo real entre o cliente e o entregador atribuido ao pedido.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

begin;

create table if not exists public.order_messages (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_role public.user_role not null,
  sender_name text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_messages_sender_name_check check (
    char_length(sender_name) between 2 and 120
  ),
  constraint order_messages_body_check check (
    char_length(body) between 1 and 1000
  )
);

comment on table public.order_messages is
  'Mensagens do pedido visiveis somente ao cliente, ao entregador atribuido e ao administrador.';

create index if not exists order_messages_order_created_idx
  on public.order_messages (order_id, created_at, id);

create index if not exists order_messages_unread_idx
  on public.order_messages (order_id, read_at)
  where read_at is null;

alter table public.order_messages enable row level security;
alter table public.order_messages replica identity full;

drop policy if exists "Participants can view order messages"
  on public.order_messages;

create policy "Participants can view order messages"
on public.order_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where public.orders.id = order_messages.order_id
      and (
        (
          public.orders.user_id = (select auth.uid())
          and exists (
            select 1
            from public.profiles
            where public.profiles.id = (select auth.uid())
              and public.profiles.role = 'client'::public.user_role
              and public.profiles.is_active = true
          )
        )
        or (
          public.orders.assigned_courier_id = (select auth.uid())
          and (select public.is_active_courier())
        )
        or (select public.is_admin())
      )
  )
);

-- O aplicativo nao escreve diretamente na tabela. As funcoes abaixo validam
-- o participante, o pedido e o conteudo antes de salvar qualquer mensagem.
revoke all on table public.order_messages
  from public, anon, authenticated;
grant select on table public.order_messages to authenticated;

create or replace function public.send_order_message(
  p_order_id uuid,
  p_body text
)
returns table (
  message_id bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.order_messages%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
    and is_active = true;

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'MESSAGE_REQUIRED';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.assigned_courier_id is null then
    raise exception 'COURIER_REQUIRED';
  end if;

  if not (
    (
      v_profile.role = 'client'::public.user_role
      and v_order.user_id = v_user_id
    )
    or (
      v_profile.role = 'courier'::public.user_role
      and v_order.assigned_courier_id = v_user_id
    )
  ) then
    raise exception 'CHAT_PARTICIPANT_REQUIRED';
  end if;

  if v_order.status not in ('ready_for_delivery', 'out_for_delivery') then
    raise exception 'CHAT_READ_ONLY';
  end if;

  insert into public.order_messages (
    order_id,
    sender_id,
    sender_role,
    sender_name,
    body
  )
  values (
    v_order.id,
    v_user_id,
    v_profile.role,
    v_profile.full_name,
    v_body
  )
  returning * into v_message;

  return query select v_message.id, v_message.created_at;
end;
$$;

revoke all on function public.send_order_message(uuid, text)
  from public, anon;
grant execute on function public.send_order_message(uuid, text)
  to authenticated;

create or replace function public.mark_order_messages_read(
  p_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
    and is_active = true;

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not (
    (
      v_profile.role = 'client'::public.user_role
      and v_order.user_id = v_user_id
    )
    or (
      v_profile.role = 'courier'::public.user_role
      and v_order.assigned_courier_id = v_user_id
    )
  ) then
    raise exception 'CHAT_PARTICIPANT_REQUIRED';
  end if;

  update public.order_messages
  set read_at = now()
  where order_id = v_order.id
    and sender_id is distinct from v_user_id
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_order_messages_read(uuid)
  from public, anon;
grant execute on function public.mark_order_messages_read(uuid)
  to authenticated;

-- Ativa mensagens em tempo real sem falhar se o arquivo for executado de novo.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_messages'
  ) then
    alter publication supabase_realtime
      add table public.order_messages;
  end if;
end
$$;

commit;
