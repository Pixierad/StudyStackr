// Storage layer.
//
// Dual mode:
//   * Local-only -- Supabase isn't configured, OR the user isn't signed in.
//     Everything reads/writes AsyncStorage under @simpleapp:*:v1 keys.
//   * Cloud      -- Supabase is configured and a session exists. Reads/writes
//     go through Supabase tables (tasks, subjects, profiles). AsyncStorage
//     is still used as a lightweight offline cache per-user so the UI can
//     render instantly on boot.
//
// Callers import the top-level helpers (loadTasks, upsertTask, deleteTask,
// loadSubjects, upsertSubject, deleteSubject, loadProfile, saveProfile, ...)
// and don't need to care which backend is active. The root auth-state listener
// re-loads data when the user signs in/out.
//
// IMPORTANT design notes (see code-review):
//   1. We perform per-row mutations (upsertTask / deleteTask) instead of
//      bulk re-uploading the whole table on every change. This avoids
//      destroying server `created_at` ordering, eliminates write-races
//      between concurrent edits, and keeps Supabase quota use bounded.
//   2. A serialised write queue (`runQueued`) guarantees that overlapping
//      saves on the same row execute in order, removing the lost-write
//      race that the bulk-save pattern was vulnerable to.
//   3. On first sign-in we attempt a one-shot migration of any legacy
//      local-only data into the user-scoped key so users who upgrade from
//      a pre-Supabase build don't silently lose their tasks/subjects.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured, currentUserId } from '../supabase';
import { DEFAULT_AVATAR_EMOJI, normalizeProfile } from '../../shared/profile';

// ── Local keys ─────────────────────────────────────────────────────────────
// The legacy keys (no user id) are preserved so existing local-only data
// keeps working. For signed-in users we scope the cache to their id.
const LEGACY_TASKS_KEY = '@simpleapp:tasks:v1';
const LEGACY_SUBJECTS_KEY = '@simpleapp:subjects:v1';
const LEGACY_USER_NAME_KEY = '@simpleapp:userName:v1';
const LEGACY_STUDY_SESSIONS_KEY = '@simpleapp:studySessions:v1';
const PROFILE_KEY_PREFIX = '@simpleapp:profile:';
const MIGRATION_FLAG_PREFIX = '@simpleapp:migrated:';
const PENDING_WRITES_PREFIX = '@simpleapp:pendingWrites:';

function tasksKey(userId) {
  return userId ? `@simpleapp:tasks:${userId}:v1` : LEGACY_TASKS_KEY;
}
function subjectsKey(userId) {
  return userId ? `@simpleapp:subjects:${userId}:v1` : LEGACY_SUBJECTS_KEY;
}
function studySessionsKey(userId) {
  return userId ? `@simpleapp:studySessions:${userId}:v1` : LEGACY_STUDY_SESSIONS_KEY;
}
function userNameKey(userId) {
  return userId ? `@simpleapp:userName:${userId}:v1` : LEGACY_USER_NAME_KEY;
}
function profileKey(userId) {
  return userId ? `${PROFILE_KEY_PREFIX}${userId}:v1` : `${PROFILE_KEY_PREFIX}local:v1`;
}
function pendingWritesKey(userId) {
  return `${PENDING_WRITES_PREFIX}${userId}:v1`;
}

// Small helper: returns the active user id when we should hit Supabase, else null.
async function cloudMode() {
  if (!isSupabaseConfigured || !supabase) return null;
  const uid = await currentUserId();
  return uid || null;
}

// ── Serialised write queue ─────────────────────────────────────────────────
// All cloud writes (single-row upserts/deletes) are funnelled through this
// promise chain so concurrent setState-driven saves cannot interleave on the
// server. This addresses the race in bulk saveTasks (review item #5).
let _writeChain = Promise.resolve();
function runQueued(fn) {
  const next = _writeChain.then(() => fn());
  _writeChain = next.catch((e) => {
    console.warn('Queued write failed:', e?.message || e);
  });
  return next;
}

let _flushChain = Promise.resolve();
const REMOTE_CACHE_TTL_MS = 30_000;
const ONLINE_TOUCH_MIN_INTERVAL_MS = 45_000;
const remoteMemoryCache = new Map();
let lastProfileOnlineTouchAt = 0;
let lastProfileOnlineTouchUserId = null;
let profileOnlineTouchDisabled = false;

function readFreshRemoteCache(key) {
  const cached = remoteMemoryCache.get(key);
  if (!cached || Date.now() - cached.savedAt > REMOTE_CACHE_TTL_MS) return null;
  return cached.value;
}

function writeRemoteCache(key, value) {
  remoteMemoryCache.set(key, { value, savedAt: Date.now() });
}

function clearRemoteCache(...keys) {
  keys.forEach((key) => remoteMemoryCache.delete(key));
}

// ── Normalizers ────────────────────────────────────────────────────────────

export function normalizeSubject(s) {
  if (typeof s === 'string') {
    return { name: s, room: '', teacher: '', color: null };
  }
  if (s && typeof s === 'object' && typeof s.name === 'string') {
    return {
      name: s.name,
      room: typeof s.room === 'string' ? s.room : '',
      teacher: typeof s.teacher === 'string' ? s.teacher : '',
      color: typeof s.color === 'string' && s.color ? s.color : null,
    };
  }
  return null;
}

