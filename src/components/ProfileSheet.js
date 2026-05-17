import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { useTheme } from '../theme';
import { AVATAR_EMOJIS, isValidUsername, normalizeProfile, normalizeUsername } from '../profile';
import { MAX_PROFILE_IMAGE_BYTES, pickProfileImage } from '../utils/pickProfileImage';
import ProfileAvatar from './ProfileAvatar';

export default function ProfileSheet({
  visible,
  onClose,
  profile,
  onProfileChange,
}) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const resolvedProfile = useMemo(() => normalizeProfile(profile), [profile]);
  const [draftName, setDraftName] = useState(resolvedProfile.name);
  const [draftUsername, setDraftUsername] = useState(resolvedProfile.username);
  const [draftAvatarType, setDraftAvatarType] = useState(resolvedProfile.avatarType);
  const [draftAvatarValue, setDraftAvatarValue] = useState(resolvedProfile.avatarValue);
  const [profileError, setProfileError] = useState(null);
  const fileInputRef = useRef(null);

  const screenHeight = Dimensions.get('window').height;
  const translateYRef = useRef(null);
  if (translateYRef.current == null) translateYRef.current = new Animated.Value(screenHeight);
  const translateY = translateYRef.current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setDraftName(resolvedProfile.name);
      setDraftUsername(resolvedProfile.username);
      setDraftAvatarType(resolvedProfile.avatarType);
      setDraftAvatarValue(resolvedProfile.avatarValue);
      setProfileError(null);
      translateY.setValue(screenHeight);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
    }
  }, [
    visible,
    resolvedProfile.name,
    resolvedProfile.username,
    resolvedProfile.avatarType,
    resolvedProfile.avatarValue,
    screenHeight,
    translateY,
  ]);

  const hasProfileChanges = useMemo(
    () =>
      draftName.trim() !== resolvedProfile.name ||
      normalizeUsername(draftUsername) !== resolvedProfile.username ||
      draftAvatarType !== resolvedProfile.avatarType ||
      draftAvatarValue !== resolvedProfile.avatarValue,
    [
      draftAvatarType,
      draftAvatarValue,
      draftName,
      draftUsername,
      resolvedProfile.avatarType,
      resolvedProfile.avatarValue,
      resolvedProfile.name,
      resolvedProfile.username,
    ]
  );

  const commitProfile = useCallback(() => {
    const next = normalizeProfile({
      ...resolvedProfile,
      name: draftName.trim(),
      username: normalizeUsername(draftUsername),
      avatarType: draftAvatarType,
      avatarValue: draftAvatarValue,
    });
    if (!isValidUsername(next.username)) {
      setProfileError('Username must be at least 3 characters.');
      return false;
    }
    setProfileError(null);
    if (hasProfileChanges) onProfileChange?.(next);
    return true;
  }, [
    draftAvatarType,
    draftAvatarValue,
    draftName,
    draftUsername,
    hasProfileChanges,
    onProfileChange,
    resolvedProfile,
  ]);

  const closeWithAnimation = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onClose?.();
    });
  }, [onClose, screenHeight, translateY]);

  const confirmAndClose = useCallback(() => {
    if (!commitProfile()) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
      return;
    }
    closeWithAnimation();
  }, [closeWithAnimation, commitProfile, translateY]);

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

  const setAvatar = (avatarType, avatarValue) => {
    setDraftAvatarType(avatarType);
    setDraftAvatarValue(avatarValue);
    setProfileError(null);
  };

  const updateUsername = (value) => {
    setDraftUsername(normalizeUsername(value));
    setProfileError(null);
  };

  const handleUploadPress = async () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click?.();
      return;
    }

    const result = await pickProfileImage();
    if (!result) return;
    if (result.errorMessage) {
      if (result.errorTitle) Alert.alert(result.errorTitle, result.errorMessage);
      else setProfileError(result.errorMessage);
      return;
    }
    setAvatar('image', result.uri);
  };

  const handleWebImageUpload = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      setProfileError('Choose an image under 1.5 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      setAvatar('image', value);
      event.target.value = '';
    };
    reader.onerror = () => {
      setProfileError('Could not read that image.');
      event.target.value = '';
    };
    reader.readAsDataURL(file);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={closeWithAnimation} />
        <Animated.View
          style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}
        >
          <View style={styles.dragZone} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Profile</Text>
              <View style={styles.headerActions}>
                <Pressable onPress={closeWithAnimation} hitSlop={8}>
                  <Text style={styles.doneText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={confirmAndClose} hitSlop={8}>
                  <Text style={[styles.doneText, styles.confirmText]}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Public profile</Text>
              <View style={styles.profileTopRow}>
                <ProfileAvatar
                  profile={{
                    ...resolvedProfile,
                    avatarType: draftAvatarType,
                    avatarValue: draftAvatarValue,
                  }}
                  size={76}
                />
                <View style={styles.avatarActions}>
                  <Pressable onPress={handleUploadPress} style={styles.uploadBtn}>
                    <Text style={styles.uploadBtnText}>Upload image</Text>
                  </Pressable>
                  {draftAvatarType === 'image' ? (
                    <Pressable
                      onPress={() => setAvatar('emoji', AVATAR_EMOJIS[0])}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>Use emoji</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {Platform.OS === 'web'
                ? React.createElement('input', {
                    ref: fileInputRef,
                    type: 'file',
                    accept: 'image/*',
                    style: { display: 'none' },
                    onChange: handleWebImageUpload,
                  })
                : null}
              <View style={styles.emojiGrid}>
                {AVATAR_EMOJIS.map((emoji) => {
                  const selected = draftAvatarType === 'emoji' && draftAvatarValue === emoji;
                  return (
                    <Pressable
                      key={emoji}
                      onPress={() => setAvatar('emoji', emoji)}
                      style={[styles.emojiOption, selected && styles.emojiOptionSelected]}
                      accessibilityLabel={`Use ${emoji} as profile picture`}
                    >
                      <Text style={styles.emojiOptionText}>{emoji}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={draftName}
                onChangeText={(value) => {
                  setDraftName(value);
                  setProfileError(null);
                }}
                placeholder="Enter your name"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                returnKeyType="done"
                autoCorrect={false}
              />
              <View style={styles.usernameRow}>
                <Text style={styles.usernamePrefix}>@</Text>
                <TextInput
                  value={draftUsername}
                  onChangeText={updateUsername}
                  placeholder="username"
                  placeholderTextColor={colors.textFaint}
                  style={[styles.input, styles.usernameInput]}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={24}
                />
              </View>
              {profileError ? (
                <View style={styles.profileErrorBox}>
                  <Text style={styles.profileErrorText}>{profileError}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
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
      maxWidth: Platform.OS === 'web' ? 560 : undefined,
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
      gap: spacing.md,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    title: {
      ...typography.title,
      fontSize: 22,
      flex: 1,
    },
    doneText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
    },
    confirmText: {
      fontWeight: '800',
    },
    content: {
      paddingHorizontal: spacing.lg,
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
    profileTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    avatarActions: {
      flex: 1,
      gap: spacing.sm,
      alignItems: 'flex-start',
    },
    uploadBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    uploadBtnText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '800',
    },
    secondaryBtn: {
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    secondaryBtnText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    emojiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    emojiOption: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emojiOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    emojiOptionText: {
      fontSize: 22,
      lineHeight: 26,
    },
    usernameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    usernamePrefix: {
      paddingLeft: spacing.md,
      color: colors.textMuted,
      fontSize: 16,
      fontWeight: '800',
    },
    usernameInput: {
      flex: 1,
      borderWidth: 0,
      backgroundColor: 'transparent',
      paddingLeft: spacing.xs,
    },
    profileErrorBox: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    profileErrorText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '700',
    },
  });
