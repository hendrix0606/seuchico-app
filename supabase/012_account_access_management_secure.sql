-- SeuChico - Etapa 12
-- Gestão segura de contas e troca obrigatória da senha temporária.

begin;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Quando verdadeiro, o usuário precisa trocar a senha temporária antes de acessar sua área.';

create or replace function public.complete_temporary_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.profiles
  set must_change_password = false,
      updated_at = now()
  where id = (select auth.uid())
    and is_active = true;

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;
end;
$$;

revoke all on function public.complete_temporary_password_change() from public;
grant execute on function public.complete_temporary_password_change() to authenticated;

commit;
