import React, { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../shared/theme';
import { todayISO, daysBetween, dueStatus } from '../shared/utils/dates';
import {
  upsertTask,
  deleteTask,
  newId,
} from '../features/tasks/taskRepository';
import {
  upsertSubject,
  deleteSubject,
} from '../features/subjects/subjectRepository';
import {
  saveProfile,
} from '../features/profile/profileRepository';
import {
  deleteStudySession,
  normalizeStudySession,
  upsertStudySession,
} from '../features/study/studyRepository';
import {
  loadChangelogLastSeen,
} from '../features/changelog/changelogRepository';
import {
  loadCachedFriendRequests,
  subscribeToFriendRequests,
} from '../features/friends/friendsRepository';
import {
  loadCachedChatRooms,
  subscribeToChatNotifications,
} from '../features/chat/chatRepository';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { loadAppData } from '../services/storage';
import { CHANGELOG, latestChangelogVersion } from '../features/changelog/changelog';
import { normalizeProfile, publicName } from '../shared/profile';

import TaskCard from '../features/tasks/components/TaskCard';
import FilterTabs from '../shared/components/FilterTabs';
import EmptyState from '../shared/components/EmptyState';
import {
  BottomActionBar,
  DESKTOP_SIDEBAR_ITEM_KEYS,
  DesktopSidebar,
  DesktopVersionBadge,
  NotificationBanner,
  NotificationsPanel,
  ProgressCard,
  SortControls,
  SyncErrorBanner,
  VersionBadge,
} from './AppChrome';
import { emptyIconFor, emptySubtitleFor, emptyTitleFor, greeting } from './appCopy';
import { notificationRoomTitle, shortNotificationBody } from './notifications';
import { compareTasks, STATUS_ONLY_FILTERS } from '../features/tasks/taskSorting';
import {
  isLocalAdminSession,
  LOCAL_ADMIN_SESSION_STORAGE_KEY,
} from '../features/auth/localAdminCredentials';

const ENHANCE_MOTION_STORAGE_KEY = '@schoolapp:enhanceMotion:v1';

const TaskForm = React.lazy(() => import('../features/tasks/components/TaskForm'));
const SubjectManager = React.lazy(() => import('../features/subjects/SubjectManager'));
const SettingsSheet = React.lazy(() => import('../features/settings/SettingsSheet'));
const ProfileSheet = React.lazy(() => import('../features/profile/ProfileSheet'));
const ProfileOnboarding = React.lazy(() => import('../features/profile/ProfileOnboarding'));
const ChangelogSheet = React.lazy(() => import('../features/changelog/ChangelogSheet'));
const FriendsSheet = React.lazy(() => import('../features/friends/FriendsSheet'));
const ChatSheet = React.lazy(() => import('../features/chat/ChatSheet'));
const StudyPage = React.lazy(() => import('../features/study/StudyPage'));

const DESKTOP_ROUTE_FALLBACK = { page: 'tasks', chatRoomId: null };

function safeDecodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function currentDesktopRoute() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return DESKTOP_ROUTE_FALLBACK;
  return desktopRouteFromPath(window.location.pathname);
}

function desktopRouteFromPath(pathname) {
  const normalized = `/${String(pathname || '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')}` || '/';
  if (normalized === '/' || normalized === '') return DESKTOP_ROUTE_FALLBACK;
  if (normalized === '/login') return DESKTOP_ROUTE_FALLBACK;
  if (normalized === '/settings') return { page: 'settings', chatRoomId: null };
  if (normalized === '/chats') return { page: 'chats', chatRoomId: null };
  if (normalized === '/study') return { page: 'study', chatRoomId: null };
  if (normalized === '/subjects') return { page: 'subjects', chatRoomId: null };
  if (normalized === '/friends') return { page: 'friends', chatRoomId: null };

  const chatMatch = normalized.match(/^\/chats\/([^/]+)$/);
  if (chatMatch) {
    return { page: 'chats', chatRoomId: safeDecodePathSegment(chatMatch[1]) };
  }

  return DESKTOP_ROUTE_FALLBACK;
}

function desktopPathFor(page, chatRoomId = null) {
  if (page === 'login') return '/login';
  if (page === 'settings') return '/settings';
  if (page === 'study') return '/study';
  if (page === 'subjects') return '/subjects';
  if (page === 'friends') return '/friends';
  if (page === 'chats') {
    return chatRoomId ? `/chats/${encodeURIComponent(chatRoomId)}` : '/chats';
  }
  return '/';
}

function writeDesktopPath(page, chatRoomId = null, { replace = false } = {}) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const nextPath = desktopPathFor(page, chatRoomId);
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]?.(null, '', nextPath);
}

