export const DEFAULT_AVATAR_EMOJI = '\u{1F393}';

export const AVATAR_EMOJIS = [
  '\u{1F393}',
  '\u{1F4DA}',
  '\u270F\uFE0F',
  '\u{1F9E0}',
  '\u2B50',
  '\u{1F680}',
  '\u{1F3A8}',
  '\u26BD',
  '\u{1F3A7}',
  '\u{1F4BB}',
  '\u{1F52C}',
  '\u{1F33F}',
  '\u2615',
  '\u{1F319}',
  '\u{1F525}',
  '\u{1F4A1}',
];

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
}

export function isValidUsername(value) {
  const username = normalizeUsername(value);
  return username.length === 0 || username.length >= 3;
}

export function normalizeProfile(profile = {}) {
  const avatarType = profile.avatarType === 'image' ? 'image' : 'emoji';
  const avatarValue =
    typeof profile.avatarValue === 'string' && profile.avatarValue
      ? profile.avatarValue
      : DEFAULT_AVATAR_EMOJI;
  const createdAt =
    typeof profile.createdAt === 'string' && profile.createdAt
      ? profile.createdAt
      : profile.created_at
        ? String(profile.created_at)
        : null;
  const lastOnlineAt =
    typeof profile.lastOnlineAt === 'string' && profile.lastOnlineAt
      ? profile.lastOnlineAt
      : profile.last_online_at
        ? String(profile.last_online_at)
        : null;

  return {
    id: profile.id ?? null,
    name: typeof profile.name === 'string' ? profile.name : '',
    username: normalizeUsername(profile.username),
    avatarType,
    avatarValue,
    createdAt,
    lastOnlineAt,
  };
}

export function publicName(profile = {}) {
  const normalized = normalizeProfile(profile);
  return normalized.name || normalized.username || 'Student';
}

export function profileCreatedDate(profile = {}) {
  const normalized = normalizeProfile(profile);
  const date = normalized.createdAt ? new Date(normalized.createdAt) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function profileCreatedDateLabel(profile = {}) {
  const date = profileCreatedDate(profile);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

export function profileStackingDays(profile = {}) {
  const date = profileCreatedDate(profile);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

export function profileStackingLabel(profile = {}) {
  const name = publicName(profile);
  const days = profileStackingDays(profile);
  return `${name} has been stacking for ${days} ${days === 1 ? 'day' : 'days'} since ${profileCreatedDateLabel(profile)}`;
}

export function profileLastOnlineDate(profile = {}) {
  const normalized = normalizeProfile(profile);
  if (!normalized.lastOnlineAt) return null;
  const date = new Date(normalized.lastOnlineAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.now();
}

export function isProfileOnline(profile = {}, now = Date.now()) {
  const date = profileLastOnlineDate(profile);
  if (!date) return false;
  const diff = nowTime(now) - date.getTime();
  return diff >= -30 * 1000 && diff <= ONLINE_WINDOW_MS;
}

export function profileOnlineLabel(profile = {}, now = Date.now()) {
  if (isProfileOnline(profile, now)) return 'Online';

  const date = profileLastOnlineDate(profile);
  if (!date) return 'Last online unknown';

  const diffMs = Math.max(0, nowTime(now) - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Last online just now';
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `Last online ${minutes}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `Last online ${hours}h ago`;
  }
  if (diffMs < 7 * day) {
    const days = Math.max(1, Math.floor(diffMs / day));
    return `Last online ${days}d ago`;
  }

  const dateLabel = profileCreatedDateLabel({ createdAt: date.toISOString() });
  return `Last online ${dateLabel}`;
}
