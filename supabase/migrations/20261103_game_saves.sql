-- Migration: Multi-slot cloud game saves
-- Table: public.game_saves

create table if not exists public.game_saves (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  company_name text,
  day int not null default 0,
  difficulty text,
  base jsonb not null,
  base_day int not null default 0,
  deltas jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_game_saves_updated_at on public.game_saves (updated_at desc);

alter table public.game_saves enable row level security;

-- Policies for public / anon access (single player game pattern)
drop policy if exists "game_saves_select" on public.game_saves;
drop policy if exists "game_saves_insert" on public.game_saves;
drop policy if exists "game_saves_update" on public.game_saves;
drop policy if exists "game_saves_delete" on public.game_saves;

create policy "game_saves_select"
  on public.game_saves for select
  to public
  using (true);

create policy "game_saves_insert"
  on public.game_saves for insert
  to anon, authenticated
  with check (true);

create policy "game_saves_update"
  on public.game_saves for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "game_saves_delete"
  on public.game_saves for delete
  to anon, authenticated
  using (true);
