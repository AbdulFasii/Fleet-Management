-- Supabase Migration: Game Images Foundation
-- Project ref: gylkbwuhzwtnazjwftgk
-- Bucket: game-images

-- 1. Ensure storage bucket exists and is public
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'game-images',
  'game-images',
  true,
  52428800, -- 50MB max file size
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 52428800;

-- 2. Storage RLS policies for anon access on game-images bucket
-- Drop existing policies if they exist to avoid conflict
drop policy if exists "Public Read game-images" on storage.objects;
drop policy if exists "Anon Insert game-images" on storage.objects;
drop policy if exists "Anon Update game-images" on storage.objects;
drop policy if exists "Anon Delete game-images" on storage.objects;

create policy "Public Read game-images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'game-images');

create policy "Anon Insert game-images"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'game-images');

create policy "Anon Update game-images"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'game-images');

create policy "Anon Delete game-images"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'game-images');

-- 3. Metadata table: game_images
create table if not exists public.game_images (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('branding', 'gallery', 'body_design')),
  owner_key text not null,
  path text not null unique,
  url text not null,
  mime text not null,
  bytes bigint not null,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

-- Indexes for fast query by owner and kind
create index if not exists idx_game_images_owner_kind on public.game_images (owner_key, kind);
create index if not exists idx_game_images_created_at on public.game_images (created_at desc);

-- 4. Table RLS policies
alter table public.game_images enable row level security;

drop policy if exists "Allow select game_images" on public.game_images;
drop policy if exists "Allow insert game_images" on public.game_images;
drop policy if exists "Allow update game_images" on public.game_images;
drop policy if exists "Allow delete game_images" on public.game_images;

create policy "Allow select game_images"
  on public.game_images for select
  to anon, authenticated
  using (true);

create policy "Allow insert game_images"
  on public.game_images for insert
  to anon, authenticated
  with check (true);

create policy "Allow update game_images"
  on public.game_images for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "Allow delete game_images"
  on public.game_images for delete
  to anon, authenticated
  using (true);
