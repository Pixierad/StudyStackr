export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function mondayISO(date = new Date()) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function currentRotation(timetable, date = new Date()) {
  if (timetable.weekCount !== 2) return 1;
  const elapsed = Math.round((Date.parse(mondayISO(date)) - Date.parse(timetable.anchorMonday)) / 604800000);
  return ((elapsed + timetable.anchorWeek - 1) % 2 + 2) % 2 + 1;
}
export function emptyTimetable() {
  return { weekCount: 1, anchorMonday: mondayISO(), anchorWeek: 1, lessons: [] };
}
export function validTime(time) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(time); }
export function lessonError(lesson, lessons) {
  if (!lesson.subject.trim()) return 'Enter a subject.';
  if (!validTime(lesson.start) || !validTime(lesson.end)) return 'Enter times as HH:MM, for example 09:00.';
  if (lesson.end <= lesson.start) return 'End time must be after start time.';
  if (lessons.some(item => item.id !== lesson.id && item.week === lesson.week && item.day === lesson.day && item.start < lesson.end && item.end > lesson.start)) return 'This lesson overlaps another lesson on this day.';
  return null;
}
