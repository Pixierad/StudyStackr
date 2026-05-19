-- SchoolApp Supabase schema.
--
-- Paste this entire file into the Supabase SQL Editor
-- (Project -> SQL Editor -> New query -> Run).
--
-- Creates three tables (profiles, subjects, tasks), indexes, and
-- row-level-security policies so each signed-in user can only see their
-- own rows. Safe to re-run: every statement uses IF NOT EXISTS / CREATE
-- OR REPLACE where possible.

-- ------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  room text not null default '',
  teacher text not null default '',
  color text,
  primary key (user_id, name)
);

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  description text,
  subject text,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.friend_requests (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id),
  check (status in ('pending', 'accepted', 'declined'))
);

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists subjects_user_id_idx on public.subjects(user_id);
create index if not exists friends_user_id_idx on public.friends(user_id);
create index if not exists friends_friend_id_idx on public.friends(friend_id);
create index if not exists friend_requests_addressee_status_idx
  on public.friend_requests(addressee_id, status, created_at desc);
create index if not exists friend_requests_requester_status_idx
  on public.friend_requests(requester_id, status, created_at desc);

-- Existing one-way friends from earlier app versions become mutual accepted
-- friendships so confirmed chat membership works consistently.
insert into public.friends (user_id, friend_id, created_at)
select f.friend_id, f.user_id, f.created_at
from public.friends f
where not exists (
  select 1
  from public.friends reverse_f
  where reverse_f.user_id = f.friend_id
    and reverse_f.friend_id = f.user_id
);

-- The application treats subject names as case-insensitive when checking
-- for duplicates ("Math" vs "math" should not both exist for the same
-- user). The (user_id, name) primary key alone is case-sensitive, so we
-- enforce the case-insensitive uniqueness with a functional index.
create unique index if not exists subjects_user_id_name_ci_uniq
  on public.subjects(user_id, lower(name));

-- ------------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.tasks    enable row level security;
alter table public.friends  enable row level security;
alter table public.friend_requests enable row level security;

-- Drop existing policies (so this file is idempotent).
drop policy if exists "profiles_select_own"   on public.profiles;
drop policy if exists "profiles_insert_own"   on public.profiles;
drop policy if exists "profiles_update_own"   on public.profiles;

drop policy if exists "subjects_select_own"   on public.subjects;
drop policy if exists "subjects_insert_own"   on public.subjects;
drop policy if exists "subjects_update_own"   on public.subjects;
drop policy if exists "subjects_delete_own"   on public.subjects;

drop policy if exists "tasks_select_own"      on public.tasks;
drop policy if exists "tasks_insert_own"      on public.tasks;
drop policy if exists "tasks_update_own"      on public.tasks;
drop policy if exists "tasks_delete_own"      on public.tasks;

drop policy if exists "friends_select_own"    on public.friends;
drop policy if exists "friends_insert_own"    on public.friends;
drop policy if exists "friends_delete_own"    on public.friends;

drop policy if exists "friend_requests_select_participant" on public.friend_requests;
drop policy if exists "friend_requests_insert_requester"   on public.friend_requests;
drop policy if exists "friend_requests_update_addressee"   on public.friend_requests;
drop policy if exists "friend_requests_delete_participant" on public.friend_requests;

-- Profiles: each user can read/write only their own profile row.
create policy "profiles_select_own"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Subjects.
create policy "subjects_select_own"
  on public.subjects for select using (auth.uid() = user_id);
create policy "subjects_insert_own"
  on public.subjects for insert with check (auth.uid() = user_id);
create policy "subjects_update_own"
  on public.subjects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subjects_delete_own"
  on public.subjects for delete using (auth.uid() = user_id);

-- Tasks.
create policy "tasks_select_own"
  on public.tasks for select using (auth.uid() = user_id);
create policy "tasks_insert_own"
  on public.tasks for insert with check (auth.uid() = user_id);
