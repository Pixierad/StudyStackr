import React, { useEffect, useRef } from 'react';
import { Animated, FlatList, Modal, Pressable, Text, View } from 'react-native';

import { useTheme } from '../shared/theme';
import ProfileAvatar from '../features/profile/ProfileAvatar';
import { SORT_OPTIONS, STATUS_ONLY_FILTERS } from '../features/tasks/taskSorting';
import { notificationTimeLabel } from './notifications';

function appVersionLabel() {
  const sha = process.env.EXPO_PUBLIC_APP_VERSION || 'dev';
  const built = process.env.EXPO_PUBLIC_APP_BUILT || '';
  return `v.${sha}${built ? ' ' + built : ''}`;
}

export function VersionBadge({ styles }) {
  return (
    <View style={styles.versionBadge} pointerEvents="none">
      <Text style={styles.versionText}>
        {appVersionLabel()}
      </Text>
    </View>
  );
}

export function DesktopVersionBadge({ styles }) {
  return (
    <View style={styles.desktopVersionBadge} pointerEvents="none">
      <Text style={styles.desktopVersionText} numberOfLines={1}>
        {appVersionLabel()}
      </Text>
    </View>
  );
}

export function BottomActionBar({
  profile,
  onProfile,
  onAddTask,
  onSubjects,
  onFriends,
  onChats,
  styles,
  shadow,
}) {
  return (
    <View style={[styles.bottomBar, shadow.float]}>
      <BarButton
        label="Profile"
        accessibilityLabel="Open profile"
        onPress={onProfile}
        styles={styles}
        avatar={<ProfileAvatar profile={profile} size={30} />}
      />
      <BarButton
        label="Subjects"
        icon="📚"
        accessibilityLabel="Manage subjects"
        onPress={onSubjects}
        styles={styles}
      />
      <Pressable
        onPress={onAddTask}
        accessibilityLabel="Add task"
        accessibilityRole="button"
        style={styles.bottomAddBtn}
      >
        <Text style={styles.bottomAddIcon}>+</Text>
      </Pressable>
      <BarButton
        label="Friends"
        icon="👥"
        accessibilityLabel="Open friends"
        onPress={onFriends}
        styles={styles}
      />
      <BarButton
        label="Chats"
        icon="💬"
        accessibilityLabel="Open chats"
        onPress={onChats}
        styles={styles}
      />
    </View>
  );
}

const SIDEBAR_ITEMS = [
  { key: 'tasks', label: 'Tasks', icon: '\u2713' },
  { key: 'chats', label: 'Chats', icon: '\u{1F4AC}' },
  { key: 'subjects', label: 'Subjects', icon: '\u{1F4DA}' },
  { key: 'friends', label: 'Friends', icon: '\u{1F465}' },
];
export const DESKTOP_SIDEBAR_ITEM_KEYS = SIDEBAR_ITEMS.map((item) => item.key);