// Map between app-shape tasks (camelCase) and DB-shape rows (snake_case).
function taskToRow(t, userId) {
  return {
    id: t.id,
    user_id: userId,
    title: t.title ?? '',
    description: t.description ?? null,
    subject: t.subject ?? null,
    due_date: t.dueDate ?? null,
    done: !!t.done,
    // Only set created_at when the caller actually provided one. Letting the
    // server default fire (now()) on insert preserves the original value on
    // subsequent UPSERTs (because we omit the column from the update set).
    ...(t.createdAt
      ? { created_at: new Date(t.createdAt).toISOString() }
      : {}),
  };
}
function rowToTask(r) {
  return {
    id: r.id,
    title: r.title ?? '',
    description: r.description ?? null,
    subject: r.subject ?? null,
    dueDate: r.due_date ?? null,
    done: !!r.done,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

function safeISODateTime(value, fallback = new Date().toISOString()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function normalizeStudySession(session = {}) {
  const now = new Date().toISOString();
  const startedAt = safeISODateTime(session.startedAt || session.started_at, now);
  const endedAt = safeISODateTime(session.endedAt || session.ended_at, startedAt);
  const durationSeconds = Math.max(0, Math.round(Number(
    session.durationSeconds ?? session.duration_seconds ?? 0
  )));
  const plannedSecondsRaw = session.plannedSeconds ?? session.planned_seconds;
  const plannedSeconds =
    plannedSecondsRaw == null ? null : Math.max(0, Math.round(Number(plannedSecondsRaw) || 0));
  const mode = ['pomodoro', 'custom', 'stopwatch'].includes(session.mode)
    ? session.mode
    : 'stopwatch';

  return {
    id: session.id || newId(),
    title:
      typeof (session.title ?? session.name) === 'string'
        ? String(session.title ?? session.name).trim().slice(0, 80)
        : '',
    subject: typeof session.subject === 'string' && session.subject ? session.subject : null,
    mode,
    durationSeconds,
    plannedSeconds,
    startedAt,
    endedAt,
    note: typeof session.note === 'string' ? session.note : '',
    createdAt: safeISODateTime(session.createdAt || session.created_at, now),
  };
}

function studySessionToRow(session, userId) {
  const cleaned = normalizeStudySession(session);
  return {
    id: cleaned.id,
    user_id: userId,
    title: cleaned.title || null,
    subject: cleaned.subject,
    mode: cleaned.mode,
    duration_seconds: cleaned.durationSeconds,
    planned_seconds: cleaned.plannedSeconds,
    started_at: cleaned.startedAt,
    ended_at: cleaned.endedAt,
    note: cleaned.note || null,
    ...(cleaned.createdAt ? { created_at: cleaned.createdAt } : {}),
  };
}

function rowToStudySession(row) {
  return normalizeStudySession(row);
}

function subjectToRow(s, userId) {
  return {
    user_id: userId,
    name: s.name,
    room: s.room ?? '',
    teacher: s.teacher ?? '',
    color: s.color ?? null,
  };
}
function rowToSubject(r) {
  return {
    name: r.name,
    room: r.room ?? '',
    teacher: r.teacher ?? '',
    color: r.color ?? null,
  };
}

function profileToRow(profile, userId) {
  const cleaned = normalizeProfile(profile);
  return {
    id: userId,
    name: cleaned.name,
    username: cleaned.username || null,
    avatar_type: cleaned.avatarType,
    avatar_value: cleaned.avatarValue || DEFAULT_AVATAR_EMOJI,
    ...(cleaned.createdAt ? { created_at: cleaned.createdAt } : {}),
  };
}

function rowToProfile(r, fallbackId = null) {
  return normalizeProfile({
    id: r?.id ?? fallbackId,
    name: r?.name ?? '',
    username: r?.username ?? '',
    avatarType: r?.avatar_type ?? r?.avatarType ?? 'emoji',
    avatarValue: r?.avatar_value ?? r?.avatarValue ?? DEFAULT_AVATAR_EMOJI,
    createdAt: r?.created_at ?? r?.createdAt ?? null,
    lastOnlineAt: r?.last_online_at ?? r?.lastOnlineAt ?? null,
  });
}

// ── Local cache helpers ────────────────────────────────────────────────────

async function readLocalArray(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to read local array:', e);
    return [];
  }
}

async function writeLocalArray(key, arr) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn('Failed to write local array:', e);
  }
}

async function readLocalObject(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.warn('Failed to read local object:', e);
    return null;
  }
}

async function writeLocalObject(key, obj) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to write local object:', e);
  }
}

function isNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('load failed') ||
    message.includes('networkerror')
  );
}

