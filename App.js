import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from './src/theme';
import { todayISO, daysBetween, dueStatus } from './src/utils/dates';
import {
  loadTasks,
  upsertTask,
  deleteTask,
  loadSubjects,
  upsertSubject,
  deleteSubject,
  loadProfile,
  saveProfile,
  loadChangelogLastSeen,
  newId,
  loadFriendRequests,
  loadChatRooms,
  subscribeToFriendRequests,
  subscribeToChatNotifications,
} from './src/storage';
import { supabase, isSupabaseConfigured } from './src/supabase';
import { CHANGELOG, latestChangelogVersion } from './src/changelog';
import { normalizeProfile, publicName } from './src/profile';

import TaskCard from './src/components/TaskCard';
import TaskForm from './src/components/TaskForm';
import SubjectManager from './src/components/SubjectManager';
import SettingsSheet from './src/components/SettingsSheet';
import ProfileSheet from './src/components/ProfileSheet';
import FilterTabs from './src/components/FilterTabs';
import EmptyState from './src/components/EmptyState';
import AuthScreen from './src/components/AuthScreen';
import ChangelogSheet from './src/components/ChangelogSheet';
import FriendsSheet from './src/components/FriendsSheet';
import ChatSheet from './src/components/ChatSheet';
import ProfileAvatar from './src/components/ProfileAvatar';

const SORT_OPTIONS = [
  { key: 'not_done_first', label: 'Not done first' },
  { key: 'due_date', label: 'Date due' },
  { key: 'alphabetical', label: 'A-Z' },
];
const STATUS_ONLY_FILTERS = new Set(['incomplete', 'complete']);

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
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [tasks, setTasks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [profile, setProfile] = useState(() => normalizeProfile());
  const [loading, setLoading] = useState(true);

  // Auth state. `session === undefined` means we haven't checked yet;
  // `null` means signed out; any object means signed in.
  // When Supabase isn't configured we treat everyone as "local user" --
  // session stays null but we render the app anyway.
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null);

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

  const [taskFormResetKey, setTaskFormResetKey] = useState(0);
  const [resumeFormAfterSubjects, setResumeFormAfterSubjects] = useState(false);
  const notifiedFriendRequestsRef = useRef(new Set());
  const notifiedMessagesRef = useRef(new Set());

  // Wire up Supabase auth listener (no-op in local-only mode).
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data?.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
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
  const sessionUserId = session?.user?.id ?? null;
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
    if (supabase) {
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
        <AuthScreen />
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

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting(publicName(profile))}</Text>
          <Text style={styles.headerTitle}>Your tasks</Text>
        </View>
        <View style={styles.headerActions}>
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
        contentContainerStyle={styles.listContent}
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

function VersionBadge({ styles }) {
  const sha = process.env.EXPO_PUBLIC_APP_VERSION || 'dev';
  const built = process.env.EXPO_PUBLIC_APP_BUILT || '';
  return (
    <View style={styles.versionBadge} pointerEvents="none">
      <Text style={styles.versionText}>
        {`v.${sha}${built ? ' ' + built : ''}`}
      </Text>
    </View>
  );
}

function BottomActionBar({
  profile,
  onProfile,
  onAddTask,
  onSubjects,
  onFriends,
  onChats,
  styles,
  shadow,
}) {
  return (
    <View style={[styles.bottomBar, shadow.float]}>
      <BarButton
        label="Profile"
        accessibilityLabel="Open profile"
        onPress={onProfile}
        styles={styles}
        avatar={<ProfileAvatar profile={profile} size={30} />}
      />
      <BarButton
        label="Subjects"
        icon="📚"
        accessibilityLabel="Manage subjects"
        onPress={onSubjects}
        styles={styles}
      />
      <Pressable
        onPress={onAddTask}
        accessibilityLabel="Add task"
        accessibilityRole="button"
        style={styles.bottomAddBtn}
      >
        <Text style={styles.bottomAddIcon}>+</Text>
      </Pressable>
      <BarButton
        label="Friends"
        icon="👥"
        accessibilityLabel="Open friends"
        onPress={onFriends}
        styles={styles}
      />
      <BarButton
        label="Chats"
        icon="💬"
        accessibilityLabel="Open chats"
        onPress={onChats}
        styles={styles}
      />
    </View>
  );
}

