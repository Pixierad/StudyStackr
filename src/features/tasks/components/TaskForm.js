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
  Keyboard,
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
  desktopWeb = false,
  subjectPanelVisible = false,
  subjectPanel = null,
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
  const screenHeightRef = useRef(screenHeight);
  // Lazy-init the Animated.Value so a fresh one isn't allocated and
  // immediately discarded on every re-render.
  const translateYRef = useRef(null);
  if (translateYRef.current == null) {
    translateYRef.current = new Animated.Value(screenHeight);
  }
  const translateY = translateYRef.current;
  const subjectPanelProgressRef = useRef(null);
  if (subjectPanelProgressRef.current == null) {
    subjectPanelProgressRef.current = new Animated.Value(subjectPanelVisible ? 1 : 0);
  }
  const subjectPanelProgress = subjectPanelProgressRef.current;
  const inputFocusedRef = useRef(false);
  const inputBlurTimerRef = useRef(null);

  // Track mount status so deferred animation callbacks (200ms timing.start
  // continuations) don't fire onCancel against a parent that has already
  // unmounted or otherwise advanced past this state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (inputBlurTimerRef.current) clearTimeout(inputBlurTimerRef.current);
    };
  }, []);

  useEffect(() => {
    screenHeightRef.current = screenHeight;
  }, [screenHeight]);

  useEffect(() => {
    if (visible) {
      translateY.setValue(screenHeightRef.current);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
    }
  }, [visible, translateY]);

  useEffect(() => {
    Animated.timing(subjectPanelProgress, {
      toValue: subjectPanelVisible ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [subjectPanelVisible, subjectPanelProgress]);

  const closeWithAnimation = () => {
    Animated.timing(translateY, {
      toValue: screenHeightRef.current,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onCancel?.();
    });
  };

  const markInputFocused = () => {
    if (inputBlurTimerRef.current) clearTimeout(inputBlurTimerRef.current);
    inputFocusedRef.current = true;
  };

  const markInputBlurred = () => {
    if (inputBlurTimerRef.current) clearTimeout(inputBlurTimerRef.current);
    inputBlurTimerRef.current = setTimeout(() => {
      inputFocusedRef.current = false;
    }, 80);
  };

  const closeOrDismissKeyboard = () => {
    if (inputFocusedRef.current) {
      Keyboard.dismiss();
      return;
    }
    closeWithAnimation();
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

  const formContent = (
    <>
          <View
            style={desktopWeb ? styles.desktopFormHeaderWrap : styles.dragZone}
            {...(!desktopWeb ? panResponder.panHandlers : {})}
          >
            {!desktopWeb ? <View style={styles.handle} /> : null}
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
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={'Add more details \u2014 notes, pages, links, anything (optional)'}
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.inputMultiline]}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                returnKeyType="default"
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Subject</Text>
                <Pressable
                  onPress={onManageSubjects}
                  hitSlop={8}
                  style={({ hovered }) => hovered && styles.manageLinkHovered}
                >
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
                  <Pressable
                    onPress={onManageSubjects}
                    style={({ pressed, hovered }) => [
                      styles.addSubjectChip,
                      hovered && styles.addSubjectChipHovered,
                      pressed && styles.addSubjectChipPressed,
                    ]}
                  >
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
                desktopWeb ? (
                  <View style={styles.desktopDateGroup}>
                    <View style={styles.desktopDateRow}>
                      <input
                        type="date"
                        value={dueDate || ''}
                        min="2000-01-01"
                        onChange={(e) => {
                          const val = e.target.value;
                          setDueDate(val ? val : null);
                        }}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          minHeight: 48,
                          borderRadius: radius.md,
                          border: `1px solid ${colors.border}`,
                          background: colors.card,
                          color: colors.text,
                          padding: `0 ${spacing.md}px`,
                          fontSize: 16,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                          outline: 'none',
                          colorScheme: isDark ? 'dark' : 'light',
                        }}
                      />
                      {dueDate ? (
                        <Pressable
                          onPress={() => setDueDate(null)}
                          style={({ pressed, hovered }) => [
                            styles.clearDateBtnDesktop,
                            hovered && styles.clearDateBtnHovered,
                            pressed && styles.clearDateBtnPressed,
                          ]}
                        >
                          <Text style={styles.clearText}>Clear</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={[styles.dateText, !dueDate && styles.dateTextMuted]}>
                      {dueDate ? relativeLabel(dueDate) : 'No due date'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.dateButton}>
                    <Text style={[styles.dateText, !dueDate && styles.dateTextMuted]}>
                      {dueDate ? relativeLabel(dueDate) : 'No due date'}
                    </Text>
                    {dueDate ? (
                      <Pressable
                        onPress={() => setDueDate(null)}
                        hitSlop={8}
                        style={({ hovered }) => [styles.clearBtnWeb, hovered && styles.clearInlineBtnHovered]}
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
                )
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
              <Pressable
                onPress={handleDelete}
                style={({ hovered }) => [styles.deleteBtn, hovered && styles.deleteBtnHovered]}
                hitSlop={8}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <View style={styles.footerRight}>
              <Pressable
                onPress={closeWithAnimation}
                style={({ pressed, hovered }) => [
                  styles.cancelBtn,
                  hovered && styles.cancelBtnHovered,
                  pressed && styles.cancelBtnPressed,
                ]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                style={({ pressed, hovered }) => [
                  styles.saveBtn,
                  hovered && styles.saveBtnHovered,
                  pressed && styles.saveBtnPressed,
                ]}
              >
                <Text style={styles.saveText}>{isEditing ? 'Save' : 'Add task'}</Text>
              </Pressable>
            </View>
          </View>
    </>
  );

  if (desktopWeb) {
    const subjectPanelWidth = subjectPanelProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 456],
    });
    const subjectPanelTranslateX = subjectPanelProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [32, 0],
    });

    return (
      <Modal visible={visible} animationType="fade" transparent onRequestClose={closeWithAnimation}>
        <View style={styles.desktopBackdrop}>
          <Pressable style={styles.backdropFill} onPress={closeOrDismissKeyboard} />
          <View style={styles.desktopDialogRow}>
            <View style={[styles.sheet, styles.desktopTaskDialog, shadow.float]}>
              {formContent}
            </View>
            <Animated.View
              pointerEvents={subjectPanelVisible ? 'auto' : 'none'}
              style={[styles.desktopSubjectSlot, { width: subjectPanelWidth }]}
            >
              <Animated.View
                style={[
                  styles.desktopSubjectDialog,
                  shadow.float,
                  {
                    opacity: subjectPanelProgress,
                    transform: [{ translateX: subjectPanelTranslateX }],
                  },
                ]}
              >
                {subjectPanel}
              </Animated.View>
            </Animated.View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.backdropFill} onPress={closeOrDismissKeyboard} />
        <Animated.View
          style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}
        >
          {formContent}
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
      style={({ pressed, hovered }) => [
        styles.chip,
        active
          ? { backgroundColor: color.bg, borderColor: color.fg }
          : { backgroundColor: colors.card, borderColor: colors.border },
        hovered && (active ? { borderColor: color.fg } : styles.chipHovered),
        pressed && styles.chipPressed,
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
            {'No room or teacher set \u2014 tap "Manage" to add them.'}
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
    desktopBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    backdropFill: {
      ...StyleSheet.absoluteFillObject,
    },
    desktopDialogRow: {
      width: '100%',
      maxWidth: 1024,
      height: '88%',
      maxHeight: '88%',
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '90%',
      paddingBottom: spacing.lg,
    },
    desktopTaskDialog: {
      width: 520,
      maxHeight: undefined,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    desktopSubjectSlot: {
      overflow: 'hidden',
    },
    desktopSubjectDialog: {
      width: 440,
      height: '100%',
      marginLeft: spacing.lg,
    },
    dragZone: {
      // Big hit area at the top of the sheet for swipe-down-to-dismiss.
      paddingBottom: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    desktopFormHeaderWrap: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: spacing.xs,
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
    manageLinkHovered: {
      backgroundColor: colors.primarySoft,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      marginHorizontal: -spacing.xs,
      marginVertical: -2,
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
    chipHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    chipPressed: {
      opacity: 0.75,
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
    addSubjectChipHovered: {
      backgroundColor: colors.primarySoft,
    },
    addSubjectChipPressed: {
      opacity: 0.75,
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
    desktopDateGroup: {
      gap: spacing.xs,
    },
    desktopDateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    clearDateBtnDesktop: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearDateBtnHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    clearDateBtnPressed: {
      opacity: 0.75,
    },
    clearBtnWeb: {
      position: 'relative',
      zIndex: 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
    },
    clearInlineBtnHovered: {
      backgroundColor: colors.primarySoft,
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
      borderRadius: radius.sm,
    },
    deleteBtnHovered: {
      backgroundColor: colors.dangerSoftHover,
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
    cancelBtnHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    cancelBtnPressed: {
      opacity: 0.78,
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
    saveBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    saveBtnPressed: {
      opacity: 0.78,
    },
    saveText: {
      color: '#fff',
      fontWeight: '700',
    },
  });
