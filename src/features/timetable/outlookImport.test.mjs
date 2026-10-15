import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutlookCalendar } from './outlookImport.mjs';
import { emptyTimetable, lessonError } from './timetableUtils.mjs';
const wrap = (...events) => `BEGIN:VCALENDAR\n${events.join('\n')}\nEND:VCALENDAR`;
const event = (extra = '', start = '20261012T090000', subject = 'Maths') => `BEGIN:VEVENT\nUID:${subject}\nSUMMARY:${subject}\nDTSTART:${start}\nDTEND:${start.replace('090000','100000')}\n${extra}\nEND:VEVENT`;
const weekly = 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261130T235959';
test('detects one week, finite dates, missing subjects and duplicate imports', () => {
  const data = { ...emptyTimetable(), weekCount: 2 };
  const result = parseOutlookCalendar(wrap(event(weekly)), data);
  assert.equal(result.weekCount, 1); assert.equal(result.lessons.length, 2);
  assert.equal(result.warnings.length, 0); assert.deepEqual(result.subjects.map(s => s.name), ['Maths']);
  assert.equal(parseOutlookCalendar(wrap(event(weekly)), { ...data, lessons: result.lessons }, [{ name: 'maths' }]).lessons.length, 0);
  assert.ok(result.lessons.every(l => l.dates.every(d => d <= '2026-11-30')));
});
test('detects two weeks and anchors alternating lessons to their actual dates', () => {
  const result = parseOutlookCalendar(wrap(event('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4'), event('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4','20261019T090000','English')), emptyTimetable());
  assert.equal(result.weekCount, 2); assert.equal(result.anchorMonday, '2026-10-12');
  assert.equal(result.lessons.find(l => l.subject === 'Maths').week, 1);
  assert.equal(result.lessons.find(l => l.subject === 'English').week, 2);
});
test('preserves half term, EXDATE and cancelled or moved occurrences', () => {
  const holiday = 'BEGIN:VEVENT\nSUMMARY:Half term\nDTSTART;VALUE=DATE:20261026\nDTEND;VALUE=DATE:20261102\nEND:VEVENT';
  const cancel = 'BEGIN:VEVENT\nUID:Maths\nRECURRENCE-ID:20261109T090000\nSTATUS:CANCELLED\nEND:VEVENT';
  const moved = event('RECURRENCE-ID:20261116T090000','20261117T090000');
  const result = parseOutlookCalendar(wrap(event(`${weekly}\nEXDATE:20261014T090000`),holiday,cancel,moved), emptyTimetable());
  const dates = result.lessons.flatMap(l => l.dates);
  for (const d of ['2026-10-14','2026-10-26','2026-10-28','2026-11-09','2026-11-16']) assert.ok(!dates.includes(d), d);
  assert.ok(dates.includes('2026-11-02')); assert.ok(dates.includes('2026-11-17'));
  assert.equal(result.holidays.length, 1); assert.equal(result.warnings.length, 0);
});
test('infers alternating patterns from dated events without inventing holiday lessons', () => {
  const result = parseOutlookCalendar(wrap(...['20261012','20261026','20261109'].map(d => event('',`${d}T090000`))), emptyTimetable());
  assert.equal(result.weekCount, 2); assert.equal(result.lessons.length, 1);
  assert.deepEqual(result.lessons[0].dates, ['2026-10-12','2026-10-26','2026-11-09']);
});
test('permits term changes at the same time on disjoint dates and rejects real conflicts', () => {
  const result = parseOutlookCalendar(wrap(event('', '20261012T090000'),event('', '20261019T090000','English')),emptyTimetable());
  assert.equal(result.lessons.length,2); assert.equal(result.warnings.length,0);
  assert.match(lessonError({...result.lessons[1], dates: ['2026-10-12']}, [result.lessons[0]]), /overlaps/);
});
test('reports unsupported rules and bounds open-ended calendars', () => {
  assert.equal(parseOutlookCalendar(wrap(event('RRULE:FREQ=DAILY')),emptyTimetable()).warnings.length,1);
  assert.match(parseOutlookCalendar(wrap(event('RRULE:FREQ=WEEKLY')),emptyTimetable()).warnings[0], /open-ended/);
  assert.throws(() => parseOutlookCalendar('invalid',emptyTimetable()), /valid ICS/);
});
