import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/outlook-calendar.js';
test('Outlook endpoint rejects arbitrary hosts, credentials and non-ICS URLs before fetching', async () => {
  for (const url of ['https://example.com/calendar.ics', 'http://outlook.live.com/calendar.ics', 'https://outlook.live.com.evil.test/calendar.ics', 'https://user:pass@outlook.live.com/calendar.ics', 'https://outlook.live.com/calendar.html']) {
    const response = await onRequestGet({ request: new Request(`https://app.test/api/outlook-calendar?url=${encodeURIComponent(url)}`) });
    assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
test('Outlook endpoint returns calendar text and rejects oversized responses', async () => {
  const original = globalThis.fetch;
  try {
    const request = new Request('https://app.test/api/outlook-calendar?url=https%3A%2F%2Foutlook.live.com%2Fcalendar.ics');
    globalThis.fetch = async (url, options) => { assert.equal(options.redirect, 'error'); return new Response('BEGIN:VCALENDAR\nEND:VCALENDAR'); };
    const response = await onRequestGet({ request }); assert.equal(response.status, 200); assert.match(await response.text(), /BEGIN:VCALENDAR/);
    globalThis.fetch = async () => new Response('x'.repeat(2000001));
    assert.equal((await onRequestGet({ request })).status, 400);
  } finally { globalThis.fetch = original; }
});

