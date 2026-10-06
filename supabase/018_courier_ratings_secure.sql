-- SeuChico - Etapa 18
-- Avaliacao de entregadores: o cliente avalia de 1 a 5 estrelas, com comentario
-- opcional, uma unica vez por pedido entregue. O admin ve a media por entregador
-- e os comentarios recentes. Execute uma unica vez no SQL Editor do Supabase.

begin;

create table if not exists public.courier_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  courier_id uuid references public.profiles(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(coalesce(comment, '')) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.courier_ratings is
  'Avaliacao do cliente sobre o entregador de um pedido entregue (uma por pedido).';

create index if not exists courier_ratings_courier_created_idx
  on public.courier_ratings (courier_id, created_at desc);

alter table public.courier_ratings enable row level security;

-- Cada cliente ve so as proprias avaliacoes; o admin ve todas. O entregador
-- nao le a tabela. Ninguem escreve direto: so a funcao abaixo grava.
drop policy if exists "Clients and admins view courier ratings" on public.courier_ratings;
create policy "Clients and admins view courier ratings"
on public.courier_ratings for select to authenticated
using (
  client_id = (select auth.uid())
  or (select public.is_admin())
);

revoke all on table public.courier_ratings from public, anon, authenticated;
grant select on table public.courier_ratings to authenticated;

create or replace function public.rate_order_courier(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null
)
returns table (rating_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_rating_id uuid;
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

  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'INVALID_RATING';
  end if;

  if char_length(coalesce(v_comment, '')) > 500 then
    raise exception 'COMMENT_TOO_LONG';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'ORDER_NOT_DELIVERED';
  end if;

  if v_order.assigned_courier_id is null then
    raise exception 'COURIER_REQUIRED';
  end if;

  begin
    insert into public.courier_ratings (
      order_id, client_id, courier_id, rating, comment
    )
    values (
      v_order.id, v_user_id, v_order.assigned_courier_id, p_rating, v_comment
    )
    returning id into v_rating_id;
  exception
    when unique_violation then
      raise exception 'ALREADY_RATED';
  end;

  return query select v_rating_id;
end;
$$;

revoke all on function public.rate_order_courier(uuid, integer, text)
  from public, anon;
grant execute on function public.rate_order_courier(uuid, integer, text)
  to authenticated;

-- Resumo para o admin: media e quantidade por entregador.
create or replace function public.admin_courier_rating_summary()
returns table (
  courier_id uuid,
  courier_name text,
  rating_count bigint,
  rating_average numeric
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
    r.courier_id,
    coalesce(p.full_name, 'Entregador removido'),
    count(*),
    round(avg(r.rating)::numeric, 2)
  from public.courier_ratings r
  left join public.profiles p on p.id = r.courier_id
  group by r.courier_id, p.full_name
  order by round(avg(r.rating)::numeric, 2) desc, count(*) desc;
end;
$$;

revoke all on function public.admin_courier_rating_summary()
  from public, anon;
grant execute on function public.admin_courier_rating_summary()
  to authenticated;

commit;
