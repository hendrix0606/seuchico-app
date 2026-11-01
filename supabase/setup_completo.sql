-- ===== 001_auth_profiles_secure.sql =====
-- SeuChico - Etapa 3
-- Perfis seguros para cliente, entregador e administrador.
-- Novos cadastros feitos pelo aplicativo sempre recebem o papel "client".

begin;

do $$
begin
  create type public.user_role as enum ('client', 'courier', 'admin');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text check (phone is null or char_length(phone) between 10 and 20),
  role public.user_role not null default 'client',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Dados públicos controlados dos usuários do SeuChico. Senhas permanecem exclusivamente no Supabase Auth.';

alter table public.profiles enable row level security;

create or replace function public.is_admin()
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
      and role = 'admin'::public.user_role
      and is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_admin())
)
with check (
  id = (select auth.uid())
  or (select public.is_admin())
);

-- Usuários comuns só podem consultar perfis permitidos pela RLS e alterar
-- nome, telefone e data de atualização. O papel nunca é alterado pelo app.
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, updated_at) on table public.profiles to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Cliente SeuChico'),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
    'client'::public.user_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Cria perfis para usuários que eventualmente já existiam antes desta etapa.
insert into public.profiles (id, full_name, phone, role)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), 'Cliente SeuChico'),
  nullif(regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
  'client'::public.user_role
from auth.users as users
on conflict (id) do nothing;

commit;


-- ===== 002_catalog_and_ticket_drafts.sql =====
-- SeuChico - Etapa 5
-- Catalogo de modelos e rascunhos de ingressos com RLS.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null check (
    category in ('party', 'wedding', 'show', 'corporate')
  ),
  description text not null,
  primary_color text not null check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.ticket_templates(id),
  event_name text not null check (char_length(event_name) between 2 and 80),
  event_date date not null,
  event_time time not null,
  location text not null check (char_length(location) between 2 and 160),
  primary_color text not null check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  quantity integer not null check (quantity between 1 and 5000),
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'draft' check (status = 'draft'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ticket_templates_active_sort_idx
  on public.ticket_templates (is_active, sort_order);

create index if not exists ticket_drafts_user_updated_idx
  on public.ticket_drafts (user_id, updated_at desc);

alter table public.ticket_templates enable row level security;
alter table public.ticket_drafts enable row level security;

drop policy if exists "Public can view active templates" on public.ticket_templates;
create policy "Public can view active templates"
on public.ticket_templates
for select
to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "Admins can create templates" on public.ticket_templates;
create policy "Admins can create templates"
on public.ticket_templates
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update templates" on public.ticket_templates;
create policy "Admins can update templates"
on public.ticket_templates
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete templates" on public.ticket_templates;
create policy "Admins can delete templates"
on public.ticket_templates
for delete
to authenticated
using (public.is_admin());

drop policy if exists "Users can view own drafts" on public.ticket_drafts;
create policy "Users can view own drafts"
on public.ticket_drafts
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Users can create own drafts" on public.ticket_drafts;
create policy "Users can create own drafts"
on public.ticket_drafts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own drafts" on public.ticket_drafts;
create policy "Users can update own drafts"
on public.ticket_drafts
for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "Users can delete own drafts" on public.ticket_drafts;
create policy "Users can delete own drafts"
on public.ticket_drafts
for delete
to authenticated
using (user_id = auth.uid() or public.is_admin());

revoke all on public.ticket_templates from anon, authenticated;
revoke all on public.ticket_drafts from anon, authenticated;

grant select on public.ticket_templates to anon, authenticated;
grant insert, update, delete on public.ticket_templates to authenticated;

grant select on public.ticket_drafts to authenticated;
grant insert (
  user_id,
  template_id,
  event_name,
  event_date,
  event_time,
  location,
  primary_color,
  accent_color,
  quantity,
  notes
) on public.ticket_drafts to authenticated;
grant update (
  template_id,
  event_name,
  event_date,
  event_time,
  location,
  primary_color,
  accent_color,
  quantity,
  notes,
  updated_at
) on public.ticket_drafts to authenticated;
grant delete on public.ticket_drafts to authenticated;

drop trigger if exists set_ticket_templates_updated_at on public.ticket_templates;
create trigger set_ticket_templates_updated_at
before update on public.ticket_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_ticket_drafts_updated_at on public.ticket_drafts;
create trigger set_ticket_drafts_updated_at
before update on public.ticket_drafts
for each row execute function public.set_updated_at();

insert into public.ticket_templates (
  slug,
  name,
  category,
  description,
  primary_color,
  accent_color,
  sort_order
)
values
  (
    'festa-vibrante',
    'Festa Vibrante',
    'party',
    'Um modelo alegre para aniversários e comemorações.',
    '#12364A',
    '#38D6D2',
    1
  ),
  (
    'casamento-elegante',
    'Casamento Elegante',
    'wedding',
    'Visual delicado para celebrar momentos inesquecíveis.',
    '#503C48',
    '#E7BFA7',
    2
  ),
  (
    'show-noturno',
    'Show Noturno',
    'show',
    'Contraste moderno para shows, festivais e apresentações.',
    '#17152F',
    '#A879FF',
    3
  ),
  (
    'corporativo-minimal',
    'Corporativo Minimal',
    'corporate',
    'Design profissional para encontros e eventos empresariais.',
    '#17324D',
    '#FFB66B',
    4
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  primary_color = excluded.primary_color,
  accent_color = excluded.accent_color,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();


-- ===== 003_orders_checkout_secure.sql =====
-- SeuChico - Etapa 6
-- Checkout, endereco de entrega e pedidos com calculo de preco no servidor.
-- Regra inicial: R$ 3,00 por ingresso + R$ 15,00 de entrega.

create table if not exists public.pricing_settings (
  id smallint primary key check (id = 1),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into public.pricing_settings (id, unit_price_cents, delivery_fee_cents)
values (1, 300, 1500)
on conflict (id) do update set
  unit_price_cents = excluded.unit_price_cents,
  delivery_fee_cents = excluded.delivery_fee_cents,
  updated_at = now();

alter table public.ticket_drafts
  drop constraint if exists ticket_drafts_status_check;

alter table public.ticket_drafts
  add constraint ticket_drafts_status_check
  check (status in ('draft', 'ordered'));

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  draft_id uuid not null unique references public.ticket_drafts(id) on delete restrict,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 5000),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  subtotal_cents integer generated always as (unit_price_cents * quantity) stored,
  total_cents integer generated always as (
    (unit_price_cents * quantity) + delivery_fee_cents
  ) stored,
  status text not null default 'awaiting_payment' check (
    status in (
      'awaiting_payment',
      'paid',
      'in_production',
      'ready_for_delivery',
      'out_for_delivery',
      'delivered',
      'cancelled'
    )
  ),
  delivery_recipient text not null,
  delivery_phone text not null,
  delivery_zip_code text not null,
  delivery_street text not null,
  delivery_number text not null,
  delivery_complement text,
  delivery_neighborhood text not null,
  delivery_city text not null,
  delivery_state text not null,
  delivery_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create index if not exists orders_status_created_idx
  on public.orders (status, created_at desc);

alter table public.pricing_settings enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Authenticated users can view pricing" on public.pricing_settings;
create policy "Authenticated users can view pricing"
on public.pricing_settings
for select
to authenticated
using (true);

drop policy if exists "Admins can update pricing" on public.pricing_settings;
create policy "Admins can update pricing"
on public.pricing_settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can view own orders" on public.orders;
create policy "Users can view own orders"
on public.orders
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
on public.orders
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete orders" on public.orders;
create policy "Admins can delete orders"
on public.orders
for delete
to authenticated
using (public.is_admin());

drop policy if exists "Users can update own drafts" on public.ticket_drafts;
create policy "Users can update own drafts"
on public.ticket_drafts
for update
to authenticated
using (
  (user_id = auth.uid() and status = 'draft')
  or public.is_admin()
)
with check (
  (user_id = auth.uid() and status = 'draft')
  or public.is_admin()
);

revoke all on public.pricing_settings from anon, authenticated;
revoke all on public.orders from anon, authenticated;

grant select on public.pricing_settings to authenticated;
grant update on public.pricing_settings to authenticated;

grant select on public.orders to authenticated;
grant update, delete on public.orders to authenticated;

drop trigger if exists set_pricing_settings_updated_at on public.pricing_settings;
create trigger set_pricing_settings_updated_at
before update on public.pricing_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.create_order_from_draft(
  p_draft_id uuid,
  p_recipient text,
  p_phone text,
  p_zip_code text,
  p_street text,
  p_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_reference text
)
returns table (order_id uuid, created_order_number bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_draft record;
  v_pricing record;
  v_order record;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select role, is_active
  into v_profile
  from public.profiles
  where id = v_user_id;

  if not found or not v_profile.is_active or v_profile.role <> 'client' then
    raise exception 'CLIENT_ACCOUNT_REQUIRED';
  end if;

  if char_length(btrim(coalesce(p_recipient, ''))) not between 2 and 100 then
    raise exception 'INVALID_RECIPIENT';
  end if;

  if coalesce(p_phone, '') !~ '^[0-9]{10,11}$' then
    raise exception 'INVALID_PHONE';
  end if;

  if coalesce(p_zip_code, '') !~ '^[0-9]{8}$' then
    raise exception 'INVALID_ZIP_CODE';
  end if;

  if char_length(btrim(coalesce(p_street, ''))) not between 2 and 160
    or char_length(btrim(coalesce(p_number, ''))) not between 1 and 20
    or char_length(btrim(coalesce(p_neighborhood, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
    or upper(btrim(coalesce(p_state, ''))) !~ '^[A-Z]{2}$'
  then
    raise exception 'INVALID_ADDRESS';
  end if;

  if char_length(coalesce(p_complement, '')) > 120
    or char_length(coalesce(p_reference, '')) > 200
  then
    raise exception 'ADDRESS_TEXT_TOO_LONG';
  end if;

  select id, quantity, status
  into v_draft
  from public.ticket_drafts
  where id = p_draft_id
    and user_id = v_user_id;

  if not found then
    raise exception 'DRAFT_NOT_FOUND';
  end if;

  select id, order_number
  into v_order
  from public.orders
  where draft_id = p_draft_id
    and user_id = v_user_id;

  if found then
    return query select v_order.id, v_order.order_number;
    return;
  end if;

  if v_draft.status <> 'draft' then
    raise exception 'DRAFT_ALREADY_ORDERED';
  end if;

  select unit_price_cents, delivery_fee_cents
  into v_pricing
  from public.pricing_settings
  where id = 1;

  if not found then
    raise exception 'PRICING_NOT_CONFIGURED';
  end if;

  insert into public.orders (
    user_id,
    draft_id,
    unit_price_cents,
    quantity,
    delivery_fee_cents,
    delivery_recipient,
    delivery_phone,
    delivery_zip_code,
    delivery_street,
    delivery_number,
    delivery_complement,
    delivery_neighborhood,
    delivery_city,
    delivery_state,
    delivery_reference
  )
  values (
    v_user_id,
    v_draft.id,
    v_pricing.unit_price_cents,
    v_draft.quantity,
    v_pricing.delivery_fee_cents,
    btrim(p_recipient),
    p_phone,
    p_zip_code,
    btrim(p_street),
    btrim(p_number),
    nullif(btrim(coalesce(p_complement, '')), ''),
    btrim(p_neighborhood),
    btrim(p_city),
    upper(btrim(p_state)),
    nullif(btrim(coalesce(p_reference, '')), '')
  )
  returning id, order_number into v_order;

  update public.ticket_drafts
  set status = 'ordered', updated_at = now()
  where id = v_draft.id;

  return query select v_order.id, v_order.order_number;
end;
$$;

revoke all on function public.create_order_from_draft(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon;

grant execute on function public.create_order_from_draft(
  uuid, text, text, text, text, text, text, text, text, text, text
) to authenticated;


-- ===== 004_stripe_payments_baseline.sql =====
-- SeuChico - Etapa 4 (reconstituida)
-- Base de pagamentos Stripe em orders + eventos de webhook.
--
-- Este arquivo NAO existia no repositorio, embora o banco de producao ja
-- tivesse estas estruturas. Foi reconstituido a partir do banco real (colunas,
-- valores padrao, regras e indices consultados no catalogo do Postgres).
--
-- E IDEMPOTENTE: no banco atual nao altera nada (tudo ja existe) e, em um banco
-- novo, recria o que falta. Execute depois do 003 e antes do 005.
--   * As regras de payment_provider e payment_status descritas aqui sao as do
--     inicio do projeto; os arquivos 015 (PIX) e 017 (dinheiro) as ampliam.
--   * So cria uma regra se ela ainda nao existir, para nunca desfazer uma
--     versao mais nova (por exemplo, a que aceita 'cash' e 'on_delivery').
--   * stripe_webhook_events e usada somente pelas Edge Functions (service role).
--     Fica com RLS ligado e sem acesso para anon/authenticated.

begin;

-- 1. Colunas de pagamento no pedido.
alter table public.orders
  add column if not exists payment_provider text not null default 'stripe',
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_attempt integer not null default 0,
  add column if not exists payment_updated_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

-- 2. Regras (somente se ainda nao existirem).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_check'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_check
      check (payment_provider in ('stripe'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (
        payment_status in (
          'pending', 'creating', 'processing', 'paid', 'failed',
          'cancelled', 'refunded'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_attempt_check'
  ) then
    alter table public.orders
      add constraint orders_payment_attempt_check
      check (payment_attempt >= 0);
  end if;
end
$$;

-- 3. Indices.
create index if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);

create unique index if not exists orders_stripe_checkout_session_uidx
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists orders_stripe_payment_intent_uidx
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- 4. Eventos do webhook do Stripe (evita processar o mesmo evento duas vezes).
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events
  from public, anon, authenticated;

commit;


-- ===== 005_admin_production_workflow_secure.sql =====
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


-- ===== 007_courier_gps_tracking_secure.sql =====
-- SeuChico - Etapa 9
-- Rastreamento GPS seguro do entregador e confirmacao de entrega.
-- Execute este arquivo uma unica vez no SQL Editor do Supabase.

begin;

create table if not exists public.delivery_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (
    accuracy_meters is null or accuracy_meters between 0 and 10000
  ),
  heading_degrees double precision check (
    heading_degrees is null or heading_degrees between 0 and 360
  ),
  speed_mps double precision check (
    speed_mps is null or speed_mps between 0 and 120
  ),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.delivery_locations is
  'Ultima localizacao autorizada do entregador. Visivel somente para as pessoas vinculadas ao pedido.';

create index if not exists delivery_locations_courier_updated_idx
  on public.delivery_locations (courier_id, updated_at desc);

alter table public.delivery_locations enable row level security;
alter table public.delivery_locations replica identity full;

drop policy if exists "Authorized users can view delivery location"
  on public.delivery_locations;

create policy "Authorized users can view delivery location"
on public.delivery_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where public.orders.id = delivery_locations.order_id
  )
);

-- Ninguem altera coordenadas diretamente. O envio passa pela funcao segura.
revoke all on table public.delivery_locations
  from public, anon, authenticated;
grant select on table public.delivery_locations to authenticated;

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

create or replace function public.courier_confirm_delivery(
  p_order_id uuid,
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
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
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

  if v_order.assigned_courier_id is distinct from v_user_id then
    raise exception 'COURIER_NOT_ASSIGNED';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      'Entrega confirmada pelo entregador.'
    ),
    true
  );

  update public.orders
  set
    status = 'delivered',
    production_notes = coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      production_notes
    ),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, v_order.status, 'delivered'::text;
end;
$$;

revoke all on function public.courier_confirm_delivery(uuid, text)
  from public, anon;
grant execute on function public.courier_confirm_delivery(uuid, text)
  to authenticated;

create or replace function public.clear_finished_delivery_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('delivered', 'cancelled') then
    delete from public.delivery_locations
    where delivery_locations.order_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.clear_finished_delivery_location()
  from public, anon, authenticated;

drop trigger if exists orders_clear_finished_delivery_location
  on public.orders;
create trigger orders_clear_finished_delivery_location
after update of status on public.orders
for each row execute function public.clear_finished_delivery_location();

-- Ativa atualizacoes em tempo real sem falhar em uma segunda execucao.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'delivery_locations'
  ) then
    alter publication supabase_realtime
      add table public.delivery_locations;
  end if;
end
$$;

commit;


-- ===== 008_fix_courier_location_rpc.sql =====
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


-- ===== 009_order_chat_secure.sql =====
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


-- ===== 010_push_notifications_secure.sql =====
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


-- ===== 011_fix_push_chat_event_key.sql =====
-- SeuChico - Correcao da Etapa 11
-- Permite chaves iniciais do chat, como chat:1.

begin;

alter table public.push_notification_events
  drop constraint if exists push_notification_events_key_check;

alter table public.push_notification_events
  add constraint push_notification_events_key_check
  check (char_length(event_key) between 6 and 300);

commit;

select 'ETAPA_11_CHAT_PUSH_CORRIGIDO' as resultado;


-- ===== 012_account_access_management_secure.sql =====
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


-- ===== 013_financial_reports_secure.sql =====
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


-- ===== 014_homologation_security.sql =====
-- SeuChico - Etapa 14
-- Homologação, privacidade e solicitação segura de exclusão de conta.

begin;

create table if not exists public.account_deletion_requests (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_deletion_requests is
  'Solicitações iniciadas pelo próprio titular. A conclusão deve respeitar retenções legais e financeiras.';

create unique index if not exists account_deletion_requests_one_pending_per_user
on public.account_deletion_requests (user_id)
where status = 'pending';

create index if not exists account_deletion_requests_status_requested_idx
on public.account_deletion_requests (status, requested_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "account_deletion_requests_select_own_or_admin" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own_or_admin"
on public.account_deletion_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
);

revoke all on table public.account_deletion_requests from anon;
revoke all on table public.account_deletion_requests from authenticated;
grant select on table public.account_deletion_requests to authenticated;

create or replace function public.request_my_account_deletion()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_id bigint;
begin
  if current_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select id
  into request_id
  from public.account_deletion_requests
  where user_id = current_user_id
    and status = 'pending'
  order by requested_at desc
  limit 1;

  if request_id is not null then
    return request_id;
  end if;

  insert into public.account_deletion_requests (user_id)
  values (current_user_id)
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.cancel_my_account_deletion_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  affected_rows integer;
begin
  if current_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  update public.account_deletion_requests
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where user_id = current_user_id
    and status = 'pending';

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

revoke all on function public.request_my_account_deletion() from public;
revoke all on function public.cancel_my_account_deletion_request() from public;
grant execute on function public.request_my_account_deletion() to authenticated;
grant execute on function public.cancel_my_account_deletion_request() to authenticated;

-- Reforça RLS nas tabelas sensíveis já instaladas nas etapas anteriores.
alter table if exists public.profiles enable row level security;
alter table if exists public.orders enable row level security;
alter table if exists public.order_messages enable row level security;
alter table if exists public.delivery_locations enable row level security;
alter table if exists public.push_tokens enable row level security;
alter table if exists public.financial_settings enable row level security;
alter table if exists public.financial_entries enable row level security;

commit;


-- ===== 015_pix_branding_secure.sql =====
-- SeuChico - Etapa 15
-- PIX manual com comprovante, aprovacao administrativa e identidade visual configuravel.
-- Execute uma unica vez no SQL Editor do Supabase.

begin;

alter table public.orders
  drop constraint if exists orders_payment_provider_check;

alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('stripe', 'pix'));

create table if not exists public.pix_settings (
  id smallint primary key check (id = 1),
  is_enabled boolean not null default false,
  pix_key text,
  pix_key_type text not null default 'random'
    check (pix_key_type in ('random', 'email', 'phone', 'cpf', 'cnpj')),
  recipient_name text,
  recipient_city text,
  pix_copy_paste text,
  instructions text,
  updated_at timestamptz not null default now()
);

insert into public.pix_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.pix_payment_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete restrict,
  proof_path text not null,
  proof_name text not null,
  proof_mime_type text,
  customer_note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pix_payment_submissions_proof_path_length_check
    check (char_length(proof_path) between 3 and 500),
  constraint pix_payment_submissions_proof_name_length_check
    check (char_length(proof_name) between 1 and 200),
  constraint pix_payment_submissions_customer_note_length_check
    check (char_length(coalesce(customer_note, '')) <= 500),
  constraint pix_payment_submissions_admin_note_length_check
    check (char_length(coalesce(admin_note, '')) <= 500)
);

create index if not exists pix_payment_submissions_status_created_idx
on public.pix_payment_submissions (status, created_at desc);

create index if not exists pix_payment_submissions_client_created_idx
on public.pix_payment_submissions (client_id, created_at desc);

create table if not exists public.app_branding_settings (
  id smallint primary key check (id = 1),
  brand_name text not null default 'SeuChico',
  tagline text not null default 'INGRESSOS PERSONALIZADOS',
  primary_color text not null default '#071D2D',
  secondary_color text not null default '#087E83',
  accent_color text not null default '#38D6D2',
  background_color text not null default '#F3F7F8',
  logo_url text,
  hero_image_url text,
  updated_at timestamptz not null default now(),
  constraint app_branding_settings_brand_name_length_check
    check (char_length(brand_name) between 2 and 50),
  constraint app_branding_settings_tagline_length_check
    check (char_length(tagline) between 2 and 80),
  constraint app_branding_settings_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint app_branding_settings_secondary_color_check
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint app_branding_settings_accent_color_check
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint app_branding_settings_background_color_check
    check (background_color ~ '^#[0-9A-Fa-f]{6}$')
);

insert into public.app_branding_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.pix_settings enable row level security;
alter table public.pix_payment_submissions enable row level security;
alter table public.app_branding_settings enable row level security;

drop policy if exists "Authenticated users can view PIX settings" on public.pix_settings;
create policy "Authenticated users can view PIX settings"
on public.pix_settings for select to authenticated
using (true);

drop policy if exists "Admins can update PIX settings" on public.pix_settings;
create policy "Admins can update PIX settings"
on public.pix_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Clients and admins can view PIX submissions" on public.pix_payment_submissions;
create policy "Clients and admins can view PIX submissions"
on public.pix_payment_submissions for select to authenticated
using (
  client_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "Everyone can view branding settings" on public.app_branding_settings;
create policy "Everyone can view branding settings"
on public.app_branding_settings for select to anon, authenticated
using (true);

drop policy if exists "Admins can update branding settings" on public.app_branding_settings;
create policy "Admins can update branding settings"
on public.app_branding_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

revoke all on table public.pix_settings from public, anon, authenticated;
revoke all on table public.pix_payment_submissions from public, anon, authenticated;
revoke all on table public.app_branding_settings from public, anon, authenticated;

grant select on table public.pix_settings to authenticated;
grant update on table public.pix_settings to authenticated;
grant select on table public.pix_payment_submissions to authenticated;
grant select on table public.app_branding_settings to anon, authenticated;
grant update on table public.app_branding_settings to authenticated;

drop trigger if exists set_pix_settings_updated_at on public.pix_settings;
create trigger set_pix_settings_updated_at
before update on public.pix_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_pix_payment_submissions_updated_at on public.pix_payment_submissions;
create trigger set_pix_payment_submissions_updated_at
before update on public.pix_payment_submissions
for each row execute function public.set_updated_at();

drop trigger if exists set_app_branding_settings_updated_at on public.app_branding_settings;
create trigger set_app_branding_settings_updated_at
before update on public.app_branding_settings
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pix-proofs',
  'pix-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clients upload own PIX proofs" on storage.objects;
create policy "Clients upload own PIX proofs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pix-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'client'
      and is_active = true
  )
);

drop policy if exists "Clients and admins view PIX proofs" on storage.objects;
create policy "Clients and admins view PIX proofs"
on storage.objects for select to authenticated
using (
  bucket_id = 'pix-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
  )
);

drop policy if exists "Admins upload brand assets" on storage.objects;
create policy "Admins upload brand assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brand-assets'
  and (select public.is_admin())
);

drop policy if exists "Admins update brand assets" on storage.objects;
create policy "Admins update brand assets"
on storage.objects for update to authenticated
using (bucket_id = 'brand-assets' and (select public.is_admin()))
with check (bucket_id = 'brand-assets' and (select public.is_admin()));

drop policy if exists "Admins delete brand assets" on storage.objects;
create policy "Admins delete brand assets"
on storage.objects for delete to authenticated
using (bucket_id = 'brand-assets' and (select public.is_admin()));

drop policy if exists "Everyone views brand assets" on storage.objects;
create policy "Everyone views brand assets"
on storage.objects for select to anon, authenticated
using (bucket_id = 'brand-assets');

create or replace function public.submit_pix_payment(
  p_order_id uuid,
  p_proof_path text,
  p_proof_name text,
  p_proof_mime_type text default null,
  p_customer_note text default null
)
returns table (submission_id uuid, submission_status text)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_settings public.pix_settings%rowtype;
  v_submission public.pix_payment_submissions%rowtype;
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

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'awaiting_payment' or v_order.payment_status = 'paid' then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT';
  end if;

  if v_order.payment_provider = 'stripe'
    and v_order.payment_status in ('creating', 'processing')
  then
    raise exception 'CARD_PAYMENT_IN_PROGRESS';
  end if;

  select * into v_settings from public.pix_settings where id = 1;
  if not found or not v_settings.is_enabled or nullif(btrim(coalesce(v_settings.pix_key, '')), '') is null then
    raise exception 'PIX_NOT_CONFIGURED';
  end if;

  if p_proof_path is null
    or (storage.foldername(p_proof_path))[1] is distinct from v_user_id::text
  then
    raise exception 'INVALID_PROOF_PATH';
  end if;

  if char_length(btrim(coalesce(p_proof_name, ''))) not between 1 and 200 then
    raise exception 'INVALID_PROOF_NAME';
  end if;

  if char_length(coalesce(p_customer_note, '')) > 500 then
    raise exception 'CUSTOMER_NOTE_TOO_LONG';
  end if;

  insert into public.pix_payment_submissions (
    order_id,
    client_id,
    proof_path,
    proof_name,
    proof_mime_type,
    customer_note,
    status,
    admin_note,
    reviewed_by,
    reviewed_at
  )
  values (
    v_order.id,
    v_user_id,
    p_proof_path,
    btrim(p_proof_name),
    nullif(btrim(coalesce(p_proof_mime_type, '')), ''),
    nullif(btrim(coalesce(p_customer_note, '')), ''),
    'pending',
    null,
    null,
    null
  )
  on conflict (order_id) do update set
    proof_path = excluded.proof_path,
    proof_name = excluded.proof_name,
    proof_mime_type = excluded.proof_mime_type,
    customer_note = excluded.customer_note,
    status = 'pending',
    admin_note = null,
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
  where public.pix_payment_submissions.status <> 'approved'
  returning * into v_submission;

  if not found then
    raise exception 'PIX_ALREADY_APPROVED';
  end if;

  update public.orders
  set
    payment_provider = 'pix',
    payment_status = 'processing',
    payment_updated_at = now(),
    updated_at = now()
  where id = v_order.id;

  return query select v_submission.id, v_submission.status;
end;
$$;

revoke all on function public.submit_pix_payment(uuid, text, text, text, text)
from public, anon;
grant execute on function public.submit_pix_payment(uuid, text, text, text, text)
to authenticated;

create or replace function public.admin_review_pix_payment(
  p_submission_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns table (order_id uuid, payment_status text, order_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.pix_payment_submissions%rowtype;
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if coalesce(p_decision, '') not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  if char_length(coalesce(p_admin_note, '')) > 500 then
    raise exception 'ADMIN_NOTE_TOO_LONG';
  end if;

  select * into v_submission
  from public.pix_payment_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND';
  end if;

  if v_submission.status <> 'pending' then
    raise exception 'SUBMISSION_ALREADY_REVIEWED';
  end if;

  select * into v_order
  from public.orders
  where id = v_submission.order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  update public.pix_payment_submissions
  set
    status = p_decision,
    admin_note = nullif(btrim(coalesce(p_admin_note, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = v_submission.id;

  if p_decision = 'approved' then
    if v_order.status <> 'awaiting_payment' or v_order.payment_status = 'paid' then
      raise exception 'ORDER_NOT_AWAITING_PAYMENT';
    end if;

    perform set_config(
      'seuchico.status_note',
      'Pagamento PIX aprovado pelo administrador.',
      true
    );

    update public.orders
    set
      payment_provider = 'pix',
      payment_status = 'paid',
      status = 'paid',
      paid_at = now(),
      payment_updated_at = now(),
      updated_at = now()
    where id = v_order.id
    returning * into v_order;
  else
    update public.orders
    set
      payment_provider = 'pix',
      payment_status = 'failed',
      payment_updated_at = now(),
      updated_at = now()
    where id = v_order.id
    returning * into v_order;
  end if;

  return query select v_order.id, v_order.payment_status, v_order.status;
end;
$$;

revoke all on function public.admin_review_pix_payment(uuid, text, text)
from public, anon;
grant execute on function public.admin_review_pix_payment(uuid, text, text)
to authenticated;

commit;


-- ===== 016_client_avatars_secure.sql =====
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


-- ===== 017_cash_on_delivery_secure.sql =====
-- SeuChico - Etapa 17
-- Pagamento em dinheiro na entrega.
--   * O admin habilita a opcao e define o valor maximo por pedido.
--   * O cliente escolhe "dinheiro" no pedido e informa, se quiser, o troco.
--   * O admin aceita o pedido (ele vai para producao sem estar pago).
--   * O entregador confirma a entrega e o recebimento: so entao o pedido vira
--     "paid" e entra na receita.
-- Execute uma unica vez no SQL Editor do Supabase.
-- Tudo roda em uma transacao: se algo falhar, nada e aplicado.

begin;

-- 0. Seguranca: este arquivo assume que payment_provider e payment_status sao
--    colunas de texto. Se forem enum, para aqui sem alterar nada.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in ('payment_provider', 'payment_status')
      and data_type not in ('text', 'character varying')
  ) then
    raise exception 'ENUM_COLUMN_DETECTED: payment_provider/payment_status nao sao texto. Envie o resultado ao desenvolvedor antes de continuar.';
  end if;
end
$$;

-- 1. Regras de valores permitidos. Remove somente os checks simples de lista
--    ("payment_status = ANY (...)" e "payment_provider = ANY (...)") e recria
--    com os novos valores. Outras regras do pedido nao sao tocadas.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '^CHECK \(+payment_(status|provider)(::text)? = ANY'
  loop
    execute format('alter table public.orders drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.orders
  drop constraint if exists orders_payment_provider_check;
alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('stripe', 'pix', 'cash'));

alter table public.orders
  drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (
    payment_status in (
      'pending', 'creating', 'processing', 'paid', 'failed',
      'cancelled', 'refunded', 'on_delivery'
    )
  );

-- 2. Dados do dinheiro no pedido.
alter table public.orders
  add column if not exists cash_change_for_cents integer,
  add column if not exists cash_received_at timestamptz,
  add column if not exists cash_received_by uuid
    references public.profiles(id) on delete set null;

comment on column public.orders.cash_change_for_cents is
  'Valor com que o cliente pretende pagar em dinheiro (para calcular o troco).';

alter table public.orders
  drop constraint if exists orders_cash_change_check;
alter table public.orders
  add constraint orders_cash_change_check
  check (
    cash_change_for_cents is null
    or (
      cash_change_for_cents >= total_cents
      and cash_change_for_cents <= 1000000
    )
  );

-- 3. Configuracao do admin (mesmo padrao do PIX).
create table if not exists public.cash_settings (
  id smallint primary key check (id = 1),
  is_enabled boolean not null default false,
  max_order_cents integer not null default 30000
    check (max_order_cents between 100 and 10000000),
  instructions text
    check (char_length(coalesce(instructions, '')) <= 500),
  updated_at timestamptz not null default now()
);

insert into public.cash_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.cash_settings enable row level security;

drop policy if exists "Authenticated users can view cash settings" on public.cash_settings;
create policy "Authenticated users can view cash settings"
on public.cash_settings for select to authenticated
using (true);

drop policy if exists "Admins can update cash settings" on public.cash_settings;
create policy "Admins can update cash settings"
on public.cash_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

revoke all on table public.cash_settings from public, anon, authenticated;
grant select on table public.cash_settings to authenticated;
grant update on table public.cash_settings to authenticated;

drop trigger if exists set_cash_settings_updated_at on public.cash_settings;
create trigger set_cash_settings_updated_at
before update on public.cash_settings
for each row execute function public.set_updated_at();

-- 4. O cliente escolhe pagar em dinheiro na entrega.
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

-- 5. Admin: pedidos em dinheiro podem iniciar a producao sem estar pagos.
--    O admin NAO marca como entregue um pedido em dinheiro a receber: quem
--    confirma entrega e recebimento e o entregador.
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
  v_is_cash_pending boolean;
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

  v_is_cash_pending := v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery';

  if v_order.payment_status <> 'paid' and not v_is_cash_pending then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if not (
    (v_order.status = 'paid' and p_next_status = 'in_production')
    or (
      v_is_cash_pending
      and v_order.status = 'awaiting_payment'
      and p_next_status = 'in_production'
    )
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

  if v_is_cash_pending and p_next_status = 'delivered' then
    raise exception 'CASH_RECEIPT_REQUIRED';
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

-- 6. Entregador: confirmar a entrega de um pedido em dinheiro tambem confirma
--    o recebimento. O pedido passa a "paid" e entra na receita.
create or replace function public.courier_confirm_delivery(
  p_order_id uuid,
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
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_is_cash_pending boolean;
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

  if v_order.assigned_courier_id is distinct from v_user_id then
    raise exception 'COURIER_NOT_ASSIGNED';
  end if;

  v_is_cash_pending := v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery';

  if v_order.payment_status <> 'paid' and not v_is_cash_pending then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      case
        when v_is_cash_pending then 'Entrega confirmada e pagamento em dinheiro recebido pelo entregador.'
        else 'Entrega confirmada pelo entregador.'
      end
    ),
    true
  );

  update public.orders
  set
    status = 'delivered',
    payment_status = case when v_is_cash_pending then 'paid' else payment_status end,
    paid_at = case when v_is_cash_pending then now() else paid_at end,
    payment_updated_at = case when v_is_cash_pending then now() else payment_updated_at end,
    cash_received_at = case when v_is_cash_pending then now() else cash_received_at end,
    cash_received_by = case when v_is_cash_pending then v_user_id else cash_received_by end,
    production_notes = coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      production_notes
    ),
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, v_order.status, 'delivered'::text;
end;
$$;

revoke all on function public.courier_confirm_delivery(uuid, text)
  from public, anon;
grant execute on function public.courier_confirm_delivery(uuid, text)
  to authenticated;

commit;


-- ===== 018_courier_ratings_secure.sql =====
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


-- ===== 019_cash_settlement_and_refusal_secure.sql =====
-- SeuChico - Etapa 19
-- Dinheiro na entrega: acerto de caixa do entregador e recusa de pagamento.
--
--  1. Acerto de caixa: o dinheiro recebido pelo entregador fica como saldo a
--     repassar. O admin registra repasses (parciais ou totais, nunca acima do
--     saldo). O entregador ve apenas o proprio saldo.
--  2. Recusa: se o cliente se recusa a pagar na porta, o entregador registra o
--     motivo e o pedido e cancelado. O cliente fica 90 dias sem poder escolher
--     "dinheiro" (volta sozinho depois disso).
--
-- Execute uma unica vez no SQL Editor do Supabase, depois do 017.
-- Tudo roda em uma transacao: se algo falhar, nada e aplicado.

begin;

-- 1. Dados da recusa no pedido.
alter table public.orders
  add column if not exists cash_refused_at timestamptz,
  add column if not exists cash_refusal_note text;

alter table public.orders
  drop constraint if exists orders_cash_refusal_note_check;
alter table public.orders
  add constraint orders_cash_refusal_note_check
  check (char_length(coalesce(cash_refusal_note, '')) <= 500);

create index if not exists orders_cash_refused_user_idx
  on public.orders (user_id, cash_refused_at)
  where cash_refused_at is not null;

-- 2. Repasses do entregador a empresa.
create table if not exists public.courier_cash_settlements (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  note text check (char_length(coalesce(note, '')) <= 300),
  settled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists courier_cash_settlements_courier_idx
  on public.courier_cash_settlements (courier_id, created_at desc);

alter table public.courier_cash_settlements enable row level security;

drop policy if exists "Couriers and admins view cash settlements" on public.courier_cash_settlements;
create policy "Couriers and admins view cash settlements"
on public.courier_cash_settlements for select to authenticated
using (
  courier_id = (select auth.uid())
  or (select public.is_admin())
);

revoke all on table public.courier_cash_settlements
  from public, anon, authenticated;
grant select on table public.courier_cash_settlements to authenticated;

-- 3. Saldos. O admin ve todos os entregadores; o entregador ve so o proprio.
--    Recebido = soma dos pedidos em dinheiro que o entregador confirmou.
create or replace function public.courier_cash_balances()
returns table (
  courier_id uuid,
  courier_name text,
  received_cents bigint,
  settled_cents bigint,
  balance_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();

  if not v_is_admin and not public.is_active_courier() then
    raise exception 'COURIER_OR_ADMIN_REQUIRED';
  end if;

  return query
  with received as (
    select o.cash_received_by as cid, sum(o.total_cents)::bigint as total
    from public.orders o
    where o.payment_provider = 'cash'
      and o.cash_received_by is not null
    group by o.cash_received_by
  ),
  settled as (
    select s.courier_id as cid, sum(s.amount_cents)::bigint as total
    from public.courier_cash_settlements s
    group by s.courier_id
  ),
  ids as (
    select r.cid from received r
    union
    select s.cid from settled s
  )
  select
    i.cid,
    coalesce(p.full_name, 'Entregador removido'),
    coalesce(r.total, 0),
    coalesce(s.total, 0),
    coalesce(r.total, 0) - coalesce(s.total, 0)
  from ids i
  left join received r on r.cid = i.cid
  left join settled s on s.cid = i.cid
  left join public.profiles p on p.id = i.cid
  where v_is_admin or i.cid = v_user_id
  order by 5 desc;
end;
$$;

revoke all on function public.courier_cash_balances() from public, anon;
grant execute on function public.courier_cash_balances() to authenticated;

-- 4. Admin registra um repasse (nunca acima do saldo do entregador).
create or replace function public.admin_register_cash_settlement(
  p_courier_id uuid,
  p_amount_cents integer,
  p_note text default null
)
returns table (settlement_id uuid, new_balance_cents bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_balance bigint;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_courier_id and role = 'courier'::public.user_role
  ) then
    raise exception 'COURIER_NOT_FOUND';
  end if;

  -- Evita dois repasses simultaneos passarem do saldo.
  perform pg_advisory_xact_lock(hashtext('cash_settlement:' || p_courier_id::text));

  select
    coalesce((
      select sum(o.total_cents)
      from public.orders o
      where o.payment_provider = 'cash'
        and o.cash_received_by = p_courier_id
    ), 0)
    - coalesce((
      select sum(s.amount_cents)
      from public.courier_cash_settlements s
      where s.courier_id = p_courier_id
    ), 0)
  into v_balance;

  if p_amount_cents > v_balance then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;

  insert into public.courier_cash_settlements (
    courier_id, amount_cents, note, settled_by
  )
  values (p_courier_id, p_amount_cents, v_note, auth.uid())
  returning id into v_id;

  return query select v_id, v_balance - p_amount_cents;
end;
$$;

revoke all on function public.admin_register_cash_settlement(uuid, integer, text)
  from public, anon;
grant execute on function public.admin_register_cash_settlement(uuid, integer, text)
  to authenticated;

-- 5. Entregador: o cliente recusou pagar. O pedido e cancelado.
create or replace function public.courier_report_cash_refusal(
  p_order_id uuid,
  p_note text
)
returns table (order_id uuid, current_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id
      and role = 'courier'::public.user_role
      and is_active = true
  ) then
    raise exception 'ACTIVE_COURIER_REQUIRED';
  end if;

  if char_length(v_note) < 3 then
    raise exception 'NOTE_REQUIRED';
  end if;

  if char_length(v_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
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

  if not (
    v_order.payment_provider = 'cash'
    and v_order.payment_status = 'on_delivery'
  ) then
    raise exception 'NOT_CASH_ON_DELIVERY';
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform set_config(
    'seuchico.status_note',
    'Cliente recusou pagar em dinheiro: ' || v_note,
    true
  );

  update public.orders
  set
    status = 'cancelled',
    payment_status = 'cancelled',
    payment_updated_at = now(),
    cash_refused_at = now(),
    cash_refusal_note = v_note,
    updated_at = now()
  where id = v_order.id;

  return query select v_order.id, 'cancelled'::text;
end;
$$;

revoke all on function public.courier_report_cash_refusal(uuid, text)
  from public, anon;
grant execute on function public.courier_report_cash_refusal(uuid, text)
  to authenticated;

-- 6. Cliente: quem recusou pagar fica 90 dias sem escolher dinheiro.
--    (Recria choose_cash_payment do 017 com a nova verificacao.)
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


-- ===== 020_cash_block_release_secure.sql =====
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


