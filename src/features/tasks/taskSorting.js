export const SORT_OPTIONS = [
  { key: 'not_done_first', label: 'Not done first' },
  { key: 'due_date', label: 'Date due' },
  { key: 'alphabetical', label: 'A-Z' },
];
export const STATUS_ONLY_FILTERS = new Set(['incomplete', 'complete']);

export function compareTasks(a, b, sortMode) {
  switch (sortMode) {
    case 'due_date': {
      const byDueDate = compareDueDates(a, b);
      if (byDueDate !== 0) return byDueDate;
      return compareTitles(a, b) || compareNewestFirst(a, b) || compareIds(a, b);
    }
    case 'alphabetical':
      return (
        compareTitles(a, b) ||
        compareDueDates(a, b) ||
        compareNewestFirst(a, b) ||
        compareIds(a, b)
      );
    case 'not_done_first':
    default:
      if (a.done !== b.done) return a.done ? 1 : -1;
      return compareDueDates(a, b) || compareNewestFirst(a, b) || compareIds(a, b);
  }
}

function compareDueDates(a, b) {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

function compareTitles(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''), undefined, {
    sensitivity: 'base',
  });
}

function compareNewestFirst(a, b) {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

function compareIds(a, b) {
  return String(a.id || '').localeCompare(String(b.id || ''));
}