async function enqueuePendingWrite(uid, op) {
  if (!uid || !op?.type) return;
  const key = pendingWritesKey(uid);
  const pending = await readLocalArray(key);
  const next = [...pending, { ...op, queuedAt: Date.now(), queueId: newId() }];
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

async function applyPendingWrite(uid, op) {
  switch (op.type) {
    case 'upsertTask': {
      const { error } = await supabase
        .from('tasks')
        .upsert([taskToRow(op.task, uid)], { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    case 'deleteTask': {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('user_id', uid)
        .eq('id', op.id);
      if (error) throw error;
      return;
    }
    case 'upsertStudySession': {
      const { error } = await supabase
        .from('study_sessions')
        .upsert([studySessionToRow(op.session, uid)], { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    case 'deleteStudySession': {
      const { error } = await supabase
        .from('study_sessions')
        .delete()
        .eq('user_id', uid)
        .eq('id', op.id);
      if (error) throw error;
      return;
    }
    case 'upsertSubject': {
      if (op.previousName && op.previousName !== op.subject?.name) {
        const { error: delErr } = await supabase
          .from('subjects')
          .delete()
          .eq('user_id', uid)
          .eq('name', op.previousName);
        if (delErr) throw delErr;
      }
      const cleaned = normalizeSubject(op.subject);
      if (!cleaned) return;
      const { error } = await supabase
        .from('subjects')
        .upsert([subjectToRow(cleaned, uid)], { onConflict: 'user_id,name' });
      if (error) throw error;
      return;
    }
    case 'deleteSubject': {
      const { error } = await supabase
        .from('subjects')
        .delete()
        .eq('user_id', uid)
        .eq('name', op.name);
      if (error) throw error;
      return;
    }
    case 'saveUserName': {
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: uid, name: op.name ?? '' }, { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    case 'saveProfile': {
      const { error } = await supabase
        .from('profiles')
        .upsert(profileToRow(op.profile, uid), { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    default:
      return;
  }
}

async function flushPendingWrites(uid) {
  if (!uid || !supabase) return;
  _flushChain = _flushChain.then(async () => {
    const key = pendingWritesKey(uid);
    const pending = await readLocalArray(key);
    if (pending.length === 0) return;

    const remaining = [];
    for (const op of pending) {
      try {
        await applyPendingWrite(uid, op);
      } catch (e) {
        if (isNetworkError(e)) {
          remaining.push(op);
        } else {
          console.warn('Dropping pending write that no longer applies:', e?.message || e);
        }
      }
    }
    await AsyncStorage.setItem(key, JSON.stringify(remaining));
  }).catch((e) => {
    console.warn('Failed to flush pending writes:', e?.message || e);
  });
  return _flushChain;
}

async function queueIfOffline(uid, op, error) {
  if (!isNetworkError(error)) throw error;
  await enqueuePendingWrite(uid, op);
  return { queued: true };
}

// ── One-time legacy migration ──────────────────────────────────────────────
// When a user signs in for the first time on a build that has Supabase
// enabled, copy any legacy local-only data into the user-scoped slot AND
// upload it to the cloud. The migration flag is keyed per-user so each
// new sign-in on the same device has the chance to import.
async function migrateLegacyIfNeeded(uid) {
  if (!uid) return;
  const flagKey = `${MIGRATION_FLAG_PREFIX}${uid}`;
  try {
    const already = await AsyncStorage.getItem(flagKey);
    if (already) return;
  } catch {
    // If we can't read the flag we don't try the migration -- safer to
    // skip than to risk duplicating data on every boot.
    return;
  }

  try {
    const [legacyTasksRaw, legacySubjectsRaw, legacyName] = await Promise.all([
      AsyncStorage.getItem(LEGACY_TASKS_KEY),
      AsyncStorage.getItem(LEGACY_SUBJECTS_KEY),
      AsyncStorage.getItem(LEGACY_USER_NAME_KEY),
    ]);
    const legacyTasks = legacyTasksRaw ? safeParseArray(legacyTasksRaw) : [];
    const legacySubjects = legacySubjectsRaw ? safeParseArray(legacySubjectsRaw) : [];

    // Tasks ── only push rows that don't already exist on the server.
    if (legacyTasks.length > 0 && supabase) {
      const { data: existing } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', uid);
      const known = new Set((existing || []).map((r) => r.id));
      const fresh = legacyTasks.filter((t) => t && t.id && !known.has(t.id));
      if (fresh.length > 0) {
        const rows = fresh.map((t) => taskToRow(t, uid));
        const { error } = await supabase
          .from('tasks')
          .upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
    }

    // Subjects -- keyed by (user_id, name). Skip names already present.
    if (legacySubjects.length > 0 && supabase) {
      const { data: existing } = await supabase
        .from('subjects')
        .select('name')
        .eq('user_id', uid);
      const known = new Set((existing || []).map((r) => r.name));
      const normalized = legacySubjects.map(normalizeSubject).filter(Boolean);
      const fresh = normalized.filter((s) => !known.has(s.name));
      if (fresh.length > 0) {
        const rows = fresh.map((s) => subjectToRow(s, uid));
        const { error } = await supabase
          .from('subjects')
          .upsert(rows, { onConflict: 'user_id,name' });
        if (error) throw error;
      }
    }

    // User name -- only adopt if the cloud profile has nothing yet.
    if (legacyName && supabase) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', uid)
        .maybeSingle();
      if (!profile?.name) {
        await supabase
          .from('profiles')
          .upsert({ id: uid, name: legacyName }, { onConflict: 'id' });
      }
    }

    await AsyncStorage.setItem(flagKey, '1');
  } catch (e) {
    // Don't crash the app on a bad migration -- just log and try again next boot.
    console.warn('Legacy migration failed (will retry next launch):', e?.message || e);
  }
}

function safeParseArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Tasks ──────────────────────────────────────────────────────────────────

async function loadCloudTasks(uid) {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const tasks = (data || []).map(rowToTask);
    AsyncStorage.setItem(tasksKey(uid), JSON.stringify(tasks)).catch(() => {});
    return tasks;
  } catch (e) {
    console.warn('Supabase loadTasks failed, falling back to cache:', e?.message);
    return readLocalArray(tasksKey(uid));
  }
}

export async function loadTasks() {
  const uid = await cloudMode();

  if (uid) {
    await migrateLegacyIfNeeded(uid);
    await flushPendingWrites(uid);
    return loadCloudTasks(uid);
  }

  return readLocalArray(tasksKey(null));
}

// Per-row upsert (insert or update a single task). All callers go through the
// queue so concurrent toggles serialise.
export async function upsertTask(task) {
  if (!task || !task.id) return;
  const uid = await cloudMode();

  if (uid) {
    // Update the local cache eagerly.
    await updateLocalTaskCache(uid, (prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...prev[idx], ...task };
        return next;
      }
      return [task, ...prev];
    });
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('tasks')
          .upsert([taskToRow(task, uid)], { onConflict: 'id' });
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'upsertTask', task }, e);
      }
    });
  }

  await updateLocalTaskCache(null, (prev) => {
    const idx = prev.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      const next = prev.slice();
      next[idx] = { ...prev[idx], ...task };
      return next;
    }
    return [task, ...prev];
  });
}

export async function deleteTask(id) {
  if (!id) return;
  const uid = await cloudMode();

  if (uid) {
    await updateLocalTaskCache(uid, (prev) => prev.filter((t) => t.id !== id));
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('user_id', uid)
          .eq('id', id);
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'deleteTask', id }, e);
      }
    });
  }

  await updateLocalTaskCache(null, (prev) => prev.filter((t) => t.id !== id));
}

