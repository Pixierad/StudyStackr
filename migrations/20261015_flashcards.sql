begin;
create table if not exists public.flashcard_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  constraint flashcard_library_shape check (jsonb_typeof(data) = 'object' and jsonb_typeof(data->'sets') = 'array' and jsonb_typeof(data->'folders') = 'array')
);
alter table public.flashcard_libraries enable row level security;
drop policy if exists "Own flashcard library" on public.flashcard_libraries;
create policy "Own flashcard library" on public.flashcard_libraries for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create table if not exists public.public_flashcard_sets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  subject text not null default '',
  cards jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 1 and 500),
  updated_at timestamptz not null default now()
);
create index if not exists public_flashcard_sets_updated on public.public_flashcard_sets(updated_at desc);
alter table public.public_flashcard_sets enable row level security;
drop policy if exists "Read public flashcards" on public.public_flashcard_sets;
create policy "Read public flashcards" on public.public_flashcard_sets for select to authenticated using (true);
drop policy if exists "Manage own public flashcards" on public.public_flashcard_sets;
create policy "Manage own public flashcards" on public.public_flashcard_sets for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.flashcard_libraries, public.public_flashcard_sets from anon;
grant select, insert, update, delete on public.flashcard_libraries, public.public_flashcard_sets to authenticated;
commit;
