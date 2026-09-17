import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

// The parent owns the switch's press target and accessibility state.
export default function ToggleTrack({ checked, enhanceMotion = false }) {
  const progress = useRef(new Animated.Value(checked ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: checked ? 1 : 0,
      duration: enhanceMotion ? 180 : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [checked, enhanceMotion, progress]);

  return (
    <View style={[styles.track, checked && styles.trackOn]} pointerEvents="none">
      <Animated.View
        style={[styles.thumb, {
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: '#dc2626' },
  trackOn: { backgroundColor: '#16a34a' },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' },
});
