import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from '../shared/theme';
import { todayISO, daysBetween, dueStatus } from '../shared/utils/dates';
import {
  loadTasks,
  upsertTask,
  deleteTask,
  newId,
} from '../features/tasks/taskRepository';
import {
  loadSubjects,
  upsertSubject,
  deleteSubject,
} from '../features/subjects/subjectRepository';
import {
  loadProfile,
  saveProfile,
} from '../features/profile/profileRepository';
import {
  loadChangelogLastSeen,
} from '../features/changelog/changelogRepository';
import {
  loadFriendRequests,
  subscribeToFriendRequests,
} from '../features/friends/friendsRepository';
import {
  loadChatRooms,
  subscribeToChatNotifications,
} from '../features/chat/chatRepository';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { CHANGELOG, latestChangelogVersion } from '../features/changelog/changelog';
import { normalizeProfile, publicName } from '../shared/profile';

import TaskCard from '../features/tasks/components/TaskCard';
import TaskForm from '../features/tasks/components/TaskForm';
import SubjectManager from '../features/subjects/SubjectManager';
import SettingsSheet from '../features/settings/SettingsSheet';
import ProfileSheet from '../features/profile/ProfileSheet';
import FilterTabs from '../shared/components/FilterTabs';
import EmptyState from '../shared/components/EmptyState';
import AuthScreen from '../features/auth/AuthScreen';
import ChangelogSheet from '../features/changelog/ChangelogSheet';
import FriendsSheet from '../features/friends/FriendsSheet';
import ChatSheet from '../features/chat/ChatSheet';
import {
  BottomActionBar,
  DesktopSidebar,
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
  createLocalAdminSession,
  isLocalAdminAccessAllowed,
  isLocalAdminSession,
  LOCAL_ADMIN_SESSION_STORAGE_KEY,
} from '../features/auth/localAdminCredentials';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { colors, spacing, radius, typography, shadow, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );
  const isDesktopWeb = Platform.OS === 'web' && width >= 900;

  const [tasks, setTasks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [profile, setProfile] = useState(() => normalizeProfile());
  const [loading, setLoading] = useState(true);

  // Auth state. `session === undefined` means we haven't checked yet;
  // `null` means signed out; any object means signed in.
  // When Supabase isn't configured we treat everyone as "local user" --
  // session stays null but we render the app anyway.
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null);
  const localAdminSession = isLocalAdminSession(session);

  const [filter, setFilter] = useState('all');
  const [sortMode, setSortMode] = useState('not_done_first');
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

  const [taskFormResetKey, setTaskFormResetKey] = useState(0);
  const [resumeFormAfterSubjects, setResumeFormAfterSubjects] = useState(false);
  const notifiedFriendRequestsRef = useRef(new Set());
  const notifiedMessagesRef = useRef(new Set());

  // Wire up Supabase auth listener (no-op in local-only mode).
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;
    (async () => {
      const savedLocalAdmin = await AsyncStorage.getItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
      if (!mounted) return;
      if (savedLocalAdmin === 'true') {
        if (!isLocalAdminAccessAllowed()) {
          await AsyncStorage.removeItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
          const { data } = await supabase.auth.getSession();
          if (mounted) setSession(data?.session ?? null);
          return;
        }
        await supabase.auth.signOut().catch(() => {});
        if (mounted) setSession(createLocalAdminSession());
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data?.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      const savedLocalAdmin = await AsyncStorage.getItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
      if (savedLocalAdmin === 'true' && isLocalAdminAccessAllowed()) return;
      setSession(s ?? null);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (STATUS_ONLY_FILTERS.has(filter) && sortMode === 'not_done_first') {
      setSortMode('due_date');
    }
  }, [filter, sortMode]);

  // Load user data whenever the active identity changes (sign in / sign out /
  // first boot in local mode). Re-keying on session.user?.id guarantees a
  // fresh load for the new user.
  const sessionUserId = localAdminSession ? null : session?.user?.id ?? null;
  useEffect(() => {
    // Skip while we're still determining the initial session.
    if (session === undefined) return;
    // If Supabase is configured but there's no session, don't load anything yet
    // -- the AuthScreen is showing.
    if (isSupabaseConfigured && !session) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [t, s, p] = await Promise.all([loadTasks(), loadSubjects(), loadProfile()]);
      if (cancelled) return;
      setTasks(t);
      setSubjects(s);
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
        const requests = await loadFriendRequests();
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
        const rooms = await loadChatRooms();
        const room = rooms.find((item) => item.id === row.room_id);
        if (!room) return;
        const sender = (room.members || []).find((member) => member.id === row.sender_id);
        const chatName = notificationRoomTitle(room, sessionUserId);
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
    setTaskFormResetKey((k) => k + 1);
    setFormVisible(true);
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    setTaskFormResetKey((k) => k + 1);
    setFormVisible(true);
  };

  const closeForm = () => {
    setFormVisible(false);
    setEditingTask(null);
    setResumeFormAfterSubjects(false);
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
      saveProfile(nextProfile)
        .then(() => setSyncError(null))
        .catch((e) => reportSyncError('save profile', e));
    },
    [reportSyncError]
  );

  const handleProfileChange = useCallback(
    (nextProfile) => {
      const cleaned = normalizeProfile(nextProfile);
      setProfile(cleaned);
      persistProfile(cleaned);
    },
    [persistProfile]
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
    setProfile(normalizeProfile());
    setProfileVisible(false);
    setSettingsVisible(false);
    setFriendsVisible(false);
    setChatsVisible(false);
    setNotificationsVisible(false);
    setNotifications([]);
    setActiveBanner(null);
    notifiedFriendRequestsRef.current.clear();
    notifiedMessagesRef.current.clear();
    setLoading(false);
  }, [localAdminSession]);

  const handleLocalAdminSignIn = useCallback(async () => {
    if (!isLocalAdminAccessAllowed()) return;
    await AsyncStorage.setItem(LOCAL_ADMIN_SESSION_STORAGE_KEY, 'true');
    if (supabase) await supabase.auth.signOut().catch(() => {});
    setSession(createLocalAdminSession());
  }, []);

  const openChangelog = useCallback(() => {
    // The sheet itself persists last-seen on open, so clearing the local
    // dot here keeps the UI in sync without an extra round-trip.
    setHasUnreadChangelog(false);
    setChangelogVisible(true);
  }, []);

  // Still determining the initial Supabase session.
  if (session === undefined) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // Supabase configured but signed out -> sign-in screen.
  if (isSupabaseConfigured && !session) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AuthScreen onLocalAdminSignIn={handleLocalAdminSignIn} />
        <VersionBadge styles={styles} />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {isDesktopWeb ? (
        <DesktopSidebar
          collapsed={desktopSidebarCollapsed}
          profile={profile}
          onToggle={() => setDesktopSidebarCollapsed((value) => !value)}
          onSubjects={() => setSubjectMgrVisible(true)}
          onFriends={() => setFriendsVisible(true)}
          onChats={() => setChatsVisible(true)}
          onProfile={() => setProfileVisible(true)}
          styles={styles}
          shadow={shadow}
        />
      ) : null}

      <View
        style={[
          isDesktopWeb ? styles.desktopMain : styles.mobileMain,
          isDesktopWeb && desktopSidebarCollapsed && styles.desktopMainCollapsed,
        ]}
      >
        <View style={[styles.header, isDesktopWeb && styles.desktopHeader]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting(publicName(profile))}</Text>
          <Text style={styles.headerTitle}>Your tasks</Text>
        </View>
        <View style={styles.headerActions}>
          {isDesktopWeb ? (
            <Pressable
              onPress={openNewTask}
              style={styles.desktopAddBtn}
              accessibilityRole="button"
              accessibilityLabel="Add task"
            >
              <Text style={styles.desktopAddText}>+ Add task</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setNotificationsVisible(true)}
            style={styles.iconBtn}
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
            onPress={() => setSettingsVisible(true)}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel="Open settings"
          >
            <Text style={styles.iconBtnText}>⚙️</Text>
          </Pressable>
          <Pressable
            onPress={openChangelog}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel={hasUnreadChangelog ? "What's new (unread)" : "What's new"}
          >
            <Text style={styles.iconBtnText}>📜</Text>
            {hasUnreadChangelog ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        </View>
        </View>

        <ProgressCard progress={progress} styles={styles} />

        {syncError ? (
          <SyncErrorBanner message={syncError} onDismiss={() => setSyncError(null)} styles={styles} />
        ) : null}

        <FilterTabs value={filter} onChange={setFilter} counts={counts} />

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

        {!isDesktopWeb ? (
          <BottomActionBar
            profile={profile}
            onProfile={() => setProfileVisible(true)}
            onAddTask={openNewTask}
            onSubjects={() => setSubjectMgrVisible(true)}
            onFriends={() => setFriendsVisible(true)}
            onChats={() => setChatsVisible(true)}
            styles={styles}
            shadow={shadow}
          />
        ) : null}

      </View>

      <TaskForm
        visible={formVisible}
        task={editingTask}
        subjects={subjects}
        resetKey={taskFormResetKey}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onCancel={closeForm}
        onManageSubjects={() => {
          if (Platform.OS === 'web') {
            setSubjectMgrVisible(true);
          } else {
            setFormVisible(false);
            setResumeFormAfterSubjects(true);
            setTimeout(() => setSubjectMgrVisible(true), 250);
          }
        }}
      />
      <SubjectManager
        visible={subjectMgrVisible}
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
      <ProfileSheet
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        profile={profile}
        onProfileChange={handleProfileChange}
      />

      <SettingsSheet
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        session={session}
        onSignOut={handleSignOut}
        onShowChangelog={() => {
          setSettingsVisible(false);
          // Defer so the settings sheet can finish dismissing first.
          setTimeout(openChangelog, 250);
        }}
      />

      <FriendsSheet
        visible={friendsVisible}
        onClose={() => setFriendsVisible(false)}
        session={session}
      />

      <ChatSheet
        visible={chatsVisible}
        onClose={() => setChatsVisible(false)}
        session={session}
        profile={profile}
      />

      <ChangelogSheet
        visible={changelogVisible}
        entries={CHANGELOG}
        onClose={() => setChangelogVisible(false)}
      />

      <NotificationsPanel
        visible={notificationsVisible}
        notifications={notifications}
        onClose={() => setNotificationsVisible(false)}
        onClear={() => setNotifications([])}
        onPressNotification={(notification) => {
          setNotificationsVisible(false);
          if (notification.type === 'friend') setFriendsVisible(true);
          if (notification.type === 'message') setChatsVisible(true);
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

      <VersionBadge styles={styles} />
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
    desktopMain: {
      flex: 1,
      minWidth: 0,
      marginLeft: 248,
      paddingVertical: spacing.md,
    },
    desktopMainCollapsed: {
      marginLeft: 96,
    },
    desktopSidebar: {
      position: 'absolute',
      top: spacing.lg,
      bottom: spacing.lg,
      left: spacing.lg,
      width: 216,
      zIndex: 20,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
    },
    desktopSidebarCollapsed: {
      width: 64,
    },
    desktopSidebarHeader: {
      paddingHorizontal: spacing.sm,
      alignItems: 'flex-end',
    },
    desktopSidebarToggle: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopSidebarToggleText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 20,
    },
    desktopSidebarNav: {
      flex: 1,
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.lg,
    },
    desktopSidebarButton: {
      minHeight: 48,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: 'transparent',
    },
    desktopSidebarButtonPressed: {
      backgroundColor: colors.cardMuted,
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
      flex: 1,
      minWidth: 0,
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
    desktopAddText: {
      color: '#fff',
      fontSize: 14,
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
