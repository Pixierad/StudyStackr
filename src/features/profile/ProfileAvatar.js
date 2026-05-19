import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

import { normalizeProfile } from '../../shared/profile';
import { useTheme } from '../../shared/theme';

export default function ProfileAvatar({ profile, size = 44, style }) {
  const { colors, radius } = useTheme();
  const avatar = normalizeProfile(profile);
  const styles = useMemo(
    () => makeStyles({ colors, radius, size }),
    [colors, radius, size]
  );

  return (
    <View style={[styles.wrap, style]}>
      {avatar.avatarType === 'image' ? (
        <Image source={{ uri: avatar.avatarValue }} style={styles.image} />
      ) : (
        <Text style={styles.emoji}>{avatar.avatarValue}</Text>
      )}
    </View>
  );
}

const makeStyles = ({ colors, radius, size }) =>
  StyleSheet.create({
    wrap: {
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
  });
