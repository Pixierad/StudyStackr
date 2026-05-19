export const DEFAULT_AVATAR_EMOJI = '🎓';

export const AVATAR_EMOJIS = [
  '🎓',
  '📚',
  '✏️',
  '🧠',
  '⭐',
  '🚀',
  '🎨',
  '⚽',
  '🎧',
  '💻',
  '🔬',
  '🌿',
  '☕',
  '🌙',
  '🔥',
  '💡',
];

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

  return {
    id: profile.id ?? null,
    name: typeof profile.name === 'string' ? profile.name : '',
    username: normalizeUsername(profile.username),
    avatarType,
    avatarValue,
  };
}

export function publicName(profile = {}) {
  const normalized = normalizeProfile(profile);
  return normalized.name || normalized.username || 'Student';
}