async function updateLocalTaskCache(uid, mutator) {
  const key = tasksKey(uid);
  const current = await readLocalArray(key);
  const next = mutator(current);
  await writeLocalArray(key, next);
}

// ── Subjects ───────────────────────────────────────────────────────────────

// Study sessions

async function loadCloudStudySessions(uid) {
  try {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', uid)
      .order('ended_at', { ascending: false });
    if (error) throw error;
    const sessions = (data || []).map(rowToStudySession);
    AsyncStorage.setItem(studySessionsKey(uid), JSON.stringify(sessions)).catch(() => {});
    return sessions;
  } catch (e) {
    console.warn('Supabase loadStudySessions failed, falling back to cache:', e?.message);
    return loadLocalStudySessions(uid);
  }
}

async function loadLocalStudySessions(uid) {
  const cached = await readLocalArray(studySessionsKey(uid));
  return cached.map(normalizeStudySession).filter((session) => session.durationSeconds > 0);
}

export async function loadStudySessions() {
  const uid = await cloudMode();

  if (uid) {
    await flushPendingWrites(uid);
    return loadCloudStudySessions(uid);
  }

  return loadLocalStudySessions(null);
}

export async function upsertStudySession(session) {
  if (!session) return;
  const cleaned = normalizeStudySession(session);
  const uid = await cloudMode();

  if (uid) {
    await updateLocalStudySessionCache(uid, (prev) => {
      const idx = prev.findIndex((item) => item.id === cleaned.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = cleaned;
        return next;
      }
      return [cleaned, ...prev];
    });
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('study_sessions')
          .upsert([studySessionToRow(cleaned, uid)], { onConflict: 'id' });
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'upsertStudySession', session: cleaned }, e);
      }
    });
  }

  await updateLocalStudySessionCache(null, (prev) => {
    const idx = prev.findIndex((item) => item.id === cleaned.id);
    if (idx >= 0) {
      const next = prev.slice();
      next[idx] = cleaned;
      return next;
    }
    return [cleaned, ...prev];
  });
}

export async function deleteStudySession(id) {
  if (!id) return;
  const uid = await cloudMode();

  if (uid) {
    await updateLocalStudySessionCache(uid, (prev) => prev.filter((item) => item.id !== id));
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('study_sessions')
          .delete()
          .eq('user_id', uid)
          .eq('id', id);
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'deleteStudySession', id }, e);
      }
    });
  }

  await updateLocalStudySessionCache(null, (prev) => prev.filter((item) => item.id !== id));
}

async function updateLocalStudySessionCache(uid, mutator) {
  const key = studySessionsKey(uid);
  const current = (await readLocalArray(key)).map(normalizeStudySession);
  const next = mutator(current)
    .filter((session) => session.durationSeconds > 0)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
  await writeLocalArray(key, next);
}

// Subjects

async function loadCloudSubjects(uid) {
  try {
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('user_id', uid)
      .order('name', { ascending: true });
    if (error) throw error;
    const subjects = (data || []).map(rowToSubject).filter(Boolean);
    AsyncStorage.setItem(subjectsKey(uid), JSON.stringify(subjects)).catch(() => {});
    return subjects;
  } catch (e) {
    console.warn('Supabase loadSubjects failed, falling back to cache:', e?.message);
    const cached = await readLocalArray(subjectsKey(uid));
    return cached.map(normalizeSubject).filter(Boolean);
  }
}

