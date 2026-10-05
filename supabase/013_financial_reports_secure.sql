-- SeuChico - Etapa 13
-- Financeiro, custos operacionais, lançamentos e relatórios protegidos.
-- Execute este arquivo uma única vez no SQL Editor do Supabase.

begin;

create table if not exists public.financial_settings (
  id smallint primary key check (id = 1),
  material_cost_per_ticket_cents integer not null default 0
    check (material_cost_per_ticket_cents >= 0),
  printing_cost_per_ticket_cents integer not null default 0
    check (printing_cost_per_ticket_cents >= 0),
  payment_fee_basis_points integer not null default 0
    check (payment_fee_basis_points between 0 and 10000),
  payment_fixed_fee_cents integer not null default 0
    check (payment_fixed_fee_cents >= 0),
  delivery_operational_cost_cents integer not null default 0
    check (delivery_operational_cost_cents >= 0),
  other_cost_per_order_cents integer not null default 0
    check (other_cost_per_order_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into public.financial_settings (id)
values (1)
on conflict (id) do nothing;

comment on table public.financial_settings is
  'Parâmetros administrativos usados para estimar custos e margens dos pedidos.';

create table if not exists public.financial_entries (
  id bigint generated always as identity primary key,
  entry_type text not null check (
    entry_type in ('revenue', 'expense', 'refund')
  ),
  category text not null check (
    category in (
      'ticket_sale', 'material', 'printing', 'delivery', 'payment_fee',
      'marketing', 'software', 'tax', 'refund', 'other'
    )
  ),
  description text not null check (
    char_length(btrim(description)) between 2 and 200
  ),
  amount_cents integer not null check (amount_cents > 0),
  occurred_on date not null default current_date,
  order_id uuid references public.orders(id) on delete set null,
  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_entries
  drop constraint if exists financial_entries_type_category_check;

alter table public.financial_entries
  add constraint financial_entries_type_category_check check (
    (entry_type = 'revenue' and category in ('ticket_sale', 'other'))
    or (
      entry_type = 'expense'
      and category in (
        'material', 'printing', 'delivery', 'payment_fee', 'marketing',
        'software', 'tax', 'other'
      )
    )
    or (entry_type = 'refund' and category = 'refund')
  );

comment on table public.financial_entries is
  'Receitas, despesas e reembolsos adicionais registrados pelo administrador.';

create index if not exists financial_entries_occurred_on_idx
  on public.financial_entries (occurred_on desc, id desc);

create index if not exists financial_entries_order_idx
  on public.financial_entries (order_id)
  where order_id is not null;

alter table public.financial_settings enable row level security;
alter table public.financial_entries enable row level security;

drop policy if exists "Active admins can view financial settings"
  on public.financial_settings;
create policy "Active admins can view financial settings"
on public.financial_settings
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Active admins can update financial settings"
  on public.financial_settings;
create policy "Active admins can update financial settings"
on public.financial_settings
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Active admins can view financial entries"
  on public.financial_entries;
create policy "Active admins can view financial entries"
on public.financial_entries
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Active admins can create financial entries"
  on public.financial_entries;
create policy "Active admins can create financial entries"
on public.financial_entries
for insert
to authenticated
with check (
  (select public.is_admin())
  and created_by = (select auth.uid())
);

drop policy if exists "Active admins can update financial entries"
  on public.financial_entries;
create policy "Active admins can update financial entries"
on public.financial_entries
for update
to authenticated
using ((select public.is_admin()))
with check (
  (select public.is_admin())
  and created_by = (select auth.uid())
);

drop policy if exists "Active admins can delete financial entries"
  on public.financial_entries;
create policy "Active admins can delete financial entries"
on public.financial_entries
for delete
to authenticated
using ((select public.is_admin()));

revoke all on table public.financial_settings from public, anon, authenticated;
revoke all on table public.financial_entries from public, anon, authenticated;

grant select on table public.financial_settings to authenticated;
grant update (
  material_cost_per_ticket_cents,
  printing_cost_per_ticket_cents,
  payment_fee_basis_points,
  payment_fixed_fee_cents,
  delivery_operational_cost_cents,
  other_cost_per_order_cents,
  updated_at
) on table public.financial_settings to authenticated;

grant select, insert, update, delete on table public.financial_entries
  to authenticated;

revoke all on sequence public.financial_entries_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.financial_entries_id_seq
  to authenticated;

drop trigger if exists financial_settings_set_updated_at
  on public.financial_settings;
create trigger financial_settings_set_updated_at
before update on public.financial_settings
for each row execute function public.set_updated_at();

drop trigger if exists financial_entries_set_updated_at
  on public.financial_entries;
create trigger financial_entries_set_updated_at
before update on public.financial_entries
for each row execute function public.set_updated_at();

commit;
