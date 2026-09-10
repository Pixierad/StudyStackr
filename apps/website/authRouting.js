// Keep the requested URL through sign-in, including a reload of the login page.
export function authPathFor(session, { pathname = '/', search = '', hash = '' }) {
  if (session === undefined) return null;
  const isLogin = pathname.replace(/\/+$/, '') === '/login';
  if (!session) {
    if (isLogin) return null;
    const requestedPath = `${pathname}${search}${hash}`;
    return requestedPath === '/' ? '/login' : `/login?next=${encodeURIComponent(requestedPath)}`;
  }
  if (!isLogin) return null;
  const next = new URLSearchParams(search).get('next');
  // Only permit app routes, never an external URL or another login redirect.
  return next && /^\/(?:settings|study|subjects|friends|chats(?:\/[^/?#]+)?|)(?:[?#].*)?$/.test(next)
    ? next
    : '/';
}
