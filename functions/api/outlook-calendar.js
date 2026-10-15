// Same-origin fetch for published Outlook calendars; never proxy arbitrary URLs.
export async function onRequestGet({ request }) {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/calendar; charset=utf-8' };
  try {
    let url = new URL(new URL(request.url).searchParams.get('url'));
    const hosts = ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'];
    const trusted = value => value.protocol === 'https:' && hosts.includes(value.hostname) && !value.port && !value.username && !value.password;
    if (!trusted(url) || !url.pathname.toLowerCase().endsWith('.ics')) throw new Error('Use a published Outlook HTTPS ICS link.');
    const signal = AbortSignal.timeout(15000);
    let response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(url, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects >= 5) throw new Error('Outlook returned too many redirects or an invalid redirect.');
      url = new URL(location, url);
      if (!trusted(url)) throw new Error('Outlook redirected outside its trusted calendar hosts. Try downloading and pasting the ICS contents.');
    }
    if (!response.ok) throw new Error(`Outlook returned HTTP ${response.status}. Try downloading and pasting the ICS contents.`);
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2000000) { await reader.cancel(); throw new Error('Calendar exceeds 2 MB.'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    const text = new TextDecoder().decode(bytes);
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('This link did not return an ICS calendar.');
    return new Response(text, { headers });
  } catch (e) {
    const message = e.name === 'TimeoutError' ? 'Outlook took too long to respond. Try again or paste the ICS contents.' : e.message || 'Calendar import failed.';
    return new Response(message, { status: 400, headers: { ...headers, 'Content-Type': 'text/plain' } });
  }
}
