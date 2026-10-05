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
