// Small date helpers used across the app.
// Tasks store dueDate as an ISO date string "YYYY-MM-DD" (no time — day-level granularity).
//
// The "soon" / "in N days" thresholds below are deliberately aligned at one
// week (7 days). Previously dueStatus treated diffs <= 3 as 'soon' while
// relativeLabel emitted "In N days" up to 6, which produced inconsistent UI
// (a task due in 5 days read "In 5 days" but rendered with the neutral
// 'future' colour). Both helpers now use the same UPCOMING_WINDOW_DAYS.

export const UPCOMING_WINDOW_DAYS = 7;

export function toISODate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISODate(new Date());
}

export function daysBetween(fromISO, toISO) {
  const a = fromISODate(fromISO);
  const b = fromISODate(toISO);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Friendly relative label: "Today", "Tomorrow", "In 3 days", "2 days ago", "Mon, Apr 21"
export function relativeLabel(iso) {
  if (!iso) return 'No due date';
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= UPCOMING_WINDOW_DAYS) return `In ${diff} days`;
  if (diff < -1 && diff >= -UPCOMING_WINDOW_DAYS) return `${Math.abs(diff)} days ago`;

  const d = fromISODate(iso);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday}, ${month} ${d.getDate()}`;
}

// Status for coloring the due-date pill. The 'soon' threshold matches
// relativeLabel's "In N days" range so colour and copy stay in lockstep.
export function dueStatus(iso, done) {
  if (done) return 'done';
  if (!iso) return 'none';
  const diff = daysBetween(todayISO(), iso);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= UPCOMING_WINDOW_DAYS) return 'soon';
  return 'future';
}