async function loadLocalSubjects(uid) {
  const cached = await readLocalArray(subjectsKey(uid));
  return cached.map(normalizeSubject).filter(Boolean);
}

export async function loadSubjects() {
  const uid = await cloudMode();

  if (uid) {
    await migrateLegacyIfNeeded(uid);
    await flushPendingWrites(uid);
    return loadCloudSubjects(uid);
  }

  return loadLocalSubjects(null);
}

// Insert / update a subject. If `previousName` differs from `subject.name`
// (i.e. a rename), the old row is removed first so the (user_id, name) PK
// stays consistent.
export async function upsertSubject(subject, previousName = null) {
  const cleaned = normalizeSubject(subject);
  if (!cleaned) return;
  const uid = await cloudMode();

  const renamed = previousName && previousName !== cleaned.name;

  if (uid) {
    await updateLocalSubjectCache(uid, (prev) => {
      let next = prev.slice();
      if (renamed) next = next.filter((s) => s.name !== previousName);
      const idx = next.findIndex((s) => s.name === cleaned.name);
      if (idx >= 0) next[idx] = cleaned;
      else next.push(cleaned);
      return next;
    });
    return runQueued(async () => {
      try {
        if (renamed) {
          const { error: delErr } = await supabase
            .from('subjects')
            .delete()
            .eq('user_id', uid)
            .eq('name', previousName);
          if (delErr) throw delErr;
        }
        const { error: upErr } = await supabase
          .from('subjects')
          .upsert([subjectToRow(cleaned, uid)], { onConflict: 'user_id,name' });
        if (upErr) throw upErr;
      } catch (e) {
        return queueIfOffline(
          uid,
          { type: 'upsertSubject', subject: cleaned, previousName: renamed ? previousName : null },
          e
        );
      }
    });
  }

  await updateLocalSubjectCache(null, (prev) => {
    let next = prev.slice();
    if (renamed) next = next.filter((s) => s.name !== previousName);
    const idx = next.findIndex((s) => s.name === cleaned.name);
    if (idx >= 0) next[idx] = cleaned;
    else next.push(cleaned);
    return next;
  });
}

export async function deleteSubject(name) {
  if (!name) return;
  const uid = await cloudMode();

  if (uid) {
    await updateLocalSubjectCache(uid, (prev) => prev.filter((s) => s.name !== name));
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('subjects')
          .delete()
          .eq('user_id', uid)
          .eq('name', name);
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'deleteSubject', name }, e);
      }
    });
  }

  await updateLocalSubjectCache(null, (prev) => prev.filter((s) => s.name !== name));
}

async function updateLocalSubjectCache(uid, mutator) {
  const key = subjectsKey(uid);
  const current = (await readLocalArray(key)).map(normalizeSubject).filter(Boolean);
  const next = mutator(current);
  await writeLocalArray(key, next);
}

// ── User name (profile) ────────────────────────────────────────────────────

