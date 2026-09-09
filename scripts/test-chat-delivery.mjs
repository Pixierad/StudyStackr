import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the production subscription with a simulated realtime transport.
const source = await readFile(new URL('../src/services/storage/index.js', import.meta.url), 'utf8');
const start = source.indexOf('export function subscribeToChatNotifications(');
const end = source.indexOf('\nconst CHANGELOG_SEEN_KEY', start);
const calls = [];
const notifications = [];
let receive;
let retry;
let fail = false;
let removed = false;
let cleared = false;
const channel = {
  on(_type, _filter, callback) { receive = callback; return this; },
  subscribe() { return this; },
};
const context = vm.createContext({
  supabase: { channel: () => channel, removeChannel: () => { removed = true; } },
  clearRemoteCache() {},
  setInterval(callback) { retry = callback; return 1; },
  clearInterval() { cleared = true; },
  async syncChatReceipts(room, ids, readIds) {
    calls.push({ room, ids: [...ids], readIds: [...readIds] });
    if (fail) throw new Error('offline');
  },
});
vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
const stop = context.subscribeToChatNotifications('recipient', (row) => notifications.push(row));
const update = (id, sender = 'sender', type = 'message') => receive({ new: {
  id, sender_id: sender, room_id: 'room', message_type: type,
} });
const settle = () => new Promise((resolve) => setImmediate(resolve));

update('incoming');
await settle();
assert.deepEqual(calls, [{ room: 'room', ids: ['incoming'], readIds: [] }]);
assert.equal(notifications.length, 1);
update('own', 'recipient');
update('system', 'sender', 'system');
await settle();
assert.equal(calls.length, 1, 'Own and system messages must not get delivery receipts');

fail = true;
update('retry');
await settle();
fail = false;
await retry();
assert.equal(calls.filter((call) => call.ids[0] === 'retry').length, 2);
await retry();
assert.equal(calls.length, 3, 'Successful acknowledgements leave the retry queue');
assert.ok(calls.every((call) => call.readIds.length === 0), 'Delivery never implies read');
stop();
await retry();
assert.ok(removed && cleared, 'Unsubscribe cleans up the channel and retry timer');
console.log('Chat delivery checks passed: global receipt, sender/system filtering, retry, read separation, cleanup.');
