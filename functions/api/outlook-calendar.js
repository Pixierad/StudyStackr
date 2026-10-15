// Same-origin fetch for published Outlook calendars; never proxy arbitrary URLs.
export async function onRequestGet({ request }) {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/calendar; charset=utf-8' };
  try {
    const url = new URL(new URL(request.url).searchParams.get('url'));
    const hosts = ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password || !url.pathname.toLowerCase().endsWith('.ics')) throw new Error('Use a published Outlook HTTPS ICS link.');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Outlook could not open this published calendar.');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2000000) { await reader.cancel(); throw new Error('Calendar exceeds 2 MB.'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    const text = new TextDecoder().decode(bytes);
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('This link did not return an ICS calendar.');
    return new Response(text, { headers });
  } catch (e) { return new Response(e.message || 'Calendar import failed.', { status: 400, headers: { ...headers, 'Content-Type': 'text/plain' } }); }
}
