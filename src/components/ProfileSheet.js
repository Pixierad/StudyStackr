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

  const commitProfile = useCallback((patch = {}) => {
    const next = normalizeProfile({
      ...resolvedProfile,
      name: draftName.trim(),
      username: normalizeUsername(draftUsername),
      avatarType: draftAvatarType,
      avatarValue: draftAvatarValue,
      ...patch,
    });
    if (!isValidUsername(next.username)) {
      setProfileError('Username must be at least 3 characters.');
      return false;
    }
    setProfileError(null);
    const changed =
      next.name !== resolvedProfile.name ||
      next.username !== resolvedProfile.username ||
      next.avatarType !== resolvedProfile.avatarType ||
      next.avatarValue !== resolvedProfile.avatarValue;
    if (changed) onProfileChange?.(next);
    return true;
  }, [
    draftAvatarType,
    draftAvatarValue,
    draftName,
    draftUsername,
    onProfileChange,
    resolvedProfile,
  ]);

  const closeWithAnimation = useCallback(() => {
    if (!commitProfile()) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
      return;
    }
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onClose?.();
    });
  }, [commitProfile, onClose, screenHeight, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        gs.dy > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
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
    commitProfile({ avatarType, avatarValue });
  };

  const handleUploadPress = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click?.();
      return;
    }
    Alert.alert('Upload image', 'Image upload is available when using SchoolApp on the web.');
  };

  const handleWebImageUpload = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (file.size > 1500 * 1024) {
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
        <Animated.View style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}>
          <View style={styles.dragZone} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Profile</Text>
              <Pressable onPress={closeWithAnimation} hitSlop={8}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
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
                onChangeText={setDraftName}
                onBlur={() => commitProfile()}
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
                  onChangeText={(value) => setDraftUsername(normalizeUsername(value))}
                  onBlur={() => commitProfile()}
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
      justifyContent: 'flex-end',
    },
    backdropFill: { ...StyleSheet.absoluteFillObject },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '88%',
      paddingBottom: spacing.lg,
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
