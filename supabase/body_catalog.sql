-- Run in Supabase Dashboard → SQL Editor → New query → Run
-- Table: public.body_catalog for global shared body designs

create table if not exists public.body_catalog (
  id text primary key default 'global',
  body_builders jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.body_catalog enable row level security;

drop policy if exists "body_catalog_select" on public.body_catalog;
drop policy if exists "body_catalog_insert" on public.body_catalog;
drop policy if exists "body_catalog_update" on public.body_catalog;

create policy "body_catalog_select"
  on public.body_catalog for select
  to public
  using (true);

create policy "body_catalog_insert"
  on public.body_catalog for insert
  to anon, authenticated
  with check (true);

create policy "body_catalog_update"
  on public.body_catalog for update
  to anon, authenticated
  using (true)
  with check (true);
