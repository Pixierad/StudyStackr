// Helpers for working with subjects (objects of { name, room, teacher, color }).

// Find a subject object by name in a list. Case-insensitive comparison so
// "Math" and "math" line up. Returns undefined if no match.
export function findSubject(name, subjects) {
  if (!name || !Array.isArray(subjects)) return undefined;
  const target = String(name).trim().toLowerCase();
  return subjects.find((s) => s && s.name && s.name.toLowerCase() === target);
}

// Lighten / darken hex toward white or black by `amount` (0..1). Used to
// derive a soft background tint from a chosen primary color.
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgb(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mix(hex, towardHex, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(towardHex);
  const t = clamp(amount, 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

// Returns a { bg, fg } pair for a given subject name. If the user picked
// a custom color for that subject, derive a soft tint from it. Otherwise
// fall back to the theme's auto-hashed color.
export function resolveSubjectStyle(name, subjects, { colorForSubject, isDark }) {
  const subject = findSubject(name, subjects);
  if (subject && subject.color) {
    return {
      bg: isDark ? mix(subject.color, '#000000', 0.7) : mix(subject.color, '#FFFFFF', 0.82),
      fg: subject.color,
    };
  }
  return colorForSubject(name);
}

// A small palette of preset colors for the subject color picker.
export const SUBJECT_COLOR_PRESETS = [
  '#FF3E38', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#10B981', '#14B8A6', '#06B6D4',
  '#3B82F6', '#5B6CFF', '#8B5CF6', '#A855F7',
  '#D946EF', '#EC4899', '#F43F5E', '#64748B',
];