async function loadCloudProfile(uid) {
  try {
    // NOTE: maybeSingle() (not single()) is intentional. The profile row
    // is created by a database trigger on sign-up, but users that signed
    // up before the trigger was deployed have no row. maybeSingle() lets
    // us return '' in that case rather than surfacing an error -- the
    // first saveUserName() call will then create the row via upsert.
    let { data, error } = await supabase
      .from('profiles')
      .select('id, name, username, avatar_type, avatar_value, created_at, last_online_at')
      .eq('id', uid)
      .maybeSingle();
    if (error && String(error.message || '').includes('last_online_at')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, name, username, avatar_type, avatar_value, created_at')
        .eq('id', uid)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;
    const profile = rowToProfile(data, uid);
    AsyncStorage.setItem(userNameKey(uid), profile.name).catch(() => {});
    writeLocalObject(profileKey(uid), profile).catch(() => {});
    return profile;
  } catch (e) {
    console.warn('Supabase loadProfile failed, falling back to cache:', e?.message);
    try {
      const cached = await readLocalObject(profileKey(uid));
      if (cached) return rowToProfile(cached, uid);
      const name = (await AsyncStorage.getItem(userNameKey(uid))) ?? '';
      return rowToProfile({ id: uid, name }, uid);
    } catch {
      return rowToProfile({ id: uid }, uid);
    }
  }
}

async function loadLocalProfile(uid) {
  try {
    const cached = await readLocalObject(profileKey(uid));
    if (cached) return rowToProfile(cached, uid);
    const name = (await AsyncStorage.getItem(userNameKey(uid))) ?? '';
    return rowToProfile({ id: uid, name }, uid);
  } catch (e) {
    console.warn('Failed to load profile:', e);
    return rowToProfile(uid ? { id: uid } : {}, uid);
  }
}

export async function loadProfile() {
  const uid = await cloudMode();

  if (uid) {
    await flushPendingWrites(uid);
    return loadCloudProfile(uid);
  }

  return loadLocalProfile(null);
}

export async function loadAppData() {
  const uid = await cloudMode();

  if (uid) {
    await migrateLegacyIfNeeded(uid);
    await flushPendingWrites(uid);
    const [tasks, subjects, profile, studySessions] = await Promise.all([
      loadCloudTasks(uid),
      loadCloudSubjects(uid),
      loadCloudProfile(uid),
      loadCloudStudySessions(uid),
    ]);
    return { tasks, subjects, profile, studySessions };
  }

  const [tasks, subjects, profile, studySessions] = await Promise.all([
    readLocalArray(tasksKey(null)),
    loadLocalSubjects(null),
    loadLocalProfile(null),
    loadLocalStudySessions(null),
  ]);
  return { tasks, subjects, profile, studySessions };
}

export async function saveProfile(profile) {
  const uid = await cloudMode();
  const cleaned = normalizeProfile(profile);

  if (uid) {
    const withId = { ...cleaned, id: uid };
    AsyncStorage.setItem(userNameKey(uid), cleaned.name).catch(() => {});
    writeLocalObject(profileKey(uid), withId).catch(() => {});
    return runQueued(async () => {
      try {
        const { error } = await supabase
          .from('profiles')
          .upsert(profileToRow(cleaned, uid), { onConflict: 'id' });
        if (error) throw error;
      } catch (e) {
        return queueIfOffline(uid, { type: 'saveProfile', profile: cleaned }, e);
      }
    });
  }

  try {
    await AsyncStorage.setItem(userNameKey(null), cleaned.name);
    await writeLocalObject(profileKey(null), cleaned);
  } catch (e) {
    console.warn('Failed to save profile:', e);
  }
}

export async function touchProfileOnline() {
  const uid = await cloudMode();
  if (!uid || profileOnlineTouchDisabled) return;

  if (uid !== lastProfileOnlineTouchUserId) {
    lastProfileOnlineTouchUserId = uid;
    lastProfileOnlineTouchAt = 0;
  }

  const nowMs = Date.now();
  if (nowMs - lastProfileOnlineTouchAt < ONLINE_TOUCH_MIN_INTERVAL_MS) return;
  lastProfileOnlineTouchAt = nowMs;

  const lastOnlineAt = new Date(nowMs).toISOString();
  try {
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: uid, last_online_at: lastOnlineAt }, { onConflict: 'id' });
    if (error) throw error;

    const cached = await readLocalObject(profileKey(uid));
    if (cached) {
      writeLocalObject(profileKey(uid), { ...cached, lastOnlineAt }).catch(() => {});
    }
  } catch (e) {
    const message = String(e?.message || '');
    if (message.includes('last_online_at')) {
      profileOnlineTouchDisabled = true;
    }
    console.warn('Supabase update online status failed:', message || e);
  }
}

export async function loadUserName() {
  const profile = await loadProfile();
  return profile.name;
}

export async function saveUserName(name) {
  const profile = await loadProfile();
  return saveProfile({ ...profile, name });
}

export async function searchProfiles(query) {
  const uid = await cloudMode();
  const term = String(query || '').trim();
  if (!uid || term.length < 1) return [];

  const { data, error } = await supabase.rpc('search_profiles', { search_term: term });
  if (error) throw error;
  return (data || []).map((row) => ({
    ...rowToProfile(row, row.id),
    isFriend: !!row.is_friend,
    incomingRequest: !!row.incoming_request,
    outgoingRequest: !!row.outgoing_request,
  }));
}

export async function loadFriends() {
  const uid = await cloudMode();
  if (!uid) return [];

  try {
    const cacheKey = `friends:${uid}`;
    const cached = readFreshRemoteCache(cacheKey);
    if (cached) return cached;
    const { data, error } = await supabase.rpc('list_friends');
    if (error) throw error;
    const friends = (data || []).map((row) => ({
      ...rowToProfile(row, row.id),
      friendedAt: row.friended_at ?? null,
    }));
    writeRemoteCache(cacheKey, friends);
    writeLocalArray(`@simpleapp:friends:${uid}:v1`, friends).catch(() => {});
    return friends;
  } catch (e) {
    console.warn('Supabase loadFriends failed, falling back to cache:', e?.message);
    return readLocalArray(`@simpleapp:friends:${uid}:v1`);
  }
}

export async function loadCachedFriends() {
  const uid = await cloudMode();
  if (!uid) return [];
  return readLocalArray(`@simpleapp:friends:${uid}:v1`);
}

