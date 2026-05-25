import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  AppState,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTheme } from '../../shared/theme';
import { resolveSubjectStyle } from '../../shared/utils/subjects';
import StudyHeatmap, { StudySummaryStrip } from './StudyHeatmap';
import {
  formatClock,
  formatDuration,
  modeLabel,
  sessionDateLabel,
  sessionTimeLabel,
} from './studyUtils';
import { newId, normalizeStudySession } from './studyRepository';

const POMODORO_SECONDS = 25 * 60;
const ACTIVE_STUDY_TIMER_KEY_PREFIX = '@simpleapp:activeStudyTimer:';
const VALID_TIMER_MODES = new Set(['stopwatch', 'pomodoro', 'custom']);
const VALID_TIMER_STATUSES = new Set(['running', 'paused']);

function activeStudyTimerKey(storageScope) {
  const rawScope = storageScope == null || storageScope === '' ? 'local' : String(storageScope);
  const safeScope = rawScope.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${ACTIVE_STUDY_TIMER_KEY_PREFIX}${safeScope}:v1`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeActiveStudyTimer(value) {
  if (!value || typeof value !== 'object') return null;
  const status = VALID_TIMER_STATUSES.has(value.status) ? value.status : null;
  const mode = VALID_TIMER_MODES.has(value.mode) ? value.mode : 'stopwatch';
  if (!status) return null;

  const startedAtMs = Math.max(0, finiteNumber(value.startedAtMs, Date.now()));
  const plannedSeconds =
    value.plannedSeconds == null ? null : Math.max(1, Math.round(finiteNumber(value.plannedSeconds, 0)));
  const accumulatedSeconds = Math.max(0, Math.round(finiteNumber(value.accumulatedSeconds, 0)));
  const startedAtISO =
    typeof value.startedAtISO === 'string' && !Number.isNaN(Date.parse(value.startedAtISO))
      ? value.startedAtISO
      : new Date(startedAtMs || Date.now()).toISOString();

  return {
    status,
    mode,
    title: typeof value.title === 'string' ? value.title.slice(0, 80) : '',
    subject: typeof value.subject === 'string' && value.subject.trim() ? value.subject.trim() : null,
    plannedSeconds,
    accumulatedSeconds,
    startedAtMs,
    startedAtISO,
  };
}

export default function StudyPage({
  sessions = [],
  subjects = [],
  isDesktopWeb = false,
  storageScope = 'local',
  onBackToTasks,
  onSaveSession,
  onDeleteSession,
}) {
  const { colors, spacing, radius, typography, shadow, colorForSubject, isDark } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography, isDesktopWeb }),
    [colors, spacing, radius, typography, isDesktopWeb]
  );

  const [mode, setMode] = useState('stopwatch');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [customMinutes, setCustomMinutes] = useState('45');
  const [activeTimer, setActiveTimer] = useState(null);
  const [timerHydrated, setTimerHydrated] = useState(false);
  const [hydratedTimerKey, setHydratedTimerKey] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const activeTimerKey = useMemo(() => activeStudyTimerKey(storageScope), [storageScope]);

  useEffect(() => {
    if (activeTimer?.status !== 'running') return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTimer?.status]);

  useEffect(() => {
    let cancelled = false;
    setTimerHydrated(false);
    setHydratedTimerKey(null);
    AsyncStorage.getItem(activeTimerKey)
      .then((raw) => {
        if (cancelled) return;
        const restored = raw ? normalizeActiveStudyTimer(JSON.parse(raw)) : null;
        setActiveTimer(restored);
        setNowMs(Date.now());
        if (restored) {
          setMode(restored.mode);
          setSessionTitle(restored.title || '');
          setSelectedSubject(restored.subject || '');
        }
      })
      .catch(() => {
        if (!cancelled) setActiveTimer(null);
      })
      .finally(() => {
        if (!cancelled) {
          setHydratedTimerKey(activeTimerKey);
          setTimerHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTimerKey]);

  useEffect(() => {
    if (!timerHydrated || hydratedTimerKey !== activeTimerKey) return undefined;
    const write = activeTimer
      ? AsyncStorage.setItem(activeTimerKey, JSON.stringify(activeTimer))
      : AsyncStorage.removeItem(activeTimerKey);
    write.catch(() => {});
    return undefined;
  }, [activeTimer, activeTimerKey, hydratedTimerKey, timerHydrated]);

  useEffect(() => {
    const refreshClock = () => setNowMs(Date.now());
    const appStateSubscription = AppState.addEventListener?.('change', refreshClock);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('focus', refreshClock);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', refreshClock);
      }
      return () => {
        appStateSubscription?.remove?.();
        window.removeEventListener('focus', refreshClock);
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', refreshClock);
        }
      };
    }

    return () => appStateSubscription?.remove?.();
  }, []);

  const persistActiveTimer = useCallback(
    (timer) => {
      const write = timer
        ? AsyncStorage.setItem(activeTimerKey, JSON.stringify(timer))
        : AsyncStorage.removeItem(activeTimerKey);
      write.catch(() => {});
    },
    [activeTimerKey]
  );

  const elapsedSeconds = useMemo(() => {
    if (!activeTimer) return 0;
    const liveSeconds =
      activeTimer.status === 'running'
        ? Math.floor((nowMs - activeTimer.startedAtMs) / 1000)
        : 0;
    return Math.max(0, activeTimer.accumulatedSeconds + liveSeconds);
  }, [activeTimer, nowMs]);

  const remainingSeconds = activeTimer?.plannedSeconds
    ? Math.max(0, activeTimer.plannedSeconds - elapsedSeconds)
    : null;
  const timerComplete = activeTimer?.plannedSeconds && elapsedSeconds >= activeTimer.plannedSeconds;
  const timerDisplay = remainingSeconds == null ? formatClock(elapsedSeconds) : formatClock(remainingSeconds);

  const startTimer = useCallback(() => {
    const plannedSeconds =
      mode === 'pomodoro'
        ? POMODORO_SECONDS
        : mode === 'custom'
          ? Math.max(1, Math.round(Number(customMinutes) || 1)) * 60
          : null;
    const now = Date.now();
    const nextTimer = {
      status: 'running',
      mode,
      title: sessionTitle.trim(),
      subject: selectedSubject || null,
      plannedSeconds,
      accumulatedSeconds: 0,
      startedAtMs: now,
      startedAtISO: new Date(now).toISOString(),
    };
    setActiveTimer(nextTimer);
    persistActiveTimer(nextTimer);
    setNowMs(now);
  }, [customMinutes, mode, persistActiveTimer, selectedSubject, sessionTitle]);

  const pauseTimer = useCallback(() => {
    if (!activeTimer || activeTimer.status !== 'running') return;
    const nextTimer = {
      ...activeTimer,
      status: 'paused',
      accumulatedSeconds: elapsedSeconds,
      startedAtMs: Date.now(),
    };
    setActiveTimer(nextTimer);
    persistActiveTimer(nextTimer);
  }, [activeTimer, elapsedSeconds, persistActiveTimer]);

  const resumeTimer = useCallback(() => {
    if (!activeTimer || activeTimer.status !== 'paused') return;
    const now = Date.now();
    const nextTimer = {
      ...activeTimer,
      status: 'running',
      startedAtMs: now,
    };
    setActiveTimer(nextTimer);
    persistActiveTimer(nextTimer);
    setNowMs(now);
  }, [activeTimer, persistActiveTimer]);

  const stopTimer = useCallback(() => {
    if (!activeTimer) return;
    const endedAt = new Date().toISOString();
    const startedAt = activeTimer.startedAtISO || endedAt;
    const durationSeconds = Math.max(1, elapsedSeconds);
    const session = normalizeStudySession({
      id: newId(),
      title: activeTimer.title,
      subject: activeTimer.subject,
      mode: activeTimer.mode,
      plannedSeconds: activeTimer.plannedSeconds,
      durationSeconds,
      startedAt,
      endedAt,
    });
    onSaveSession?.(session);
    setActiveTimer(null);
    persistActiveTimer(null);
    setSessionTitle('');
  }, [activeTimer, elapsedSeconds, onSaveSession, persistActiveTimer]);

  const discardTimer = useCallback(() => {
    if (!activeTimer) return;
    const clear = () => {
      setActiveTimer(null);
      persistActiveTimer(null);
    };
    if (elapsedSeconds < 60) {
      clear();
      return;
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Discard this timer without saving a study session?')) clear();
      return;
    }
    Alert.alert('Discard timer?', 'This will not save a study session.', [
      { text: 'Keep timer', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: clear },
    ]);
  }, [activeTimer, elapsedSeconds, persistActiveTimer]);

  const deleteSession = useCallback(
    (session) => {
      const remove = () => onDeleteSession?.(session.id);
      if (Platform.OS === 'web') {
        if (window.confirm('Delete study session?\n\nThis cannot be undone.')) remove();
        return;
      }
      Alert.alert('Delete study session?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: remove },
      ]);
    },
    [onDeleteSession]
  );

  const modeOptions = [
    { key: 'stopwatch', label: 'Stopwatch' },
    { key: 'pomodoro', label: 'Pomodoro' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <View style={styles.page}>
      {!isDesktopWeb ? (
        <View style={styles.mobileHeader}>
          <Pressable
            onPress={onBackToTasks}
            style={({ pressed, hovered }) => [
              styles.backBtn,
              hovered && styles.backBtnHovered,
              pressed && styles.backBtnPressed,
            ]}
          >
            <Text style={styles.backBtnText}>Tasks</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Study</Text>
            <Text style={styles.pageTitle}>Study hub</Text>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topGrid}>
          <View style={[styles.timerPanel, shadow.card]}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.kicker}>Timer</Text>
                <Text style={styles.panelTitle}>
                  {activeTimer ? activeTimer.title || modeLabel(activeTimer.mode) : 'New study session'}
                </Text>
              </View>
              {timerComplete ? (
                <View style={styles.completePill}>
                  <Text style={styles.completePillText}>Done</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.timerText}>{timerDisplay}</Text>
            <Text style={styles.timerMeta}>
              {activeTimer
                ? `${formatDuration(elapsedSeconds)} studied${activeTimer.subject ? ` for ${activeTimer.subject}` : ''}`
                : 'Start a timer to log your study hours.'}
            </Text>

            {!activeTimer ? (
              <>
                <View style={styles.segmented}>
                  {modeOptions.map((option) => {
                    const active = mode === option.key;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => setMode(option.key)}
                        style={({ pressed, hovered }) => [
                          styles.segment,
                          active && styles.segmentActive,
                          hovered && !active && styles.segmentHovered,
                          pressed && styles.segmentPressed,
                        ]}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Session name</Text>
                  <TextInput
                    value={sessionTitle}
                    onChangeText={setSessionTitle}
                    placeholder="e.g. Biology revision"
                    placeholderTextColor={colors.textFaint}
                    style={styles.input}
                    returnKeyType="done"
                    maxLength={80}
                  />
                </View>

                {mode === 'custom' ? (
                  <View style={styles.customRow}>
                    <Text style={styles.fieldLabel}>Minutes</Text>
                    <TextInput
                      value={customMinutes}
                      onChangeText={(value) => setCustomMinutes(value.replace(/[^\d]/g, '').slice(0, 3))}
                      keyboardType="number-pad"
                      placeholder="45"
                      placeholderTextColor={colors.textFaint}
                      style={styles.minuteInput}
                    />
                  </View>
                ) : null}

                <SubjectChooser
                  selectedSubject={selectedSubject}
                  subjects={subjects}
                  onChange={setSelectedSubject}
                  styles={styles}
                  colors={colors}
                  colorForSubject={colorForSubject}
                  isDark={isDark}
                />

                <Pressable
                  onPress={startTimer}
                  style={({ pressed, hovered }) => [
                    styles.primaryBtn,
                    hovered && styles.primaryBtnHovered,
                    pressed && styles.primaryBtnPressed,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Start studying</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.timerActions}>
                {activeTimer.status === 'running' ? (
                  <Pressable
                    onPress={pauseTimer}
                    style={({ pressed, hovered }) => [
                      styles.secondaryBtn,
                      hovered && styles.secondaryBtnHovered,
                      pressed && styles.secondaryBtnPressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Pause</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={resumeTimer}
                    style={({ pressed, hovered }) => [
                      styles.secondaryBtn,
                      hovered && styles.secondaryBtnHovered,
                      pressed && styles.secondaryBtnPressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Start</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={stopTimer}
                  style={({ pressed, hovered }) => [
                    styles.primaryBtn,
                    styles.timerActionBtn,
                    hovered && styles.primaryBtnHovered,
                    pressed && styles.primaryBtnPressed,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Stop and save</Text>
                </Pressable>
                <Pressable
                  onPress={discardTimer}
                  style={({ pressed, hovered }) => [
                    styles.dangerBtn,
                    hovered && styles.dangerBtnHovered,
                    pressed && styles.secondaryBtnPressed,
                  ]}
                >
                  <Text style={styles.dangerBtnText}>Discard</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.statsColumn}>
            <StudySummaryStrip sessions={sessions} />
            <StudyHeatmap sessions={sessions} />
          </View>
        </View>

        <View style={[styles.sessionsPanel, shadow.card]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.kicker}>Sessions</Text>
              <Text style={styles.panelTitle}>Recent study</Text>
            </View>
          </View>

          <FlatList
            data={sessions.slice(0, 30)}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.sessionDivider} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No study sessions yet</Text>
                <Text style={styles.emptyText}>
                  Stopwatch, Pomodoro, and custom timers will appear here after you stop and save.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <SessionRow
                session={item}
                subjects={subjects}
                onDelete={() => deleteSession(item)}
                styles={styles}
                colors={colors}
                colorForSubject={colorForSubject}
                isDark={isDark}
              />
            )}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SubjectChooser({ selectedSubject, subjects, onChange, styles, colors, colorForSubject, isDark }) {
  return (
    <View style={styles.subjectBlock}>
      <Text style={styles.fieldLabel}>Subject</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.subjectRow}
      >
        <SubjectChip
          name=""
          label="No subject"
          active={!selectedSubject}
          onPress={() => onChange('')}
          subjects={subjects}
          styles={styles}
          colors={colors}
          colorForSubject={colorForSubject}
          isDark={isDark}
        />
        {subjects.map((subject) => (
          <SubjectChip
            key={subject.name}
            name={subject.name}
            label={subject.name}
            active={selectedSubject === subject.name}
            onPress={() => onChange(subject.name)}
            subjects={subjects}
            styles={styles}
            colors={colors}
            colorForSubject={colorForSubject}
            isDark={isDark}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function SubjectChip({ name, label, active, onPress, subjects, styles, colors, colorForSubject, isDark }) {
  const color = name
    ? resolveSubjectStyle(name, subjects, { colorForSubject, isDark })
    : { bg: colors.cardMuted, fg: colors.textMuted };
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.subjectChip,
        active
          ? { backgroundColor: color.bg, borderColor: color.fg }
          : { backgroundColor: colors.card, borderColor: colors.border },
        hovered && !active && styles.subjectChipHovered,
        pressed && styles.subjectChipPressed,
      ]}
    >
      <Text style={[styles.subjectChipText, { color: active ? color.fg : colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SessionRow({ session, subjects, onDelete, styles, colors, colorForSubject, isDark }) {
  const color = session.subject
    ? resolveSubjectStyle(session.subject, subjects, { colorForSubject, isDark })
    : { bg: colors.cardMuted, fg: colors.textMuted };

  const title = session.title || session.subject || modeLabel(session.mode);
  const metaParts = [
    modeLabel(session.mode),
    session.title && session.subject ? session.subject : null,
    sessionDateLabel(session.endedAt),
    sessionTimeLabel(session.endedAt),
  ].filter(Boolean);

  return (
    <View style={styles.sessionRow}>
      <View style={[styles.sessionDot, { backgroundColor: color.fg }]} />
      <View style={styles.sessionText}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sessionMeta} numberOfLines={1}>
          {metaParts.join(' \u00B7 ')}
        </Text>
      </View>
      <View style={styles.sessionDurationWrap}>
        <Text style={styles.sessionDuration}>{formatDuration(session.durationSeconds)}</Text>
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          style={({ pressed, hovered }) => [
            styles.deleteBtn,
            hovered && styles.deleteBtnHovered,
            pressed && styles.deleteBtnPressed,
          ]}
        >
          <Text style={styles.deleteBtnText}>{'\u00D7'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = ({ colors, spacing, radius, typography, isDesktopWeb }) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: isDesktopWeb ? 0 : spacing.lg,
      paddingBottom: isDesktopWeb ? spacing.xxl : 136,
      gap: spacing.lg,
    },
    mobileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    backBtn: {
      minHeight: 40,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    backBtnHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    backBtnPressed: {
      opacity: 0.75,
    },
    backBtnText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '900',
    },
    topGrid: {
      flexDirection: isDesktopWeb ? 'row' : 'column',
      alignItems: 'stretch',
      gap: spacing.lg,
    },
    timerPanel: {
      flex: isDesktopWeb ? 0.9 : undefined,
      minWidth: isDesktopWeb ? 340 : undefined,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.lg,
    },
    statsColumn: {
      flex: 1.2,
      minWidth: 0,
      gap: spacing.md,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    kicker: {
      ...typography.label,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    pageTitle: {
      ...typography.title,
      fontSize: 26,
    },
    panelTitle: {
      ...typography.heading,
      marginTop: 2,
    },
    completePill: {
      borderRadius: radius.pill,
      backgroundColor: colors.successSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    completePillText: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '900',
    },
    timerText: {
      color: colors.text,
      fontSize: isDesktopWeb ? 58 : 50,
      fontWeight: '900',
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    timerMeta: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
      fontWeight: '700',
      marginTop: -spacing.sm,
    },
    segmented: {
      flexDirection: 'row',
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      padding: 4,
      gap: 4,
    },
    segment: {
      flex: 1,
      minHeight: 38,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    segmentActive: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    segmentPressed: {
      opacity: 0.76,
    },
    segmentText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '900',
    },
    segmentTextActive: {
      color: colors.text,
    },
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    fieldLabel: {
      ...typography.label,
      textTransform: 'uppercase',
    },
    field: {
      gap: spacing.sm,
    },
    input: {
      minHeight: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    minuteInput: {
      width: 96,
      minHeight: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    subjectBlock: {
      gap: spacing.sm,
    },
    subjectRow: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    subjectChip: {
      minHeight: 36,
      maxWidth: 156,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    subjectChipHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    subjectChipPressed: {
      opacity: 0.75,
    },
    subjectChipText: {
      fontSize: 13,
      fontWeight: '800',
    },
    primaryBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    primaryBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    primaryBtnPressed: {
      opacity: 0.78,
    },
    primaryBtnText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
    },
    timerActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      justifyContent: 'center',
    },
    timerActionBtn: {
      minWidth: 138,
    },
    secondaryBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    secondaryBtnHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    secondaryBtnPressed: {
      opacity: 0.78,
    },
    secondaryBtnText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '900',
    },
    dangerBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    dangerBtnHovered: {
      backgroundColor: colors.dangerSoftHover,
    },
    dangerBtnText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: '900',
    },
    sessionsPanel: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    empty: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
      gap: spacing.xs,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '900',
    },
    emptyText: {
      ...typography.bodyMuted,
      textAlign: 'center',
      maxWidth: 420,
    },
    sessionDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.sm,
    },
    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 58,
    },
    sessionDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    sessionText: {
      flex: 1,
      minWidth: 0,
    },
    sessionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '900',
    },
    sessionMeta: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 3,
    },
    sessionDurationWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    sessionDuration: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    deleteBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtnHovered: {
      backgroundColor: colors.dangerSoftHover,
    },
    deleteBtnPressed: {
      opacity: 0.75,
    },
    deleteBtnText: {
      color: colors.danger,
      fontSize: 21,
      lineHeight: 23,
      fontWeight: '500',
    },
  });
