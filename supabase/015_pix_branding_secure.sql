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
