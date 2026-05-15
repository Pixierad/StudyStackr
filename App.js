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
  const [editingTask, setEditingTask] = useState(null);
  const [formVisible, setFormVisible] = useState(false);
  const [subjectMgrVisible, setSubjectMgrVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [friendsVisible, setFriendsVisible] = useState(false);
  const [chatsVisible, setChatsVisible] = useState(false);
  const [changelogVisible, setChangelogVisible] = useState(false);
  const [hasUnreadChangelog, setHasUnreadChangelog] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const [taskFormResetKey, setTaskFormResetKey] = useState(0);
  const [resumeFormAfterSubjects, setResumeFormAfterSubjects] = useState(false);

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
    const c = { all: tasks.length, today: 0, upcoming: 0, overdue: 0, done: 0 };
    for (const t of tasks) {
      if (t.done) {
        c.done++;
        continue;
      }
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
        case 'today':
          return status === 'today';
        case 'upcoming':
          // "upcoming" = anything in the future that isn't overdue/today/done.
          return !t.done && (status === 'soon' || status === 'future');
        case 'overdue':
          return status === 'overdue';
        case 'done':
          return t.done;
        case 'all':
        default:
          return true;
      }
    });
    return matches.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  }, [tasks, filter]);

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
      />

      <ChangelogSheet
        visible={changelogVisible}
        entries={CHANGELOG}
        onClose={() => setChangelogVisible(false)}
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
    case 'today':
      return 'Nothing upcoming or due today';
    case 'upcoming':
      return 'No upcoming tasks or events';
    case 'overdue':
      return 'Nothing overdue';
    case 'done':
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
    case 'upcoming':
      return 'No future due dates scheduled.';
    case 'overdue':
      return "You're on top of things. 🎉";
    case 'done':
      return 'Completed tasks will show up here.';
    default:
      return '';
  }
}

function emptyIconFor(filter, total) {
  if (total === 0) return '📚';
  switch (filter) {
    case 'today':
      return '☀️';
    case 'upcoming':
      return '📅';
    case 'overdue':
      return '🎯';
    case 'done':
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