export async function loadFriendStudyProfile(friendId) {
  const uid = await cloudMode();
  if (!uid || !friendId) return null;

  const cacheKey = `friendStudy:${uid}:${friendId}`;
  const cached = readFreshRemoteCache(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('get_friend_study_profile', {
    friend_profile_id: friendId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const profile = rowToProfile(row, row.id || friendId);
  const rawSessions = Array.isArray(row.study_sessions)
    ? row.study_sessions
    : Array.isArray(row.sessions)
      ? row.sessions
      : [];
  const studySessions = rawSessions.map(rowToStudySession);
  const result = { profile, studySessions };
  writeRemoteCache(cacheKey, result);
  return result;
}

export async function loadFriendRequests() {
  const uid = await cloudMode();
  if (!uid) return { incoming: [], outgoing: [] };

  try {
    const cacheKey = `friendRequests:${uid}`;
    const cached = readFreshRemoteCache(cacheKey);
    if (cached) return cached;
    const { data, error } = await supabase.rpc('list_friend_requests');
    if (error) throw error;
    const items = (data || []).map((row) => ({
      ...rowToProfile(row, row.id),
      requesterId: row.requester_id ?? null,
      addresseeId: row.addressee_id ?? null,
      direction: row.direction ?? 'incoming',
      createdAt: row.created_at ?? null,
    }));
    const grouped = {
      incoming: items.filter((item) => item.direction === 'incoming'),
      outgoing: items.filter((item) => item.direction === 'outgoing'),
    };
    writeRemoteCache(cacheKey, grouped);
    writeLocalObject(`@simpleapp:friendRequests:${uid}:v1`, grouped).catch(() => {});
    return grouped;
  } catch (e) {
    console.warn('Supabase loadFriendRequests failed, falling back to cache:', e?.message);
    return (
      (await readLocalObject(`@simpleapp:friendRequests:${uid}:v1`)) ||
      { incoming: [], outgoing: [] }
    );
  }
}

export async function loadCachedFriendRequests() {
  const uid = await cloudMode();
  if (!uid) return { incoming: [], outgoing: [] };
  return (
    (await readLocalObject(`@simpleapp:friendRequests:${uid}:v1`)) ||
    { incoming: [], outgoing: [] }
  );
}

export async function addFriend(friendId) {
  const uid = await cloudMode();
  if (!uid || !friendId || friendId === uid) return;
  const { error } = await supabase.rpc('add_friend', { friend_profile_id: friendId });
  if (error) throw error;
  clearRemoteCache(`friends:${uid}`, `friendRequests:${uid}`);
}

export async function acceptFriendRequest(requesterId) {
  const uid = await cloudMode();
  if (!uid || !requesterId || requesterId === uid) return;
  const { error } = await supabase.rpc('accept_friend_request', {
    requester_profile_id: requesterId,
  });
  if (error) throw error;
  clearRemoteCache(`friends:${uid}`, `friendRequests:${uid}`);
}

export async function declineFriendRequest(requesterId) {
  const uid = await cloudMode();
  if (!uid || !requesterId || requesterId === uid) return;
  const { error } = await supabase.rpc('decline_friend_request', {
    requester_profile_id: requesterId,
  });
  if (error) throw error;
  clearRemoteCache(`friendRequests:${uid}`);
}

export async function removeFriend(friendId) {
  const uid = await cloudMode();
  if (!uid || !friendId) return;
  const { error } = await supabase.rpc('remove_friend', { friend_profile_id: friendId });
  if (error) throw error;
  clearRemoteCache(`friends:${uid}`, `friendRequests:${uid}`);
}

// Chat rooms

const CHAT_CACHE_PREFIX = '@simpleapp:chats:';
const CHAT_MESSAGES_CACHE_PREFIX = '@simpleapp:chatMessages:';

function chatRoomsKey(userId) {
  return `${CHAT_CACHE_PREFIX}${userId}:v1`;
}

function chatMessagesKey(userId, roomId) {
  return `${CHAT_MESSAGES_CACHE_PREFIX}${userId}:${roomId}:v1`;
}

function rowToChatRoom(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    expiresAt: row.expires_at ?? null,
    isPinned: !!row.is_pinned,
    lastReadAt: row.last_read_at ?? null,
    lastMessageBody: row.last_message_body ?? null,
    lastMessageAt: row.last_message_at ?? null,
    unreadCount: Number(row.unread_count ?? 0),
    members: Array.isArray(row.members)
      ? row.members.map((m) => ({
          ...rowToProfile(m, m?.id),
          isFriend: !!m?.is_friend,
          incomingRequest: !!m?.incoming_request,
          outgoingRequest: !!m?.outgoing_request,
        }))
      : [],
  };
}

function rowToChatMessage(row) {
  const messageType = row.message_type ?? row.kind ?? 'message';
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    body: row.body ?? '',
    createdAt: row.created_at ?? null,
    type: messageType,
    isSystem: messageType === 'system',
    sender: rowToProfile(
      {
        id: row.sender_id,
        name: row.sender_name,
        username: row.sender_username,
        avatar_type: row.sender_avatar_type,
        avatar_value: row.sender_avatar_value,
      },
      row.sender_id
    ),
  };
}

export async function loadChatRooms() {
  const uid = await cloudMode();
  if (!uid) return [];

  try {
    const cacheKey = `chatRooms:${uid}`;
    const cached = readFreshRemoteCache(cacheKey);
    if (cached) return cached;
    const { data, error } = await supabase.rpc('list_chat_rooms');
    if (error) throw error;
    const rooms = (data || []).map(rowToChatRoom);
    writeRemoteCache(cacheKey, rooms);
    writeLocalArray(chatRoomsKey(uid), rooms).catch(() => {});
    return rooms;
  } catch (e) {
    console.warn('Supabase loadChatRooms failed, falling back to cache:', e?.message);
    return readLocalArray(chatRoomsKey(uid));
  }
}

export async function loadCachedChatRooms() {
  const uid = await cloudMode();
  if (!uid) return [];
  return readLocalArray(chatRoomsKey(uid));
}

export async function createChatRoom({ name, friendIds, lifetimeHours }) {
  const uid = await cloudMode();
  if (!uid) throw new Error('Sign in to create chats.');
  const { data, error } = await supabase.rpc('create_chat_room', {
    room_name: String(name || '').trim(),
    friend_ids: Array.isArray(friendIds) ? friendIds : [],
    lifetime_hours: Number(lifetimeHours) || 24,
  });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`);
  return data;
}

export async function renameChatRoom(roomId, name) {
  const uid = await cloudMode();
  if (!uid || !roomId) return;
  const { error } = await supabase.rpc('rename_chat_room', {
    room_profile_id: roomId,
    room_name: String(name || '').trim(),
  });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`, `chatMessages:${uid}:${roomId}`);
}

