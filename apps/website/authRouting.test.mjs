import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./authRouting.js', import.meta.url), 'utf8');
const { authPathFor } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const signedIn = { user: { id: 'test-user' } };
const location = (path) => new URL(path, 'https://example.test');

for (const path of ['/friends', '/subjects', '/study', '/settings', '/chats', '/chats/room-123', '/chats/room%20name']) {
  test(`reload preserves ${path} while restoring an existing session`, () => {
    assert.equal(authPathFor(undefined, location(path)), null);
    assert.equal(authPathFor(signedIn, location(path)), null);
  });

  test(`sign-in returns to ${path}, even after reloading the login page`, () => {
    const loginPath = authPathFor(null, location(path));
    assert.equal(location(loginPath).pathname, '/login');
    assert.equal(authPathFor(undefined, location(loginPath)), null);
    assert.equal(authPathFor(null, location(loginPath)), null);
    assert.equal(authPathFor(signedIn, location(loginPath)), path);
  });
}

test('preserves query parameters and fragments through sign-in', () => {
  const path = '/friends?search=Alex#results';
  const loginPath = authPathFor(null, location(path));
  assert.equal(authPathFor(signedIn, location(loginPath)), path);
});

test('ordinary login and explicit sign-out return to the main page', () => {
  assert.equal(authPathFor(null, location('/')), '/login');
  assert.equal(authPathFor(signedIn, location('/login')), '/');
});

test('rejects external URLs, unknown routes and recursive login redirects', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/login?next=/friends', '/unknown']) {
    assert.equal(authPathFor(signedIn, location(`/login?next=${encodeURIComponent(path)}`)), '/');
  }
});
