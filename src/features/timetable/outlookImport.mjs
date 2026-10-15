import { currentRotation, lessonError, mondayISO } from './timetableUtils.mjs';
const decode = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
function calendarDate(property) {
  const match = property?.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) throw new Error('All-day or invalid event dates are unsupported.');
  const [, y, m, d, h, min, sec = '00', utc] = match;
  if (utc) return new Date(`${y}-${m}-${d}T${h}:${min}:${sec}Z`);
  const zone = property.params.match(/TZID=([^;:]+)/i)?.[1].replace(/"/g, '');
  // Outlook commonly exports Windows timezone names.
  const tz = zone === 'GMT Standard Time' ? 'Europe/London' : zone === 'UTC' ? 'UTC' : zone;
  if (!tz) return new Date(+y, +m - 1, +d, +h, +min, +sec);
  let stamp = Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) { const parts = Object.fromEntries(format.formatToParts(new Date(stamp)).map(v => [v.type, v.value])); const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second); stamp += Date.UTC(+y, +m - 1, +d, +h, +min, +sec) - local; }
  return new Date(stamp);
}
export function parseOutlookCalendar(text, timetable) {
  if (text.length > 2000000 || !text.includes('BEGIN:VCALENDAR')) throw new Error('Paste a valid ICS calendar under 2 MB.');
  const events = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').match(/BEGIN:VEVENT\n[\s\S]*?END:VEVENT/g) || [];
  const lessons = [], warnings = []; const now = Date.now();
  for (const [index, event] of events.entries()) {
    try {
      const properties = {};
      for (const line of event.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '').split('\n')) { const colon = line.indexOf(':'); if (colon < 0) continue; const [name, ...params] = line.slice(0, colon).split(';'); properties[name] = { params: params.join(';'), value: decode(line.slice(colon + 1)) }; }
      if (properties.STATUS?.value === 'CANCELLED') continue;
      const start = calendarDate(properties.DTSTART), end = calendarDate(properties.DTEND);
      const rule = Object.fromEntries((properties.RRULE?.value || '').split(';').map(v => v.split('=')));
      if (!rule.FREQ) throw new Error('One-off events are skipped; the timetable repeats weekly.');
      if (rule.FREQ !== 'WEEKLY' || !['1', '2'].includes(rule.INTERVAL || '1') || properties.EXDATE || properties['RECURRENCE-ID'] || properties.RDATE || rule.COUNT || Object.keys(rule).some(k => !['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'WKST'].includes(k))) throw new Error('This recurrence needs manual entry (exceptions or unsupported rule).');
      if (rule.UNTIL && calendarDate({ value: rule.UNTIL, params: '' }).getTime() < now) continue;
      if (start.toDateString() !== end.toDateString()) throw new Error('Overnight events need manual entry.');
      const interval = Number(rule.INTERVAL || 1);
      if (interval === 2 && timetable.weekCount !== 2) throw new Error('Select a two-week timetable before importing alternating lessons.');
      const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
      const days = rule.BYDAY ? rule.BYDAY.split(',').map(v => dayNames.indexOf(v)) : [(start.getDay() + 6) % 7];
      if (days.includes(-1)) throw new Error('Unsupported day rule.');
      const time = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      for (const week of interval === 2 ? [currentRotation(timetable, start)] : Array.from({ length: timetable.weekCount }, (_, i) => i + 1)) for (const day of days) {
        const lesson = { id: `outlook-${index}-${week}-${day}`, week, day, subject: properties.SUMMARY?.value || 'Imported lesson', teacher: '', room: properties.LOCATION?.value || '', start: time(start), end: time(end) };
        const identical = [...timetable.lessons, ...lessons].some(v => ['week', 'day', 'subject', 'start', 'end'].every(k => v[k] === lesson[k]));
        if (identical) continue;
        const error = lessonError(lesson, [...timetable.lessons, ...lessons]); if (error) { warnings.push(`${lesson.subject}: ${error}`); continue; }
        lessons.push(lesson);
      }
    } catch (e) { warnings.push(`Event ${index + 1}: ${e.message}`); }
  }
  if (lessons.length > 500) throw new Error('Import at most 500 lessons at once.');
  return { lessons, warnings, anchor: mondayISO() };
}