function BarButton({ label, icon, avatar, onPress, accessibilityLabel, styles }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={styles.bottomBarBtn}
    >
      {avatar || <Text style={styles.bottomBarIcon}>{icon}</Text>}
      <Text style={styles.bottomBarLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function SortControls({ value, onChange, filter, styles }) {
  const options = STATUS_ONLY_FILTERS.has(filter)
    ? SORT_OPTIONS.filter((option) => option.key !== 'not_done_first')
    : SORT_OPTIONS;
  return (
    <View style={styles.sortControls}>
      <Text style={styles.sortLabel}>Order</Text>
      <View style={styles.sortOptions}>
        {options.map((option) => {
          const active = value === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.sortOption, active && styles.sortOptionActive]}
            >
              <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ProgressCard({ progress, styles }) {
  const { doneCount, total, pct } = progress;
  const { shadow } = useTheme();

  // Lazy allocation -- avoids re-creating the Animated.Value on every render.
  const animatedPctRef = useRef(null);
  if (animatedPctRef.current == null) animatedPctRef.current = new Animated.Value(pct);
  const animatedPct = animatedPctRef.current;

  useEffect(() => {
    Animated.timing(animatedPct, {
      toValue: pct,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [pct, animatedPct]);

  const widthInterpolated = animatedPct.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.progressCard, shadow.card]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.progressLabel}>Progress</Text>
        <Text style={styles.progressText}>
          {total === 0
            ? 'No tasks or events yet — add one to get started.'
            : `${doneCount} of ${total} done (${pct}%)`}
        </Text>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[styles.progressFill, { width: widthInterpolated }]}
          />
        </View>
      </View>
    </View>
  );
}

function SyncErrorBanner({ message, onDismiss, styles }) {
  return (
    <View style={styles.syncBanner}>
      <Text style={styles.syncBannerText}>{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss sync warning">
        <Text style={styles.syncBannerDismiss}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

function NotificationBanner({ notification, onDone, styles, shadow }) {
  const translateXRef = useRef(null);
  const opacityRef = useRef(null);
  if (translateXRef.current == null) translateXRef.current = new Animated.Value(380);
  if (opacityRef.current == null) opacityRef.current = new Animated.Value(0);
  const translateX = translateXRef.current;
  const opacity = opacityRef.current;

  useEffect(() => {
    if (!notification) return undefined;
    translateX.setValue(380);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 380,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => onDone?.());
    }, 3000);

    return () => clearTimeout(timer);
  }, [notification?.id, notification, onDone, translateX, opacity]);

  if (!notification) return null;

  return (
    <Animated.View
      style={[
        styles.notificationBanner,
        shadow.float,
        { opacity, transform: [{ translateX }] },
      ]}
      pointerEvents="box-none"
    >
      <Text style={styles.notificationBannerTitle} numberOfLines={1}>
        {notification.title}
      </Text>
      {notification.body ? (
        <Text style={styles.notificationBannerBody} numberOfLines={2}>
          {notification.body}
        </Text>
      ) : null}
    </Animated.View>
  );
}

function NotificationsPanel({
  visible,
  notifications,
  onClose,
  onClear,
  onPressNotification,
  styles,
  shadow,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.notificationsModal}>
        <Pressable style={styles.notificationsBackdrop} onPress={onClose} />
        <View style={[styles.notificationsPanel, shadow.float]}>
          <View style={styles.notificationsHeader}>
            <Text style={styles.notificationsTitle}>Notifications</Text>
            <View style={styles.notificationsHeaderActions}>
              {notifications.length > 0 ? (
                <Pressable onPress={onClear} hitSlop={8}>
                  <Text style={styles.notificationsLink}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={styles.notificationsLink}>Done</Text>
              </Pressable>
            </View>
          </View>

          {notifications.length === 0 ? (
            <Text style={styles.notificationsEmpty}>No notifications yet.</Text>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              style={styles.notificationsList}
              ItemSeparatorComponent={() => <View style={styles.notificationDivider} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPressNotification?.(item)}
                  style={styles.notificationRow}
                >
                  <View style={styles.notificationTypeDot} />
                  <View style={styles.notificationRowText}>
                    <Text style={styles.notificationRowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.body ? (
                      <Text style={styles.notificationRowBody} numberOfLines={2}>
                        {item.body}
                      </Text>
                    ) : null}
                    <Text style={styles.notificationRowTime}>
                      {notificationTimeLabel(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function notificationRoomTitle(room, userId) {
  if (room?.name?.trim()) return room.name.trim();
  const members = (room?.members || []).filter((member) => member.id !== userId);
  const names = (members.length ? members : room?.members || []).map(publicName).filter(Boolean);
  if (names.length === 0) return 'Chat';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function shortNotificationBody(body) {
  const text = String(body || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'New message';
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function notificationTimeLabel(createdAt) {
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

function compareTasks(a, b, sortMode) {
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

function greeting(name) {
  const h = new Date().getHours();
  const suffix = name ? `, ${name}` : '';
  if (h < 5) return name ? `Up late, ${name}?` : 'Up late?';
  if (h < 12) return `Good morning${suffix}`;
  if (h < 17) return `Good afternoon${suffix}`;
  if (h < 22) return `Good evening${suffix}`;
  return `Late night${suffix}`;
}

function emptyTitleFor(filter, total) {
  if (total === 0) return 'No tasks or events yet';
  switch (filter) {
    case 'incomplete':
      return 'No unfinished tasks or events';
    case 'today':
      return 'Nothing upcoming or due today';
    case 'upcoming':
      return 'No upcoming tasks or events';
    case 'overdue':
      return 'Nothing overdue';
    case 'complete':
      return 'No completed tasks or events';
    default:
      return 'All caught up';
  }
}

function emptySubtitleFor(filter, total) {
  if (total === 0) return 'Tap the + button to add your first task or event.';
  switch (filter) {
    case 'today':
      return 'Enjoy your day — or get ahead on something upcoming.';
    case 'incomplete':
      return 'Everything is finished for now.';
    case 'upcoming':
      return 'No future due dates scheduled.';
    case 'overdue':
      return "You're on top of things. 🎉";
    case 'complete':
      return 'Completed tasks will show up here.';
    default:
      return '';
  }
}

function emptyIconFor(filter, total) {
  if (filter === 'incomplete') return '✅';
  if (total === 0) return '📚';
  switch (filter) {
    case 'today':
      return '☀️';
    case 'upcoming':
      return '📅';
    case 'overdue':
      return '🎯';
    case 'complete':
      return '✅';
    default:
      return '🎉';
  }
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      display: 'flex',
      flexDirection: 'column',
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
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
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