export async function addChatParticipants(roomId, friendIds) {
  const uid = await cloudMode();
  if (!uid || !roomId) return;
  const { error } = await supabase.rpc('add_chat_participants', {
    room_profile_id: roomId,
    friend_ids: Array.isArray(friendIds) ? friendIds : [],
  });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`, `chatMessages:${uid}:${roomId}`);
}

export async function loadChatMessages(roomId) {
  const uid = await cloudMode();
  if (!uid || !roomId) return [];

  try {
    const cacheKey = `chatMessages:${uid}:${roomId}`;
    const cached = readFreshRemoteCache(cacheKey);
    if (cached) return cached;
    const { data, error } = await supabase.rpc('list_chat_messages', {
      room_profile_id: roomId,
    });
    if (error) throw error;
    const messages = (data || []).map(rowToChatMessage);
    writeRemoteCache(cacheKey, messages);
    writeLocalArray(chatMessagesKey(uid, roomId), messages).catch(() => {});
    return messages;
  } catch (e) {
    console.warn('Supabase loadChatMessages failed, falling back to cache:', e?.message);
    return readLocalArray(chatMessagesKey(uid, roomId));
  }
}

export async function loadCachedChatMessages(roomId) {
  const uid = await cloudMode();
  if (!uid || !roomId) return [];
  return readLocalArray(chatMessagesKey(uid, roomId));
}

export async function sendChatMessage(roomId, body) {
  const uid = await cloudMode();
  if (!uid || !roomId) return null;
  const { data, error } = await supabase.rpc('send_chat_message', {
    room_profile_id: roomId,
    message_body: String(body || ''),
  });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`, `chatMessages:${uid}:${roomId}`);
  return data;
}

export async function markChatRead(roomId) {
  const uid = await cloudMode();
  if (!uid || !roomId) return;
  const { error } = await supabase.rpc('mark_chat_read', { room_profile_id: roomId });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`);
}

export async function setChatPinned(roomId, pinned) {
  const uid = await cloudMode();
  if (!uid || !roomId) return;
  const { error } = await supabase.rpc('set_chat_pinned', {
    room_profile_id: roomId,
    pinned: !!pinned,
  });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`);
}

export async function hideChatRoom(roomId) {
  const uid = await cloudMode();
  if (!uid || !roomId) return;
  const { error } = await supabase.rpc('hide_chat_room', { room_profile_id: roomId });
  if (error) throw error;
  clearRemoteCache(`chatRooms:${uid}`, `chatMessages:${uid}:${roomId}`);
}

export function subscribeToChatRoom(roomId, onChange) {
  if (!supabase || !roomId || typeof onChange !== 'function') return () => {};
  const channel = supabase
    .channel(`chat-room-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${roomId}`,
      },
      () => {
        currentUserId()
          .then((uid) => {
            if (uid) clearRemoteCache(`chatRooms:${uid}`, `chatMessages:${uid}:${roomId}`);
          })
          .finally(() => onChange());
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToFriendRequests(userId, onChange) {
  if (!supabase || !userId || typeof onChange !== 'function') return () => {};
  const channel = supabase
    .channel(`friend-requests-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'friend_requests',
        filter: `addressee_id=eq.${userId}`,
      },
      (payload) => {
        const next = payload?.new;
        clearRemoteCache(`friendRequests:${userId}`);
        if (!next || next.status === 'pending') onChange(next || payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToChatNotifications(userId, onMessage) {
  if (!supabase || !userId || typeof onMessage !== 'function') return () => {};
  const channel = supabase
    .channel(`chat-notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const row = payload?.new;
        if (row?.sender_id && row.sender_id !== userId) {
          clearRemoteCache(`chatRooms:${userId}`);
          onMessage(row);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

const CHANGELOG_SEEN_KEY = '@simpleapp:changelog:lastSeen:v1';

// Used by the in-app changelog to decide whether to show an "unread" dot.

export async function loadChangelogLastSeen() {
  try {
    return (await AsyncStorage.getItem(CHANGELOG_SEEN_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function saveChangelogLastSeen(version) {
  if (!version) return;
  try {
    await AsyncStorage.setItem(CHANGELOG_SEEN_KEY, version);
  } catch (e) {
    console.warn('Failed to persist changelog seen version:', e?.message);
  }
}

// ── Misc ───────────────────────────────────────────────────────────────────

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