export function DesktopSidebar({
  collapsed,
  progress,
  profile,
  activePage,
  onToggle,
  onTasks,
  onSubjects,
  onFriends,
  onChats,
  onProfile,
  styles,
  shadow,
}) {
  const activeIndex = SIDEBAR_ITEMS.findIndex((item) => item.key === activePage);
  const activeYRef = useRef(null);
  if (activeYRef.current == null) activeYRef.current = new Animated.Value(Math.max(0, activeIndex) * 56);
  const activeY = activeYRef.current;
  const sidebarWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [64, 216],
  });
  const toggleWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 102],
  });
  const labelWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 126],
  });
  const labelSlide = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 0],
  });
  const actions = {
    tasks: onTasks,
    chats: onChats,
    subjects: onSubjects,
    friends: onFriends,
  };

  useEffect(() => {
    if (activeIndex < 0) return;
    Animated.timing(activeY, {
      toValue: activeIndex * 56,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeY]);

  return (
    <Animated.View style={[styles.desktopSidebar, { width: sidebarWidth }, shadow.float]}>
      <View style={styles.desktopSidebarHeader}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Open sidebar' : 'Collapse sidebar'}
        >
          <Animated.View style={[styles.desktopSidebarToggle, { width: toggleWidth }]}>
            <View style={styles.desktopSidebarToggleIcon}>
              <Text style={styles.desktopSidebarToggleText}>{collapsed ? '>' : '<'}</Text>
            </View>
            <Animated.View
              style={[
                styles.desktopSidebarToggleLabelWrap,
                { width: labelWidth, opacity: progress, transform: [{ translateX: labelSlide }] },
              ]}
            >
              <Text style={styles.desktopSidebarToggleLabel} numberOfLines={1}>
                Hide
              </Text>
            </Animated.View>
          </Animated.View>
        </Pressable>
      </View>

      <View style={styles.desktopSidebarNav}>
        {activeIndex >= 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.desktopSidebarActiveIndicator,
              { transform: [{ translateY: activeY }] },
            ]}
          />
        ) : null}
        {SIDEBAR_ITEMS.map((item) => (
          <SidebarButton
            key={item.key}
            label={item.label}
            icon={item.icon}
            labelWidth={labelWidth}
            labelOpacity={progress}
            labelSlide={labelSlide}
            onPress={actions[item.key]}
            styles={styles}
          />
        ))}
      </View>

      <View style={styles.desktopSidebarFooter}>
        <Pressable
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          style={({ pressed }) => [
            styles.desktopSidebarProfile,
            pressed && styles.desktopSidebarButtonPressed,
          ]}
        >
          <ProfileAvatar profile={profile} size={34} />
          <Animated.View
            style={[
              styles.desktopSidebarProfileText,
              { width: labelWidth, opacity: progress, transform: [{ translateX: labelSlide }] },
            ]}
          >
              <Text style={styles.desktopSidebarLabel} numberOfLines={1}>
                Profile
              </Text>
              <Text style={styles.desktopSidebarMeta} numberOfLines={1}>
                {profile?.username ? `@${profile.username}` : 'Your account'}
              </Text>
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function SidebarButton({ label, icon, labelWidth, labelOpacity, labelSlide, onPress, styles }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }) => [
        styles.desktopSidebarButton,
        hovered && styles.desktopSidebarButtonHovered,
        pressed && styles.desktopSidebarButtonPressed,
      ]}
    >
      <Text style={styles.desktopSidebarIcon}>{icon}</Text>
      <Animated.View
        style={[
          styles.desktopSidebarLabelWrap,
          { width: labelWidth, opacity: labelOpacity, transform: [{ translateX: labelSlide }] },
        ]}
      >
        <Text style={styles.desktopSidebarLabel} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function BarButton({ label, icon, avatar, onPress, accessibilityLabel, styles }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={styles.bottomBarBtn}
    >
      {avatar || <Text style={styles.bottomBarIcon}>{icon}</Text>}
      <Text style={styles.bottomBarLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function SortControls({ value, onChange, filter, styles }) {
  const options = STATUS_ONLY_FILTERS.has(filter)
    ? SORT_OPTIONS.filter((option) => option.key !== 'not_done_first')
    : SORT_OPTIONS;
  return (
    <View style={styles.sortControls}>
      <Text style={styles.sortLabel}>Order</Text>
      <View style={styles.sortOptions}>
        {options.map((option) => {
          const active = value === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.sortOption, active && styles.sortOptionActive]}
            >
              <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ProgressCard({ progress, styles }) {
  const { doneCount, total, pct } = progress;
  const { shadow } = useTheme();

  // Lazy allocation -- avoids re-creating the Animated.Value on every render.
  const animatedPctRef = useRef(null);
  if (animatedPctRef.current == null) animatedPctRef.current = new Animated.Value(pct);
  const animatedPct = animatedPctRef.current;

  useEffect(() => {
    Animated.timing(animatedPct, {
      toValue: pct,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [pct, animatedPct]);

  const widthInterpolated = animatedPct.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.progressCard, shadow.card]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.progressLabel}>Progress</Text>
        <Text style={styles.progressText}>
          {total === 0
            ? 'No tasks or events yet — add one to get started.'
            : `${doneCount} of ${total} done (${pct}%)`}
        </Text>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[styles.progressFill, { width: widthInterpolated }]}
          />
        </View>
      </View>
    </View>
  );
}

export function SyncErrorBanner({ message, onDismiss, styles }) {
  return (
    <View style={styles.syncBanner}>
      <Text style={styles.syncBannerText}>{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss sync warning">
        <Text style={styles.syncBannerDismiss}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

export function NotificationBanner({ notification, onDone, styles, shadow }) {
  const translateXRef = useRef(null);
  const opacityRef = useRef(null);
  if (translateXRef.current == null) translateXRef.current = new Animated.Value(380);
  if (opacityRef.current == null) opacityRef.current = new Animated.Value(0);
  const translateX = translateXRef.current;
  const opacity = opacityRef.current;

  useEffect(() => {
    if (!notification) return undefined;
    translateX.setValue(380);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 380,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => onDone?.());
    }, 3000);

    return () => clearTimeout(timer);
  }, [notification?.id, notification, onDone, translateX, opacity]);

  if (!notification) return null;

  return (
    <Animated.View
      style={[
        styles.notificationBanner,
        shadow.float,
        { opacity, transform: [{ translateX }] },
      ]}
      pointerEvents="box-none"
    >
      <Text style={styles.notificationBannerTitle} numberOfLines={1}>
        {notification.title}
      </Text>
      {notification.body ? (
        <Text style={styles.notificationBannerBody} numberOfLines={2}>
          {notification.body}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function NotificationsPanel({
  visible,
  notifications,
  onClose,
  onClear,
  onPressNotification,
  styles,
  shadow,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.notificationsModal}>
        <Pressable style={styles.notificationsBackdrop} onPress={onClose} />
        <View style={[styles.notificationsPanel, shadow.float]}>
          <View style={styles.notificationsHeader}>
            <Text style={styles.notificationsTitle}>Notifications</Text>
            <View style={styles.notificationsHeaderActions}>
              {notifications.length > 0 ? (
                <Pressable onPress={onClear} hitSlop={8}>
                  <Text style={styles.notificationsLink}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={styles.notificationsLink}>Done</Text>
              </Pressable>
            </View>
          </View>

          {notifications.length === 0 ? (
            <Text style={styles.notificationsEmpty}>No notifications yet.</Text>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              style={styles.notificationsList}
              ItemSeparatorComponent={() => <View style={styles.notificationDivider} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPressNotification?.(item)}
                  style={styles.notificationRow}
                >
                  <View style={styles.notificationTypeDot} />
                  <View style={styles.notificationRowText}>
                    <Text style={styles.notificationRowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.body ? (
                      <Text style={styles.notificationRowBody} numberOfLines={2}>
                        {item.body}
                      </Text>
                    ) : null}
                    <Text style={styles.notificationRowTime}>
                      {notificationTimeLabel(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
