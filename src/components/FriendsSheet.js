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
  ActivityIndicator,
  Platform,
} from 'react-native';

import { useTheme } from '../theme';
import {
  acceptFriendRequest,
  addFriend,
  declineFriendRequest,
  loadCachedFriendRequests,
  loadCachedFriends,
  loadFriendRequests,
  loadFriends,
  removeFriend,
  searchProfiles,
} from '../storage';
import { publicName } from '../profile';
import ProfileAvatar from './ProfileAvatar';

export default function FriendsSheet({ visible, onClose, session = null }) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [results, setResults] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const canUseFriends = !!session;
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

  const closeWithAnimation = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onClose?.();
    });
  }, [onClose, screenHeight, translateY]);
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

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    setMessage(null);
    if (!canUseFriends) {
      setFriends([]);
      setRequests({ incoming: [], outgoing: [] });
      return;
    }
    let cancelled = false;
    setLoadingFriends(friends.length === 0);
    Promise.all([loadCachedFriends(), loadCachedFriendRequests()])
      .then(([cachedFriends, cachedRequests]) => {
        if (cancelled) return;
        if (cachedFriends.length > 0) {
          setFriends(cachedFriends);
          setLoadingFriends(false);
        }
        if (cachedRequests.incoming.length > 0 || cachedRequests.outgoing.length > 0) {
          setRequests(cachedRequests);
        }
      })
      .catch(() => {});
    Promise.all([loadFriends(), loadFriendRequests()])
      .then(([friendItems, requestItems]) => {
        if (cancelled) return;
        setFriends(friendItems);
        setRequests(requestItems);
      })
      .catch((e) => {
        if (!cancelled) setMessage(e?.message || 'Could not load friends.');
      })
      .finally(() => {
        if (!cancelled) setLoadingFriends(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, canUseFriends]);

  useEffect(() => {
    if (!visible || !canUseFriends) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const id = setTimeout(() => {
      searchProfiles(term)
        .then((items) => {
          if (!cancelled) setResults(items);
        })
        .catch((e) => {
          if (!cancelled) {
            setResults([]);
            setMessage(e?.message || 'Search failed.');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, visible, canUseFriends]);

  const handleAdd = async (person) => {
    if (!person?.id || busyId) return;
    setBusyId(person.id);
    setMessage(null);
    try {
      await addFriend(person.id);
      const [nextFriends, nextRequests] = await Promise.all([loadFriends(), loadFriendRequests()]);
      const becameFriend = nextFriends.some((item) => item.id === person.id);
      setResults((prev) =>
        prev.map((item) =>
          item.id === person.id
            ? {
                ...item,
                isFriend: becameFriend,
                incomingRequest: false,
                outgoingRequest: !becameFriend,
              }
            : item
        )
      );
      setFriends(nextFriends);
      setRequests(nextRequests);
      setMessage(becameFriend ? 'Friend request accepted.' : 'Friend request sent.');
    } catch (e) {
      setMessage(e?.message || 'Could not send friend request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = async (person) => {
    if (!person?.id || busyId) return;
    setBusyId(person.id);
    setMessage(null);
    try {
      await acceptFriendRequest(person.id);
      const [nextFriends, nextRequests] = await Promise.all([loadFriends(), loadFriendRequests()]);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setResults((prev) =>
        prev.map((item) =>
          item.id === person.id
            ? { ...item, isFriend: true, incomingRequest: false, outgoingRequest: false }
            : item
        )
      );
      setMessage('Friend request accepted.');
    } catch (e) {
      setMessage(e?.message || 'Could not accept friend request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (person) => {
    if (!person?.id || busyId) return;
    setBusyId(person.id);
    setMessage(null);
    try {
      await declineFriendRequest(person.id);
      const nextRequests = await loadFriendRequests();
      setRequests(nextRequests);
      setResults((prev) =>
        prev.map((item) =>
          item.id === person.id ? { ...item, incomingRequest: false } : item
        )
      );
      setMessage('Friend request declined.');
    } catch (e) {
      setMessage(e?.message || 'Could not decline friend request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (person) => {
    if (!person?.id || busyId) return;
    setBusyId(person.id);
    setMessage(null);
    try {
      await removeFriend(person.id);
      const nextRequests = await loadFriendRequests();
      setFriends((prev) => prev.filter((item) => item.id !== person.id));
      setResults((prev) =>
        prev.map((item) =>
          item.id === person.id
            ? { ...item, isFriend: false, incomingRequest: false, outgoingRequest: false }
            : item
        )
      );
      setRequests(nextRequests);
    } catch (e) {
      setMessage(e?.message || 'Could not remove friend.');
    } finally {
      setBusyId(null);
    }
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
              <Text style={styles.title}>Friends</Text>
              <Pressable onPress={closeWithAnimation} hitSlop={8}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.content}>
            {!canUseFriends ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Friend search needs an account</Text>
                <Text style={styles.noticeText}>
                  Sign in with cloud sync to find classmates by name or username.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Find people</Text>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search name or username"
                    placeholderTextColor={colors.textFaint}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {searching ? <ActivityIndicator color={colors.primary} /> : null}
                  {message ? (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{message}</Text>
                    </View>
                  ) : null}
                  {results.length > 0 ? (
                    <ScrollView
                      style={styles.compactListFrame}
                      contentContainerStyle={styles.listFrameContent}
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                    >
                      {results.map((person) => (
                        <SearchResultRow
                          key={person.id}
                          person={person}
                          busy={busyId === person.id}
                          onAdd={() => handleAdd(person)}
                          onAccept={() => handleAccept(person)}
                          styles={styles}
                        />
                      ))}
                    </ScrollView>
                  ) : null}
                  {query.trim().length >= 2 && !searching && results.length === 0 ? (
                    <Text style={styles.emptyText}>No matching profiles yet.</Text>
                  ) : null}
                </View>

                {requests.incoming.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Friend requests</Text>
                    <ScrollView
                      style={styles.compactListFrame}
                      contentContainerStyle={styles.listFrameContent}
                      nestedScrollEnabled
                    >
                      {requests.incoming.map((person) => (
                        <FriendRequestRow
                          key={person.id}
                          person={person}
                          busy={busyId === person.id}
                          onAccept={() => handleAccept(person)}
                          onDecline={() => handleDecline(person)}
                          styles={styles}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Requests sent</Text>
                  <ScrollView
                    style={styles.listFrame}
                    contentContainerStyle={styles.listFrameContent}
                    nestedScrollEnabled
                  >
                    {requests.outgoing.length === 0 ? (
                      <Text style={styles.emptyText}>Requests you send will show up here.</Text>
                    ) : (
                      requests.outgoing.map((person) => (
                        <FriendRow
                          key={person.id}
                          person={person}
                          busy={busyId === person.id}
                          actionLabel="Requested"
                          disabled
                          styles={styles}
                        />
                      ))
                    )}
                  </ScrollView>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Friends</Text>
                  <ScrollView
                    style={styles.listFrame}
                    contentContainerStyle={styles.listFrameContent}
                    nestedScrollEnabled
                  >
                    {loadingFriends ? <ActivityIndicator color={colors.primary} /> : null}
                    {!loadingFriends && friends.length === 0 ? (
                      <Text style={styles.emptyText}>Friends you add will show up here.</Text>
                    ) : null}
                    {friends.map((person) => (
                      <FriendRow
                        key={person.id}
                        person={person}
                        busy={busyId === person.id}
                        actionLabel="Remove"
                        danger
                        onPress={() => handleRemove(person)}
                        styles={styles}
                      />
                    ))}
                  </ScrollView>
                </View>
              </>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SearchResultRow({ person, busy, onAdd, onAccept, styles }) {
  if (person.isFriend) {
    return (
      <FriendRow
        person={person}
        busy={busy}
        actionLabel="Friends"
        disabled
        styles={styles}
      />
    );
  }

  if (person.outgoingRequest) {
    return (
      <FriendRow
        person={person}
        busy={busy}
        actionLabel="Requested"
        disabled
        styles={styles}
      />
    );
  }

  return (
    <FriendRow
      person={person}
      busy={busy}
      actionLabel={person.incomingRequest ? 'Confirm' : 'Request'}
      onPress={person.incomingRequest ? onAccept : onAdd}
      styles={styles}
    />
  );
}

function FriendRequestRow({ person, busy, onAccept, onDecline, styles }) {
  const name = publicName(person);
  const username = person.username ? `@${person.username}` : 'No username';

  return (
    <View style={styles.friendRow}>
      <ProfileAvatar profile={person} size={42} />
      <View style={styles.friendText}>
        <Text style={styles.friendName} numberOfLines={1}>{name}</Text>
        <Text style={styles.friendUsername} numberOfLines={1}>{username}</Text>
      </View>
      <View style={styles.requestActions}>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          style={[styles.friendAction, styles.friendActionSubtle, busy && styles.friendActionDisabled]}
        >
          <Text style={styles.friendActionSubtleText}>Decline</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          style={[styles.friendAction, busy && styles.friendActionDisabled]}
        >
          {busy ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.friendActionText}>Confirm</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function FriendRow({ person, busy, actionLabel, disabled, danger, onPress, styles }) {
  const name = publicName(person);
  const username = person.username ? `@${person.username}` : 'No username';

  return (
    <View style={styles.friendRow}>
      <ProfileAvatar profile={person} size={42} />
      <View style={styles.friendText}>
        <Text style={styles.friendName} numberOfLines={1}>{name}</Text>
        <Text style={styles.friendUsername} numberOfLines={1}>{username}</Text>
      </View>
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        style={[
          styles.friendAction,
          danger && styles.friendActionDanger,
          (disabled || busy) && styles.friendActionDisabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" />
        ) : (
          <Text style={[styles.friendActionText, danger && styles.friendActionDangerText]}>
            {actionLabel}
          </Text>
        )}
      </Pressable>
    </View>
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
      maxWidth: Platform.OS === 'web' ? 640 : undefined,
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
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
      flexShrink: 1,
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
    notice: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    noticeTitle: {
      ...typography.subheading,
    },
    noticeText: {
      ...typography.bodyMuted,
    },
    errorBox: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    errorText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '600',
    },
    emptyText: {
      ...typography.bodyMuted,
      paddingVertical: spacing.sm,
    },
    listFrame: {
      maxHeight: 230,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardMuted,
    },
    compactListFrame: {
      maxHeight: 148,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardMuted,
    },
    listFrameContent: {
      padding: spacing.sm,
      gap: spacing.sm,
      flexGrow: 1,
    },
    friendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    friendText: {
      flex: 1,
      minWidth: 0,
    },
    friendName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    friendUsername: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    friendAction: {
      minWidth: 74,
      minHeight: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
    },
    friendActionDanger: {
      backgroundColor: colors.dangerSoft,
    },
    friendActionSubtle: {
      minWidth: 70,
      backgroundColor: colors.cardMuted,
    },
    friendActionDisabled: {
      opacity: 0.55,
    },
    friendActionText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '800',
    },
    friendActionDangerText: {
      color: colors.danger,
    },
    friendActionSubtleText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '800',
    },
    requestActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
  });
