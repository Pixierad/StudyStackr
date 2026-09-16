import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/services/storage/index.js', import.meta.url), 'utf8');
const start = source.indexOf('export function subscribeToChatRoom(');
const end = source.indexOf('export function subscribeToFriendRequests(', start);
let receive, status, poll, release;
let removed = false;
let cleared = false;
let fail = false;
let hold = false;
let refreshes = 0;
let rows = [];
let displayed = [];
const invalidations = [];
const channel = {
  on(type, filter, callback) {
    assert.equal(type, 'postgres_changes');
    assert.equal(filter.filter, 'room_id=eq.room');
    receive = callback;
    return this;
  },
  subscribe(callback) { status = callback; return this; },
};
const context = vm.createContext({
  supabase: { channel: () => channel, removeChannel: () => { removed = true; } },
  currentUserId: async () => 'recipient',
  clearRemoteCache: (...keys) => invalidations.push(keys),
  setInterval(callback, delay) { assert.equal(delay, 3000); poll = callback; return 1; },
  clearInterval() { cleared = true; },
  console: { warn() {} },
});
vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
const stop = context.subscribeToChatRoom('room', async () => {
  refreshes++;
  if (hold) await new Promise((resolve) => { release = resolve; });
  if (fail) throw new Error('offline');
  displayed = [...rows];
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

rows.push('sent before subscription');
status('SUBSCRIBED');
await settle();
assert.deepEqual(displayed, rows, 'Subscribing catches the initial fetch/subscribe gap');
rows.push('live incoming');
await receive();
assert.deepEqual(displayed, rows, 'Incoming messages appear without sending a reply');
rows.push('silently missed event');
await poll();
assert.deepEqual(displayed, rows, 'Polling catches missing events even while subscribed');
fail = true;
await poll();
fail = false;
rows.push('during disconnect');
status('SUBSCRIBED');
await settle();
assert.deepEqual(displayed, rows, 'Reconnect catches messages after a failed refresh');

hold = true;
const pending = receive();
await settle();
const before = refreshes;
await receive();
await poll();
assert.equal(refreshes, before, 'Concurrent updates do not overlap requests');
hold = false;
release();
await pending;
assert.equal(refreshes, before + 1, 'Events during a request trigger one catch-up');
assert.ok(invalidations.every((keys) => keys.join(',') === 'chatRooms:recipient,chatMessages:recipient:room'));

stop();
const stoppedAt = refreshes;
await poll();
await receive();
status('SUBSCRIBED');
await settle();
assert.equal(refreshes, stoppedAt, 'Late callbacks cannot refresh a closed room');
assert.ok(removed && cleared, 'Closing a room removes both channel and timer');
console.log('Chat reception checks passed: live events, missed events, reconnect, retry, serialization, cleanup.');
