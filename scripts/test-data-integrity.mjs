// Run: node scripts/test-data-integrity.mjs <path-to-pglite-dist-index.js>
// Uses an isolated PostgreSQL WASM database; never connects to Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const setup = readFileSync(new URL('../supabase-setup.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/20260908_data_integrity.sql', import.meta.url), 'utf8');
const marker = '-- Data integrity migration (keep in sync with migrations/20260908_data_integrity.sql).';
assert.equal(setup.split(marker)[1].trim(), migration.trim(), 'setup and migration must match');
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
// PGlite has core gen_random_uuid(); only the unavailable pgcrypto extension
// installation is skipped. All application SQL/functions are executed unchanged.
const baseline = setup.split(marker)[0].replace('create extension if not exists pgcrypto;', '');
await db.exec(baseline);
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const c = '00000000-0000-0000-0000-000000000003';
const room = '00000000-0000-0000-0000-000000000010';
const msg = '00000000-0000-0000-0000-000000000020';
let passed = 0;
async function check(label, sql, expected) {
  assert.deepEqual((await db.query(sql)).rows, expected, label);
  console.log('PASS', label); passed++;
}
async function rejects(label, sql, code) {
  await db.exec('begin');
  let error;
  try { await db.exec(sql); await db.exec('set constraints all immediate'); }
  catch (e) { error = e; }
  finally { await db.exec('rollback'); }
  assert.equal(error?.code, code, `${label}: ${error?.message || 'unexpectedly accepted'}`);
  console.log('PASS', label); passed++;
}
try {
  await db.exec(`insert into auth.users(id) values ('${a}'),('${b}');
    update public.profiles set name='Keep this name' where id='${b}';
    delete from public.profiles where id='${a}';
    insert into public.tasks(id,user_id) values ('legacy-task','${a}');`);
  await db.exec(migration);
  await db.exec(migration);
  await check('repair and repeat preserve existing profile data',
    'select name from public.profiles order by id', [{name:''},{name:'Keep this name'}]);
  await check('repair keeps existing tasks', 'select count(*)::int as n from public.tasks', [{n:1}]);
  await db.exec(`insert into auth.users(id) values ('${c}')`);
  await check('signup creates profile without confirmation',
    `select count(*)::int as n from public.profiles where id='${c}'`, [{n:1}]);
  await rejects('profile deletion blocked', `delete from public.profiles where id='${a}'`, '23503');
  await rejects('profile reassignment blocked', `update public.profiles set id=gen_random_uuid() where id='${a}'`, '23514');
  await rejects('profile truncate blocked', 'truncate public.profiles cascade', '23503');
  await rejects('unknown task owner blocked', "insert into public.tasks(id,user_id) values ('bad',gen_random_uuid())", '23503');
  await rejects('one-way friendship blocked', `insert into public.friends values ('${a}','${b}',now())`, '23503');
  await db.exec(`begin; insert into public.friends(user_id,friend_id) values ('${a}','${b}'),('${b}','${a}'); commit;`);
  await rejects('one-sided friendship removal blocked', `delete from public.friends where user_id='${a}'`, '23503');
  await rejects('invalid study time blocked', `insert into public.study_sessions(id,user_id,started_at,ended_at) values ('bad','${a}',now(),now()-interval '1 hour')`, '23514');
  await rejects('accepted request without response blocked', `insert into public.friend_requests(requester_id,addressee_id,status) values ('${a}','${b}','accepted')`, '23514');
  await rejects('room without creator membership blocked', `insert into public.chat_rooms(id,created_by) values ('${room}','${a}')`, '23503');
  await db.exec(`begin;
    insert into public.chat_rooms(id,created_by) values ('${room}','${a}');
    insert into public.chat_room_members(room_id,user_id) values ('${room}','${a}'),('${room}','${b}');
    insert into public.chat_messages(id,room_id,sender_id,body) values ('${msg}','${room}','${a}','Hello'); commit;`);
  await rejects('nonmember sender blocked', `insert into public.chat_messages(room_id,sender_id,body) values ('${room}','${c}','Invalid')`, '23503');
  await rejects('normal message needs sender', `insert into public.chat_messages(room_id,body) values ('${room}','Invalid')`, '23514');
  await db.exec(`insert into public.chat_messages(room_id,body,message_type) values ('${room}','System event','system')`);
  await rejects('nonmember receipt blocked', `insert into public.chat_message_receipts(message_id,user_id) values ('${msg}','${c}')`, '23503');
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);
    select * from public.sync_chat_receipts('${room}',array['${msg}']::uuid[],array['${msg}']::uuid[]);`);
  await check('existing receipt RPC derives room and records read',
    'select room_id, read_at is not null as read from public.chat_message_receipts', [{room_id:room,read:true}]);
  await db.exec(`select * from public.sync_chat_receipts('${room}',array['${msg}']::uuid[],array['${msg}']::uuid[]);`);
  await check('receipt RPC retry is idempotent', 'select count(*)::int as n from public.chat_message_receipts', [{n:1}]);
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);
    select public.remove_friend('${b}');
    select public.add_friend('${b}');
    select set_config('request.jwt.claim.sub','${b}',false);
    select public.accept_friend_request('${a}');`);
  await check('friend RPCs remain compatible', 'select count(*)::int as n from public.friends', [{n:2}]);
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);
    select public.create_chat_room('RPC room',array['${b}']::uuid[],24);`);
  await check('room RPC creates required memberships', 'select count(*)::int as n from public.chat_rooms', [{n:2}]);
  await db.exec(`delete from auth.users where id='${b}'`);
  await check('member account deletion cascades receipts and friendships',
    'select (select count(*) from public.chat_message_receipts)::int as receipts, (select count(*) from public.friends)::int as friends', [{receipts:0,friends:0}]);
  await db.exec(`delete from auth.users where id='${a}'`);
  await check('creator account deletion cascades rooms messages tasks and profile',
    `select (select count(*) from public.chat_rooms)::int as rooms,
      (select count(*) from public.chat_messages)::int as messages,
      (select count(*) from public.tasks)::int as tasks,
      (select count(*) from public.profiles where id='${a}')::int as profiles`,
    [{rooms:0,messages:0,tasks:0,profiles:0}]);
  await db.exec(setup.replace('create extension if not exists pgcrypto;', ''));
  await check('full setup can be reapplied after migration',
    'select count(*)::int as n from public.profiles', [{n:1}]);
  // Simulate unexpected legacy data and ensure a failed migration does not
  // leave even its earlier profile backfill partially applied.
  await db.exec(`alter table public.study_sessions drop constraint study_sessions_time_order_check;
    insert into public.study_sessions(id,user_id,started_at,ended_at)
      values ('invalid-history','${c}',now(),now()-interval '1 hour');
    alter table auth.users disable trigger on_auth_user_created;
    insert into auth.users(id) values ('${a}');
    alter table auth.users enable trigger on_auth_user_created;`);
  await assert.rejects(db.exec(migration), error => error.code === '23514');
  await db.exec('rollback');
  await check('invalid history rolls back the entire repair',
    `select count(*)::int as n from public.profiles where id='${a}'`, [{n:0}]);
  console.log(`${passed} database checks passed.`);
} finally { await db.close(); }
