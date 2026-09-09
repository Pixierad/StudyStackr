-- Run after 20260908_data_integrity.sql as the database owner in SQL Editor.
-- Deleting a profile now permanently deletes its Auth account and all records
-- covered by the existing Auth deletion cascades. No accounts are deleted by
-- installing this migration. Existing RLS policies/grants are unchanged.
begin;
lock table auth.users, public.profiles in share row exclusive mode;

create or replace function public.protect_profile_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    if exists (select 1 from auth.users) then
      raise exception 'Cannot truncate profiles while auth users exist. Use DELETE.' using errcode = '23503';
    end if;
    return null;
  end if;
  if new.id is distinct from old.id then
    raise exception 'Profile IDs cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_profile_identity() from public, anon, authenticated;
drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity before update of id on public.profiles
  for each row execute function public.protect_profile_identity();

-- AFTER is essential: the profile is already gone before Auth cascades back
-- to profiles. When deletion starts in Auth, this DELETE finds no row and is
-- a harmless no-op. Failure anywhere rolls back the entire deletion.
create or replace function public.delete_profile_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from auth.users where id = old.id;
  return old;
end;
$$;
revoke execute on function public.delete_profile_auth_user() from public, anon, authenticated;
drop trigger if exists profiles_delete_auth_user on public.profiles;
create trigger profiles_delete_auth_user after delete on public.profiles
  for each row execute function public.delete_profile_auth_user();

commit;