create policy "tasks_update_own"
  on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own"
  on public.tasks for delete using (auth.uid() = user_id);

-- Friends can be read directly, but mutations go through the RPC helpers
-- below so requests cannot bypass confirmation or create one-sided rows.
create policy "friends_select_own"
  on public.friends for select using (auth.uid() = user_id);

-- Friend requests are visible only to the requester and recipient. Mutations
-- go through RPC helpers so recipients cannot tamper with request ownership.
create policy "friend_requests_select_participant"
  on public.friend_requests for select using (
    auth.uid() = requester_id or auth.uid() = addressee_id
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'friend_requests'
    ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- (Without this, the first name save would insert a fresh row;
-- this just pre-populates an empty one so the UI is never empty.)
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- Theme columns on profiles (added after initial schema).
-- ------------------------------------------------------------------

alter table public.profiles
  add column if not exists theme_key text not null default 'light',
  add column if not exists custom_themes jsonb not null default '[]'::jsonb,
  add column if not exists username text,
  add column if not exists avatar_type text not null default 'emoji',
  add column if not exists avatar_value text not null default '🎓';

create unique index if not exists profiles_username_ci_uniq
  on public.profiles(lower(username))
  where username is not null and username <> '';

-- ------------------------------------------------------------------
-- Trigger: auto-create profile row on new sign-up.
-- ------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, '')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- Friend/profile helper functions.
-- These return only public profile fields so the app can search by name
-- or username without opening the whole profiles table through RLS.
-- ------------------------------------------------------------------

drop function if exists public.search_profiles(text);

create function public.search_profiles(search_term text)
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  is_friend boolean,
  incoming_request boolean,
  outgoing_request boolean
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.username,
    p.avatar_type,
    p.avatar_value,
    exists (
      select 1
      from public.friends f
      where f.user_id = auth.uid()
        and f.friend_id = p.id
    ) as is_friend,
    exists (
      select 1
      from public.friend_requests fr
      where fr.requester_id = p.id
        and fr.addressee_id = auth.uid()
        and fr.status = 'pending'
    ) as incoming_request,
    exists (
      select 1
      from public.friend_requests fr
      where fr.requester_id = auth.uid()
        and fr.addressee_id = p.id
        and fr.status = 'pending'
    ) as outgoing_request
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and length(trim(search_term)) >= 2
    and (
      p.name ilike '%' || trim(search_term) || '%'
      or p.username ilike '%' || trim(search_term) || '%'
    )
  order by
    case
      when lower(coalesce(p.username, '')) = lower(trim(search_term)) then 0
      when coalesce(p.username, '') ilike trim(search_term) || '%' then 1
      when p.name ilike trim(search_term) || '%' then 2
      else 3
    end,
    p.name
  limit 20;
$$;

create or replace function public.list_friends()
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  friended_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.username,
    p.avatar_type,
    p.avatar_value,
    f.created_at as friended_at
  from public.friends f
  join public.profiles p on p.id = f.friend_id
  where auth.uid() is not null
    and f.user_id = auth.uid()
  order by f.created_at desc;
$$;

create or replace function public.list_friend_requests()
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  requester_id uuid,
  addressee_id uuid,
  direction text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.username,
    p.avatar_type,
    p.avatar_value,
    fr.requester_id,
    fr.addressee_id,
    case
      when fr.addressee_id = auth.uid() then 'incoming'
      else 'outgoing'
    end as direction,
    fr.created_at
  from public.friend_requests fr
  join public.profiles p
    on p.id = case
      when fr.addressee_id = auth.uid() then fr.requester_id
      else fr.addressee_id
    end
  where auth.uid() is not null
    and fr.status = 'pending'
    and (fr.requester_id = auth.uid() or fr.addressee_id = auth.uid())
  order by fr.created_at desc;
$$;

