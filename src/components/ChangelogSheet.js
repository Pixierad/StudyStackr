// "What's new" bottom-sheet listing recent app updates.
//
// Behaviour:
//   * Opens from the Settings sheet (or directly via the header dot when
//     there is something unread).
//   * On open, persists the latest version into AsyncStorage via
//     saveChangelogLastSeen() so the unread dot disappears.
//   * Pure presentational: takes the current changelog data as a prop so
//     the screen never depends on a fetch.
//
// Architectural note: the entries themselves live in src/changelog.js so
// release notes can be reviewed in code review (and bumped in the same
// commit as the feature being shipped).

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  ScrollView,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
} from 'react-native';
import { useTheme } from '../theme';
import { saveChangelogLastSeen } from '../storage';

export default function ChangelogSheet({ visible, entries = [], onClose }) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  // Lazily allocate the Animated.Value so re-renders don't churn it.
  const translateYRef = useRef(null);
  if (translateYRef.current == null) {
    translateYRef.current = new Animated.Value(0);
  }
  const translateY = translateYRef.current;

  const screenHeight = Dimensions.get('window').height;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Slide-in animation + persist "last seen" so the unread badge clears.
  useEffect(() => {
    if (visible) {
      translateY.setValue(screenHeight);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
      const latest = entries[0]?.version;
      if (latest) saveChangelogLastSeen(latest);
    }
  }, [visible, translateY, screenHeight, entries]);

  const closeWithAnimation = () => {
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      // Guard against late callbacks firing after unmount or after the
      // parent already closed the sheet by other means.
      if (mountedRef.current) onClose?.();
    });
  };

  const panResponderRef = useRef(null);
  if (panResponderRef.current == null) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        gs.dy > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => translateY.stopAnimation(),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const dismissed = gs.dy > 100 || gs.vy > 0.5;
        if (dismissed) {
          closeWithAnimation();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={closeWithAnimation} />
        <Animated.View
          style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}
        >
          <View style={styles.dragZone} {...panResponderRef.current.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>What's new</Text>
              <Pressable onPress={closeWithAnimation} hitSlop={8}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {entries.length === 0 ? (
              <Text style={styles.empty}>
                No release notes yet. Check back after the next update.
              </Text>
            ) : (
              entries.map((entry, idx) => (
                <View key={entry.version} style={styles.entry}>
                  <View style={styles.entryHeader}>
                    <View style={styles.versionPill}>
                      <Text style={styles.versionPillText}>v{entry.version}</Text>
                    </View>
                    <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
                    {idx === 0 ? (
                      <View style={styles.latestPill}>
                        <Text style={styles.latestPillText}>Latest</Text>
                      </View>
                    ) : null}
                  </View>
                  {entry.title ? (
                    <Text style={styles.entryTitle}>{entry.title}</Text>
                  ) : null}
                  <View style={styles.notes}>
                    {entry.notes.map((note, i) => (
                      <View key={i} style={styles.noteRow}>
                        <Text style={styles.noteBullet}>•</Text>
                        <Text style={styles.noteText}>{note}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  // Locale-friendly "Apr 25, 2026" without bringing in a date lib.
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
      padding: Platform.OS === 'web' ? spacing.lg : 0,
    },
    backdropFill: { ...StyleSheet.absoluteFillObject },
    sheet: {
      alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderBottomLeftRadius: Platform.OS === 'web' ? radius.xl : 0,
      borderBottomRightRadius: Platform.OS === 'web' ? radius.xl : 0,
      width: Platform.OS === 'web' ? '100%' : undefined,
      maxWidth: Platform.OS === 'web' ? 680 : undefined,
      maxHeight: '88%',
      paddingBottom: spacing.lg,
      overflow: 'hidden',
    },
    dragZone: {
      paddingBottom: spacing.sm,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    title: {
      ...typography.title,
      fontSize: 22,
    },
    doneText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    empty: {
      ...typography.bodyMuted,
      textAlign: 'center',
      paddingVertical: spacing.xl,
    },
    entry: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    entryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    versionPill: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    versionPillText: {
      color: colors.primary,
      fontWeight: '700',
      fontSize: 12,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
    entryDate: {
      ...typography.bodyMuted,
      fontSize: 12,
    },
    latestPill: {
      backgroundColor: colors.successSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    latestPillText: {
      color: colors.success,
      fontWeight: '700',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    entryTitle: {
      ...typography.body,
      fontWeight: '700',
      fontSize: 16,
    },
    notes: {
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    noteRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-start',
    },
    noteBullet: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      width: 12,
    },
    noteText: {
      ...typography.body,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      flex: 1,
    },
  });
