import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

import { normalizeProfile } from '../../shared/profile';
import { useTheme } from '../../shared/theme';

export default function ProfileAvatar({
  profile,
  size = 44,
  style,
  showOnlineIndicator = false,
  isOnline = false,
}) {
  const { colors, radius } = useTheme();
  const avatar = normalizeProfile(profile);
  const indicatorSize = Math.max(10, Math.round(size * 0.28));
  const indicatorBorderWidth = Math.max(2, Math.round(size * 0.05));
  const styles = useMemo(
    () => makeStyles({ colors, radius, size, indicatorSize, indicatorBorderWidth }),
    [colors, radius, size, indicatorSize, indicatorBorderWidth]
  );

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.avatarCircle}>
        {avatar.avatarType === 'image' ? (
          <Image source={{ uri: avatar.avatarValue }} style={styles.image} />
        ) : (
          <Text style={styles.emoji}>{avatar.avatarValue}</Text>
        )}
      </View>
      {showOnlineIndicator && isOnline ? <View style={styles.onlineIndicator} /> : null}
    </View>
  );
}

const makeStyles = ({ colors, radius, size, indicatorSize, indicatorBorderWidth }) =>
  StyleSheet.create({
    wrap: {
      width: size,
      height: size,
    },
    avatarCircle: {
      width: size,
      height: size,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    emoji: {
      fontSize: Math.max(18, Math.round(size * 0.5)),
      lineHeight: Math.max(22, Math.round(size * 0.58)),
    },
    onlineIndicator: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: indicatorSize,
      height: indicatorSize,
      borderRadius: radius.pill,
      borderWidth: indicatorBorderWidth,
      borderColor: colors.card,
      backgroundColor: colors.success,
    },
  });
