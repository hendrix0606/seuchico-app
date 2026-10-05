-- SeuChico - Etapa 16
-- Foto do cliente: o cliente escolhe a propria foto e ela aparece no perfil e
-- no chat com o entregador. A foto e dado pessoal, entao o bucket e PRIVADO.
-- Execute uma unica vez no SQL Editor do Supabase.

begin;

alter table public.profiles
  add column if not exists avatar_path text;

-- O caminho precisa estar na pasta do proprio usuario: "<id-do-usuario>/arquivo".
alter table public.profiles
  drop constraint if exists profiles_avatar_path_check;

alter table public.profiles
  add constraint profiles_avatar_path_check
  check (
    avatar_path is null
    or (
      char_length(avatar_path) between 3 and 300
      and avatar_path like id::text || '/%'
    )
  );

grant update (avatar_path) on table public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clients upload own avatar" on storage.objects;
create policy "Clients upload own avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'client'
      and is_active = true
  )
);

drop policy if exists "Clients delete own avatar" on storage.objects;
create policy "Clients delete own avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Quem pode ver a foto: o proprio cliente, o administrador e o entregador
-- atribuido a um pedido desse cliente enquanto a entrega esta em andamento.
drop policy if exists "Participants view client avatar" on storage.objects;
create policy "Participants view client avatar"
on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
    or (
      (select public.is_active_courier())
      and exists (
        select 1
        from public.orders
        where public.orders.user_id::text = (storage.foldername(name))[1]
          and public.orders.assigned_courier_id = (select auth.uid())
          and public.orders.status in ('ready_for_delivery', 'out_for_delivery')
      )
    )
  )
);

-- O entregador nao le a tabela profiles. Esta funcao devolve somente o caminho
-- da foto do cliente do pedido, e apenas para quem participa da entrega.
create or replace function public.get_order_client_avatar(p_order_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_path text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  if not (
    v_order.user_id = v_user_id
    or public.is_admin()
    or (
      v_order.assigned_courier_id = v_user_id
      and public.is_active_courier()
      and v_order.status in ('ready_for_delivery', 'out_for_delivery')
    )
  ) then
    raise exception 'CHAT_PARTICIPANT_REQUIRED';
  end if;

  select avatar_path into v_path
  from public.profiles
  where id = v_order.user_id
    and is_active = true;

  return v_path;
end;
$$;

revoke all on function public.get_order_client_avatar(uuid) from public, anon;
grant execute on function public.get_order_client_avatar(uuid) to authenticated;

commit;