create or replace function public.add_friend(friend_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_existing boolean := false;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send friend requests.';
  end if;

  if friend_profile_id = auth.uid() then
    raise exception 'You cannot request yourself as a friend.';
  end if;

  if not exists (select 1 from public.profiles p where p.id = friend_profile_id) then
    raise exception 'That profile does not exist.';
  end if;

  if exists (
    select 1
    from public.friends f
    where f.user_id = auth.uid()
      and f.friend_id = friend_profile_id
  ) then
    return;
  end if;

  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where requester_id = friend_profile_id
    and addressee_id = auth.uid()
    and status = 'pending'
  returning true into accepted_existing;

  if accepted_existing then
    insert into public.friends (user_id, friend_id)
    values
      (auth.uid(), friend_profile_id),
      (friend_profile_id, auth.uid())
    on conflict (user_id, friend_id) do nothing;
    return;
  end if;

  insert into public.friend_requests (requester_id, addressee_id, status, created_at, responded_at)
  values (auth.uid(), friend_profile_id, 'pending', now(), null)
  on conflict (requester_id, addressee_id)
  do update set
    status = 'pending',
    created_at = now(),
    responded_at = null
  where public.friend_requests.status <> 'pending';
end;
$$;

create or replace function public.accept_friend_request(requester_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_request boolean := false;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept friend requests.';
  end if;

  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where requester_id = requester_profile_id
    and addressee_id = auth.uid()
    and status = 'pending'
  returning true into found_request;

  if not found_request then
    raise exception 'Friend request is no longer available.';
  end if;

  insert into public.friends (user_id, friend_id)
  values
    (auth.uid(), requester_profile_id),
    (requester_profile_id, auth.uid())
  on conflict (user_id, friend_id) do nothing;
end;
$$;

create or replace function public.decline_friend_request(requester_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to decline friend requests.';
  end if;

  update public.friend_requests
  set status = 'declined', responded_at = now()
  where requester_id = requester_profile_id
    and addressee_id = auth.uid()
    and status = 'pending';
end;
$$;

create or replace function public.remove_friend(friend_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  delete from public.friends
  where (user_id = auth.uid() and friend_id = friend_profile_id)
     or (user_id = friend_profile_id and friend_id = auth.uid());

  delete from public.friend_requests
  where status = 'pending'
    and (
      (requester_id = auth.uid() and addressee_id = friend_profile_id)
      or (requester_id = friend_profile_id and addressee_id = auth.uid())
    );
end;
$$;

-- ------------------------------------------------------------------
-- Temporary friend chat rooms.
-- Rooms are temporary, membership-gated, and can only be created with
-- people already in the creator's friends list. "Deleting" a chat hides
-- it for the signed-in user instead of deleting everyone else's history.
-- ------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  is_pinned boolean not null default false,
  hidden_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete cascade,
  body text not null,
  message_type text not null default 'message',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (length(trim(body)) > 0),
  check (message_type in ('message', 'system')),
  check (length(body) <= 2000)
);

alter table public.chat_messages
  alter column sender_id drop not null;

alter table public.chat_messages
  add column if not exists message_type text not null default 'message';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_message_type_check'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_message_type_check
      check (message_type in ('message', 'system'));
  end if;
end;
$$;

create index if not exists chat_rooms_expires_at_idx on public.chat_rooms(expires_at);
create index if not exists chat_room_members_user_id_idx on public.chat_room_members(user_id);
create index if not exists chat_room_members_room_id_idx on public.chat_room_members(room_id);
create index if not exists chat_messages_room_id_created_at_idx
  on public.chat_messages(room_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_messages'
    ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_rooms_select_member" on public.chat_rooms;
drop policy if exists "chat_room_members_select_member" on public.chat_room_members;
drop policy if exists "chat_room_members_update_self" on public.chat_room_members;
drop policy if exists "chat_messages_select_member" on public.chat_messages;
drop policy if exists "chat_messages_insert_member" on public.chat_messages;

create policy "chat_rooms_select_member"
  on public.chat_rooms for select using (
    exists (
      select 1
      from public.chat_room_members m
      where m.room_id = chat_rooms.id
        and m.user_id = auth.uid()
        and m.hidden_at is null
    )
  );

create policy "chat_room_members_select_member"
  on public.chat_room_members for select using (user_id = auth.uid());

create policy "chat_room_members_update_self"
  on public.chat_room_members for update using (
    user_id = auth.uid()
  ) with check (
    user_id = auth.uid()
  );

create policy "chat_messages_select_member"
  on public.chat_messages for select using (
    deleted_at is null
    and exists (
      select 1
      from public.chat_room_members m
      join public.chat_rooms r on r.id = m.room_id
      where m.room_id = chat_messages.room_id
        and m.user_id = auth.uid()
        and m.hidden_at is null
        and r.expires_at > now()
    )
  );

create policy "chat_messages_insert_member"
  on public.chat_messages for insert with check (
    sender_id = auth.uid()
    and message_type = 'message'
    and length(trim(body)) > 0
    and exists (
      select 1
      from public.chat_room_members m
      join public.chat_rooms r on r.id = m.room_id
      where m.room_id = chat_messages.room_id
        and m.user_id = auth.uid()
        and m.hidden_at is null
        and r.expires_at > now()
    )
  );

create or replace function public.chat_member_profiles(room_profile_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'username', p.username,
        'avatar_type', p.avatar_type,
        'avatar_value', p.avatar_value,
        'is_friend', exists (
          select 1
          from public.friends f
          where f.user_id = auth.uid()
            and f.friend_id = p.id
        ),
        'incoming_request', exists (
          select 1
          from public.friend_requests fr
          where fr.requester_id = p.id
            and fr.addressee_id = auth.uid()
            and fr.status = 'pending'
        ),
        'outgoing_request', exists (
          select 1
          from public.friend_requests fr
          where fr.requester_id = auth.uid()
            and fr.addressee_id = p.id
            and fr.status = 'pending'
        )
      )
      order by case when p.id = auth.uid() then 0 else 1 end, p.name
    ),
    '[]'::jsonb
  )
  from public.chat_room_members m
  join public.profiles p on p.id = m.user_id
  where m.room_id = room_profile_id
    and m.hidden_at is null
    and exists (
      select 1
      from public.chat_room_members self
      where self.room_id = room_profile_id
        and self.user_id = auth.uid()
        and self.hidden_at is null
    );
$$;

create or replace function public.create_chat_room(
  room_name text,
  friend_ids uuid[],
  lifetime_hours integer default 24
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_friend_ids uuid[];
  new_room_id uuid;
  requested_count integer;
  friend_count integer;
  ttl_hours integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a chat.';
  end if;

  select array(
    select distinct x
    from unnest(coalesce(friend_ids, array[]::uuid[])) as x
    where x is not null and x <> auth.uid()
  ) into clean_friend_ids;

  requested_count := coalesce(array_length(clean_friend_ids, 1), 0);
  if requested_count = 0 then
    raise exception 'Choose at least one friend for the chat.';
  end if;

  select count(*) into friend_count
  from public.friends f
  where f.user_id = auth.uid()
    and f.friend_id = any(clean_friend_ids);

  if friend_count <> requested_count then
    raise exception 'Chats can only include people in your friends list.';
  end if;

  ttl_hours := least(greatest(coalesce(lifetime_hours, 24), 1), 168);

  insert into public.chat_rooms (name, created_by, expires_at)
  values (left(trim(coalesce(room_name, '')), 80), auth.uid(), now() + make_interval(hours => ttl_hours))
  returning id into new_room_id;

  insert into public.chat_room_members (room_id, user_id, last_read_at)
  values (new_room_id, auth.uid(), now());

  insert into public.chat_room_members (room_id, user_id)
  select new_room_id, x
  from unnest(clean_friend_ids) as x;

  return new_room_id;
end;
$$;

create or replace function public.rename_chat_room(room_profile_id uuid, room_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text;
  actor_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to edit a chat.';
  end if;

  clean_name := left(trim(coalesce(room_name, '')), 80);
  select coalesce(nullif(trim(p.name), ''), p.username, 'Someone') into actor_name
  from public.profiles p
  where p.id = auth.uid();

  update public.chat_rooms
  set name = clean_name
  where id = room_profile_id
    and created_by = auth.uid()
    and expires_at > now();

  if not found then
    raise exception 'Only the chat creator can edit this chat.';
  end if;

  insert into public.chat_messages (room_id, sender_id, body, message_type)
  values (
    room_profile_id,
    null,
    actor_name || case
      when clean_name = '' then ' cleared the chat name.'
      else ' changed the chat name to "' || clean_name || '".'
    end,
    'system'
  );
end;
$$;

create or replace function public.add_chat_participants(
  room_profile_id uuid,
  friend_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_friend_ids uuid[];
  requested_count integer;
  friend_count integer;
  actor_name text;
  added_names text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to add people to a chat.';
  end if;

  if not exists (
    select 1
    from public.chat_rooms r
    where r.id = room_profile_id
      and r.created_by = auth.uid()
      and r.expires_at > now()
  ) then
    raise exception 'Only the chat creator can add people.';
  end if;

  select array(
    select distinct x
    from unnest(coalesce(friend_ids, array[]::uuid[])) as x
    where x is not null
      and x <> auth.uid()
      and not exists (
        select 1
        from public.chat_room_members m
        where m.room_id = room_profile_id
          and m.user_id = x
          and m.hidden_at is null
      )
  ) into clean_friend_ids;

  requested_count := coalesce(array_length(clean_friend_ids, 1), 0);
  if requested_count = 0 then
    return;
  end if;

  select count(*) into friend_count
  from public.friends f
  where f.user_id = auth.uid()
    and f.friend_id = any(clean_friend_ids);

  if friend_count <> requested_count then
    raise exception 'Chats can only include people in your friends list.';
  end if;

  insert into public.chat_room_members (room_id, user_id)
  select room_profile_id, x
  from unnest(clean_friend_ids) as x
  on conflict (room_id, user_id)
  do update set hidden_at = null;

  select coalesce(nullif(trim(p.name), ''), p.username, 'Someone') into actor_name
  from public.profiles p
  where p.id = auth.uid();

  select string_agg(coalesce(nullif(trim(p.name), ''), p.username, 'Someone'), ', ' order by p.name)
    into added_names
  from public.profiles p
  where p.id = any(clean_friend_ids);

  insert into public.chat_messages (room_id, sender_id, body, message_type)
  values (
    room_profile_id,
    null,
    actor_name || ' added ' || coalesce(added_names, 'someone') || ' to the chat.',
    'system'
  );
end;
$$;

create or replace function public.cleanup_expired_chat_rooms()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.chat_rooms
  where expires_at <= now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.list_chat_rooms()
returns table (
  id uuid,
  name text,
  created_by uuid,
  created_at timestamptz,
  expires_at timestamptz,
  is_pinned boolean,
  last_read_at timestamptz,
  last_message_body text,
  last_message_at timestamptz,
  unread_count bigint,
  members jsonb
)
language sql
security definer
set search_path = public
as $$
  with cleanup as (
    select public.cleanup_expired_chat_rooms()
  )
  select
    r.id,
    r.name,
    r.created_by,
    r.created_at,
    r.expires_at,
    self.is_pinned,
    self.last_read_at,
    last_msg.body as last_message_body,
    last_msg.created_at as last_message_at,
    (
      select count(*)
      from public.chat_messages unread
      where unread.room_id = r.id
        and unread.sender_id <> auth.uid()
        and unread.deleted_at is null
        and (self.last_read_at is null or unread.created_at > self.last_read_at)
    ) as unread_count,
    public.chat_member_profiles(r.id) as members
  from cleanup, public.chat_room_members self
  join public.chat_rooms r on r.id = self.room_id
  left join lateral (
    select body, created_at
    from public.chat_messages lm
    where lm.room_id = r.id
      and lm.deleted_at is null
    order by lm.created_at desc
    limit 1
  ) last_msg on true
  where auth.uid() is not null
    and self.user_id = auth.uid()
    and self.hidden_at is null
    and r.expires_at > now()
  order by
    self.is_pinned desc,
    coalesce(last_msg.created_at, r.created_at) desc;
$$;

drop function if exists public.list_chat_messages(uuid);

create or replace function public.list_chat_messages(room_profile_id uuid)
returns table (
  id uuid,
  room_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  sender_name text,
  sender_username text,
  sender_avatar_type text,
  sender_avatar_value text,
  message_type text
)
language sql
security definer
set search_path = public
as $$
  with cleanup as (
    select public.cleanup_expired_chat_rooms()
  )
  select
    msg.id,
    msg.room_id,
    msg.sender_id,
    msg.body,
    msg.created_at,
    p.name as sender_name,
    p.username as sender_username,
    p.avatar_type as sender_avatar_type,
    p.avatar_value as sender_avatar_value,
    coalesce(msg.message_type, 'message') as message_type
  from cleanup, public.chat_messages msg
  join public.chat_rooms r on r.id = msg.room_id
  join public.chat_room_members self on self.room_id = msg.room_id
  left join public.profiles p on p.id = msg.sender_id
  where auth.uid() is not null
    and self.user_id = auth.uid()
    and self.hidden_at is null
    and r.expires_at > now()
    and msg.room_id = room_profile_id
    and msg.deleted_at is null
  order by msg.created_at asc
  limit 200;
$$;

create or replace function public.send_chat_message(room_profile_id uuid, message_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send messages.';
  end if;

  if length(trim(coalesce(message_body, ''))) = 0 then
    raise exception 'Message cannot be empty.';
  end if;

  if not exists (
    select 1
    from public.chat_room_members m
    join public.chat_rooms r on r.id = m.room_id
    where m.room_id = room_profile_id
      and m.user_id = auth.uid()
      and m.hidden_at is null
      and r.expires_at > now()
  ) then
    raise exception 'This chat is no longer available.';
  end if;

  insert into public.chat_messages (room_id, sender_id, body)
  values (room_profile_id, auth.uid(), left(trim(message_body), 2000))
  returning id into new_message_id;

  update public.chat_room_members
  set last_read_at = now(), hidden_at = null
  where room_id = room_profile_id
    and user_id = auth.uid();

  return new_message_id;
end;
$$;

create or replace function public.mark_chat_read(room_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_room_members
  set last_read_at = now()
  where auth.uid() is not null
    and room_id = room_profile_id
    and user_id = auth.uid()
    and hidden_at is null;
$$;

create or replace function public.set_chat_pinned(room_profile_id uuid, pinned boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_room_members
  set is_pinned = coalesce(pinned, false)
  where auth.uid() is not null
    and room_id = room_profile_id
    and user_id = auth.uid()
    and hidden_at is null;
$$;

create or replace function public.hide_chat_room(room_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  was_visible boolean;
begin
  select exists (
    select 1
    from public.chat_room_members m
    join public.chat_rooms r on r.id = m.room_id
    where m.room_id = room_profile_id
      and m.user_id = auth.uid()
      and m.hidden_at is null
      and r.expires_at > now()
  ) into was_visible;

  update public.chat_room_members
  set hidden_at = now(), is_pinned = false
  where auth.uid() is not null
    and room_id = room_profile_id
    and user_id = auth.uid();

  if was_visible then
    select coalesce(nullif(trim(p.name), ''), p.username, 'Someone') into actor_name
    from public.profiles p
    where p.id = auth.uid();

    insert into public.chat_messages (room_id, sender_id, body, message_type)
    values (
      room_profile_id,
      null,
      actor_name || ' left the chat.',
      'system'
    );
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- Security hardening for exposed RPC functions.
--
-- Supabase exposes functions in the public schema through /rest/v1/rpc.
-- The app needs these RPCs to be callable by signed-in users, but the
-- privileged SECURITY DEFINER bodies should not be directly exposed from
-- that public API schema. This block moves the privileged implementations
-- into a private schema, then recreates public SECURITY INVOKER wrappers
-- with the same names/signatures used by the app.
-- ------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
alter function public.handle_new_user() set search_path = public;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'alter function public.rls_auto_enable() set search_path = public';
  end if;
end;
$$;

drop function if exists private.search_profiles(text);
alter function public.search_profiles(text) set schema private;
create function public.search_profiles(search_term text)
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  is_friend boolean,
  incoming_request boolean,
  outgoing_request boolean
)
language sql
security invoker
set search_path = public, private
as $$
  select *
  from private.search_profiles(search_term);
$$;

drop function if exists private.list_friends();
alter function public.list_friends() set schema private;
create function public.list_friends()
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  friended_at timestamptz
)
language sql
security invoker
set search_path = public, private
as $$
  select *
  from private.list_friends();
$$;

drop function if exists private.list_friend_requests();
alter function public.list_friend_requests() set schema private;
create function public.list_friend_requests()
returns table (
  id uuid,
  name text,
  username text,
  avatar_type text,
  avatar_value text,
  requester_id uuid,
  addressee_id uuid,
  direction text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public, private
as $$
  select *
  from private.list_friend_requests();
$$;

drop function if exists private.add_friend(uuid);
alter function public.add_friend(uuid) set schema private;
create function public.add_friend(friend_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.add_friend(friend_profile_id);
$$;

drop function if exists private.accept_friend_request(uuid);
alter function public.accept_friend_request(uuid) set schema private;
create function public.accept_friend_request(requester_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.accept_friend_request(requester_profile_id);
$$;

drop function if exists private.decline_friend_request(uuid);
alter function public.decline_friend_request(uuid) set schema private;
create function public.decline_friend_request(requester_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.decline_friend_request(requester_profile_id);
$$;

drop function if exists private.remove_friend(uuid);
alter function public.remove_friend(uuid) set schema private;
create function public.remove_friend(friend_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.remove_friend(friend_profile_id);
$$;

drop function if exists private.chat_member_profiles(uuid);
alter function public.chat_member_profiles(uuid) set schema private;
create function public.chat_member_profiles(room_profile_id uuid)
returns jsonb
language sql
security invoker
set search_path = public, private
as $$
  select private.chat_member_profiles(room_profile_id);
$$;

drop function if exists private.create_chat_room(text, uuid[], integer);
alter function public.create_chat_room(text, uuid[], integer) set schema private;
create function public.create_chat_room(
  room_name text,
  friend_ids uuid[],
  lifetime_hours integer default 24
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.create_chat_room(room_name, friend_ids, lifetime_hours);
$$;

drop function if exists private.rename_chat_room(uuid, text);
alter function public.rename_chat_room(uuid, text) set schema private;
create function public.rename_chat_room(room_profile_id uuid, room_name text)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.rename_chat_room(room_profile_id, room_name);
$$;

drop function if exists private.add_chat_participants(uuid, uuid[]);
alter function public.add_chat_participants(uuid, uuid[]) set schema private;
create function public.add_chat_participants(room_profile_id uuid, friend_ids uuid[])
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.add_chat_participants(room_profile_id, friend_ids);
$$;

drop function if exists private.cleanup_expired_chat_rooms();
alter function public.cleanup_expired_chat_rooms() set schema private;
create function public.cleanup_expired_chat_rooms()
returns bigint
language sql
security invoker
set search_path = public, private
as $$
  select private.cleanup_expired_chat_rooms();
$$;

drop function if exists private.list_chat_rooms();
alter function public.list_chat_rooms() set schema private;
create function public.list_chat_rooms()
returns table (
  id uuid,
  name text,
  created_by uuid,
  created_at timestamptz,
  expires_at timestamptz,
  is_pinned boolean,
  last_read_at timestamptz,
  last_message_body text,
  last_message_at timestamptz,
  unread_count bigint,
  members jsonb
)
language sql
security invoker
set search_path = public, private
as $$
  select *
  from private.list_chat_rooms();
$$;

drop function if exists private.list_chat_messages(uuid);
alter function public.list_chat_messages(uuid) set schema private;
create function public.list_chat_messages(room_profile_id uuid)
returns table (
  id uuid,
  room_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  sender_name text,
  sender_username text,
  sender_avatar_type text,
  sender_avatar_value text,
  message_type text
)
language sql
security invoker
set search_path = public, private
as $$
  select *
  from private.list_chat_messages(room_profile_id);
$$;

drop function if exists private.send_chat_message(uuid, text);
alter function public.send_chat_message(uuid, text) set schema private;
create function public.send_chat_message(room_profile_id uuid, message_body text)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.send_chat_message(room_profile_id, message_body);
$$;

drop function if exists private.mark_chat_read(uuid);
alter function public.mark_chat_read(uuid) set schema private;
create function public.mark_chat_read(room_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.mark_chat_read(room_profile_id);
$$;

drop function if exists private.set_chat_pinned(uuid, boolean);
alter function public.set_chat_pinned(uuid, boolean) set schema private;
create function public.set_chat_pinned(room_profile_id uuid, pinned boolean)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.set_chat_pinned(room_profile_id, pinned);
$$;

drop function if exists private.hide_chat_room(uuid);
alter function public.hide_chat_room(uuid) set schema private;
create function public.hide_chat_room(room_profile_id uuid)
returns void
language sql
security invoker
set search_path = public, private
as $$
  select private.hide_chat_room(room_profile_id);
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function public.search_profiles(text) from public, anon;
revoke execute on function public.list_friends() from public, anon;
revoke execute on function public.list_friend_requests() from public, anon;
revoke execute on function public.add_friend(uuid) from public, anon;
revoke execute on function public.accept_friend_request(uuid) from public, anon;
revoke execute on function public.decline_friend_request(uuid) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.chat_member_profiles(uuid) from public, anon;
revoke execute on function public.create_chat_room(text, uuid[], integer) from public, anon;
revoke execute on function public.rename_chat_room(uuid, text) from public, anon;
revoke execute on function public.add_chat_participants(uuid, uuid[]) from public, anon;
revoke execute on function public.cleanup_expired_chat_rooms() from public, anon;
revoke execute on function public.list_chat_rooms() from public, anon;
revoke execute on function public.list_chat_messages(uuid) from public, anon;
revoke execute on function public.send_chat_message(uuid, text) from public, anon;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
revoke execute on function public.set_chat_pinned(uuid, boolean) from public, anon;
revoke execute on function public.hide_chat_room(uuid) from public, anon;

grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.list_friend_requests() to authenticated;
grant execute on function public.add_friend(uuid) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.chat_member_profiles(uuid) to authenticated;
grant execute on function public.create_chat_room(text, uuid[], integer) to authenticated;
grant execute on function public.rename_chat_room(uuid, text) to authenticated;
grant execute on function public.add_chat_participants(uuid, uuid[]) to authenticated;
grant execute on function public.cleanup_expired_chat_rooms() to authenticated;
grant execute on function public.list_chat_rooms() to authenticated;
grant execute on function public.list_chat_messages(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.set_chat_pinned(uuid, boolean) to authenticated;
grant execute on function public.hide_chat_room(uuid) to authenticated;
