import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Alert,
  Animated,
  PanResponder,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../shared/theme';
import { resolveSubjectStyle, SUBJECT_COLOR_PRESETS } from '../../shared/utils/subjects';

export default function SubjectManager({
  visible,
  embedded = false,
  subjects,
  onChange,
  onClose,
  taskCountsBySubject = {},
}) {
  const { colors, spacing, radius, typography, shadow, colorForSubject, isDark } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (visible) setEditing(null);
  }, [visible]);

  const screenHeight = Dimensions.get('window').height;
  const screenHeightRef = useRef(screenHeight);
  // Lazy-init Animated.Value (otherwise a fresh one is created and discarded
  // on every re-render).
  const translateYRef = useRef(null);
  if (translateYRef.current == null) translateYRef.current = new Animated.Value(0);
  const translateY = translateYRef.current;

  // Mount tracking guards animation continuations against firing after
  // the parent has unmounted or advanced past this state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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

  const closeWithAnimation = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenHeightRef.current,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onClose?.();
    });
  }, [onClose, translateY]);
  const isHeaderDrag = (event, gs) => {
    const y = event.nativeEvent.locationY ?? 0;
    return y <= 112 && gs.dy > 2 && Math.abs(gs.dy) > Math.abs(gs.dx);
  };

  const panResponder = useMemo(
    () =>
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
    }),
    [closeWithAnimation, translateY]
  );

  const handleSaveSubject = (next) => {
    const previousName =
      editing && editing.index != null ? subjects[editing.index]?.name ?? null : null;
    const name = (next.name || '').trim();
    if (!name) {
      Alert.alert('Missing name', 'Subject needs a name.');
      return false;
    }
    const dup = subjects.some(
      (s, i) =>
        s.name.toLowerCase() === name.toLowerCase() &&
        i !== (editing?.index ?? -1)
    );
    if (dup) {
      Alert.alert('Already exists', `"${name}" is already in your subjects.`);
      return false;
    }

    const cleaned = {
      name,
      room: (next.room || '').trim(),
      teacher: (next.teacher || '').trim(),
      color: next.color || null,
    };

    if (editing && editing.index != null) {
      const updated = subjects.map((s, i) => (i === editing.index ? cleaned : s));
      onChange(updated, { renamedFrom: previousName, renamedTo: cleaned.name });
    } else {
      onChange([...subjects, cleaned]);
    }
    return true;
  };

  const remove = (index) => {
    const subject = subjects[index];
    if (!subject) return;
    const count = taskCountsBySubject[subject.name] ?? 0;
    const message =
      count > 0
        ? `"${subject.name}" is used by ${count} task${count === 1 ? '' : 's'}. Those tasks will lose their subject tag.`
        : `Remove "${subject.name}" from your subjects?`;
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove subject?\n\n${message}`)) {
        onChange(subjects.filter((_, i) => i !== index));
      }
      return;
    }
    Alert.alert('Remove subject?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onChange(subjects.filter((_, i) => i !== index)),
      },
    ]);
  };

  if (embedded) {
    if (!visible) return null;
    return (
      <View style={[styles.sheet, styles.embeddedWindow, shadow.card]}>
        <View style={styles.embeddedHeader}>
          <View style={styles.header}>
            <Text style={styles.title}>Subjects</Text>
            {onClose ? (
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={({ hovered }) => hovered && styles.headerTextButtonHovered}
              >
                <Text style={styles.doneText}>Close</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.addRow}>
          <Pressable
            onPress={() => setEditing({ index: null, draft: blankSubject() })}
            style={({ pressed, hovered }) => [
              styles.addBtn,
              hovered && styles.addBtnHovered,
              pressed && styles.addBtnPressed,
            ]}
          >
            <Text style={styles.addBtnText}>+ Add subject</Text>
          </Pressable>
        </View>

        {subjects.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No subjects yet. Add a few to organize your tasks by class.
            </Text>
          </View>
        ) : (
          <FlatList
            data={subjects}
            keyExtractor={(item, i) => `${item.name}-${i}`}
            style={styles.listOuter}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item, index }) => {
              const color = resolveSubjectStyle(item.name, subjects, { colorForSubject, isDark });
              const count = taskCountsBySubject[item.name] ?? 0;
              const meta = formatRowMeta(item, count);
              return (
                <Pressable
                  onPress={() => setEditing({ index, draft: { ...item } })}
                  style={({ pressed, hovered }) => [
                    styles.row,
                    { backgroundColor: color.bg },
                    hovered && { borderColor: color.fg },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: color.fg }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: color.fg }]}>{item.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      remove(index);
                    }}
                    hitSlop={8}
                    style={({ pressed, hovered }) => [
                      styles.removeBtn,
                      hovered && styles.removeBtnHovered,
                      pressed && styles.removeBtnPressed,
                    ]}
                  >
                    <Text style={styles.removeText}>{'\u00D7'}</Text>
                  </Pressable>
                </Pressable>
              );
            }}
          />
        )}

        <SubjectEditor
          visible={!!editing}
          embedded
          isNew={editing?.index == null}
          initial={editing?.draft}
          onCancel={() => setEditing(null)}
          onSave={handleSaveSubject}
        />
      </View>
    );
  }

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
              <Text style={styles.title}>Subjects</Text>
              <Pressable
                onPress={closeWithAnimation}
                hitSlop={8}
                style={({ hovered }) => hovered && styles.headerTextButtonHovered}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.addRow}>
            <Pressable
              onPress={() => setEditing({ index: null, draft: blankSubject() })}
              style={({ pressed, hovered }) => [
                styles.addBtn,
                hovered && styles.addBtnHovered,
                pressed && styles.addBtnPressed,
              ]}
            >
              <Text style={styles.addBtnText}>+ Add subject</Text>
            </Pressable>
          </View>

          {subjects.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No subjects yet. Add a few to organize your tasks by class.
              </Text>
            </View>
          ) : (
            <FlatList
              data={subjects}
              keyExtractor={(item, i) => `${item.name}-${i}`}
              style={styles.listOuter}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
              renderItem={({ item, index }) => {
                const color = resolveSubjectStyle(item.name, subjects, { colorForSubject, isDark });
                const count = taskCountsBySubject[item.name] ?? 0;
                const meta = formatRowMeta(item, count);
                return (
                  <Pressable
                    onPress={() => setEditing({ index, draft: { ...item } })}
                    style={({ pressed, hovered }) => [
                      styles.row,
                      { backgroundColor: color.bg },
                      hovered && { borderColor: color.fg },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={[styles.dot, { backgroundColor: color.fg }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: color.fg }]}>{item.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        remove(index);
                      }}
                      hitSlop={8}
                      style={({ pressed, hovered }) => [
                        styles.removeBtn,
                        hovered && styles.removeBtnHovered,
                        pressed && styles.removeBtnPressed,
                      ]}
                    >
                      <Text style={styles.removeText}>{'\u00D7'}</Text>
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          )}
        </Animated.View>

        <SubjectEditor
          visible={!!editing}
          isNew={editing?.index == null}
          initial={editing?.draft}
          onCancel={() => setEditing(null)}
          onSave={handleSaveSubject}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function blankSubject() {
  return { name: '', room: '', teacher: '', color: null };
}

function formatRowMeta(subject, count) {
  const parts = [];
  if (subject.room) parts.push(`Room ${subject.room}`);
  if (subject.teacher) parts.push(subject.teacher);
  parts.push(`${count} ${count === 1 ? 'task' : 'tasks'}`);
  return parts.join(' \u00B7 ');
}

function SubjectEditor({ visible, embedded = false, isNew, initial, onCancel, onSave }) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [teacher, setTeacher] = useState('');
  const [color, setColor] = useState(null);
  const nameInputRef = useRef(null);
  const roomInputRef = useRef(null);
  const teacherInputRef = useRef(null);
  const inputFocusedRef = useRef(false);
  const inputBlurTimerRef = useRef(null);
  const screenHeight = Dimensions.get('window').height;
  const screenHeightRef = useRef(screenHeight);
  const translateYRef = useRef(null);
  if (translateYRef.current == null) translateYRef.current = new Animated.Value(screenHeight);
  const translateY = translateYRef.current;
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
      setName(initial?.name ?? '');
      setRoom(initial?.room ?? '');
      setTeacher(initial?.teacher ?? '');
      setColor(initial?.color ?? null);
    }
  }, [visible, initial]);

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

  const closeWithAnimation = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenHeightRef.current,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onCancel?.();
    });
  }, [onCancel, translateY]);
  const isHeaderDrag = (event, gs) => {
    const y = event.nativeEvent.locationY ?? 0;
    return y <= 112 && gs.dy > 2 && Math.abs(gs.dy) > Math.abs(gs.dx);
  };

  const panResponder = useMemo(
    () =>
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
    }),
    [closeWithAnimation, translateY]
  );

  const submit = () => {
    if (onSave({ name, room, teacher, color }) !== false) {
      if (embedded) onCancel?.();
      else closeWithAnimation();
    }
  };

  const moveToRoom = useCallback(() => {
    roomInputRef.current?.focus?.();
  }, []);

  const moveToTeacher = useCallback(() => {
    teacherInputRef.current?.focus?.();
  }, []);

  const finishKeyboardEditing = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const markInputFocused = useCallback(() => {
    if (inputBlurTimerRef.current) clearTimeout(inputBlurTimerRef.current);
    inputFocusedRef.current = true;
  }, []);

  const markInputBlurred = useCallback(() => {
    if (inputBlurTimerRef.current) clearTimeout(inputBlurTimerRef.current);
    inputBlurTimerRef.current = setTimeout(() => {
      inputFocusedRef.current = false;
    }, 80);
  }, []);

  const closeOrDismissKeyboard = useCallback(() => {
    if (inputFocusedRef.current) {
      Keyboard.dismiss();
      return;
    }
    if (embedded) onCancel?.();
    else closeWithAnimation();
  }, [closeWithAnimation, embedded, onCancel]);

  if (embedded) {
    if (!visible) return null;
    return (
      <View style={styles.editorInlineOverlay}>
        <Pressable style={styles.backdropFill} onPress={closeOrDismissKeyboard} />
        <View style={[styles.editorSheet, styles.editorInlinePanel, shadow.float]}>
          <View style={styles.header}>
            <Text style={styles.title}>{isNew ? 'New subject' : 'Edit subject'}</Text>
            <Pressable
              onPress={onCancel}
              hitSlop={8}
              style={({ hovered }) => hovered && styles.headerTextButtonHovered}
            >
              <Text style={styles.doneText}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.editorContent}
          >
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                ref={nameInputRef}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Math"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoFocus={isNew}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={moveToRoom}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={40}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Room number</Text>
              <TextInput
                ref={roomInputRef}
                value={room}
                onChangeText={setRoom}
                placeholder="e.g. A-204"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={moveToTeacher}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={20}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Teacher</Text>
              <TextInput
                ref={teacherInputRef}
                value={teacher}
                onChangeText={setTeacher}
                placeholder="e.g. Ms. Patel"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={finishKeyboardEditing}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={40}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Color</Text>
              <View style={styles.colorRow}>
                <Pressable
                  onPress={() => setColor(null)}
                  style={({ pressed, hovered }) => [
                    styles.colorAuto,
                    hovered && styles.colorAutoHovered,
                    pressed && styles.colorPressed,
                    color == null && { borderColor: colors.text, borderWidth: 3 },
                  ]}
                >
                  <Text style={styles.colorAutoText}>Auto</Text>
                </Pressable>
                {SUBJECT_COLOR_PRESETS.map((hex) => {
                  const selected = color && color.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => setColor(hex)}
                      style={({ pressed, hovered }) => [
                        styles.colorSwatch,
                        { backgroundColor: hex },
                        hovered && styles.colorSwatchHovered,
                        pressed && styles.colorPressed,
                        selected && { borderColor: colors.text, borderWidth: 3 },
                      ]}
                      accessibilityLabel={hex}
                    />
                  );
                })}
              </View>
              <Text style={styles.hint}>
                "Auto" picks a color from the theme based on the subject name.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.editorFooter}>
            <Pressable
              onPress={onCancel}
              style={({ pressed, hovered }) => [
                styles.cancelBtn,
                hovered && styles.cancelBtnHovered,
                pressed && styles.cancelBtnPressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              style={({ pressed, hovered }) => [
                styles.saveBtn,
                hovered && styles.saveBtnHovered,
                pressed && styles.saveBtnPressed,
              ]}
            >
              <Text style={styles.saveText}>{isNew ? 'Add subject' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.editorBackdrop}
      >
        <Pressable style={styles.backdropFill} onPress={closeOrDismissKeyboard} />
        <Animated.View
          style={[styles.editorSheet, shadow.float, { transform: [{ translateY }] }]}
        >
          <View style={styles.dragZone} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{isNew ? 'New subject' : 'Edit subject'}</Text>
              <Pressable
                onPress={closeWithAnimation}
                hitSlop={8}
                style={({ hovered }) => hovered && styles.headerTextButtonHovered}
              >
                <Text style={styles.doneText}>Cancel</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.editorContent}
          >
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                ref={nameInputRef}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Math"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoFocus={isNew}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={moveToRoom}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={40}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Room number</Text>
              <TextInput
                ref={roomInputRef}
                value={room}
                onChangeText={setRoom}
                placeholder="e.g. A-204"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={moveToTeacher}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={20}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Teacher</Text>
              <TextInput
                ref={teacherInputRef}
                value={teacher}
                onChangeText={setTeacher}
                placeholder="e.g. Ms. Patel"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={finishKeyboardEditing}
                onFocus={markInputFocused}
                onBlur={markInputBlurred}
                maxLength={40}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Color</Text>
              <View style={styles.colorRow}>
                <Pressable
                  onPress={() => setColor(null)}
                  style={({ pressed, hovered }) => [
                    styles.colorAuto,
                    hovered && styles.colorAutoHovered,
                    pressed && styles.colorPressed,
                    color == null && { borderColor: colors.text, borderWidth: 3 },
                  ]}
                >
                  <Text style={styles.colorAutoText}>Auto</Text>
                </Pressable>
                {SUBJECT_COLOR_PRESETS.map((hex) => {
                  const selected = color && color.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => setColor(hex)}
                      style={({ pressed, hovered }) => [
                        styles.colorSwatch,
                        { backgroundColor: hex },
                        hovered && styles.colorSwatchHovered,
                        pressed && styles.colorPressed,
                        selected && { borderColor: colors.text, borderWidth: 3 },
                      ]}
                      accessibilityLabel={hex}
                    />
                  );
                })}
              </View>
              <Text style={styles.hint}>
                "Auto" picks a color from the theme based on the subject name.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.editorFooter}>
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
              onPress={submit}
              style={({ pressed, hovered }) => [
                styles.saveBtn,
                hovered && styles.saveBtnHovered,
                pressed && styles.saveBtnPressed,
              ]}
            >
              <Text style={styles.saveText}>{isNew ? 'Add subject' : 'Save'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    backdropFill: { ...StyleSheet.absoluteFillObject },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      height: '75%',
      paddingBottom: spacing.lg,
    },
    embeddedWindow: {
      flex: 1,
      position: 'relative',
      height: undefined,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    embeddedHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: spacing.xs,
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
    headerTextButtonHovered: {
      backgroundColor: colors.primarySoft,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      marginHorizontal: -spacing.xs,
      marginVertical: -2,
    },
    addRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    addBtn: {
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    addBtnPressed: {
      opacity: 0.78,
    },
    addBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 15,
    },
    empty: {
      flex: 1,
      padding: spacing.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      ...typography.bodyMuted,
      textAlign: 'center',
    },
    listOuter: {
      flex: 1,
    },
    list: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
      gap: spacing.md,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '700',
    },
    rowMeta: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    removeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.5)',
    },
    removeBtnHovered: {
      backgroundColor: colors.dangerSoftHover,
    },
    removeBtnPressed: {
      opacity: 0.7,
    },
    removeText: {
      fontSize: 20,
      fontWeight: '400',
      color: colors.textMuted,
      lineHeight: 22,
    },
    editorBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    editorInlineOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    editorSheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '90%',
      paddingBottom: spacing.lg,
    },
    editorInlinePanel: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 560,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    editorContent: {
      padding: spacing.lg,
      gap: spacing.lg,
    },
    field: {
      gap: spacing.sm,
    },
    fieldLabel: {
      ...typography.label,
      textTransform: 'uppercase',
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
    hint: {
      ...typography.bodyMuted,
      fontSize: 12,
    },
    colorRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    colorAuto: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
    },
    colorAutoHovered: {
      backgroundColor: colors.cardMutedHover,
      borderColor: colors.borderHover,
    },
    colorAutoText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
    },
    colorSwatch: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorSwatchHovered: {
      borderColor: colors.borderHover,
    },
    colorPressed: {
      opacity: 0.75,
    },
    editorFooter: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
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
