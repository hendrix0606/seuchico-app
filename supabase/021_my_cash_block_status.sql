-- SeuChico - Etapa 21
-- Permite ao proprio cliente saber ate quando esta bloqueado de pagar em
-- dinheiro (recusa anterior), para o app esconder o botao em vez de so
-- barrar no servidor. Devolve NULL quando nao ha bloqueio.
-- Mesma regra de choose_cash_payment: recusa nos ultimos 90 dias e posterior
-- a ultima liberacao feita pelo administrador.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

create or replace function public.my_cash_block_until()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select max(o.cash_refused_at) + interval '90 days'
  from public.orders o
  where o.user_id = (select auth.uid())
    and o.cash_refused_at is not null
    and o.cash_refused_at > now() - interval '90 days'
    and o.cash_refused_at > coalesce(
      (select max(b.released_at)
       from public.cash_block_releases b
       where b.client_id = (select auth.uid())),
      '-infinity'::timestamptz
    );
$$;

revoke all on function public.my_cash_block_until() from public, anon;
grant execute on function public.my_cash_block_until() to authenticated;

select 'ETAPA_21_STATUS_BLOQUEIO_DINHEIRO_OK' as resultado;
