import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Animated,
  Dimensions,
  PanResponder,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../../shared/theme';
import { toISODate, fromISODate, relativeLabel } from '../../../shared/utils/dates';
import { findSubject, resolveSubjectStyle } from '../../../shared/utils/subjects';

export default function TaskForm({
  visible,
  task,
  subjects,
  onSave,
  onDelete,
  onCancel,
  onManageSubjects,
  resetKey,
}) {
  const { colors, spacing, radius, typography, shadow, colorForSubject, isDark } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const isEditing = !!task;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  const screenHeight = Dimensions.get('window').height;
  // Lazy-init the Animated.Value so a fresh one isn't allocated and
  // immediately discarded on every re-render.
  const translateYRef = useRef(null);
  if (translateYRef.current == null) {
    translateYRef.current = new Animated.Value(screenHeight);
  }
  const translateY = translateYRef.current;

  // Track mount status so deferred animation callbacks (200ms timing.start
  // continuations) don't fire onCancel against a parent that has already
  // unmounted or otherwise advanced past this state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      translateY.setValue(screenHeight);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
    }
  }, [visible, translateY, screenHeight]);

  const closeWithAnimation = () => {
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onCancel?.();
    });
  };
  const isHeaderDrag = (event, gs) => {
    const y = event.nativeEvent.locationY ?? 0;
    return y <= 112 && gs.dy > 2 && Math.abs(gs.dy) > Math.abs(gs.dx);
  };

  // Swipe-down-to-dismiss. Only the drag zone (handle + title area) responds,
  // so the ScrollView below it still scrolls normally.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: isHeaderDrag,
      onMoveShouldSetPanResponderCapture: isHeaderDrag,
      onPanResponderGrant: () => {
        translateY.stopAnimation();
      },
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
    })
  ).current;

  // Re-sync the local form state from `task` whenever the caller asks us to
  // reset (via resetKey) OR the underlying task identity changes. Including
  // task?.id removes the fragile coupling that earlier required callers to
  // bump resetKey *before* changing task -- a future caller that swaps the
  // prop directly will now still see the right initial values.
  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setSubject(task?.subject ?? '');
    setDueDate(task?.dueDate ?? null);
    setShowPicker(false);
  }, [resetKey, task?.id]);

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('Missing title', 'Please give your task a name.');
      return;
    }
    const trimmedDesc = description.trim();
    onSave({
      title: trimmed,
      description: trimmedDesc || null,
      subject: subject || null,
      dueDate: dueDate || null,
    });
  };

  const handleDelete = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Delete task?\n\nThis cannot be undone.')) {
        onDelete?.();
      }
      return;
    }
    Alert.alert('Delete task?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  const onDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event?.type === 'dismissed') return;
    if (selectedDate) setDueDate(toISODate(selectedDate));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.backdropFill} onPress={closeWithAnimation} />
        <Animated.View
          style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}
        >
          <View style={styles.dragZone} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>
                {isEditing ? 'Edit task' : 'New task'}
              </Text>
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={styles.field}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Read Chapter 4"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoFocus={!isEditing}
                returnKeyType="done"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Add more details — notes, pages, links, anything (optional)"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.inputMultiline]}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                returnKeyType="default"
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Subject</Text>
                <Pressable onPress={onManageSubjects} hitSlop={8}>
                  <Text style={styles.manageLink}>Manage</Text>
                </Pressable>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.subjectRow}
              >
                <SubjectChip
                  label="None"
                  name=""
                  active={!subject}
                  onPress={() => setSubject('')}
                  subjects={subjects}
                  styles={styles}
                  colors={colors}
                  colorForSubject={colorForSubject}
                  isDark={isDark}
                />
                {subjects.map((s) => (
                  <SubjectChip
                    key={s.name}
                    label={s.name}
                    name={s.name}
                    active={subject === s.name}
                    onPress={() => setSubject(s.name)}
                    subjects={subjects}
                    styles={styles}
                    colors={colors}
                    colorForSubject={colorForSubject}
                    isDark={isDark}
                  />
                ))}
                {subjects.length === 0 ? (
                  <Pressable onPress={onManageSubjects} style={styles.addSubjectChip}>
                    <Text style={styles.addSubjectText}>+ Add a subject</Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              <SubjectDetails
                name={subject}
                subjects={subjects}
                styles={styles}
                colors={colors}
                colorForSubject={colorForSubject}
                isDark={isDark}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Due date</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.dateButton}>
                  <Text style={[styles.dateText, !dueDate && styles.dateTextMuted]}>
                    {dueDate ? relativeLabel(dueDate) : 'No due date'}
                  </Text>
                  {dueDate ? (
                    <Pressable
                      onPress={() => setDueDate(null)}
                      hitSlop={8}
                      style={styles.clearBtnWeb}
                    >
                      <Text style={styles.clearText}>Clear</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.dateHint}>Tap to set</Text>
                  )}
                  <input
                    type="date"
                    value={dueDate || ''}
                    min="2000-01-01"
                    onChange={(e) => {
                      const val = e.target.value;
                      setDueDate(val ? val : null);
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      background: 'transparent',
                    }}
                  />
                </View>
              ) : (
                <>
                  <Pressable
                    onPress={() => setShowPicker((v) => !v)}
                    style={styles.dateButton}
                  >
                    <Text style={[styles.dateText, !dueDate && styles.dateTextMuted]}>
                      {dueDate ? relativeLabel(dueDate) : 'No due date'}
                    </Text>
                    {dueDate ? (
                      <Pressable onPress={() => setDueDate(null)} hitSlop={8}>
                        <Text style={styles.clearText}>Clear</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.dateHint}>Tap to set</Text>
                    )}
                  </Pressable>
                  {showPicker && (
                    <DateTimePicker
                      value={dueDate ? fromISODate(dueDate) : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={onDateChange}
                      minimumDate={new Date(2000, 0, 1)}
                    />
                  )}
                </>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {isEditing ? (
              <Pressable onPress={handleDelete} style={styles.deleteBtn} hitSlop={8}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <View style={styles.footerRight}>
              <Pressable onPress={closeWithAnimation} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} style={styles.saveBtn}>
                <Text style={styles.saveText}>{isEditing ? 'Save' : 'Add task'}</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SubjectChip({ label, name, active, onPress, subjects, styles, colors, colorForSubject, isDark }) {
  const color = name
    ? resolveSubjectStyle(name, subjects, { colorForSubject, isDark })
    : colorForSubject('');
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active
          ? { backgroundColor: color.bg, borderColor: color.fg }
          : { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? color.fg : colors.textMuted },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SubjectDetails({ name, subjects, styles, colors, colorForSubject, isDark }) {
  const subject = findSubject(name, subjects);
  if (!subject) return null;
  const color = resolveSubjectStyle(name, subjects, { colorForSubject, isDark });
  const hasDetails = subject.room || subject.teacher;
  return (
    <View style={[styles.subjectDetail, { backgroundColor: color.bg, borderColor: color.fg }]}>
      <View style={[styles.subjectDetailDot, { backgroundColor: color.fg }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.subjectDetailName, { color: color.fg }]} numberOfLines={1}>
          {subject.name}
        </Text>
        {hasDetails ? (
          <View style={styles.subjectDetailMetaRow}>
            {subject.room ? (
              <View style={styles.subjectDetailMetaItem}>
                <Text style={styles.subjectDetailMetaLabel}>Room</Text>
                <Text style={[styles.subjectDetailMetaValue, { color: colors.text }]} numberOfLines={1}>
                  {subject.room}
                </Text>
              </View>
            ) : null}
            {subject.teacher ? (
              <View style={styles.subjectDetailMetaItem}>
                <Text style={styles.subjectDetailMetaLabel}>Teacher</Text>
                <Text style={[styles.subjectDetailMetaValue, { color: colors.text }]} numberOfLines={1}>
                  {subject.teacher}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.subjectDetailMetaValue, { color: colors.textMuted, fontSize: 12 }]}>
            No room or teacher set — tap "Manage" to add them.
          </Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    backdropFill: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '90%',
      paddingBottom: spacing.lg,
    },
    dragZone: {
      // Big hit area at the top of the sheet for swipe-down-to-dismiss.
      paddingBottom: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    header: {
      width: '100%',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    content: {
      padding: spacing.lg,
      gap: spacing.lg,
    },
    title: {
      ...typography.title,
      fontSize: 24,
    },
    field: {
      gap: spacing.sm,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    label: {
      ...typography.label,
      textTransform: 'uppercase',
    },
    manageLink: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
      color: colors.text,
    },
    inputMultiline: {
      minHeight: 96,
      paddingTop: spacing.md,
      lineHeight: 22,
    },
    subjectRow: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      maxWidth: 160,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
    },
    addSubjectChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: 'dashed',
    },
    addSubjectText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    subjectDetail: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      marginTop: spacing.sm,
    },
    subjectDetailDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginTop: 6,
    },
    subjectDetailName: {
      fontSize: 15,
      fontWeight: '700',
    },
    subjectDetailMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.lg,
      marginTop: spacing.xs,
    },
    subjectDetailMetaItem: {
      flexDirection: 'column',
    },
    subjectDetailMetaLabel: {
      ...typography.label,
      fontSize: 11,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    subjectDetailMetaValue: {
      fontSize: 14,
      fontWeight: '600',
      marginTop: 2,
    },
    dateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      position: 'relative',
      overflow: 'hidden',
    },
    clearBtnWeb: {
      position: 'relative',
      zIndex: 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    dateText: {
      fontSize: 16,
      color: colors.text,
      fontWeight: '500',
    },
    dateTextMuted: {
      color: colors.textFaint,
    },
    dateHint: {
      fontSize: 13,
      color: colors.textFaint,
    },
    clearText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '600',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    footerRight: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    deleteBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    deleteText: {
      color: colors.danger,
      fontWeight: '600',
      fontSize: 14,
    },
    cancelBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
    },
    cancelText: {
      color: colors.textMuted,
      fontWeight: '600',
    },
    saveBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    saveText: {
      color: '#fff',
      fontWeight: '700',
    },
  });
