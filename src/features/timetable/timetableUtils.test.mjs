import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mondayISO, currentRotation, lessonError } from './timetableUtils.mjs';
const rotation = { weekCount: 2, anchorMonday: '2026-10-05', anchorWeek: 2 };
test('rotation changes on Mondays and wraps across years', () => {
  assert.equal(currentRotation(rotation, new Date(2026, 9, 11)), 2);
  assert.equal(currentRotation(rotation, new Date(2026, 9, 12)), 1);
  assert.equal(currentRotation(rotation, new Date(2026, 9, 19)), 2);
  assert.equal(currentRotation(rotation, new Date(2026, 8, 28)), 1);
  assert.equal(currentRotation({ ...rotation, anchorMonday: '2026-12-28' }, new Date(2027, 0, 4)), 1);
  assert.equal(currentRotation({ ...rotation, weekCount: 1 }, new Date(2026, 9, 12)), 1);
});
test('calendar weeks stay consistent over daylight saving', () => {
  assert.equal(mondayISO(new Date(2026, 9, 25)), '2026-10-19');
  assert.equal(currentRotation(rotation, new Date(2026, 9, 26)), 1);
});
test('lesson validation prevents overlaps but permits adjacent lessons and separate weeks', () => {
  const lesson = { id: 'a', subject: 'Maths', day: 0, week: 1, start: '09:00', end: '10:00' };
  assert.equal(lessonError(lesson, [lesson]), null);
  assert.ok(lessonError({ ...lesson, id: 'b', start: '09:30' }, [lesson]));
  assert.equal(lessonError({ ...lesson, id: 'b', start: '10:00', end: '11:00' }, [lesson]), null);
  assert.equal(lessonError({ ...lesson, id: 'b', week: 2 }, [lesson]), null);
  assert.ok(lessonError({ ...lesson, start: '25:00' }, []));
  assert.ok(lessonError({ ...lesson, end: '08:00' }, []));
  assert.ok(lessonError({ ...lesson, subject: ' ' }, []));
});
