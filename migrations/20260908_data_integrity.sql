-- Run in the Supabase SQL Editor as the project database owner.
-- Atomic and repeatable. Restores missing profiles without deleting accounts
-- or overwriting existing profiles. Unexpected invalid data aborts the migration.
begin;

-- Serialize repairs with writes to auth/users and application tables.
lock table auth.users, public.profiles, public.subjects, public.tasks,
  public.study_sessions, public.friends, public.friend_requests,
  public.chat_rooms, public.chat_room_members, public.chat_messages,
  public.chat_message_receipts in share row exclusive mode;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, created_at)
  values (new.id, '', new.created_at)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, name, created_at)
select u.id, '', u.created_at from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Account deletion must start in Auth. It still cascades normally because the
-- auth row is already gone when its profile's DELETE trigger runs.
create or replace function public.protect_profile_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    if exists (select 1 from auth.users) then
      raise exception 'Cannot truncate profiles while auth users exist.' using errcode = '23503';
    end if;
    return null;
  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'Profile IDs cannot be changed.' using errcode = '23514';
    end if;
    return new;
  elsif exists (select 1 from auth.users where id = old.id) then
    raise exception 'Delete the account through Auth, not its profile.' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke execute on function public.protect_profile_identity() from public, anon, authenticated;
drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity before delete or update of id on public.profiles
  for each row execute function public.protect_profile_identity();
drop trigger if exists profiles_protect_truncate on public.profiles;
create trigger profiles_protect_truncate before truncate on public.profiles
  for each statement execute function public.protect_profile_identity();

-- Every user reference must resolve to a profile as well as an auth user.
-- Deferred checks let Auth's existing cascades finish in any trigger order.
do $$
declare r record; constraint_name text;
begin
  for r in select * from (values
    ('subjects', 'user_id'), ('tasks', 'user_id'), ('study_sessions', 'user_id'),
    ('friends', 'user_id'), ('friends', 'friend_id'),
    ('friend_requests', 'requester_id'), ('friend_requests', 'addressee_id'),
    ('chat_rooms', 'created_by'), ('chat_room_members', 'user_id'),
    ('chat_messages', 'sender_id'), ('chat_message_receipts', 'user_id')
  ) as refs(table_name, column_name)
  loop
    constraint_name := r.table_name || '_' || r.column_name || '_profile_fkey';
    if not exists (select 1 from pg_constraint
      where conrelid = format('public.%I', r.table_name)::regclass and conname = constraint_name) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) deferrable initially deferred',
        r.table_name, constraint_name, r.column_name);
    end if;
  end loop;
end;
$$;

-- A friendship is mutual. Repair legacy one-way rows as the setup already did.
insert into public.friends (user_id, friend_id, created_at)
select friend_id, user_id, created_at from public.friends
on conflict (user_id, friend_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.friends'::regclass and conname = 'friends_mutual_fkey') then
    alter table public.friends add constraint friends_mutual_fkey
      foreign key (friend_id, user_id) references public.friends(user_id, friend_id)
      deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_rooms'::regclass and conname = 'chat_rooms_creator_member_fkey') then
    alter table public.chat_rooms add constraint chat_rooms_creator_member_fkey
      foreign key (id, created_by) references public.chat_room_members(room_id, user_id)
      deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_messages'::regclass and conname = 'chat_messages_sender_member_fkey') then
    alter table public.chat_messages add constraint chat_messages_sender_member_fkey
      foreign key (room_id, sender_id) references public.chat_room_members(room_id, user_id)
      deferrable initially deferred;
  end if;
end;
$$;

-- Carry the message's room onto receipts so foreign keys can enforce that the
-- receipt recipient belongs to that same room. Existing RPC callers omit it;
-- the trigger derives it instead of trusting a supplied room ID.
alter table public.chat_message_receipts add column if not exists room_id uuid;
update public.chat_message_receipts r set room_id = m.room_id
from public.chat_messages m where m.id = r.message_id and r.room_id is distinct from m.room_id;
alter table public.chat_message_receipts alter column room_id set not null;

create or replace function public.set_receipt_room()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select room_id into new.room_id from public.chat_messages where id = new.message_id;
  if not found then
    raise exception 'Receipt message does not exist.' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.set_receipt_room() from public, anon, authenticated;
drop trigger if exists chat_receipts_set_room on public.chat_message_receipts;
create trigger chat_receipts_set_room before insert or update on public.chat_message_receipts
  for each row execute function public.set_receipt_room();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_messages'::regclass and conname = 'chat_messages_id_room_key') then
    alter table public.chat_messages add constraint chat_messages_id_room_key unique (id, room_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_message_receipts'::regclass and conname = 'chat_receipts_message_room_fkey') then
    alter table public.chat_message_receipts add constraint chat_receipts_message_room_fkey
      foreign key (message_id, room_id) references public.chat_messages(id, room_id)
      on delete cascade deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_message_receipts'::regclass and conname = 'chat_receipts_member_fkey') then
    alter table public.chat_message_receipts add constraint chat_receipts_member_fkey
      foreign key (room_id, user_id) references public.chat_room_members(room_id, user_id)
      on delete cascade deferrable initially deferred;
  end if;
end;
$$;

-- Validate existing records too; do not silently discard inconsistent history.
do $$
declare r record;
begin
  for r in select * from (values
    ('study_sessions', 'study_sessions_time_order_check', 'ended_at >= started_at'),
    ('friend_requests', 'friend_requests_response_check', '(status = ''pending'') = (responded_at is null)'),
    ('chat_rooms', 'chat_rooms_expiry_check', 'expires_at > created_at'),
    ('chat_messages', 'chat_messages_sender_check', 'message_type = ''system'' or sender_id is not null'),
    ('chat_messages', 'chat_messages_body_length_check', 'length(body) <= 2000')
  ) as checks(table_name, constraint_name, expression)
  loop
    if not exists (select 1 from pg_constraint
      where conrelid = format('public.%I', r.table_name)::regclass and conname = r.constraint_name) then
      execute format('alter table public.%I add constraint %I check (%s)', r.table_name, r.constraint_name, r.expression);
    end if;
  end loop;
end;
$$;

commit;
