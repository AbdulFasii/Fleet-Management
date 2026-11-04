-- Fix: "new row violates row-level security policy" on Storage upload to game-images
-- Run in Supabase Dashboard → SQL Editor → New query → Run

-- Ensure bucket exists and is public for read URLs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'game-images',
  'game-images',
  true,
  52428800, -- 50 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Drop old policies if re-running
drop policy if exists "game_images_public_select" on storage.objects;
drop policy if exists "game_images_anon_insert" on storage.objects;
drop policy if exists "game_images_anon_update" on storage.objects;
drop policy if exists "game_images_anon_delete" on storage.objects;
drop policy if exists "Public read game-images" on storage.objects;
drop policy if exists "Anon upload game-images" on storage.objects;
drop policy if exists "Anon update game-images" on storage.objects;
drop policy if exists "Anon delete game-images" on storage.objects;

-- Public / anon can read
create policy "game_images_public_select"
on storage.objects for select
to public
using (bucket_id = 'game-images');

-- Anon + authenticated can upload
create policy "game_images_anon_insert"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'game-images');

-- Anon + authenticated can overwrite (upsert)
create policy "game_images_anon_update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'game-images')
with check (bucket_id = 'game-images');

-- Anon + authenticated can delete
create policy "game_images_anon_delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'game-images');

-- Optional metadata table (app warns but continues if missing)
create table if not exists public.game_images (
  id uuid primary key,
  kind text not null check (kind in ('branding', 'gallery', 'body_design')),
  owner_key text not null,
  path text not null,
  url text not null,
  mime text,
  bytes bigint,
  width int,
  height int,
  created_at timestamptz default now()
);

alter table public.game_images enable row level security;

drop policy if exists "game_images_table_select" on public.game_images;
drop policy if exists "game_images_table_insert" on public.game_images;
drop policy if exists "game_images_table_update" on public.game_images;
drop policy if exists "game_images_table_delete" on public.game_images;

create policy "game_images_table_select"
on public.game_images for select to public using (true);

create policy "game_images_table_insert"
on public.game_images for insert to anon, authenticated with check (true);

create policy "game_images_table_update"
on public.game_images for update to anon, authenticated using (true) with check (true);

create policy "game_images_table_delete"
on public.game_images for delete to anon, authenticated using (true);
