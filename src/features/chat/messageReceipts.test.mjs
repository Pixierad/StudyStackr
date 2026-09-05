import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./messageReceipts.js', import.meta.url), 'utf8');
const { latestReadersByMessage } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

test('each reader moves to their latest read message, regardless of receipt order', () => {
  const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const receipts = [
    { messageId: 'b', userId: 'friend', readAt: '2026-09-05' },
    { messageId: 'a', userId: 'friend', readAt: '2026-09-04' },
    { messageId: 'a', userId: 'other', readAt: '2026-09-04' },
    { messageId: 'c', userId: 'friend', deliveredAt: '2026-09-05' },
  ];
  const result = latestReadersByMessage(messages, receipts, 'self');
  assert.deepEqual(result.get('a').map((r) => r.userId), ['other']);
  assert.deepEqual(result.get('b').map((r) => r.userId), ['friend']);
  assert.equal(result.has('c'), false);
});

test('ignore self, missing, pending and system messages; allow multiple readers', () => {
  const messages = [{ id: 'a' }, { id: 'local', isLocal: true }, { id: 'system', isSystem: true }];
  const receipts = ['self', 'one', 'two'].map((userId) => ({ messageId: 'a', userId, readAt: 'today' }));
  for (const messageId of ['missing', 'local', 'system']) receipts.push({ messageId, userId: 'one', readAt: 'today' });
  const result = latestReadersByMessage(messages, receipts, 'self');
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('a').map((r) => r.userId), ['one', 'two']);
});
