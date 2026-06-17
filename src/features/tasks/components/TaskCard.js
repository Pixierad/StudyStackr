import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../../shared/theme';
import { resolveSubjectStyle } from '../../../shared/utils/subjects';
import { relativeLabel, dueStatus } from '../../../shared/utils/dates';

export default function TaskCard({ task, subjects = [], onToggle, onPress, onDelete }) {
  const { colors, spacing, radius, typography, shadow, colorForSubject, isDark } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const subjectColor = resolveSubjectStyle(task.subject, subjects, { colorForSubject, isDark });
  const status = dueStatus(task.dueDate, task.done);
  const duePill = dueStyleFor(status, colors);

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed, hovered }) => [
        styles.card,
        shadow.card,
        task.done && styles.cardDone,
        hovered && (task.done ? styles.cardDoneHovered : styles.cardHovered),
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
        {task.done && <Text style={styles.checkmark}>{'\u2713'}</Text>}
      </View>

      <View style={styles.content}>
        <Text
          style={[styles.title, task.done && styles.titleDone]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {task.description ? (
          <Text
            style={[styles.description, task.done && styles.descriptionDone]}
            numberOfLines={2}
          >
            {task.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {task.subject ? (
            <View style={[styles.subjectBadge, { backgroundColor: subjectColor.bg }]}>
              <Text style={[styles.subjectText, { color: subjectColor.fg }]} numberOfLines={1}>
                {task.subject}
              </Text>
            </View>
          ) : null}
          {task.dueDate ? (
            <View style={[styles.duePill, { backgroundColor: duePill.bg }]}>
              <Text style={[styles.dueText, { color: duePill.fg }]}>
                {relativeLabel(task.dueDate)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {!task.done && onPress ? (
        <Pressable
          onPress={onPress}
          hitSlop={10}
          style={({ pressed, hovered }) => [
            styles.editBtn,
            hovered && styles.editBtnHovered,
            pressed && styles.editBtnPressed,
          ]}
          accessibilityLabel="Edit task"
          accessibilityRole="button"
        >
          <Text style={styles.editBtnText}>{'\u270E'}</Text>
        </Pressable>
      ) : null}

      {task.done && onDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={10}
          style={({ pressed, hovered }) => [
            styles.deleteBtn,
            hovered && styles.deleteBtnHovered,
            pressed && styles.deleteBtnPressed,
          ]}
          accessibilityLabel="Delete task"
          accessibilityRole="button"
        >
          <Text style={styles.deleteBtnText}>{'\u00D7'}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function dueStyleFor(status, colors) {
  switch (status) {
    case 'overdue':
      return { bg: colors.dangerSoft, fg: colors.danger };
    case 'today':
      return { bg: colors.warningSoft, fg: colors.warning };
    case 'soon':
      return { bg: colors.primarySoft, fg: colors.primary };
    case 'done':
      return { bg: colors.successSoft, fg: colors.success };
    default:
      return { bg: colors.cardMuted, fg: colors.textMuted };
  }
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    cardDone: {
      backgroundColor: colors.cardMuted,
    },
    cardHovered: {
      backgroundColor: colors.cardHover,
    },
    cardDoneHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    cardPressed: {
      opacity: 0.7,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkboxDone: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    checkmark: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 16,
    },
    content: {
      flex: 1,
      minWidth: 0,
      gap: spacing.sm,
    },
    title: {
      ...typography.body,
      fontWeight: '600',
      fontSize: 16,
    },
    titleDone: {
      textDecorationLine: 'line-through',
      color: colors.textMuted,
    },
    description: {
      ...typography.bodyMuted,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textMuted,
      marginTop: -2,
    },
    descriptionDone: {
      color: colors.textFaint,
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    subjectBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
      maxWidth: 180,
    },
    subjectText: {
      fontSize: 12,
      fontWeight: '600',
    },
    duePill: {
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    dueText: {
      fontSize: 12,
      fontWeight: '600',
    },
    editBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    editBtnPressed: {
      opacity: 0.6,
    },
    editBtnHovered: {
      backgroundColor: colors.primarySoftHover,
    },
    editBtnText: {
      color: colors.primary,
      fontSize: 18,
      fontWeight: '500',
      lineHeight: 22,
      marginTop: -1,
    },
    deleteBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    deleteBtnPressed: {
      opacity: 0.6,
    },
    deleteBtnHovered: {
      backgroundColor: colors.dangerSoftHover,
    },
    deleteBtnText: {
      color: colors.danger,
      fontSize: 22,
      fontWeight: '500',
      lineHeight: 24,
      marginTop: -2,
    },
  });
