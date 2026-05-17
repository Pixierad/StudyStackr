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
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';

import { useTheme } from '../theme';
import {
  createChatRoom,
  hideChatRoom,
  loadChatMessages,
  loadChatRooms,
  loadFriends,
  markChatRead,
  sendChatMessage,
  setChatPinned,
  subscribeToChatRoom,
} from '../storage';
import { normalizeUsername, publicName } from '../profile';
import ProfileAvatar from './ProfileAvatar';

const DURATION_OPTIONS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];
const COMPOSER_INPUT_MIN_HEIGHT = 40;
const COMPOSER_INPUT_LINE_HEIGHT = 20;
const COMPOSER_INPUT_VERTICAL_PADDING = 16;
const COMPOSER_INPUT_MAX_LINES = 6;
const COMPOSER_INPUT_MAX_HEIGHT =
  COMPOSER_INPUT_LINE_HEIGHT * COMPOSER_INPUT_MAX_LINES + COMPOSER_INPUT_VERTICAL_PADDING;

export default function ChatSheet({ visible, onClose, session = null, profile = null }) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [mode, setMode] = useState('list');
  const [rooms, setRooms] = useState([]);
  const [friends, setFriends] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [roomName, setRoomName] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState([]);
  const [lifetimeHours, setLifetimeHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [actionRoom, setActionRoom] = useState(null);
  const [detailsRoom, setDetailsRoom] = useState(null);

  const canUseChats = !!session;
  const userId = session?.user?.id ?? null;
  const screenHeight = Dimensions.get('window').height;
  const translateYRef = useRef(null);
  const messageScrollRef = useRef(null);
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

  const refreshRooms = useCallback(async () => {
    if (!canUseChats) {
      setRooms([]);
      return [];
    }
    const items = await loadChatRooms();
    setRooms(items);
    return items;
  }, [canUseChats]);

  const refreshMessages = useCallback(async (roomId) => {
    if (!roomId) return;
    const items = await loadChatMessages(roomId);
    setMessages(items);
    markChatRead(roomId).catch(() => {});
    setTimeout(() => messageScrollRef.current?.scrollToEnd?.({ animated: true }), 50);
  }, []);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(screenHeight);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [visible, translateY, screenHeight]);

  useEffect(() => {
    if (!visible) return;
    setMode('list');
    setActiveRoom(null);
    setDetailsRoom(null);
    setMessages([]);
    setDraft('');
    setMessage(null);
    if (!canUseChats) return;

    let cancelled = false;
    setLoading(true);
    Promise.all([loadChatRooms(), loadFriends()])
      .then(([roomItems, friendItems]) => {
        if (cancelled) return;
        setRooms(roomItems);
        setFriends(friendItems);
      })
      .catch((e) => {
        if (!cancelled) setMessage(e?.message || 'Could not load chats.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, canUseChats]);

  useEffect(() => {
    if (!activeRoom?.id || mode !== 'room') return undefined;
    refreshMessages(activeRoom.id);
    const unsubscribe = subscribeToChatRoom(activeRoom.id, () => {
      refreshMessages(activeRoom.id);
      refreshRooms().catch(() => {});
    });
    return unsubscribe;
  }, [activeRoom?.id, mode, refreshMessages, refreshRooms]);

  const startCreate = () => {
    setRoomName('');
    setSelectedFriendIds([]);
    setLifetimeHours(24);
    setMessage(null);
    setMode('create');
  };

  const openRoom = (room) => {
    setActiveRoom(room);
    setMessages([]);
    setDraft('');
    setMessage(null);
    setMode('room');
  };

  const toggleFriend = (id) => {
    setSelectedFriendIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (selectedFriendIds.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const roomId = await createChatRoom({
        name: roomName,
        friendIds: selectedFriendIds,
        lifetimeHours,
      });
      const nextRooms = await refreshRooms();
      const nextRoom = nextRooms.find((room) => room.id === roomId);
      if (nextRoom) openRoom(nextRoom);
      else setMode('list');
    } catch (e) {
      setMessage(e?.message || 'Could not create chat.');
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !activeRoom?.id || busy) return;
    setBusy(true);
    setDraft('');
    try {
      await sendChatMessage(activeRoom.id, body);
      await refreshMessages(activeRoom.id);
      await refreshRooms();
    } catch (e) {
      setDraft(body);
      setMessage(e?.message || 'Could not send message.');
    } finally {
      setBusy(false);
    }
  };

  const handlePin = async (room) => {
    setActionRoom(null);
    setRooms((prev) =>
      prev.map((item) => (item.id === room.id ? { ...item, isPinned: !item.isPinned } : item))
    );
    try {
      await setChatPinned(room.id, !room.isPinned);
      await refreshRooms();
    } catch (e) {
      setMessage(e?.message || 'Could not update chat.');
      await refreshRooms().catch(() => {});
    }
  };

  const handleHide = async (room) => {
    setActionRoom(null);
    setRooms((prev) => prev.filter((item) => item.id !== room.id));
    if (activeRoom?.id === room.id) {
      setMode('list');
      setActiveRoom(null);
    }
    try {
      await hideChatRoom(room.id);
      await refreshRooms();
    } catch (e) {
      setMessage(e?.message || 'Could not delete chat.');
      await refreshRooms().catch(() => {});
    }
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeWithAnimation}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={closeWithAnimation} />
        <Animated.View style={[styles.sheet, shadow.float, { transform: [{ translateY }] }]}>
          <View style={styles.dragZone} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              {mode === 'list' ? null : (
                <Pressable onPress={() => setMode('list')} hitSlop={8} style={styles.headerSide}>
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
              )}
              {mode === 'room' ? (
                <Pressable
                  onPress={() => setDetailsRoom(activeRoom)}
                  disabled={!activeRoom}
                  style={styles.titleButton}
                  accessibilityRole="button"
                  accessibilityLabel="Show chat details"
                >
                  <Text style={styles.title} numberOfLines={1}>
                    {roomTitle(activeRoom, userId)}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.title} numberOfLines={1}>
                  {mode === 'create' ? 'New chat' : 'Chats'}
                </Text>
              )}
              <Pressable onPress={closeWithAnimation} hitSlop={8} style={styles.headerSide}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>

          {!canUseChats ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Chats need an account</Text>
              <Text style={styles.noticeText}>Sign in with cloud sync to create temporary rooms with friends.</Text>
            </View>
          ) : mode === 'create' ? (
            <CreateView
              styles={styles}
              colors={colors}
              friends={friends}
              roomName={roomName}
              setRoomName={setRoomName}
              selectedFriendIds={selectedFriendIds}
              toggleFriend={toggleFriend}
              lifetimeHours={lifetimeHours}
              setLifetimeHours={setLifetimeHours}
              busy={busy}
              message={message}
              onCreate={handleCreate}
            />
          ) : mode === 'room' ? (
            <RoomView
              styles={styles}
              colors={colors}
              room={activeRoom}
              messages={messages}
              userId={userId}
              profile={profile}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              message={message}
              onSend={handleSend}
              scrollRef={messageScrollRef}
            />
          ) : (
            <ListView
              styles={styles}
              rooms={rooms}
              userId={userId}
              loading={loading}
              message={message}
              onCreate={startCreate}
              onOpen={openRoom}
              onLongPress={setActionRoom}
            />
          )}
        </Animated.View>

        {actionRoom ? (
          <ActionPanel
            styles={styles}
            room={actionRoom}
            onCancel={() => setActionRoom(null)}
            onPin={() => handlePin(actionRoom)}
            onDelete={() => handleHide(actionRoom)}
          />
        ) : null}

        {detailsRoom ? (
          <ChatDetailsPanel
            styles={styles}
            room={detailsRoom}
            userId={userId}
            onClose={() => setDetailsRoom(null)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function ListView({ styles, rooms, userId, loading, message, onCreate, onOpen, onLongPress }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onCreate} style={styles.createRow}>
        <View style={styles.createIcon}>
          <Text style={styles.createIconText}>+</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.createTitle}>Create new chat</Text>
          <Text style={styles.createHint}>Temporary rooms for friends only</Text>
        </View>
      </Pressable>

      {message ? <MessageBox styles={styles} text={message} /> : null}
      {loading ? <ActivityIndicator /> : null}
      {!loading && rooms.length === 0 ? (
        <Text style={styles.emptyText}>Ongoing chats will show up here.</Text>
      ) : null}
      {rooms.map((room) => (
        <ChatRow
          key={room.id}
          room={room}
          userId={userId}
          styles={styles}
          onPress={() => onOpen(room)}
          onLongPress={() => onLongPress(room)}
        />
      ))}
    </ScrollView>
  );
}

function CreateView({
  styles,
  colors,
  friends,
  roomName,
  setRoomName,
  selectedFriendIds,
  toggleFriend,
  lifetimeHours,
  setLifetimeHours,
  busy,
  message,
  onCreate,
}) {
  const canCreate = selectedFriendIds.length > 0 && !busy;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Name</Text>
        <TextInput
          value={roomName}
          onChangeText={setRoomName}
          placeholder="Optional chat name"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          maxLength={80}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Lasts for</Text>
        <View style={styles.durationGrid}>
          {DURATION_OPTIONS.map((option) => {
            const active = lifetimeHours === option.hours;
            return (
              <Pressable
                key={option.hours}
                onPress={() => setLifetimeHours(option.hours)}
                style={[styles.durationBtn, active && styles.durationBtnActive]}
              >
                <Text style={[styles.durationText, active && styles.durationTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Friends</Text>
        {friends.length === 0 ? (
          <Text style={styles.emptyText}>Add friends first, then create a chat.</Text>
        ) : null}
        {friends.map((friend) => {
          const selected = selectedFriendIds.includes(friend.id);
          return (
            <Pressable
              key={friend.id}
              onPress={() => toggleFriend(friend.id)}
              style={[styles.friendPickRow, selected && styles.friendPickRowSelected]}
            >
              <ProfileAvatar profile={friend} size={38} />
              <View style={styles.friendText}>
                <Text style={styles.friendName} numberOfLines={1}>{publicName(friend)}</Text>
                <Text style={styles.friendUsername} numberOfLines={1}>
                  {friend.username ? `@${friend.username}` : 'Friend'}
                </Text>
              </View>
              <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                {selected ? <Text style={styles.checkText}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {message ? <MessageBox styles={styles} text={message} /> : null}

      <Pressable
        onPress={onCreate}
        disabled={!canCreate}
        style={[styles.primaryBtn, !canCreate && styles.disabled]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create chat</Text>}
      </Pressable>
    </ScrollView>
  );
}

function RoomView({
  styles,
  colors,
  room,
  messages,
  userId,
  profile,
  draft,
  setDraft,
  busy,
  message,
  onSend,
  scrollRef,
}) {
  const [selection, setSelection] = useState({ start: draft.length, end: draft.length });
  const [measuredInputHeight, setMeasuredInputHeight] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const inputHeight = useMemo(
    () => composerHeightForText(draft, measuredInputHeight),
    [draft, measuredInputHeight]
  );
  const currentUsername = normalizeUsername(profile?.username);
  const activeMention =
    getActiveMention(draft, selection.start) || getActiveMention(draft, draft.length);
  const mentionOptions = useMemo(
    () => getMentionOptions(room, userId, activeMention?.query),
    [room, userId, activeMention?.query]
  );
  useEffect(() => {
    if (!draft) setMeasuredInputHeight(0);
  }, [draft]);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardInset(event.endCoordinates?.height || 0);
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 50);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollRef]);
  const showMentions = !!activeMention && mentionOptions.length > 0;
  const insertMention = (person) => {
    const handle = mentionHandle(person);
    if (!handle || !activeMention) return;
    const next = replaceActiveMention(draft, activeMention, handle);
    const nextCursor = activeMention.start + handle.length + 2;
    setDraft(next);
    setSelection({ start: nextCursor, end: nextCursor });
  };
  const updateDraft = (value) => {
    setDraft(value);
    setSelection({ start: value.length, end: value.length });
  };
  const updateInputHeight = (event) => {
    const measuredHeight = Math.ceil(event.nativeEvent.contentSize?.height || 0);
    setMeasuredInputHeight(measuredHeight);
  };
  const handleComposerKeyPress = (event) => {
    const nativeEvent = event.nativeEvent || {};
    if (Platform.OS !== 'web') return;
    if (nativeEvent.key !== 'Enter' || nativeEvent.shiftKey) return;
    event.preventDefault?.();
    nativeEvent.preventDefault?.();
    if (!draft.trim() || busy) return;
    onSend?.();
  };

  return (
    <KeyboardAvoidingView
      style={styles.roomWrap}
    >
      <Text style={styles.expiryText}>{expiresText(room?.expiresAt)}</Text>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.length === 0 ? (
          <Text style={styles.emptyText}>No messages yet.</Text>
        ) : null}
        {messages.map((item) => {
          const mine = item.senderId === userId;
          const mentioned = !mine && mentionsUsername(item.body, currentUsername);
          return (
            <View key={item.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
              {!mine ? <ProfileAvatar profile={item.sender} size={30} /> : null}
              <View style={[styles.bubble, mentioned && styles.bubbleMentioned, mine && styles.bubbleMine]}>
                {!mine ? (
                  <Text style={[styles.senderName, mentioned && styles.senderNameMentioned]} numberOfLines={1}>{publicName(item.sender)}</Text>
                ) : null}
                <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      {message ? <MessageBox styles={styles} text={message} /> : null}
      <View style={[styles.composer, keyboardInset ? { marginBottom: keyboardInset } : null]}>
        {showMentions ? (
          <View style={[styles.mentionPanel, { bottom: inputHeight + 12 }]}>
            {mentionOptions.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => insertMention(person)}
                style={styles.mentionOption}
              >
                <ProfileAvatar profile={person} size={28} />
                <View style={styles.mentionText}>
                  <Text style={styles.mentionName} numberOfLines={1}>{publicName(person)}</Text>
                  <Text style={styles.mentionUsername} numberOfLines={1}>@{mentionHandle(person)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={updateDraft}
          onContentSizeChange={updateInputHeight}
          onKeyPress={handleComposerKeyPress}
          onSubmitEditing={
            Platform.OS === 'web'
              ? undefined
              : () => {
                  if (!draft.trim() || busy) return;
                  onSend?.();
                }
          }
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          placeholder="Message"
          placeholderTextColor={colors.textFaint}
          style={[styles.composerInput, { height: inputHeight }]}
          multiline
          numberOfLines={Math.min(
            COMPOSER_INPUT_MAX_LINES,
            Math.max(1, String(draft || '').split('\n').length)
          )}
          scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
          returnKeyType="send"
          submitBehavior={Platform.OS === 'web' ? undefined : 'submit'}
          maxLength={2000}
        />
        <Pressable
          onPress={onSend}
          disabled={!draft.trim() || busy}
          style={[styles.sendBtn, (!draft.trim() || busy) && styles.disabled]}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatRow({ room, userId, styles, onPress, onLongPress }) {
  const title = roomTitle(room, userId);
  const people = peopleSummary(room?.members || []);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={styles.chatRow}
    >
      <View style={styles.avatarStack}>
        {(room.members || []).slice(0, 2).map((member, index) => (
          <ProfileAvatar
            key={member.id || index}
            profile={member}
            size={34}
            style={index > 0 ? styles.avatarOverlap : null}
          />
        ))}
      </View>
      <View style={styles.chatText}>
        <View style={styles.chatTitleRow}>
          <Text style={styles.chatTitle} numberOfLines={1}>{title}</Text>
          {room.isPinned ? <Text style={styles.pinText}>Pinned</Text> : null}
        </View>
        <Text style={styles.peopleText} numberOfLines={1}>{people}</Text>
        <Text style={styles.previewText} numberOfLines={1}>
          {room.lastMessageBody || expiresText(room.expiresAt)}
        </Text>
      </View>
      {room.unreadCount > 0 ? (
        <View style={styles.unreadPill}>
          <Text style={styles.unreadText}>{room.unreadCount > 9 ? '9+' : room.unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ActionPanel({ styles, room, onCancel, onPin, onDelete }) {
  return (
    <View style={styles.actionBackdrop}>
      <Pressable style={styles.backdropFill} onPress={onCancel} />
      <View style={styles.actionPanel}>
        <Text style={styles.actionTitle} numberOfLines={1}>{roomTitle(room)}</Text>
        <Pressable onPress={onPin} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>{room.isPinned ? 'Unpin chat' : 'Pin chat'}</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={[styles.actionBtn, styles.actionDanger]}>
          <Text style={styles.actionDangerText}>Delete from my chats</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.actionCancel}>
          <Text style={styles.actionCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChatDetailsPanel({ styles, room, userId, onClose }) {
  const participants = room?.members || [];
  return (
    <View style={styles.actionBackdrop}>
      <Pressable style={styles.backdropFill} onPress={onClose} />
      <View style={styles.detailsPanel}>
        <View style={styles.detailsHeader}>
          <Text style={styles.detailsTitle}>Chat details</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.detailsSection}>
          <Text style={styles.sectionLabel}>Chat name</Text>
          <Text style={styles.detailsValue}>{roomTitle(room, userId)}</Text>
        </View>

        <View style={styles.detailsSection}>
          <Text style={styles.sectionLabel}>Participants</Text>
          {participants.length === 0 ? (
            <Text style={styles.emptyText}>No participants listed.</Text>
          ) : (
            participants.map((person) => (
              <View key={person.id} style={styles.participantRow}>
                <ProfileAvatar profile={person} size={34} />
                <View style={styles.friendText}>
                  <Text style={styles.friendName} numberOfLines={1}>{publicName(person)}</Text>
                  <Text style={styles.friendUsername} numberOfLines={1}>
                    {person.username ? `@${person.username}` : person.id === userId ? 'You' : 'Participant'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.detailsSection}>
          <Text style={styles.sectionLabel}>Expiry date</Text>
          <Text style={styles.detailsValue}>{formatExpiryDate(room?.expiresAt)}</Text>
        </View>
      </View>
    </View>
  );
}

function MessageBox({ styles, text }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function getActiveMention(value, cursorPosition) {
  const text = String(value || '');
  const cursor = Math.max(0, Math.min(Number(cursorPosition ?? text.length), text.length));
  const beforeCursor = text.slice(0, cursor);
  const match = /(^|[\s([{])@([a-zA-Z0-9_]*)$/.exec(beforeCursor);
  if (!match) return null;

  const start = match.index + match[1].length;
  const query = match[2].toLowerCase();
  return {
    query,
    start,
    end: cursor,
  };
}

function composerHeightForText(value, measuredHeight = 0) {
  const text = String(value || '');
  const explicitLineCount = Math.max(1, text.split('\n').length);
  const explicitLineHeight =
    explicitLineCount * COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING;
  const nextHeight = Math.max(measuredHeight, explicitLineHeight);
  return Math.min(
    COMPOSER_INPUT_MAX_HEIGHT,
    Math.max(COMPOSER_INPUT_MIN_HEIGHT, nextHeight)
  );
}

function getMentionOptions(room, userId, query) {
  if (query == null) return [];
  return (room?.members || [])
    .filter((person) => person.id !== userId && mentionHandle(person))
    .filter((person) => {
      const handle = mentionHandle(person);
      const name = publicName(person).toLowerCase();
      return handle.includes(query) || name.includes(query);
    })
    .slice(0, 5);
}

function mentionHandle(person) {
  const username = normalizeUsername(person?.username);
  if (username) return username;
  return normalizeUsername(publicName(person));
}

function replaceActiveMention(value, activeMention, username) {
  const text = String(value || '');
  return `${text.slice(0, activeMention.start)}@${username} ${text.slice(activeMention.end)}`;
}

function mentionsUsername(body, username) {
  if (!username) return false;
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?=$|[^a-zA-Z0-9_])`, 'i').test(String(body || ''));
}

function roomTitle(room, userId = null) {
  if (room?.name?.trim()) return room.name.trim();
  const members = (room?.members || []).filter((member) => member.id !== userId);
  return peopleSummary(members.length ? members : room?.members || []) || 'Chat room';
}

function peopleSummary(members) {
  const names = (members || []).map(publicName).filter(Boolean);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function expiresText(expiresAt) {
  if (!expiresAt) return 'Temporary chat';
  const end = new Date(expiresAt).getTime();
  const diff = end - Date.now();
  if (diff <= 0) return 'Expired';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `Expires in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `Expires in ${hours}h`;
  return `Expires in ${Math.ceil(hours / 24)}d`;
}

function formatExpiryDate(expiresAt) {
  if (!expiresAt) return 'No expiry date';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'No expiry date';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
      maxWidth: Platform.OS === 'web' ? 860 : undefined,
      height: '88%',
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
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    headerSide: {
      minWidth: 48,
    },
    title: {
      ...typography.title,
      flex: 1,
      fontSize: 22,
      textAlign: 'center',
    },
    titleButton: {
      flex: 1,
      minWidth: 0,
    },
    backText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
    },
    doneText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
      textAlign: 'right',
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    notice: {
      margin: spacing.lg,
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
    createRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.md,
    },
    createIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createIconText: {
      color: '#fff',
      fontSize: 28,
      lineHeight: 30,
      fontWeight: '300',
    },
    createTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
    },
    createHint: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    emptyText: {
      ...typography.bodyMuted,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
    chatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    avatarStack: {
      width: 48,
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarOverlap: {
      marginLeft: -20,
    },
    chatText: {
      flex: 1,
      minWidth: 0,
    },
    chatTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    chatTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
    },
    pinText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '800',
    },
    peopleText: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    previewText: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 3,
    },
    unreadPill: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    unreadText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '800',
    },
    section: {
      gap: spacing.sm,
    },
    sectionLabel: {
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
    durationGrid: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    durationBtn: {
      minWidth: 58,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
    },
    durationBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    durationText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '800',
    },
    durationTextActive: {
      color: '#fff',
    },
    friendPickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    friendPickRowSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
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
    checkCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    checkCircleSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '900',
    },
    primaryBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    primaryBtnText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '800',
    },
    disabled: {
      opacity: 0.5,
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
    roomWrap: {
      flex: 1,
      minHeight: 0,
    },
    expiryText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
      paddingBottom: spacing.sm,
    },
    messagesContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
      flexGrow: 1,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      maxWidth: '86%',
    },
    messageRowMine: {
      alignSelf: 'flex-end',
      justifyContent: 'flex-end',
    },
    bubble: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderBottomLeftRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    bubbleMentioned: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
      borderWidth: 2,
    },
    bubbleMine: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: radius.sm,
    },
    senderName: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
      marginBottom: 2,
    },
    senderNameMentioned: {
      color: colors.primary,
    },
    messageText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 20,
    },
    messageTextMine: {
      color: '#fff',
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      position: 'relative',
    },
    mentionPanel: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: 56,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      overflow: 'hidden',
      zIndex: 5,
    },
    mentionOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.primarySoft,
    },
    mentionText: {
      flex: 1,
      minWidth: 0,
    },
    mentionName: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
    },
    mentionUsername: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 1,
    },
    composerInput: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 15,
      lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
      color: colors.text,
      textAlignVertical: 'top',
    },
    sendBtn: {
      minHeight: 44,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '800',
    },
    actionBackdrop: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
      backgroundColor: colors.overlay,
    },
    actionPanel: {
      margin: spacing.lg,
      alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
      width: Platform.OS === 'web' ? '100%' : undefined,
      maxWidth: Platform.OS === 'web' ? 420 : undefined,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    actionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
      padding: spacing.sm,
    },
    actionBtn: {
      minHeight: 46,
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
    },
    actionDanger: {
      backgroundColor: colors.dangerSoft,
    },
    actionDangerText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: '800',
    },
    actionCancel: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionCancelText: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '700',
    },
    detailsPanel: {
      margin: spacing.lg,
      alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
      width: Platform.OS === 'web' ? '100%' : undefined,
      maxWidth: Platform.OS === 'web' ? 520 : undefined,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.lg,
    },
    detailsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    detailsTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
    },
    detailsSection: {
      gap: spacing.sm,
    },
    detailsValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    participantRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      padding: spacing.sm,
      gap: spacing.sm,
    },
  });