export default function SignedInApp({ session, setSession }) {
  const { colors, spacing, radius, typography, shadow, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );
  const isDesktopWeb = Platform.OS === 'web' && width >= 900;
  const initialDesktopRouteRef = useRef(null);
  if (initialDesktopRouteRef.current == null) {
    initialDesktopRouteRef.current = currentDesktopRoute();
  }

  const [tasks, setTasks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [studySessions, setStudySessions] = useState([]);
  const [profile, setProfile] = useState(() => normalizeProfile());
  const [loading, setLoading] = useState(true);

  const localAdminSession = isLocalAdminSession(session);

  const [filter, setFilter] = useState('all');
  const [sortMode, setSortMode] = useState('due_date');
  const [editingTask, setEditingTask] = useState(null);
  const [formVisible, setFormVisible] = useState(false);
  const [subjectMgrVisible, setSubjectMgrVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [friendsVisible, setFriendsVisible] = useState(false);
  const [chatsVisible, setChatsVisible] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [changelogVisible, setChangelogVisible] = useState(false);
  const [hasUnreadChangelog, setHasUnreadChangelog] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [activeBanner, setActiveBanner] = useState(null);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [desktopPage, setDesktopPage] = useState(initialDesktopRouteRef.current.page);
  const [desktopChatRoomId, setDesktopChatRoomId] = useState(initialDesktopRouteRef.current.chatRoomId);
  const [renderedDesktopPage, setRenderedDesktopPage] = useState(initialDesktopRouteRef.current.page);
  const previousDesktopPageRef = useRef(initialDesktopRouteRef.current.page);
  const pendingDesktopPageRef = useRef(null);
  const [desktopTaskSubjectsVisible, setDesktopTaskSubjectsVisible] = useState(false);
  const [mobilePage, setMobilePage] = useState('tasks');
  const [enhanceMotion, setEnhanceMotion] = useState(false);

  const [taskFormResetKey, setTaskFormResetKey] = useState(0);
  const [resumeFormAfterSubjects, setResumeFormAfterSubjects] = useState(false);
  const desktopPageMotionRef = useRef(null);
  if (desktopPageMotionRef.current == null) desktopPageMotionRef.current = new Animated.Value(1);
  const desktopPageMotion = desktopPageMotionRef.current;
  const desktopSidebarProgressRef = useRef(null);
  if (desktopSidebarProgressRef.current == null) {
    desktopSidebarProgressRef.current = new Animated.Value(desktopSidebarCollapsed ? 0 : 1);
  }
  const desktopSidebarProgress = desktopSidebarProgressRef.current;
  const desktopMainMarginLeft = desktopSidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [96, 248],
  });
  const desktopPageDirection = useMemo(() => {
    const previousIndex = DESKTOP_SIDEBAR_ITEM_KEYS.indexOf(previousDesktopPageRef.current);
    const nextIndex = DESKTOP_SIDEBAR_ITEM_KEYS.indexOf(pendingDesktopPageRef.current || renderedDesktopPage);
    if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return 1;
    return nextIndex > previousIndex ? 1 : -1;
  }, [renderedDesktopPage]);
  const notifiedFriendRequestsRef = useRef(new Set());
  const notifiedMessagesRef = useRef(new Set());

  const applyDesktopRoute = useCallback((route) => {
    setDesktopPage(route.page);
    setDesktopChatRoomId(route.chatRoomId);
    setSettingsVisible(false);
    setChatsVisible(false);
  }, []);

  const navigateDesktopPage = useCallback(
    (page, chatRoomId = null, options = {}) => {
      const route = { page, chatRoomId };
      applyDesktopRoute(route);
      writeDesktopPath(page, chatRoomId, options);
    },
    [applyDesktopRoute]
  );

  useEffect(() => {
    Animated.timing(desktopSidebarProgress, {
      toValue: desktopSidebarCollapsed ? 0 : 1,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [desktopSidebarCollapsed, desktopSidebarProgress]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      if (isDesktopWeb) applyDesktopRoute(currentDesktopRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyDesktopRoute, isDesktopWeb]);

  useEffect(() => {
    if (!isDesktopWeb) return;
    applyDesktopRoute(currentDesktopRoute());
  }, [applyDesktopRoute, isDesktopWeb]);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(ENHANCE_MOTION_STORAGE_KEY)
      .then((value) => {
        if (mounted) setEnhanceMotion(value === 'true');
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleEnhanceMotionChange = useCallback((value) => {
    setEnhanceMotion(value);
    AsyncStorage.setItem(ENHANCE_MOTION_STORAGE_KEY, value ? 'true' : 'false').catch(() => {});
  }, []);

  useEffect(() => {
    if (STATUS_ONLY_FILTERS.has(filter) && sortMode === 'not_done_first') {
      setSortMode('due_date');
    }
  }, [filter, sortMode]);

  useEffect(() => {
    if (renderedDesktopPage === desktopPage) return;
    if (!enhanceMotion || !isDesktopWeb) {
      previousDesktopPageRef.current = desktopPage;
      pendingDesktopPageRef.current = null;
      setRenderedDesktopPage(desktopPage);
      desktopPageMotion.setValue(1);
      return;
    }
    pendingDesktopPageRef.current = desktopPage;
    Animated.timing(desktopPageMotion, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(() => {
      const nextPage = pendingDesktopPageRef.current || desktopPage;
      setRenderedDesktopPage(nextPage);
      desktopPageMotion.setValue(0);
      Animated.timing(desktopPageMotion, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        previousDesktopPageRef.current = nextPage;
        pendingDesktopPageRef.current = null;
      });
    });
  }, [desktopPage, desktopPageMotion, enhanceMotion, isDesktopWeb, renderedDesktopPage]);

  // Load user data whenever the active identity changes (sign in / sign out /
  // first boot in local mode). Re-keying on session.user?.id guarantees a
  // fresh load for the new user.
  const sessionUserId = localAdminSession ? null : session?.user?.id ?? null;
  useEffect(() => {
    // Skip while we're still determining the initial session.
    if (session === undefined) return;
    // If Supabase is configured but there's no session, don't load anything yet.
    if (isSupabaseConfigured && !session) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { tasks: t, subjects: s, profile: p, studySessions: ss = [] } = await loadAppData();
      if (cancelled) return;
      setTasks(t);
      setSubjects(s);
      setStudySessions(ss);
      setProfile(p);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, sessionUserId]);

  const addNotification = useCallback((notification) => {
    const next = {
      id: notification.id || newId(),
      type: notification.type || 'general',
      title: notification.title || 'Notification',
      body: notification.body || '',
      createdAt: notification.createdAt || new Date().toISOString(),
    };
    setNotifications((prev) => [next, ...prev.filter((item) => item.id !== next.id)].slice(0, 50));
    setActiveBanner(next);
  }, []);

  const dismissActiveBanner = useCallback(() => {
    setActiveBanner(null);
  }, []);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const unsubscribeRequests = subscribeToFriendRequests(sessionUserId, async (row) => {
      const requestKey = row?.requester_id
        ? `${row.requester_id}:${row.addressee_id || sessionUserId}`
        : null;
      if (!requestKey || notifiedFriendRequestsRef.current.has(requestKey)) return;
      notifiedFriendRequestsRef.current.add(requestKey);

      try {
        const requests = await loadCachedFriendRequests();
        const person = requests.incoming.find((item) => item.id === row.requester_id);
        addNotification({
          id: `friend:${requestKey}`,
          type: 'friend',
          title: 'New friend request',
          body: `${publicName(person)} wants to be friends.`,
          createdAt: row.created_at,
        });
      } catch {
        addNotification({
          id: `friend:${requestKey}`,
          type: 'friend',
          title: 'New friend request',
          body: 'Someone wants to be friends.',
          createdAt: row?.created_at,
        });
      }
    });

    const unsubscribeMessages = subscribeToChatNotifications(sessionUserId, async (row) => {
      if (!row?.id || notifiedMessagesRef.current.has(row.id)) return;
      notifiedMessagesRef.current.add(row.id);

      try {
        const rooms = await loadCachedChatRooms();
        const room = rooms.find((item) => item.id === row.room_id);
        const sender = (room.members || []).find((member) => member.id === row.sender_id);
        const chatName = room ? notificationRoomTitle(room, sessionUserId) : 'a chat';
        const senderName = publicName(sender) || 'Someone';
        addNotification({
          id: `message:${row.id}`,
          type: 'message',
          title: `New message from ${senderName} in ${chatName}`,
          body: shortNotificationBody(row.body),
          createdAt: row.created_at,
        });
      } catch {
        addNotification({
          id: `message:${row.id}`,
          type: 'message',
          title: 'New message',
          body: shortNotificationBody(row.body),
          createdAt: row?.created_at,
        });
      }
    });

    return () => {
      unsubscribeRequests?.();
      unsubscribeMessages?.();
    };
  }, [sessionUserId, addNotification]);

  // Compute "is the latest changelog version unseen?" once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await loadChangelogLastSeen();
      const latest = latestChangelogVersion();
      if (cancelled) return;
      setHasUnreadChangelog(Boolean(latest && seen !== latest));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const today = todayISO();
    const c = { all: tasks.length, incomplete: 0, today: 0, upcoming: 0, overdue: 0, complete: 0 };
    for (const t of tasks) {
      if (t.done) {
        c.complete++;
        continue;
      }
      c.incomplete++;
      if (!t.dueDate) continue;
      const diff = daysBetween(today, t.dueDate);
      if (diff < 0) c.overdue++;
      else if (diff === 0) c.today++;
      else c.upcoming++;
    }
    return c;
  }, [tasks]);

  const filtered = useMemo(() => {
    // All filter branches now route through dueStatus so future changes
    // (e.g. a grace period for "overdue") propagate uniformly.
    const matches = tasks.filter((t) => {
      const status = dueStatus(t.dueDate, t.done);
      switch (filter) {
        case 'incomplete':
          return !t.done;
        case 'today':
          return status === 'today';
        case 'upcoming':
          // "upcoming" = anything in the future that isn't overdue/today/done.
          return !t.done && (status === 'soon' || status === 'future');
        case 'overdue':
          return status === 'overdue';
        case 'complete':
          return t.done;
        case 'all':
        default:
          return true;
      }
    });
    return matches.slice().sort((a, b) => compareTasks(a, b, sortMode));
  }, [tasks, filter, sortMode]);

  // OPEN tasks per subject -- mirrors the "tasks remaining" UX we
  // expose on the subject row. Done tasks are explicitly excluded.
  const taskCountsBySubject = useMemo(() => {
    const out = {};
    for (const t of tasks) {
      if (!t.subject || t.done) continue;
      out[t.subject] = (out[t.subject] ?? 0) + 1;
    }
    return out;
  }, [tasks]);

  const progress = useMemo(() => {
    const doneCount = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    return { doneCount, total, pct };
  }, [tasks]);

  const openNewTask = () => {
    setEditingTask(null);
    setDesktopTaskSubjectsVisible(false);
    setTaskFormResetKey((k) => k + 1);
    setFormVisible(true);
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    setDesktopTaskSubjectsVisible(false);
    setTaskFormResetKey((k) => k + 1);
    setFormVisible(true);
  };

  const closeForm = () => {
    setFormVisible(false);
    setEditingTask(null);
    setResumeFormAfterSubjects(false);
    setDesktopTaskSubjectsVisible(false);
  };

  const reportSyncError = useCallback((action, error) => {
    const message = error?.message || 'Please check your connection and try again.';
    setSyncError(`Could not ${action}. ${message}`);
  }, []);

  const persistTask = useCallback(
    (task, action = 'save task') => {
      upsertTask(task)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError(action, e));
    },
    [reportSyncError]
  );

  const persistDeleteTask = useCallback(
    (id) => {
      deleteTask(id)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('delete task', e));
    },
    [reportSyncError]
  );

  const persistSubject = useCallback(
    (subject, previousName = null) => {
      upsertSubject(subject, previousName)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('save subject', e));
    },
    [reportSyncError]
  );

  const persistDeleteSubject = useCallback(
    (name) => {
      deleteSubject(name)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('delete subject', e));
    },
    [reportSyncError]
  );

  const persistProfile = useCallback(
    (nextProfile) => {
      return saveProfile(nextProfile)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('save profile', e));
    },
    [reportSyncError]
  );

  const persistStudySession = useCallback(
    (session) => {
      return upsertStudySession(session)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('save study session', e));
    },
    [reportSyncError]
  );

  const persistDeleteStudySession = useCallback(
    (id) => {
      return deleteStudySession(id)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('delete study session', e));
    },
    [reportSyncError]
  );

  const handleProfileChange = useCallback(
    (nextProfile) => {
      const cleaned = normalizeProfile(nextProfile);
      setProfile(cleaned);
      return persistProfile(cleaned);
    },
    [persistProfile]
  );

  const completeProfileOnboarding = useCallback(
    async (nextProfile) => {
      const cleaned = normalizeProfile(nextProfile);
      try {
        await saveProfile(cleaned);
        setSyncError(null);
        setProfile(cleaned);
      } catch (e) {
        reportSyncError('save profile', e);
        throw e;
      }
    },
    [reportSyncError]
  );

  // ── Per-row mutations ─────────────────────────────────────────────────────
  // Each handler updates local state AND issues a single targeted write to
  // storage. This replaces the bulk "save the entire table" pattern that
  // upserted every row on every keystroke.

  const handleSaveTask = useCallback(
    (values) => {
      if (editingTask) {
        const updated = { ...editingTask, ...values };
        setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? updated : t)));
        persistTask(updated);
      } else {
        const newTask = {
          id: newId(),
          title: values.title,
          description: values.description ?? null,
          subject: values.subject,
          dueDate: values.dueDate,
          done: false,
          createdAt: Date.now(),
        };
        setTasks((prev) => [newTask, ...prev]);
        persistTask(newTask);
      }
      closeForm();
    },
    [editingTask, persistTask]
  );

  const handleDeleteTask = useCallback(() => {
    if (!editingTask) return;
    const id = editingTask.id;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    persistDeleteTask(id);
    closeForm();
  }, [editingTask, persistDeleteTask]);

  const toggleDone = useCallback((id) => {
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const changed = next.find((t) => t.id === id);
      if (changed) persistTask(changed, 'update task');
      return next;
    });
  }, [persistTask]);

  const quickDeleteTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    persistDeleteTask(id);
  }, [persistDeleteTask]);

  const handleSaveStudySession = useCallback(
    (session) => {
      const cleaned = normalizeStudySession(session);
      setStudySessions((prev) => {
        const idx = prev.findIndex((item) => item.id === cleaned.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = cleaned;
          return next.sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
        }
        return [cleaned, ...prev];
      });
      persistStudySession(cleaned);
    },
    [persistStudySession]
  );

  const handleDeleteStudySession = useCallback(
    (id) => {
      setStudySessions((prev) => prev.filter((item) => item.id !== id));
      persistDeleteStudySession(id);
    },
    [persistDeleteStudySession]
  );

  // SubjectManager passes us the full next array. Diff it against current
  // state so we can issue per-row writes. Renames keep task tags attached;
  // true deletions clear the tag from affected tasks.
  const updateSubjects = useCallback(
    (nextSubjects, change = {}) => {
      const renamedFrom =
        change.renamedFrom && change.renamedFrom !== change.renamedTo
          ? change.renamedFrom
          : null;
      const renamedTo = renamedFrom ? change.renamedTo : null;
      const prevByName = new Map(subjects.map((s) => [s.name, s]));
      const nextByName = new Map(nextSubjects.map((s) => [s.name, s]));

      const removedNames = [...prevByName.keys()].filter(
        (n) => !nextByName.has(n) && n !== renamedFrom
      );
      const addedOrChanged = [...nextByName.entries()].filter(
        ([name, s]) =>
          !prevByName.has(name) ||
          name === renamedTo ||
          !subjectShallowEqual(prevByName.get(name), s)
      );

      if (renamedFrom && renamedTo) {
        setTasks((prev) => {
          const updates = [];
          const next = prev.map((t) => {
            if (t.subject === renamedFrom) {
              const renamed = { ...t, subject: renamedTo };
              updates.push(renamed);
              return renamed;
            }
            return t;
          });
          updates.forEach((u) => persistTask(u, 'update task subject'));
          return next;
        });
      }

      if (removedNames.length > 0) {
        const removedSet = new Set(removedNames);
        setTasks((prev) => {
          const updates = [];
          const next = prev.map((t) => {
            if (t.subject && removedSet.has(t.subject)) {
              const cleared = { ...t, subject: null };
              updates.push(cleared);
              return cleared;
            }
            return t;
          });
          // Persist the updates outside the setter (per-row).
          updates.forEach((u) => persistTask(u, 'clear deleted subject from task'));
          return next;
        });
      }

      // Persist subject mutations.
      removedNames.forEach((name) => persistDeleteSubject(name));
      addedOrChanged.forEach(([name, s]) => {
        persistSubject(s, name === renamedTo ? renamedFrom : null);
      });

      setSubjects(nextSubjects);
    },
    [subjects, persistTask, persistDeleteSubject, persistSubject]
  );

  const handleSignOut = useCallback(async () => {
    if (localAdminSession) {
      await AsyncStorage.removeItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
      setSession(null);
    } else if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Sign out failed:', e?.message);
      }
    }
    // Clear in-memory state ONLY -- we never call saveTasks([]) here, which
    // in cloud mode would now re-route through cloudMode() === null and
    // silently overwrite legacy local data. Closing the sheet is enough.
    setTasks([]);
    setSubjects([]);
    setStudySessions([]);
    setProfile(normalizeProfile());
    setProfileVisible(false);
    setSettingsVisible(false);
    setFriendsVisible(false);
    setChatsVisible(false);
    setDesktopPage('tasks');
    setMobilePage('tasks');
    setDesktopChatRoomId(null);
    setRenderedDesktopPage('tasks');
    previousDesktopPageRef.current = 'tasks';
    pendingDesktopPageRef.current = null;
    writeDesktopPath(isSupabaseConfigured ? 'login' : 'tasks', null, { replace: true });
    setNotificationsVisible(false);
    setNotifications([]);
    setActiveBanner(null);
    notifiedFriendRequestsRef.current.clear();
    notifiedMessagesRef.current.clear();
    setLoading(false);
  }, [localAdminSession]);

  const openChangelog = useCallback(() => {
    // The sheet itself persists last-seen on open, so clearing the local
    // dot here keeps the UI in sync without an extra round-trip.
    setHasUnreadChangelog(false);
    setChangelogVisible(true);
  }, []);

  const openSubjects = useCallback(() => {
    if (isDesktopWeb) navigateDesktopPage('subjects');
    else setSubjectMgrVisible(true);
  }, [isDesktopWeb, navigateDesktopPage]);

  const openStudy = useCallback(() => {
    if (isDesktopWeb) navigateDesktopPage('study');
    else setMobilePage('study');
  }, [isDesktopWeb, navigateDesktopPage]);

  const openFriends = useCallback(() => {
    if (isDesktopWeb) navigateDesktopPage('friends');
    else setFriendsVisible(true);
  }, [isDesktopWeb, navigateDesktopPage]);

  const openChats = useCallback(() => {
    if (isDesktopWeb) navigateDesktopPage('chats');
    else setChatsVisible(true);
  }, [isDesktopWeb, navigateDesktopPage]);

  const openSettings = useCallback(() => {
    if (isDesktopWeb) navigateDesktopPage('settings');
    else setSettingsVisible(true);
  }, [isDesktopWeb, navigateDesktopPage]);

  const desktopHeaderTitle =
    desktopPage === 'subjects'
      ? 'Subjects'
      : desktopPage === 'study'
        ? 'Study'
        : desktopPage === 'friends'
          ? 'Friends'
          : desktopPage === 'settings'
            ? 'Settings'
            : desktopPage === 'chats'
              ? 'Chats'
              : 'Your tasks';
  const desktopHeaderKicker =
    desktopPage === 'tasks' ? greeting(publicName(profile)) : desktopPage;

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <LoadingSkeleton styles={styles} isDesktopWeb={isDesktopWeb} />
      </SafeAreaView>
    );
  }

  const needsProfileOnboarding =
    !!sessionUserId && !localAdminSession && (!profile.name.trim() || !profile.username);

  if (needsProfileOnboarding) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Suspense fallback={<LoadingSkeleton styles={styles} isDesktopWeb={isDesktopWeb} />}>
          <ProfileOnboarding
            profile={profile}
            onComplete={completeProfileOnboarding}
          />
        </Suspense>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {isDesktopWeb ? (
        <DesktopSidebar
          collapsed={desktopSidebarCollapsed}
          progress={desktopSidebarProgress}
          profile={profile}
          activePage={desktopPage}
          onToggle={() => setDesktopSidebarCollapsed((value) => !value)}
          onTasks={() => navigateDesktopPage('tasks')}
          onStudy={openStudy}
          onSubjects={openSubjects}
          onFriends={openFriends}
          onChats={openChats}
          onProfile={() => setProfileVisible(true)}
          styles={styles}
          shadow={shadow}
        />
      ) : null}

      <Animated.View
        style={[
          isDesktopWeb ? styles.desktopMain : styles.mobileMain,
          isDesktopWeb && { marginLeft: desktopMainMarginLeft },
        ]}
      >
        {isDesktopWeb ? (
          <View style={[styles.header, styles.desktopHeader]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{desktopHeaderKicker}</Text>
              <Text style={styles.headerTitle}>{desktopHeaderTitle}</Text>
            </View>
            <View style={styles.headerActions}>
              <DesktopVersionBadge styles={styles} />
              <Pressable
                onPress={openNewTask}
                style={({ pressed, hovered }) => [
                  styles.desktopAddBtn,
                  hovered && styles.desktopAddBtnHovered,
                  pressed && styles.desktopAddBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add task"
              >
                <Text style={styles.desktopAddText}>+ Add task</Text>
              </Pressable>
              <Pressable
                onPress={() => setNotificationsVisible(true)}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel="Open notifications"
              >
                <Text style={styles.iconBtnText}>{'\u{1F514}'}</Text>
                {notifications.length > 0 ? (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>
                      {notifications.length > 9 ? '9+' : notifications.length}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                onPress={openSettings}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel="Open settings"
              >
                <Text style={styles.iconBtnText}>{'\u2699\uFE0F'}</Text>
              </Pressable>
              <Pressable
                onPress={openChangelog}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel={hasUnreadChangelog ? "What's new (unread)" : "What's new"}
              >
                <Text style={styles.iconBtnText}>{'\u{1F4DC}'}</Text>
                {hasUnreadChangelog ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            </View>
          </View>
        ) : null}

        {isDesktopWeb && renderedDesktopPage !== 'tasks' ? (
          <Animated.View
            style={[
              styles.desktopPage,
              enhanceMotion && {
                opacity: desktopPageMotion,
                transform: [
                  {
                    translateY: desktopPageMotion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [desktopPageDirection * 18, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Suspense fallback={<DesktopPageFallback styles={styles} colors={colors} />}>
              {renderedDesktopPage === 'study' ? (
                <StudyPage
                  sessions={studySessions}
                  subjects={subjects}
                  isDesktopWeb
                  storageScope={sessionUserId}
                  onSaveSession={handleSaveStudySession}
                  onDeleteSession={handleDeleteStudySession}
                />
              ) : null}
              {renderedDesktopPage === 'subjects' ? (
                <SubjectManager
                  visible
                  embedded
                  subjects={subjects}
                  onChange={updateSubjects}
                  onClose={() => navigateDesktopPage('tasks')}
                  taskCountsBySubject={taskCountsBySubject}
                />
              ) : null}
              {renderedDesktopPage === 'friends' ? (
                <FriendsSheet
                  visible
                  embedded
                  onClose={() => navigateDesktopPage('tasks')}
                  session={session}
                />
              ) : null}
              {renderedDesktopPage === 'chats' ? (
                <ChatSheet
                  visible
                  embedded
                  activeRoomId={desktopChatRoomId}
                  onRoomChange={(roomId) => navigateDesktopPage('chats', roomId)}
                  onClose={() => navigateDesktopPage('tasks')}
                  session={session}
                  profile={profile}
                />
              ) : null}
              {renderedDesktopPage === 'settings' ? (
                <SettingsSheet
                  visible
                  embedded
                  onClose={() => navigateDesktopPage('tasks')}
                  session={session}
                  onSignOut={handleSignOut}
                  enhanceMotion={enhanceMotion}
                  onEnhanceMotionChange={handleEnhanceMotionChange}
                  onShowChangelog={() => {
                    navigateDesktopPage('tasks');
                    setTimeout(openChangelog, 250);
                  }}
                />
              ) : null}
            </Suspense>
          </Animated.View>
        ) : (
          <Animated.View
            style={[
              styles.tasksPage,
              isDesktopWeb && enhanceMotion && {
                opacity: desktopPageMotion,
                transform: [
                  {
                    translateY: desktopPageMotion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [desktopPageDirection * 18, 0],
                    }),
                  },
                ],
              },
            ]}
          >
        {!isDesktopWeb && mobilePage === 'study' ? (
          <Suspense fallback={<DesktopPageFallback styles={styles} colors={colors} />}>
            <StudyPage
              sessions={studySessions}
              subjects={subjects}
              storageScope={sessionUserId}
              onBackToTasks={() => setMobilePage('tasks')}
              onSaveSession={handleSaveStudySession}
              onDeleteSession={handleDeleteStudySession}
            />
          </Suspense>
        ) : (
          <>
        {!isDesktopWeb ? (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{greeting(publicName(profile))}</Text>
              <Text style={styles.headerTitle}>Your tasks</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setNotificationsVisible(true)}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel="Open notifications"
              >
                <Text style={styles.iconBtnText}>{'\u{1F514}'}</Text>
                {notifications.length > 0 ? (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>
                      {notifications.length > 9 ? '9+' : notifications.length}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                onPress={openSettings}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel="Open settings"
              >
                <Text style={styles.iconBtnText}>{'\u2699\uFE0F'}</Text>
              </Pressable>
              <Pressable
                onPress={openChangelog}
                style={({ pressed, hovered }) => [
                  styles.iconBtn,
                  hovered && styles.iconBtnHovered,
                  pressed && styles.iconBtnPressed,
                ]}
                hitSlop={8}
                accessibilityLabel={hasUnreadChangelog ? "What's new (unread)" : "What's new"}
              >
                <Text style={styles.iconBtnText}>{'\u{1F4DC}'}</Text>
                {hasUnreadChangelog ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            </View>
          </View>
        ) : null}

        <ProgressCard progress={progress} styles={styles} />

        {syncError ? (
          <SyncErrorBanner message={syncError} onDismiss={() => setSyncError(null)} styles={styles} />
        ) : null}

        <FilterTabs
          value={filter}
          onChange={setFilter}
          counts={counts}
        />

        <SortControls value={sortMode} onChange={setSortMode} filter={filter} styles={styles} />

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            isDesktopWeb && styles.desktopListContent,
          ]}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              subjects={subjects}
              onToggle={() => toggleDone(item.id)}
              onPress={() => openEditTask(item)}
              onDelete={() => quickDeleteTask(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title={emptyTitleFor(filter, tasks.length)}
              subtitle={emptySubtitleFor(filter, tasks.length)}
              icon={emptyIconFor(filter, tasks.length)}
            />
          }
        />
          </>
        )}

        {!isDesktopWeb ? (
          <BottomActionBar
            profile={profile}
            onProfile={() => setProfileVisible(true)}
            onAddTask={openNewTask}
            onAddSubject={openSubjects}
            onStudy={openStudy}
            onFriends={openFriends}
            onChats={openChats}
            styles={styles}
            shadow={shadow}
          />
        ) : null}
          </Animated.View>
        )}

      </Animated.View>

      <Suspense fallback={null}>
        {formVisible ? (
          <TaskForm
            visible
            task={editingTask}
            subjects={subjects}
            desktopWeb={isDesktopWeb}
            subjectPanelVisible={desktopTaskSubjectsVisible}
            subjectPanel={
              isDesktopWeb && desktopTaskSubjectsVisible ? (
                <SubjectManager
                  visible
                  embedded
                  subjects={subjects}
                  onChange={updateSubjects}
                  onClose={() => setDesktopTaskSubjectsVisible(false)}
                  taskCountsBySubject={taskCountsBySubject}
                />
              ) : null
            }
            resetKey={taskFormResetKey}
            onSave={handleSaveTask}
            onDelete={handleDeleteTask}
            onCancel={closeForm}
            onManageSubjects={() => {
              if (isDesktopWeb) {
                setDesktopTaskSubjectsVisible(true);
              } else if (Platform.OS === 'web') {
                setSubjectMgrVisible(true);
              } else {
                setFormVisible(false);
                setResumeFormAfterSubjects(true);
                setTimeout(() => setSubjectMgrVisible(true), 250);
              }
            }}
          />
        ) : null}
        {subjectMgrVisible ? (
          <SubjectManager
            visible
            subjects={subjects}
            onChange={updateSubjects}
            onClose={() => {
              setSubjectMgrVisible(false);
              if (resumeFormAfterSubjects) {
                setResumeFormAfterSubjects(false);
                setTimeout(() => setFormVisible(true), 250);
              }
            }}
            taskCountsBySubject={taskCountsBySubject}
          />
        ) : null}
        {profileVisible ? (
          <ProfileSheet
            visible
            onClose={() => setProfileVisible(false)}
            profile={profile}
            onProfileChange={handleProfileChange}
          />
        ) : null}

        {!isDesktopWeb && settingsVisible ? (
          <SettingsSheet
            visible
            onClose={() => setSettingsVisible(false)}
            session={session}
            onSignOut={handleSignOut}
            enhanceMotion={enhanceMotion}
            onEnhanceMotionChange={handleEnhanceMotionChange}
            onShowChangelog={() => {
              setSettingsVisible(false);
              // Defer so the settings sheet can finish dismissing first.
              setTimeout(openChangelog, 250);
            }}
          />
        ) : null}

        {friendsVisible ? (
          <FriendsSheet
            visible
            onClose={() => setFriendsVisible(false)}
            session={session}
          />
        ) : null}

        {chatsVisible ? (
          <ChatSheet
            visible
            onClose={() => setChatsVisible(false)}
            session={session}
            profile={profile}
          />
        ) : null}

        {changelogVisible ? (
          <ChangelogSheet
            visible
            entries={CHANGELOG}
            onClose={() => setChangelogVisible(false)}
          />
        ) : null}
      </Suspense>

      <NotificationsPanel
        visible={notificationsVisible}
        notifications={notifications}
        onClose={() => setNotificationsVisible(false)}
        onClear={() => setNotifications([])}
        onPressNotification={(notification) => {
          setNotificationsVisible(false);
          if (notification.type === 'friend') openFriends();
          if (notification.type === 'message') openChats();
        }}
        styles={styles}
        shadow={shadow}
      />

      <NotificationBanner
        notification={activeBanner}
        onDone={dismissActiveBanner}
        styles={styles}
        shadow={shadow}
      />

      {!isDesktopWeb ? <VersionBadge styles={styles} /> : null}
    </SafeAreaView>
  );
}

function subjectShallowEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    (a.room ?? '') === (b.room ?? '') &&
    (a.teacher ?? '') === (b.teacher ?? '') &&
    (a.color ?? null) === (b.color ?? null)
  );
}

function DesktopPageFallback({ styles, colors }) {
  return (
    <View style={styles.desktopPageFallback}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function LoadingSkeleton({ styles, isDesktopWeb }) {
  const rows = isDesktopWeb ? [0, 1, 2, 3, 4] : [0, 1, 2];
  return (
    <View style={isDesktopWeb ? styles.skeletonShell : styles.skeletonMobile}>
      {isDesktopWeb ? (
        <View style={styles.skeletonSidebar}>
          <View style={[styles.skeletonBlock, styles.skeletonToggle]} />
          <View style={styles.skeletonNav}>
            {[0, 1, 2, 3, 4].map((item) => (
              <View key={item} style={[styles.skeletonBlock, styles.skeletonNavItem]} />
            ))}
          </View>
          <View style={[styles.skeletonBlock, styles.skeletonProfile]} />
        </View>
      ) : null}
      <View style={styles.skeletonMain}>
        <View style={styles.skeletonHeader}>
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeletonBlock, styles.skeletonKicker]} />
            <View style={[styles.skeletonBlock, styles.skeletonTitle]} />
          </View>
          <View style={styles.skeletonHeaderActions}>
            <View style={[styles.skeletonBlock, styles.skeletonCircle]} />
            <View style={[styles.skeletonBlock, styles.skeletonCircle]} />
          </View>
        </View>
        <View style={[styles.skeletonBlock, styles.skeletonProgress]} />
        <View style={styles.skeletonTabs}>
          {[0, 1, 2, 3].map((item) => (
            <View key={item} style={[styles.skeletonBlock, styles.skeletonTab]} />
          ))}
        </View>
        <View style={styles.skeletonList}>
          {rows.map((item) => (
            <View key={item} style={[styles.skeletonBlock, styles.skeletonCard]}>
              <View style={[styles.skeletonBlock, styles.skeletonCardCheck]} />
              <View style={{ flex: 1, gap: 8 }}>
                <View style={[styles.skeletonBlock, styles.skeletonCardLine]} />
                <View style={[styles.skeletonBlock, styles.skeletonCardLineShort]} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      display: 'flex',
      flexDirection: 'column',
    },
    mobileMain: {
      flex: 1,
    },
    tasksPage: {
      flex: 1,
    },
    desktopMain: {
      flex: 1,
      minWidth: 0,
      paddingVertical: spacing.md,
    },
    desktopPage: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    desktopPageFallback: {
      flex: 1,
      minHeight: 320,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopSidebar: {
      position: 'absolute',
      top: spacing.lg,
      bottom: spacing.lg,
      left: spacing.lg,
      zIndex: 20,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      overflow: 'hidden',
    },
    desktopSidebarHeader: {
      paddingHorizontal: spacing.sm,
      alignItems: 'flex-start',
    },
    desktopSidebarTogglePressable: {
      borderRadius: radius.md,
    },
    desktopSidebarToggleHovered: {
      backgroundColor: colors.primarySoft,
    },
    desktopSidebarToggle: {
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      flexDirection: 'row',
      overflow: 'hidden',
    },
    desktopSidebarToggleIcon: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopSidebarToggleText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 20,
    },
    desktopSidebarToggleLabelWrap: {
      height: 40,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    desktopSidebarToggleLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '900',
    },
    desktopSidebarNav: {
      flex: 1,
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.lg,
      position: 'relative',
    },
    desktopSidebarActiveIndicator: {
      position: 'absolute',
      left: spacing.sm,
      right: spacing.sm,
      top: spacing.lg,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.primarySoft,
    },
    desktopSidebarButton: {
      minHeight: 48,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: 'transparent',
      zIndex: 1,
    },
    desktopSidebarButtonPressed: {
      backgroundColor: colors.primarySoftHover,
    },
    desktopSidebarButtonHovered: {
      backgroundColor: colors.primarySoft,
    },
    desktopSidebarIcon: {
      width: 24,
      textAlign: 'center',
      fontSize: 20,
      lineHeight: 24,
    },
    desktopSidebarLabel: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
    },
    desktopSidebarLabelWrap: {
      overflow: 'hidden',
    },
    desktopSidebarFooter: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    desktopSidebarProfile: {
      minHeight: 54,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    desktopSidebarProfileText: {
      minWidth: 0,
      overflow: 'hidden',
    },
    desktopSidebarMeta: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    loadingWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skeletonShell: {
      flex: 1,
      flexDirection: 'row',
      gap: spacing.xl,
      padding: spacing.lg,
      backgroundColor: colors.bg,
    },
    skeletonMobile: {
      flex: 1,
      padding: spacing.lg,
      backgroundColor: colors.bg,
    },
    skeletonSidebar: {
      width: 216,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    skeletonNav: {
      flex: 1,
      gap: spacing.sm,
      paddingTop: spacing.lg,
    },
    skeletonMain: {
      flex: 1,
      gap: spacing.md,
      minWidth: 0,
    },
    skeletonHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingTop: spacing.sm,
    },
    skeletonHeaderActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    skeletonBlock: {
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    skeletonToggle: {
      width: 84,
      height: 40,
    },
    skeletonNavItem: {
      height: 48,
    },
    skeletonProfile: {
      height: 54,
    },
    skeletonKicker: {
      width: 120,
      height: 12,
    },
    skeletonTitle: {
      width: 220,
      height: 28,
    },
    skeletonCircle: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
    },
    skeletonProgress: {
      height: 92,
    },
    skeletonTabs: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    skeletonTab: {
      width: 88,
      height: 36,
      borderRadius: radius.pill,
    },
    skeletonList: {
      gap: spacing.sm,
    },
    skeletonCard: {
      minHeight: 92,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.lg,
      backgroundColor: colors.card,
    },
    skeletonCardCheck: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      backgroundColor: colors.cardMuted,
    },
    skeletonCardLine: {
      width: '72%',
      height: 16,
      backgroundColor: colors.cardMuted,
    },
    skeletonCardLineShort: {
      width: '44%',
      height: 12,
      backgroundColor: colors.cardMuted,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      gap: spacing.md,
    },
    desktopHeader: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    desktopAddBtn: {
      minHeight: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopAddBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    desktopAddBtnPressed: {
      opacity: 0.78,
    },
    desktopAddText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '900',
    },
    desktopVersionBadge: {
      minHeight: 36,
      maxWidth: 220,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopVersionText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '900',
    },
    greeting: {
      ...typography.caption,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    headerTitle: {
      ...typography.title,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      position: 'relative',
    },
    iconBtnHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    iconBtnPressed: {
      backgroundColor: colors.cardMutedHover,
    },
    iconBtnText: {
      fontSize: 20,
    },
    unreadDot: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
      borderWidth: 2,
      borderColor: colors.bg,
    },
    notificationBadge: {
      position: 'absolute',
      top: 4,
      right: 3,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
      borderWidth: 2,
      borderColor: colors.bg,
    },
    notificationBadgeText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '900',
      lineHeight: 11,
    },
    notificationBanner: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.lg,
      left: Platform.OS === 'web' ? undefined : spacing.lg,
      width: Platform.OS === 'web' ? 340 : undefined,
      zIndex: 30,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: 3,
    },
    notificationBannerTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
    },
    notificationBannerBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    notificationsModal: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    notificationsBackdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    notificationsPanel: {
      position: 'absolute',
      top: 68,
      right: spacing.lg,
      left: Platform.OS === 'web' ? undefined : spacing.lg,
      width: Platform.OS === 'web' ? 360 : undefined,
      maxHeight: 420,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    notificationsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    notificationsTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
    },
    notificationsHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    notificationsLink: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '800',
    },
    notificationsLinkHovered: {
      backgroundColor: colors.primarySoft,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      marginHorizontal: -spacing.xs,
      marginVertical: -2,
    },
    notificationsEmpty: {
      ...typography.bodyMuted,
      padding: spacing.lg,
      textAlign: 'center',
    },
    notificationsList: {
      maxHeight: 352,
    },
    notificationRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    notificationRowHovered: {
      backgroundColor: colors.cardHover,
    },
    notificationRowPressed: {
      backgroundColor: colors.cardMutedHover,
    },
    notificationTypeDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
      marginTop: 5,
    },
    notificationRowText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    notificationRowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '800',
    },
    notificationRowBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    notificationRowTime: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '700',
      marginTop: 2,
    },
    notificationDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: spacing.lg,
    },
    progressCard: {
      backgroundColor: colors.card,
      marginHorizontal: spacing.lg,
      marginVertical: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    progressLabel: {
      ...typography.label,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    progressText: {
      ...typography.body,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.cardMuted,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 3,
    },
    syncBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.dangerSoft,
    },
    syncBannerText: {
      flex: 1,
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
    },
    syncBannerDismiss: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '800',
    },
    syncBannerDismissHovered: {
      backgroundColor: colors.dangerSoftHover,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      marginHorizontal: -spacing.xs,
      marginVertical: -2,
    },
    sortControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    sortLabel: {
      ...typography.caption,
      textTransform: 'uppercase',
      fontWeight: '800',
      minWidth: 44,
    },
    sortOptions: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    sortOption: {
      minHeight: 34,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortOptionActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    sortOptionHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    sortOptionActiveHovered: {
      backgroundColor: colors.primarySoftHover,
    },
    sortOptionPressed: {
      backgroundColor: colors.cardMutedHover,
    },
    sortOptionText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '800',
    },
    sortOptionTextActive: {
      color: colors.primary,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: 136,
      flexGrow: 1,
    },
    desktopListContent: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl,
    },
    bottomBar: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.md,
      minHeight: 72,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      gap: spacing.xs,
    },
    bottomActionMenu: {
      position: 'absolute',
      bottom: 78,
      alignSelf: 'center',
      minWidth: 214,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing.sm,
      flexDirection: 'row',
      gap: spacing.sm,
      zIndex: 2,
    },
    bottomActionChoice: {
      flex: 1,
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      paddingHorizontal: spacing.sm,
    },
    bottomActionChoiceHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    bottomActionChoicePressed: {
      opacity: 0.78,
    },
    bottomActionChoiceIcon: {
      fontSize: 18,
      lineHeight: 20,
    },
    bottomActionChoiceText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '900',
    },
    bottomBarBtn: {
      flex: 1,
      minWidth: 0,
      maxWidth: 82,
      height: 56,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    bottomBarBtnHovered: {
      backgroundColor: colors.cardHover,
    },
    bottomBarBtnPressed: {
      backgroundColor: colors.cardMutedHover,
    },
    bottomBarIcon: {
      fontSize: 22,
      lineHeight: 26,
    },
    bottomBarLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
    },
    bottomAddBtn: {
      width: 58,
      height: 58,
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bottomAddBtnOpen: {
      backgroundColor: colors.text,
    },
    bottomAddBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    bottomAddBtnPressed: {
      opacity: 0.78,
    },
    bottomAddIcon: {
      color: '#fff',
      fontSize: 32,
      fontWeight: '300',
      lineHeight: 34,
    },
    versionBadge: {
      position: 'absolute',
      left: spacing.md,
      bottom: 96,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: colors.cardMuted,
      opacity: 0.7,
    },
    versionText: {
      fontSize: 10,
      color: colors.textMuted,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
  });
