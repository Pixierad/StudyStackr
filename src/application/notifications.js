import { publicName } from '../shared/profile';

export function notificationRoomTitle(room, userId) {
  if (room?.name?.trim()) return room.name.trim();
  const members = (room?.members || []).filter((member) => member.id !== userId);
  const names = (members.length ? members : room?.members || []).map(publicName).filter(Boolean);
  if (names.length === 0) return 'Chat';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export function shortNotificationBody(body) {
  const text = String(body || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'New message';
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

export function notificationTimeLabel(createdAt) {
  const time = new Date(createdAt || Date.now()).getTime();
  if (Number.isNaN(time)) return 'Just now';
  const diff = Date.now() - time;
  if (diff < 60000) return 'Just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

