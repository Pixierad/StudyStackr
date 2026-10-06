-- Timetable settings and lessons belong to the signed-in user.
begin;
create table if not exists public.timetables (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"weekCount":1,"anchorWeek":1,"lessons":[]}'::jsonb,
  constraint timetable_data_object check (jsonb_typeof(data) = 'object')
);
alter table public.timetables enable row level security;
drop policy if exists "Users manage their timetable" on public.timetables;
create policy "Users manage their timetable" on public.timetables
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.timetables from anon;
grant select, insert, update, delete on public.timetables to authenticated;
commit;
