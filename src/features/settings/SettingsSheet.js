import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  ScrollView,
  Animated,
  PanResponder,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import {
  useTheme,
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  previewColorsFor,
  isValidHex,
  softFromPrimary,
} from '../../shared/theme';

const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || '';

const LEGAL_CONTENT = {
  privacy: {
    title: 'Privacy',
    body: [
      'StudyStackr is a schoolwork planner for creating tasks, subjects, friends, chats, and profile details.',
      'When you sign in, the app uses your email address to create and secure your account. App content you save may be synced with the cloud database so it can be available across your devices.',
      'Profile names, usernames, avatars, friend requests, chat rooms, messages, subjects, and tasks are used only to provide the app features shown on this site.',
      'Do not enter passwords from other services. This sign-in form is only for your StudyStackr account.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      'Use StudyStackr only for your own schoolwork, planning, and communication with people you know.',
      'You are responsible for the information you add to tasks, profile fields, subjects, friends, and chats.',
      "Do not use the app to impersonate another person, collect someone else\u2019s credentials, post harmful content, or misuse the service.",
      'The app is provided as a school planner and may change as features are improved.',
    ],
  },
  contact: {
    title: 'Contact',
    body: [
      SUPPORT_EMAIL
        ? `For support, questions, or account help, contact ${SUPPORT_EMAIL}.`
        : 'For support, questions, or account help, contact the owner or administrator who gave you access to this app.',
      'If you believe this website has been flagged incorrectly, report it to the app owner so they can review the deployment and request a Google Safe Browsing review.',
    ],
  },
};

// A palette of pickable primary colors for the custom-theme builder. Users
// can also type a hex code manually.
const CUSTOM_COLOR_OPTIONS = [
  '#FF3E38', '#F97316', '#F59E0B', '#EAB308',
  '#10B981', '#059669', '#14B8A6', '#06B6D4',
  '#3B82F6', '#5B6CFF', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#EC4899', '#F43F5E',
  '#64748B', '#374151', '#000000', '#FFFFFF',
];

