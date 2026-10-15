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
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const timeKey = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
export function parseOutlookCalendar(text, timetable, subjects = []) {
  if (text.length > 2000000 || !text.includes('BEGIN:VCALENDAR')) throw new Error('Paste a valid ICS calendar under 2 MB.');
  const events = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').match(/BEGIN:VEVENT\n[\s\S]*?END:VEVENT/g) || [];
  const warnings = [], records = [], occurrences = [], holidays = [];
  for (const [index, event] of events.entries()) {
    const props = {};
    for (const line of event.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '').split('\n')) {
      const colon = line.indexOf(':'); if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(';');
      (props[name] ||= []).push({ params: params.join(';'), value: decode(line.slice(colon+1)) });
    }
    records.push({ index, props, get: name => props[name]?.[0] });
  }
  const overrides = new Set();
  for (const r of records.filter(r => r.get('RECURRENCE-ID'))) { try { overrides.add(`${r.get('UID')?.value}|${calendarDate(r.get('RECURRENCE-ID')).getTime()}`); } catch { warnings.push(`Event ${r.index+1}: invalid recurrence override.`); } }
  let explicitTwo = false;
  for (const { index, props, get } of records) {
    try {
      if (get('STATUS')?.value === 'CANCELLED') continue;
      if (/^\d{8}$/.test(get('DTSTART')?.value || '')) {
        const iso = value => `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
        if (/holiday|half.?term|school closed|inset|no school/i.test(get('SUMMARY')?.value || '')) {
          holidays.push({ start: iso(get('DTSTART').value), end: iso(get('DTEND')?.value || get('DTSTART').value), name: get('SUMMARY').value });
          if (get('RRULE')) warnings.push(`Event ${index+1}: recurring holiday imported for its first date range only.`);
        }
        continue;
      }
      const start = calendarDate(get('DTSTART')), end = calendarDate(get('DTEND'));
      if (dateKey(start) !== dateKey(end)) throw new Error('Overnight events need manual entry.');
      const rule = Object.fromEntries((get('RRULE')?.value || '').split(';').filter(Boolean).map(v => v.split('=')));
      if (rule.FREQ && (rule.FREQ !== 'WEEKLY' || !['1','2'].includes(rule.INTERVAL || '1') || Object.keys(rule).some(k => !['FREQ','INTERVAL','BYDAY','UNTIL','COUNT','WKST'].includes(k)))) throw new Error('Unsupported recurrence; enter this event manually.');
      explicitTwo ||= rule.INTERVAL === '2';
      const exclusions = new Set((props.EXDATE || []).flatMap(p => p.value.split(',').map(value => calendarDate({ ...p, value }).getTime())));
      const days = rule.BYDAY ? rule.BYDAY.split(',').map(v => ['SU','MO','TU','WE','TH','FR','SA'].indexOf(v)) : [start.getDay()];
      if (days.includes(-1)) throw new Error('Unsupported day rule.');
      // Bound open-ended feeds to a year; finite feeds keep their actual end date.
      const limit = new Date(start); limit.setFullYear(limit.getFullYear()+2);
      let until = rule.UNTIL ? calendarDate({ value: rule.UNTIL.length === 8 ? `${rule.UNTIL}T235959` : rule.UNTIL, params: '' }) : new Date(Math.max(Date.now(), start.getTime()) + 366*86400000);
      if (until > limit) { until = limit; warnings.push(`Event ${index+1}: preview limited to two years.`); }
      if (rule.FREQ && !rule.UNTIL && !rule.COUNT) warnings.push(`Event ${index+1}: open-ended recurrence imported through ${dateKey(until)}; reimport to extend it.`);
      let count = 0;
      const add = date => {
        if (exclusions.has(date.getTime()) || (!get('RECURRENCE-ID') && overrides.has(`${get('UID')?.value}|${date.getTime()}`))) return;
        occurrences.push({ date: dateKey(date), day: (date.getDay()+6)%7, subject: get('SUMMARY')?.value || 'Imported lesson', teacher: '', room: get('LOCATION')?.value || '', start: timeKey(date), end: timeKey(new Date(date.getTime()+end.getTime()-start.getTime())) });
      };
      if (!rule.FREQ) add(start);
      else for (let cursor = new Date(start); cursor <= until; cursor.setDate(cursor.getDate()+1)) {
        const weeks = Math.round((Date.parse(mondayISO(cursor))-Date.parse(mondayISO(start)))/604800000);
        if (weeks % Number(rule.INTERVAL || 1) || !days.includes(cursor.getDay())) continue;
        if (rule.COUNT && count >= Number(rule.COUNT)) break;
        count++; add(new Date(cursor));
      }
      for (const p of props.RDATE || []) for (const value of p.value.split(',')) add(calendarDate({ ...p, value }));
    } catch (e) { warnings.push(`Event ${index+1}: ${e.message}`); }
  }
  const active = occurrences.filter(o => !holidays.some(h => o.date >= h.start && (h.end === h.start ? o.date === h.start : o.date < h.end)));
  const anchor = active.map(o => mondayISO(new Date(`${o.date}T12:00:00`))).sort()[0] || mondayISO();
  const signatures = new Map();
  for (const o of active) {
    const key = [o.day,o.start,o.end,o.subject,o.room].join('|');
    const weeks = signatures.get(key) || new Set(); weeks.add(Math.round((Date.parse(mondayISO(new Date(`${o.date}T12:00:00`)))-Date.parse(anchor))/604800000)); signatures.set(key,weeks);
  }
  const inferredTwo = [...signatures.values()].some(weeks => weeks.size >= 3 && new Set([...weeks].map(w => w%2)).size === 1);
  const weekCount = explicitTwo || inferredTwo ? 2 : 1;
  const config = { weekCount, anchorMonday: anchor, anchorWeek: 1 };
  const grouped = new Map();
  for (const o of active) {
    const week = currentRotation(config, new Date(`${o.date}T12:00:00`));
    const key = [week,o.day,o.start,o.end,o.subject,o.room].join('|');
    if (!grouped.has(key)) grouped.set(key, { ...o, id: `outlook-${grouped.size}`, week, dates: [] });
    grouped.get(key).dates.push(o.date);
  }
  const lessons = [];
  for (const lesson of grouped.values()) {
    const knownSubject = subjects.find(s => s.name.trim().toLowerCase() === lesson.subject.trim().toLowerCase());
    if (knownSubject) lesson.subject = knownSubject.name;
    delete lesson.date; lesson.dates = [...new Set(lesson.dates)].sort();
    const existing = timetable.lessons.find(v => ['week','day','subject','start','end','room'].every(k => (k === 'subject' ? (v[k] || '').trim().toLowerCase() === lesson[k].trim().toLowerCase() : (v[k] || '') === (lesson[k] || ''))) && JSON.stringify(v.dates) === JSON.stringify(lesson.dates));
    if (existing) continue;
    const error = lessonError(lesson, [...timetable.lessons, ...lessons]);
    if (error) warnings.push(`${lesson.subject}: ${error}`); else lessons.push(lesson);
  }
  if (lessons.length > 500) throw new Error('Import at most 500 lesson patterns at once.');
  const missing = [...new Map(lessons.map(l => [l.subject.trim().toLowerCase(), { name: l.subject.trim(), room: l.room, teacher: l.teacher, color: null }])).values()].filter(s => !subjects.some(v => v.name.trim().toLowerCase() === s.name.toLowerCase()));
  return { lessons, warnings: [...new Set(warnings)], ...config, anchor, subjects: missing, holidays };
}
