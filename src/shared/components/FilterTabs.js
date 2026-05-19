import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../theme';

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'incomplete', label: 'Not done' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'complete', label: 'Done' },
];

export default function FilterTabs({ value, onChange, counts = {} }) {
  const { colors, spacing, radius, typography } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {FILTERS.map((f) => {
        const active = value === f.key;
        const count = counts[f.key];
        return (
          <Pressable
            key={f.key}
            onPress={() => onChange(f.key)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {f.label}
            </Text>
            {typeof count === 'number' ? (
              <View style={[styles.count, active && styles.countActive]}>
                <Text style={[styles.countText, active && styles.countTextActive]}>
                  {count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    // Keep the horizontal ScrollView from flex-growing vertically in its
    // column parent. Without this, it stretches into available space and
    // creates a big gap between the filter row and the task list below.
    scroll: {
      flexGrow: 0,
      flexShrink: 0,
    },
    row: {
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      alignItems: 'center',
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tabText: {
      ...typography.body,
      fontWeight: '600',
      fontSize: 14,
      color: colors.textMuted,
    },
    tabTextActive: {
      color: '#fff',
    },
    count: {
      minWidth: 20,
      paddingHorizontal: 6,
      height: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countActive: {
      backgroundColor: 'rgba(255,255,255,0.25)',
    },
    countText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
    },
    countTextActive: {
      color: '#fff',
    },
  });
