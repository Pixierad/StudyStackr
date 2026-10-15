import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutlookCalendar } from './outlookImport.mjs';
import { emptyTimetable } from './timetableUtils.mjs';
const event = (extra = '', start = '20261012T090000', end = '20261012T100000') => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Maths\r\nDTSTART:${start}\r\nDTEND:${end}\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
test('previews repeating lessons across weeks and avoids duplicate imports', () => {
  const data = { ...emptyTimetable(), weekCount: 2 };
  const parsed = parseOutlookCalendar(event(), data);
  assert.equal(parsed.lessons.length, 4); assert.equal(parsed.warnings.length, 0);
  assert.equal(parseOutlookCalendar(event(), { ...data, lessons: parsed.lessons }).lessons.length, 0);
});
test('reports exceptions, one-off events, unsupported intervals, and overlaps', () => {
  assert.equal(parseOutlookCalendar(event('EXDATE:20261014T090000'), emptyTimetable()).lessons.length, 0);
  assert.equal(parseOutlookCalendar(event().replace('FREQ=WEEKLY', 'FREQ=DAILY'), emptyTimetable()).warnings.length, 1);
  assert.equal(parseOutlookCalendar(event().replace('RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n', ''), emptyTimetable()).warnings.length, 1);
  const data = emptyTimetable(); data.lessons = [{ id: 'old', week: 1, day: 0, subject: 'English', start: '09:15', end: '10:15' }];
  const result = parseOutlookCalendar(event(), data); assert.equal(result.lessons.length, 1); assert.equal(result.warnings.length, 1);
  assert.throws(() => parseOutlookCalendar('not a calendar', data), /valid ICS/);
});
