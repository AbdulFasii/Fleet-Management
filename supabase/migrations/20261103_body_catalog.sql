-- Supabase Migration: Global Body Designs Catalog
-- Project ref: gylkbwuhzwtnazjwftgk

-- Create table for global shared body designs tree
create table if not exists public.body_catalog (
  id text primary key default 'global',
  body_builders jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.body_catalog enable row level security;

-- Drop existing policies if re-running
drop policy if exists "body_catalog_select" on public.body_catalog;
drop policy if exists "body_catalog_insert" on public.body_catalog;
drop policy if exists "body_catalog_update" on public.body_catalog;

-- Policies: anon / public access for single-player global catalog
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
