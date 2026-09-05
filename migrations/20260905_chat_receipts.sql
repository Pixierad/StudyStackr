-- Run once in the Supabase SQL editor for existing installations.
-- Delivery means fetched by the recipient's active chat; read means viewed
-- at the bottom of that chat. First acknowledgement times are immutable.
create table if not exists public.chat_message_receipts (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id),
  check (read_at is null or read_at >= delivered_at)
);
alter table public.chat_message_receipts enable row level security;
revoke all on public.chat_message_receipts from anon, authenticated;

create or replace function private.sync_chat_receipts(
  room_profile_id uuid, delivered_ids uuid[], read_ids uuid[]
)
returns table(message_id uuid, user_id uuid, delivered_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.chat_room_members m
    join public.chat_rooms r on r.id = m.room_id
    where m.room_id = room_profile_id and m.user_id = auth.uid()
      and m.hidden_at is null and r.expires_at > now()
  ) then
    raise exception 'This chat is no longer available.';
  end if;

  insert into public.chat_message_receipts as existing (message_id, user_id, delivered_at, read_at)
  select msg.id, auth.uid(), now(),
    case when msg.id = any(coalesce(read_ids, '{}'::uuid[])) then now() end
  from public.chat_messages msg
  join public.chat_room_members self on self.room_id = msg.room_id and self.user_id = auth.uid()
  where msg.room_id = room_profile_id
    and msg.id = any(coalesce(delivered_ids, '{}'::uuid[]))
    and msg.sender_id <> auth.uid() and msg.message_type = 'message'
    and msg.deleted_at is null and msg.created_at >= self.joined_at
  on conflict on constraint chat_message_receipts_pkey do update
    set read_at = coalesce(existing.read_at, excluded.read_at)
    where existing.read_at is null and excluded.read_at is not null;

  return query
  select msg.id, member.user_id, receipt.delivered_at, receipt.read_at
  from public.chat_messages msg
  join public.chat_room_members member on member.room_id = msg.room_id
    and member.user_id <> msg.sender_id and member.joined_at <= msg.created_at
  left join public.chat_message_receipts receipt
    on receipt.message_id = msg.id and receipt.user_id = member.user_id
  where msg.room_id = room_profile_id and msg.deleted_at is null
    and msg.message_type = 'message'
    and msg.id = any(coalesce(delivered_ids, '{}'::uuid[]));
end;
$$;

create or replace function public.sync_chat_receipts(
  room_profile_id uuid, delivered_ids uuid[], read_ids uuid[]
)
returns table(message_id uuid, user_id uuid, delivered_at timestamptz, read_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from private.sync_chat_receipts(room_profile_id, delivered_ids, read_ids);
$$;
revoke execute on function private.sync_chat_receipts(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.sync_chat_receipts(uuid, uuid[], uuid[]) from public, anon;
grant execute on function private.sync_chat_receipts(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.sync_chat_receipts(uuid, uuid[], uuid[]) to authenticated;