// Full-screen settings window: account, theme gallery, and custom theme builder.
export default function SettingsSheet({
  visible,
  embedded = false,
  onClose,
  session = null,
  onSignOut,
  enhanceMotion = false,
  onEnhanceMotionChange,
  onShowChangelog,
}) {
  const {
    colors,
    spacing,
    radius,
    typography,
    shadow,
    themeKey,
    customThemes,
    setTheme,
    addCustomTheme,
    deleteCustomTheme,
  } = useTheme();

  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  // Local draft synced each time Settings opens; only Confirm applies it.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draftThemeKey, setDraftThemeKey] = useState(themeKey);
  const [legalPage, setLegalPage] = useState(null);
  const initialThemeKeyRef = useRef(themeKey);

  useEffect(() => {
    if (visible) {
      setBuilderOpen(false);
      setLegalPage(null);
      setDraftThemeKey(themeKey);
      initialThemeKeyRef.current = themeKey;
    }
  }, [visible]);

  const handleCancel = () => {
    if (themeKey !== initialThemeKeyRef.current) setTheme(initialThemeKeyRef.current);
    setDraftThemeKey(initialThemeKeyRef.current);
    onClose();
  };

  const handleConfirm = () => {
    if (draftThemeKey !== themeKey) setTheme(draftThemeKey);
    initialThemeKeyRef.current = draftThemeKey;
    onClose();
  };

  const confirmDeleteCustom = (theme) => {
    const run = () => deleteCustomTheme(theme.key);
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${theme.label}"?`)) run();
      return;
    }
    Alert.alert(`Delete "${theme.label}"?`, 'This theme will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const allThemeKeys = [...THEME_PRESET_KEYS, ...customThemes.map((t) => t.key)];

  const content = (
      <View style={styles.settingsScreen}>
        <View style={styles.settingsWindow}>
          <View style={styles.settingsWindowHeader}>
            <View style={styles.settingsHeader}>
              <Pressable
                onPress={handleCancel}
                hitSlop={8}
                style={({ hovered }) => [styles.settingsHeaderSide, hovered && styles.headerTextButtonHovered]}
              >
                <Text style={styles.doneText}>Cancel</Text>
              </Pressable>
              <Text style={styles.settingsTitle} numberOfLines={1}>Settings</Text>
              <Pressable
                onPress={handleConfirm}
                hitSlop={8}
                style={({ hovered }) => [styles.settingsHeaderSide, hovered && styles.headerTextButtonHovered]}
              >
                <Text style={[styles.doneText, styles.confirmText]}>Confirm</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Theme gallery */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>Theme</Text>
                <Pressable
                  onPress={() => setBuilderOpen(true)}
                  hitSlop={8}
                  style={({ hovered }) => hovered && styles.headerTextButtonHovered}
                >
                  <Text style={styles.addLink}>+ New theme</Text>
                </Pressable>
              </View>
              <View style={styles.themeGrid}>
                {allThemeKeys.map((key) => {
                  const preview = previewColorsFor(key, customThemes);
                  const selected = draftThemeKey === key;
                  return (
                    <ThemeTile
                      key={key}
                      preview={preview}
                      selected={selected}
                      onPress={() => setDraftThemeKey(key)}
                      onLongPress={
                        preview.isCustom ? () => confirmDeleteCustom({ key, label: preview.label }) : undefined
                      }
                      styles={styles}
                    />
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Pick any theme, or tap "+ New theme" to design your own.
                Long-press a custom theme to delete it.
              </Text>
            </View>

            {Platform.OS === 'web' ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Experience</Text>
                <Pressable
                  onPress={() => onEnhanceMotionChange?.(!enhanceMotion)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: enhanceMotion }}
                  style={styles.switchRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchTitle}>Enhance motion</Text>
                    <Text style={styles.hint}>
                      Tween desktop workspace changes between sidebar pages.
                    </Text>
                  </View>
                  <View style={[styles.switchTrack, enhanceMotion && styles.switchTrackOn]}>
                    <View style={[styles.switchThumb, enhanceMotion && styles.switchThumbOn]} />
                  </View>
                </Pressable>
              </View>
            ) : null}

            {/* What's new */}
            {onShowChangelog ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>About</Text>
                <Pressable
                  onPress={() => {
                    handleCancel();
                    onShowChangelog?.();
                  }}
                  style={styles.changelogRow}
                  accessibilityRole="button"
                  accessibilityLabel="Show what's new"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.changelogTitle}>What's new</Text>
                    <Text style={styles.hint}>Recent updates and improvements.</Text>
                  </View>
                  <Text style={styles.changelogChevron}>{'\u203A'}</Text>
                </Pressable>
                {Platform.OS === 'web' ? (
                  <View style={styles.legalGrid}>
                    {Object.keys(LEGAL_CONTENT).map((key) => (
                      <Pressable
                        key={key}
                        onPress={() => setLegalPage(key)}
                        accessibilityRole="button"
                        style={styles.legalCard}
                      >
                        <Text style={styles.legalCardTitle}>{LEGAL_CONTENT[key].title}</Text>
                        <Text style={styles.hint} numberOfLines={2}>
                          {key === 'privacy'
                            ? 'How account and app data are used.'
                            : key === 'terms'
                              ? 'Rules for using StudyStackr.'
                              : 'Support and ownership information.'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Account (only shown when signed in via Supabase) */}
            {session ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Account</Text>
                <View style={styles.accountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountEmail} numberOfLines={1}>
                      {session?.user?.email || 'Signed in'}
                    </Text>
                    <Text style={styles.hint}>
                      Your tasks sync to the cloud while you're signed in.
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      if (window.confirm('Sign out of this account?')) {
                        onSignOut?.();
                      }
                      return;
                    }
                    Alert.alert(
                      'Sign out?',
                      'You can sign back in any time.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Sign out', style: 'destructive', onPress: () => onSignOut?.() },
                      ]
                    );
                  }}
                  style={styles.signOutBtn}
                >
                  <Text style={styles.signOutText}>Sign out</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          {/* Custom theme builder (inline modal on top) */}
          <CustomThemeBuilder
            visible={builderOpen}
            onClose={() => setBuilderOpen(false)}
            onCreate={(draft) => {
              const created = addCustomTheme(draft);
              if (created?.key) setDraftThemeKey(created.key);
              setBuilderOpen(false);
            }}
          />

          {Platform.OS === 'web' ? (
            <LegalModal
              page={legalPage}
              styles={styles}
              onClose={() => setLegalPage(null)}
            />
          ) : null}
        </View>
      </View>
  );

  if (embedded) {
    if (!visible) return null;
    return content;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel} presentationStyle="fullScreen">
      {content}
    </Modal>
  );
}

// A card that previews a theme using its actual bg / card / primary colors.
function ThemeTile({ preview, selected, onPress, onLongPress, styles }) {
  const border = selected ? preview.primary : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={({ pressed, hovered }) => [
        styles.themeTile,
        { borderColor: border, backgroundColor: preview.bg },
        hovered && { borderColor: preview.primary },
        pressed && styles.themeTilePressed,
      ]}
      accessibilityLabel={preview.label}
      accessibilityRole="button"
    >
      <View style={styles.themeTileTop}>
        <Text style={styles.themeTileEmoji}>
          {preview.emoji || (preview.isDark ? '\u{1F311}' : '\u{1F3A8}')}
        </Text>
        {selected ? (
          <View style={[styles.themeTileCheck, { backgroundColor: preview.primary }]}>
            <Text style={styles.themeTileCheckText}>{'\u2713'}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.themeTileCardRow, { backgroundColor: preview.card, borderColor: preview.border }]}>
        <View style={[styles.themeTileDot, { backgroundColor: preview.primary }]} />
        <View style={styles.themeTileLines}>
          <View style={[styles.themeTileLine, { backgroundColor: preview.text, opacity: 0.9 }]} />
          <View style={[styles.themeTileLine, styles.themeTileLineShort, { backgroundColor: preview.textMuted, opacity: 0.6 }]} />
        </View>
      </View>
      <Text style={[styles.themeTileLabel, { color: preview.text }]} numberOfLines={1}>
        {preview.label}{preview.isCustom ? ' \u2728' : ''}
      </Text>
    </Pressable>
  );
}

// Inline modal (layered on top of the settings sheet) for creating a
// custom theme. Asks for: name, light/dark base, primary color.
function CustomThemeBuilder({ visible, onClose, onCreate }) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [name, setName] = useState('');
  const [baseIsDark, setBaseIsDark] = useState(false);
  const [primary, setPrimary] = useState('#5B6CFF');

  const builderScreenHeight = Dimensions.get('window').height;
  // Lazy-init Animated.Value so re-renders don't churn it.
  const builderTranslateYRef = useRef(null);
  if (builderTranslateYRef.current == null) {
    builderTranslateYRef.current = new Animated.Value(builderScreenHeight);
  }
  const builderTranslateY = builderTranslateYRef.current;
  const builderMountedRef = useRef(true);

  useEffect(() => {
    builderMountedRef.current = true;
    return () => {
      builderMountedRef.current = false;
    };
  }, []);

  const closeBuilderWithAnimation = useCallback(() => {
    Animated.timing(builderTranslateY, {
      toValue: builderScreenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (builderMountedRef.current) onClose?.();
    });
  }, [builderScreenHeight, builderTranslateY, onClose]);
  const isBuilderHeaderDrag = (event, gs) => {
    const y = event.nativeEvent.locationY ?? 0;
    return y <= 112 && gs.dy > 2 && Math.abs(gs.dy) > Math.abs(gs.dx);
  };

  const builderPanResponder = useMemo(
    () =>
      PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: isBuilderHeaderDrag,
      onMoveShouldSetPanResponderCapture: isBuilderHeaderDrag,
      onPanResponderGrant: () => {
        builderTranslateY.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) builderTranslateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const dismissed = gs.dy > 100 || gs.vy > 0.5;
        if (dismissed) {
          closeBuilderWithAnimation();
        } else {
          Animated.spring(builderTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    }),
    [closeBuilderWithAnimation, builderTranslateY]
  );

  useEffect(() => {
    if (visible) {
      setName('');
      setBaseIsDark(false);
      setPrimary('#5B6CFF');
      builderTranslateY.setValue(builderScreenHeight);
      Animated.spring(builderTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
    }
  }, [visible, builderTranslateY, builderScreenHeight]);

  const canCreate = name.trim().length > 0 && isValidHex(primary);

  const softPreview = softFromPrimary(primary, baseIsDark);
  const basePalette = baseIsDark
    ? { bg: '#0F1218', card: '#1A1F2B', text: '#F3F4F8', textMuted: '#9CA3AF', border: '#2A2F3D' }
    : { bg: '#F5F6FA', card: '#FFFFFF', text: '#1A1D29', textMuted: '#6B7280', border: '#E5E7EB' };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeBuilderWithAnimation}>
      <View style={styles.builderBackdrop}>
        <Pressable style={styles.backdropFill} onPress={closeBuilderWithAnimation} />
        <Animated.View
          style={[styles.builderSheet, shadow.float, { transform: [{ translateY: builderTranslateY }] }]}
        >
          <View style={styles.dragZone} {...builderPanResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>New theme</Text>
              <Pressable
                onPress={closeBuilderWithAnimation}
                hitSlop={8}
                style={({ hovered }) => hovered && styles.headerTextButtonHovered}
              >
                <Text style={styles.doneText}>Cancel</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Theme name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Cherry blossom"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoFocus
                maxLength={32}
              />
            </View>

            {/* Base mode */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Base</Text>
              <View style={styles.segment}>
                <SegmentButton
                  label={'\u2600\uFE0F  Light base'}
                  active={!baseIsDark}
                  onPress={() => setBaseIsDark(false)}
                  styles={styles}
                />
                <SegmentButton
                  label={'\u{1F319}  Dark base'}
                  active={baseIsDark}
                  onPress={() => setBaseIsDark(true)}
                  styles={styles}
                />
              </View>
              <Text style={styles.hint}>
                Sets the overall background and text colors.
              </Text>
            </View>

            {/* Primary color */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Primary color</Text>
              <View style={styles.colorGrid}>
                {CUSTOM_COLOR_OPTIONS.map((hex) => {
                  const selected = primary.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => setPrimary(hex)}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: hex },
                        selected && { borderColor: colors.text, borderWidth: 3 },
                      ]}
                      accessibilityLabel={hex}
                    />
                  );
                })}
              </View>
              <TextInput
                value={primary}
                onChangeText={(v) => setPrimary(v.startsWith('#') ? v : `#${v}`)}
                placeholder="#RRGGBB"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, { marginTop: spacing.sm }]}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
              />
              {!isValidHex(primary) ? (
                <Text style={[styles.hint, { color: colors.danger }]}>
                  Hex must look like #RRGGBB (or #RGB).
                </Text>
              ) : null}
            </View>

            {/* Live preview */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Preview</Text>
              <View
                style={[
                  styles.previewPane,
                  { backgroundColor: basePalette.bg, borderColor: basePalette.border },
                ]}
              >
                <Text style={[styles.previewTitle, { color: basePalette.text }]}>
                  {name.trim() || 'Your theme'}
                </Text>
                <View
                  style={[
                    styles.previewCard,
                    { backgroundColor: basePalette.card, borderColor: basePalette.border },
                  ]}
                >
                  <View style={[styles.previewDot, { backgroundColor: primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: basePalette.text, fontWeight: '600' }}>
                      Read Chapter 4
                    </Text>
                    <Text style={{ color: basePalette.textMuted, fontSize: 12 }}>
                      Due tomorrow
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: softPreview,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text style={{ color: primary, fontSize: 12, fontWeight: '700' }}>
                      Soon
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: primary,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    marginTop: spacing.sm,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    Sample button
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          <View style={styles.builderFooter}>
            <Pressable
              onPress={closeBuilderWithAnimation}
              style={[styles.cancelBtn]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => canCreate && onCreate({ name, baseIsDark, primary })}
              disabled={!canCreate}
              style={[styles.saveBtn, !canCreate && { opacity: 0.5 }]}
            >
              <Text style={styles.saveText}>Create theme</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SegmentButton({ label, active, onPress, styles }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.segmentBtn,
        active && styles.segmentBtnActive,
        hovered && (active ? styles.segmentBtnActiveHovered : styles.segmentBtnHovered),
        pressed && styles.segmentBtnPressed,
      ]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LegalModal({ page, styles, onClose }) {
  const content = page ? LEGAL_CONTENT[page] : null;
  return (
    <Modal visible={!!content} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.legalBackdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.legalPanel}>
          <View style={styles.legalHeader}>
            <Text style={styles.legalTitle}>{content?.title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ hovered }) => hovered && styles.headerTextButtonHovered}
            >
              <Text style={styles.legalClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.legalBody}>
            {content?.body.map((paragraph, index) => (
              <Text key={index} style={styles.legalParagraph}>
                {paragraph}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    settingsScreen: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingTop: Platform.OS === 'ios' ? 44 : Platform.OS === 'web' ? 0 : spacing.lg,
    },
    settingsWindow: {
      flex: 1,
      backgroundColor: colors.bg,
      width: '100%',
    },
    settingsWindowHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    settingsHeader: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    settingsHeaderSide: {
      width: 82,
    },
    settingsTitle: {
      ...typography.title,
      flex: 1,
      fontSize: 20,
      textAlign: 'center',
    },
    settingsScroll: {
      flex: 1,
    },
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
      maxWidth: Platform.OS === 'web' ? 720 : undefined,
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
    headerTextButtonHovered: {
      backgroundColor: colors.primarySoft,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      marginHorizontal: -spacing.xs,
      marginVertical: -2,
    },
    confirmText: {
      textAlign: 'right',
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.xl,
    },
    section: {
      gap: spacing.sm,
    },
    sectionLabel: {
      ...typography.label,
      textTransform: 'uppercase',
      marginBottom: spacing.xs,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    addLink: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    hint: {
      ...typography.bodyMuted,
      fontSize: 13,
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
    // Segmented control
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      padding: 4,
      gap: 4,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: radius.md - 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnActive: {
      backgroundColor: colors.card,
    },
    segmentBtnHovered: {
      backgroundColor: colors.cardMutedHover,
    },
    segmentBtnActiveHovered: {
      backgroundColor: colors.cardHover,
    },
    segmentBtnPressed: {
      opacity: 0.78,
    },
    segmentText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: colors.text,
    },

    // Theme gallery
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      paddingTop: spacing.xs,
    },
    themeTile: {
      width: 148,
      borderRadius: radius.lg,
      borderWidth: 2,
      padding: spacing.md,
      gap: spacing.sm,
    },
    themeTilePressed: {
      opacity: 0.78,
    },
    themeTileTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    themeTileEmoji: {
      fontSize: 18,
    },
    themeTileCheck: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeTileCheckText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '800',
      lineHeight: 14,
    },
    themeTileCardRow: {
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    themeTileDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    themeTileLines: {
      flex: 1,
      gap: 4,
    },
    themeTileLine: {
      height: 5,
      borderRadius: 3,
    },
    themeTileLineShort: {
      width: '60%',
    },
    themeTileLabel: {
      fontSize: 13,
      fontWeight: '700',
    },

    // Custom theme builder
    builderBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    builderSheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '92%',
      paddingBottom: spacing.lg,
    },
    colorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    colorSwatch: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    previewPane: {
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    previewTitle: {
      fontSize: 18,
      fontWeight: '700',
    },
    previewCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md,
    },
    previewDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    builderFooter: {
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

    // Account section
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    accountEmail: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    signOutBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.dangerSoft,
      marginTop: spacing.sm,
    },
    signOutText: {
      color: colors.danger,
      fontWeight: '700',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    switchTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 2,
    },
    switchTrack: {
      width: 48,
      height: 28,
      borderRadius: radius.pill,
      backgroundColor: colors.borderStrong,
      padding: 3,
      justifyContent: 'center',
    },
    switchTrackOn: {
      backgroundColor: colors.primary,
    },
    switchThumb: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.card,
    },
    switchThumbOn: {
      alignSelf: 'flex-end',
    },

    // What's-new row
    changelogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    changelogTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    changelogChevron: {
      color: colors.textMuted,
      fontSize: 22,
      lineHeight: 22,
    },
    legalGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    legalCard: {
      flexGrow: 1,
      flexBasis: 180,
      minHeight: 82,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing.md,
      justifyContent: 'center',
      gap: spacing.xs,
    },
    legalCardTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
    },
    legalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    legalPanel: {
      width: '100%',
      maxWidth: 560,
      maxHeight: '82%',
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    legalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    legalTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '900',
    },
    legalClose: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '800',
    },
    legalBody: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    legalParagraph: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 21,
    },
  });
