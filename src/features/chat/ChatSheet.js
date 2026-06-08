import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';

import { useTheme } from '../../shared/theme';
import {
  addChatParticipants,
  addFriend,
  createChatRoom,
  hideChatRoom,
  loadCachedChatMessages,
  loadCachedChatRooms,
  loadCachedFriends,
  loadChatMessages,
  loadChatRooms,
  loadFriends,
  markChatRead,
  renameChatRoom,
  sendChatMessage,
  setChatPinned,
  subscribeToChatRoom,
} from './chatRepository';
import { normalizeUsername, publicName } from '../../shared/profile';
import ProfileAvatar from '../profile/ProfileAvatar';

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
const COMPOSER_INPUT_FONT_SIZE = 15;
const COMPOSER_INPUT_AVERAGE_CHAR_WIDTH = 7.1;
const PENDING_MATCH_WINDOW_MS = 60_000;

function localMessageId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function messageTimestamp(message, fallback = 0) {
  const time = new Date(message?.createdAt || '').getTime();
  return Number.isNaN(time) ? fallback : time;
}

function createLocalMessage({ roomId, userId, profile, body }) {
  const id = localMessageId();
  return {
    id,
    localId: id,
    roomId,
    senderId: userId,
    body,
    createdAt: new Date().toISOString(),
    type: 'message',
    isSystem: false,
    isLocal: true,
    localStatus: 'sending',
    sender: {
      ...(profile || {}),
      id: userId,
    },
  };
}

function stripLocalMessages(messages = []) {
  return messages.filter((message) => !message?.isLocal);
}

function pendingMatchesRemote(pending, remote) {
  if (!pending || !remote || remote.isSystem) return false;
  if (pending.senderId !== remote.senderId || pending.body !== remote.body) return false;
  const pendingTime = messageTimestamp(pending, Date.now());
  const remoteTime = messageTimestamp(remote, pendingTime);
  return Math.abs(remoteTime - pendingTime) <= PENDING_MATCH_WINDOW_MS;
}

function reconcilePendingMessages(pendingMessages = [], roomId, remoteMessages = []) {
  const remoteIds = new Set(remoteMessages.map((message) => message.id).filter(Boolean));
  const matchedRemoteIds = new Set();

  return pendingMessages.filter((pending) => {
    if (pending.roomId !== roomId) return true;
    if (pending.serverId && remoteIds.has(pending.serverId)) {
      matchedRemoteIds.add(pending.serverId);
      return false;
    }

    const match = remoteMessages.find((remote) => {
      if (remote.id && matchedRemoteIds.has(remote.id)) return false;
      return pendingMatchesRemote(pending, remote);
    });

    if (match) {
      if (match.id) matchedRemoteIds.add(match.id);
      return false;
    }

    return true;
  });
}

function mergeChatMessages(remoteMessages = [], pendingMessages = [], roomId) {
  const localMessages = pendingMessages.filter((message) => message.roomId === roomId);
  return [...stripLocalMessages(remoteMessages), ...localMessages].sort(
    (a, b) => messageTimestamp(a) - messageTimestamp(b)
  );
}

function sentMessageId(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return sentMessageId(value[0]);
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function applyPendingRoomPreviews(rooms, pendingMessages = []) {
  if (!Array.isArray(rooms) || pendingMessages.length === 0) return rooms;
  return rooms.map((room) => {
    const latestPending = pendingMessages
      .filter((message) => message.roomId === room.id && message.localStatus !== 'failed')
      .sort((a, b) => messageTimestamp(b) - messageTimestamp(a))[0];
    if (!latestPending) return room;
    const roomLastAt = messageTimestamp({ createdAt: room.lastMessageAt });
    if (roomLastAt > messageTimestamp(latestPending)) return room;
    return {
      ...room,
      lastMessageBody: latestPending.body,
      lastMessageAt: latestPending.createdAt,
      unreadCount: 0,
    };
  });
}

export default function ChatSheet({
  visible,
  embedded = false,
  activeRoomId,
  onRoomChange,
  onClose,
  session = null,
  profile = null,
}) {
  const { colors, spacing, radius, typography } = useTheme();
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
  const messageScrollRef = useRef(null);
  const activeRoomIdRef = useRef(null);
  const pendingMessagesRef = useRef([]);

  useEffect(() => {
    activeRoomIdRef.current = activeRoom?.id ?? null;
  }, [activeRoom?.id]);

  const syncVisibleMessages = useCallback((roomId, animated = true) => {
    if (!roomId || activeRoomIdRef.current !== roomId) return;
    setMessages((current) => mergeChatMessages(current, pendingMessagesRef.current, roomId));
    setTimeout(() => messageScrollRef.current?.scrollToEnd?.({ animated }), 50);
  }, []);

  const refreshRooms = useCallback(async () => {
    if (!canUseChats) {
      setRooms([]);
      return [];
    }
    const items = await loadChatRooms();
    const nextItems = applyPendingRoomPreviews(items, pendingMessagesRef.current);
    setRooms(nextItems);
    return nextItems;
  }, [canUseChats]);

  const refreshMessages = useCallback(async (roomId) => {
    if (!roomId) return;
    const items = await loadChatMessages(roomId);
    pendingMessagesRef.current = reconcilePendingMessages(
      pendingMessagesRef.current,
      roomId,
      items
    );
    if (activeRoomIdRef.current === roomId) {
      setMessages(mergeChatMessages(items, pendingMessagesRef.current, roomId));
      markChatRead(roomId).catch(() => {});
      setTimeout(() => messageScrollRef.current?.scrollToEnd?.({ animated: true }), 50);
    }
    return items;
  }, []);

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
    setLoading(rooms.length === 0);
    Promise.all([loadCachedChatRooms(), loadCachedFriends()])
      .then(([cachedRooms, cachedFriends]) => {
        if (cancelled) return;
        if (cachedRooms.length > 0) {
          setRooms(applyPendingRoomPreviews(cachedRooms, pendingMessagesRef.current));
          setLoading(false);
        }
        if (cachedFriends.length > 0) setFriends(cachedFriends);
      })
      .catch(() => {});
    Promise.all([loadChatRooms(), loadFriends()])
      .then(([roomItems, friendItems]) => {
        if (cancelled) return;
        setRooms(applyPendingRoomPreviews(roomItems, pendingMessagesRef.current));
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

  const roomRoutingControlled = activeRoomId !== undefined;

  const startCreate = () => {
    setRoomName('');
    setSelectedFriendIds([]);
    setLifetimeHours(24);
    setMessage(null);
    setMode('create');
  };

  const openRoom = useCallback((room) => {
    const roomId = room?.id ?? null;
    activeRoomIdRef.current = roomId;
    setActiveRoom(room);
    setMessages(roomId ? mergeChatMessages([], pendingMessagesRef.current, roomId) : []);
    setDraft('');
    setMessage(null);
    setMode('room');
    onRoomChange?.(roomId);
    if (!roomId) return;
    loadCachedChatMessages(roomId)
      .then((cachedMessages) => {
        if (cachedMessages.length > 0 && activeRoomIdRef.current === roomId) {
          setMessages(mergeChatMessages(cachedMessages, pendingMessagesRef.current, roomId));
          setTimeout(() => messageScrollRef.current?.scrollToEnd?.({ animated: false }), 50);
        }
      })
      .catch(() => {});
  }, [onRoomChange]);

  const backToList = useCallback(() => {
    activeRoomIdRef.current = null;
    setMode('list');
    setActiveRoom(null);
    setDetailsRoom(null);
    setMessages([]);
    setDraft('');
    setMessage(null);
    onRoomChange?.(null);
  }, [onRoomChange]);

  useEffect(() => {
    if (!visible || !roomRoutingControlled || !activeRoomId) return;
    if (activeRoom?.id === activeRoomId) return;
    const routedRoom = rooms.find((room) => room.id === activeRoomId);
    if (routedRoom) openRoom(routedRoom);
  }, [activeRoom?.id, activeRoomId, openRoom, roomRoutingControlled, rooms, visible]);

  useEffect(() => {
    if (!visible || !roomRoutingControlled || activeRoomId || mode !== 'room') return;
    backToList();
  }, [activeRoomId, backToList, mode, roomRoutingControlled, visible]);

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

  const handleSend = () => {
    const body = draft.trim();
    const roomId = activeRoom?.id;
    if (!body || !roomId || !userId) return;

    const localMessage = createLocalMessage({ roomId, userId, profile, body });
    pendingMessagesRef.current = [...pendingMessagesRef.current, localMessage];
    setDraft('');
    setMessage(null);
    setMessages((current) => mergeChatMessages(current, pendingMessagesRef.current, roomId));
    setRooms((current) => applyPendingRoomPreviews(current, pendingMessagesRef.current));
    setActiveRoom((current) =>
      current?.id === roomId
        ? {
            ...current,
            lastMessageBody: body,
            lastMessageAt: localMessage.createdAt,
            unreadCount: 0,
          }
        : current
    );
    setTimeout(() => messageScrollRef.current?.scrollToEnd?.({ animated: true }), 50);

    sendChatMessage(roomId, body)
      .then(async (messageId) => {
        const serverId = sentMessageId(messageId);
        pendingMessagesRef.current = pendingMessagesRef.current.map((pending) =>
          pending.localId === localMessage.localId
            ? {
                ...pending,
                id: serverId || pending.id,
                serverId: serverId || pending.serverId,
                localStatus: 'sent',
              }
            : pending
        );
        syncVisibleMessages(roomId, false);
        await refreshMessages(roomId);
        await refreshRooms();
      })
      .catch((e) => {
        pendingMessagesRef.current = pendingMessagesRef.current.map((pending) =>
          pending.localId === localMessage.localId
            ? { ...pending, localStatus: 'failed' }
            : pending
        );
        syncVisibleMessages(roomId, false);
        setMessage(e?.message || 'Could not send message.');
        refreshRooms().catch(() => {});
      });
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

  const replaceRoom = (nextRoom) => {
    if (!nextRoom?.id) return;
    setRooms((prev) => prev.map((room) => (room.id === nextRoom.id ? nextRoom : room)));
    setActiveRoom((prev) => (prev?.id === nextRoom.id ? nextRoom : prev));
    setDetailsRoom((prev) => (prev?.id === nextRoom.id ? nextRoom : prev));
  };

  const refreshRoomById = async (roomId) => {
    const nextRooms = await refreshRooms();
    const nextRoom = nextRooms.find((room) => room.id === roomId);
    if (nextRoom) replaceRoom(nextRoom);
    return nextRoom;
  };

  const handleRenameRoom = async (room, nextName) => {
    const name = String(nextName || '').trim();
    if (!room?.id || busy) return;
    const optimisticRoom = { ...room, name };
    replaceRoom(optimisticRoom);
    setBusy(true);
    setMessage(null);
    try {
      await renameChatRoom(room.id, name);
      await refreshRoomById(room.id);
      if (activeRoom?.id === room.id) await refreshMessages(room.id);
    } catch (e) {
      setMessage(e?.message || 'Could not rename chat.');
      await refreshRoomById(room.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleAddParticipants = async (room, friendIds) => {
    if (!room?.id || !Array.isArray(friendIds) || friendIds.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await addChatParticipants(room.id, friendIds);
      await refreshRoomById(room.id);
      if (activeRoom?.id === room.id) await refreshMessages(room.id);
    } catch (e) {
      setMessage(e?.message || 'Could not add people to this chat.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestFriend = async (person) => {
    if (!person?.id || person.id === userId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await addFriend(person.id);
      const nextFriends = await loadFriends();
      setFriends(nextFriends);
      if (detailsRoom?.id) await refreshRoomById(detailsRoom.id);
    } catch (e) {
      setMessage(e?.message || 'Could not send friend request.');
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <View style={[styles.screen, embedded && styles.embeddedScreen]}>
        <View style={[styles.chatWindow, embedded && styles.embeddedChatWindow]}>
          <View style={[styles.windowHeader, mode === 'create' && styles.windowHeaderPlain]}>
            <View style={styles.header}>
              <Pressable
                onPress={mode === 'list' ? onClose : backToList}
                disabled={embedded && mode === 'list'}
                hitSlop={8}
                style={styles.headerSide}
              >
                <Text style={styles.backText}>{embedded && mode === 'list' ? '' : 'Back'}</Text>
              </Pressable>
              {mode === 'room' ? (
                <Pressable
                  onPress={() => setDetailsRoom(activeRoom)}
                  disabled={!activeRoom}
                  style={styles.titleButton}
                  accessibilityRole="button"
                  accessibilityLabel="Show chat details"
                >
                  <Text style={styles.roomTitle} numberOfLines={1}>
                    {roomTitle(activeRoom, userId)}
                  </Text>
                  <Text style={styles.headerExpiryText} numberOfLines={1}>
                    {expiresText(activeRoom?.expiresAt)}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.title} numberOfLines={1}>
                  {mode === 'create' ? 'New chat' : 'Chats'}
                </Text>
              )}
              <View style={styles.headerSide} />
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
              spacing={spacing}
              room={activeRoom}
              messages={messages}
              userId={userId}
              profile={profile}
              draft={draft}
              setDraft={setDraft}
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
        </View>

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
            friends={friends}
            busy={busy}
            onRename={handleRenameRoom}
            onAddParticipants={handleAddParticipants}
            onRequestFriend={handleRequestFriend}
            onClose={() => setDetailsRoom(null)}
          />
        ) : null}
      </View>
  );

  if (embedded) {
    if (!visible) return null;
    return content;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {content}
    </Modal>
  );
}

function ListView({ styles, rooms, userId, loading, message, onCreate, onOpen, onLongPress }) {
  return (
    <View style={styles.listWrap}>
      <View style={styles.createEntryWrap}>
        <Pressable
          onPress={onCreate}
          style={({ pressed, hovered }) => [
            styles.createRow,
            hovered && styles.createRowHovered,
            pressed && styles.createRowPressed,
          ]}
        >
          <View style={styles.createIcon}>
            <Text style={styles.createIconText}>+</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.createTitle}>Create new chat</Text>
            <Text style={styles.createHint}>Temporary rooms for friends only</Text>
          </View>
        </Pressable>
      </View>

      <ScrollView style={styles.chatList} contentContainerStyle={styles.chatListContent}>
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
    </View>
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
    <View style={styles.createContent}>
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
                style={({ pressed, hovered }) => [
                  styles.durationBtn,
                  active && styles.durationBtnActive,
                  hovered && (active ? styles.durationBtnActiveHovered : styles.durationBtnHovered),
                  pressed && styles.durationBtnPressed,
                ]}
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
              style={({ pressed, hovered }) => [
                styles.friendPickRow,
                selected && styles.friendPickRowSelected,
                hovered && (selected ? styles.friendPickRowSelectedHovered : styles.friendPickRowHovered),
                pressed && styles.friendPickRowPressed,
              ]}
            >
              <ProfileAvatar profile={friend} size={38} />
              <View style={styles.friendText}>
                <Text style={styles.friendName} numberOfLines={1}>{publicName(friend)}</Text>
                <Text style={styles.friendUsername} numberOfLines={1}>
                  {friend.username ? `@${friend.username}` : 'Friend'}
                </Text>
              </View>
              <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                {selected ? <Text style={styles.checkText}>{'\u2713'}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {message ? <MessageBox styles={styles} text={message} /> : null}

      <Pressable
        onPress={onCreate}
        disabled={!canCreate}
        style={({ pressed, hovered }) => [
          styles.primaryBtn,
          hovered && canCreate && styles.primaryBtnHovered,
          pressed && canCreate && styles.primaryBtnPressed,
          !canCreate && styles.disabled,
        ]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create chat</Text>}
      </Pressable>
    </View>
  );
}

function RoomView({
  styles,
  colors,
  spacing,
  room,
  messages,
  userId,
  profile,
  draft,
  setDraft,
  message,
  onSend,
  scrollRef,
}) {
  const [selection, setSelection] = useState({ start: draft.length, end: draft.length });
  const [measuredInputHeight, setMeasuredInputHeight] = useState(0);
  const [measuredTextHeight, setMeasuredTextHeight] = useState(0);
  const [inputFrameWidth, setInputFrameWidth] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const measuredContentHeight = Math.max(measuredInputHeight, measuredTextHeight);
  const inputHeight = useMemo(
    () => composerHeightForText(draft, measuredContentHeight, inputFrameWidth, spacing.md),
    [draft, inputFrameWidth, measuredContentHeight, spacing.md]
  );
  const currentUsername = normalizeUsername(profile?.username);
  const activeMention =
    getActiveMention(draft, selection.start) || getActiveMention(draft, draft.length);
  const mentionOptions = useMemo(
    () => getMentionOptions(room, userId, activeMention?.query),
    [room, userId, activeMention?.query]
  );
  useEffect(() => {
    if (!draft) {
      setMeasuredInputHeight(0);
      setMeasuredTextHeight(0);
    }
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
  const updateMeasuredTextHeight = (event) => {
    const measuredHeight = Math.ceil(event.nativeEvent.layout?.height || 0);
    if (measuredHeight) setMeasuredTextHeight(measuredHeight);
  };
  const updateInputFrameWidth = (event) => {
    const nextWidth = Math.round(event.nativeEvent.layout?.width || 0);
    setInputFrameWidth((current) => (current === nextWidth ? current : nextWidth));
  };
  const handleComposerKeyPress = (event) => {
    const nativeEvent = event.nativeEvent || {};
    if (Platform.OS !== 'web') return;
    if (nativeEvent.key !== 'Enter' || nativeEvent.shiftKey) return;
    event.preventDefault?.();
    nativeEvent.preventDefault?.();
    if (!draft.trim()) return;
    onSend?.();
  };
  const composerBottomLift = Platform.OS === 'web' ? spacing.md : spacing.xl;
  const canSend = !!draft.trim();

  return (
    <KeyboardAvoidingView
      style={styles.roomWrap}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.length === 0 ? (
          <Text style={styles.emptyText}>No messages yet.</Text>
        ) : null}
        {messages.map((item, index) => {
          if (item.isSystem) {
            return (
              <View key={item.id} style={styles.systemMessageRow}>
                <View style={styles.systemMessageBox}>
                  <Text style={styles.systemMessageText}>{item.body}</Text>
                </View>
              </View>
            );
          }
          const mine = item.senderId === userId;
          const mentioned = !mine && mentionsUsername(item.body, currentUsername);
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const startsSenderRun = !previous || previous.isSystem || previous.senderId !== item.senderId;
          const endsSenderRun = !next || next.isSystem || next.senderId !== item.senderId;
          return (
            <View key={item.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
              {!mine ? (
                endsSenderRun ? (
                  <ProfileAvatar profile={item.sender} size={30} />
                ) : (
                  <View style={styles.messageAvatarSpacer} />
                )
              ) : null}
              <View
                style={[
                  styles.bubble,
                  mentioned && styles.bubbleMentioned,
                  mine && styles.bubbleMine,
                  item.localStatus === 'sending' && styles.bubbleSending,
                  item.localStatus === 'failed' && styles.bubbleFailed,
                ]}
              >
                {!mine && startsSenderRun ? (
                  <Text style={[styles.senderName, mentioned && styles.senderNameMentioned]} numberOfLines={1}>{publicName(item.sender)}</Text>
                ) : null}
                <Text
                  style={[
                    styles.messageText,
                    mine && styles.messageTextMine,
                    item.localStatus === 'failed' && styles.messageTextFailed,
                  ]}
                >
                  {item.body}
                </Text>
                {item.localStatus === 'sending' || item.localStatus === 'failed' ? (
                  <Text
                    style={[
                      styles.messageStatus,
                      mine && styles.messageStatusMine,
                      item.localStatus === 'failed' && styles.messageStatusFailed,
                    ]}
                  >
                    {item.localStatus === 'failed' ? 'Not sent' : 'Sending...'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
      {message ? <MessageBox styles={styles} text={message} /> : null}
      <View
        style={[
          styles.composer,
          { paddingBottom: composerBottomLift },
          keyboardInset ? { marginBottom: keyboardInset } : null,
        ]}
      >
        {showMentions ? (
          <View style={[styles.mentionPanel, { bottom: inputHeight + composerBottomLift + 12 }]}>
            {mentionOptions.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => insertMention(person)}
                style={({ pressed, hovered }) => [
                  styles.mentionOption,
                  hovered && styles.mentionOptionHovered,
                  pressed && styles.mentionOptionPressed,
                ]}
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
        <View
          onLayout={updateInputFrameWidth}
          style={[styles.composerInputFrame, { height: inputHeight }]}
        >
          <Text
            onLayout={updateMeasuredTextHeight}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.composerMeasureText}
          >
            {draft || ' '}
          </Text>
          <TextInput
            value={draft}
            onChangeText={updateDraft}
            onContentSizeChange={updateInputHeight}
            onKeyPress={handleComposerKeyPress}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            placeholder="Message"
            placeholderTextColor={colors.textFaint}
            style={[styles.composerInput, { minHeight: inputHeight }]}
            multiline
            numberOfLines={Math.min(
              COMPOSER_INPUT_MAX_LINES,
              Math.max(1, String(draft || '').split('\n').length)
            )}
            scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
            returnKeyType={Platform.OS === 'web' ? 'send' : 'default'}
            submitBehavior={Platform.OS === 'web' ? undefined : 'newline'}
            blurOnSubmit={false}
            maxLength={2000}
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed, hovered }) => [
            styles.sendBtn,
            hovered && canSend && styles.sendBtnHovered,
            pressed && canSend && styles.sendBtnPressed,
            !canSend && styles.disabled,
          ]}
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
      style={({ pressed, hovered }) => [
        styles.chatRow,
        hovered && styles.chatRowHovered,
        pressed && styles.chatRowPressed,
      ]}
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

function ChatDetailsPanel({
  styles,
  room,
  userId,
  friends,
  busy,
  onRename,
  onAddParticipants,
  onRequestFriend,
  onClose,
}) {
  const participants = room?.members || [];
  const isCreator = room?.createdBy === userId;
  const [draftName, setDraftName] = useState(room?.name || '');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const memberIds = useMemo(() => new Set(participants.map((person) => person.id)), [participants]);
  const addableFriends = useMemo(
    () => (friends || []).filter((friend) => friend?.id && !memberIds.has(friend.id)),
    [friends, memberIds]
  );
  const filteredAddableFriends = useMemo(() => {
    const query = friendSearch.trim().toLowerCase();
    if (!query) return addableFriends;
    return addableFriends.filter((friend) => {
      const name = publicName(friend).toLowerCase();
      const username = String(friend.username || '').toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [addableFriends, friendSearch]);
  const cleanDraftName = draftName.trim();
  const canSaveName = isCreator && cleanDraftName !== String(room?.name || '').trim() && !busy;
  const canAddPeople = isCreator && selectedIds.length > 0 && !busy;

  useEffect(() => {
    setDraftName(room?.name || '');
    setSelectedIds([]);
    setShowAddPeople(false);
    setFriendSearch('');
  }, [room?.id, room?.name]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const saveName = () => {
    if (!canSaveName) return;
    onRename(room, cleanDraftName);
  };

  const addPeople = () => {
    if (!canAddPeople) return;
    onAddParticipants(room, selectedIds);
    setSelectedIds([]);
    setShowAddPeople(false);
    setFriendSearch('');
  };

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

        <View style={styles.detailsContent}>
          <View style={styles.detailsSection}>
            <Text style={styles.sectionLabel}>Chat name</Text>
            {isCreator ? (
              <View style={styles.detailsEditRow}>
                <TextInput
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="Optional chat name"
                  placeholderTextColor={styles.placeholderColor.color}
                  style={[styles.input, styles.detailsNameInput]}
                  maxLength={80}
                />
                <Pressable
                  onPress={saveName}
                  disabled={!canSaveName}
                  style={[styles.smallPrimaryBtn, !canSaveName && styles.disabled]}
                >
                  <Text style={styles.smallPrimaryText}>Save</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.detailsValue}>{roomTitle(room, userId)}</Text>
            )}
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.participantHeader}>
              <Text style={styles.sectionLabel}>Participants</Text>
              {isCreator ? (
                <Pressable
                  onPress={() => setShowAddPeople(true)}
                  style={styles.addParticipantBtn}
                >
                  <Text style={styles.addParticipantText}>Add participant</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              style={styles.participantsFrame}
              contentContainerStyle={styles.participantsContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {participants.length === 0 ? (
                <Text style={styles.emptyText}>No participants listed.</Text>
              ) : (
                participants.map((person) => {
                  const isSelf = person.id === userId;
                  const canRequest = !isSelf && !person.isFriend && !person.outgoingRequest && !busy;
                  const actionLabel = person.isFriend
                    ? 'Friends'
                    : person.outgoingRequest
                      ? 'Requested'
                      : person.incomingRequest
                        ? 'Confirm'
                        : 'Request';
                  return (
                    <View key={person.id} style={styles.participantRow}>
                      <ProfileAvatar profile={person} size={34} />
                      <View style={styles.friendText}>
                        <Text style={styles.friendName} numberOfLines={1}>{publicName(person)}</Text>
                        <Text style={styles.friendUsername} numberOfLines={1}>
                          {person.username ? `@${person.username}` : isSelf ? 'You' : 'Participant'}
                        </Text>
                      </View>
                      {!isSelf ? (
                        <Pressable
                          onPress={() => onRequestFriend(person)}
                          disabled={!canRequest}
                          style={[styles.friendRequestBtn, !canRequest && styles.friendRequestBtnDisabled]}
                        >
                          <Text
                            style={[
                              styles.friendRequestText,
                              !canRequest && styles.friendRequestTextDisabled,
                            ]}
                          >
                            {actionLabel}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionLabel}>Expiry date</Text>
            <Text style={styles.detailsValue}>{formatExpiryDate(room?.expiresAt)}</Text>
          </View>
        </View>
      </View>
      {showAddPeople ? (
        <AddParticipantsPanel
          styles={styles}
          friends={filteredAddableFriends}
          selectedIds={selectedIds}
          search={friendSearch}
          setSearch={setFriendSearch}
          toggleSelected={toggleSelected}
          busy={busy}
          canAdd={canAddPeople}
          hasAnyFriends={addableFriends.length > 0}
          onAdd={addPeople}
          onCancel={() => {
            setShowAddPeople(false);
            setSelectedIds([]);
            setFriendSearch('');
          }}
        />
      ) : null}
    </View>
  );
}

function AddParticipantsPanel({
  styles,
  friends,
  selectedIds,
  search,
  setSearch,
  toggleSelected,
  busy,
  canAdd,
  hasAnyFriends,
  onAdd,
  onCancel,
}) {
  return (
    <View style={styles.addParticipantOverlay}>
      <Pressable style={styles.backdropFill} onPress={onCancel} />
      <View style={styles.addParticipantPanel}>
        <View style={styles.detailsHeader}>
          <Text style={styles.detailsTitle}>Add participant</Text>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.doneText}>Cancel</Text>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search friends"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ScrollView
          style={styles.addParticipantList}
          contentContainerStyle={styles.addParticipantListContent}
          keyboardShouldPersistTaps="handled"
        >
          {!hasAnyFriends ? (
            <Text style={styles.emptyText}>Everyone in your friends list is already here.</Text>
          ) : friends.length === 0 ? (
            <Text style={styles.emptyText}>No friends match that search.</Text>
          ) : (
            friends.map((friend) => {
              const selected = selectedIds.includes(friend.id);
              return (
                <Pressable
                  key={friend.id}
                  onPress={() => toggleSelected(friend.id)}
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
                    {selected ? <Text style={styles.checkText}>{'\u2713'}</Text> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <Pressable
          onPress={onAdd}
          disabled={!canAdd}
          style={[styles.primaryBtn, !canAdd && styles.disabled]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add to chat</Text>}
        </Pressable>
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

function composerHeightForText(value, measuredHeight = 0, inputWidth = 0, horizontalPadding = 0) {
  const text = String(value || '');
  const explicitLineCount = Math.max(1, text.split('\n').length);
  const wrappedLineCount = estimateWrappedLineCount(text, inputWidth, horizontalPadding);
  const lineCount = Math.max(explicitLineCount, wrappedLineCount);
  const explicitLineHeight =
    lineCount * COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING;
  const nextHeight = Math.max(measuredHeight, explicitLineHeight);
  return Math.min(
    COMPOSER_INPUT_MAX_HEIGHT,
    Math.max(COMPOSER_INPUT_MIN_HEIGHT, nextHeight)
  );
}

function estimateWrappedLineCount(value, inputWidth, horizontalPadding) {
  const text = String(value || '');
  const availableWidth = inputWidth - horizontalPadding * 2;
  if (availableWidth <= 0) return Math.max(1, text.split('\n').length);

  const charactersPerLine = Math.max(
    1,
    Math.floor(availableWidth / COMPOSER_INPUT_AVERAGE_CHAR_WIDTH)
  );
  return text.split('\n').reduce((total, line) => {
    const visualLength = Math.max(1, line.length);
    return total + Math.ceil(visualLength / charactersPerLine);
  }, 0);
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
    screen: {
      flex: 1,
      position: 'relative',
      backgroundColor: colors.bg,
      paddingTop: Platform.OS === 'ios' ? 44 : Platform.OS === 'web' ? 0 : spacing.lg,
      paddingBottom: 0,
    },
    embeddedScreen: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    backdropFill: { ...StyleSheet.absoluteFillObject },
    chatWindow: {
      flex: 1,
      alignSelf: 'center',
      backgroundColor: colors.bg,
      width: '100%',
      overflow: 'hidden',
    },
    embeddedChatWindow: {
      alignSelf: 'stretch',
    },
    windowHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    windowHeaderPlain: {
      borderBottomWidth: 0,
    },
    header: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      gap: spacing.sm,
    },
    headerSide: {
      width: 64,
    },
    title: {
      ...typography.title,
      flex: 1,
      fontSize: 20,
      textAlign: 'center',
    },
    titleButton: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roomTitle: {
      ...typography.title,
      color: colors.text,
      fontSize: 18,
      textAlign: 'center',
    },
    headerExpiryText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 14,
      marginTop: 1,
      textAlign: 'center',
    },
    backText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    doneText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
      textAlign: 'right',
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    createContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    listWrap: {
      flex: 1,
      minHeight: 0,
    },
    createEntryWrap: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    chatList: {
      flex: 1,
    },
    chatListContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
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
    createRowHovered: {
      backgroundColor: colors.primarySoftHover,
    },
    createRowPressed: {
      opacity: 0.78,
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
    chatRowHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    chatRowPressed: {
      backgroundColor: colors.cardMutedHover,
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
    placeholderColor: {
      color: colors.textFaint,
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
    durationBtnHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    durationBtnActiveHovered: {
      backgroundColor: colors.primaryHover,
    },
    durationBtnPressed: {
      opacity: 0.78,
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
    friendPickRowHovered: {
      backgroundColor: colors.cardHover,
      borderColor: colors.borderHover,
    },
    friendPickRowSelectedHovered: {
      backgroundColor: colors.primarySoftHover,
    },
    friendPickRowPressed: {
      opacity: 0.78,
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
    primaryBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    primaryBtnPressed: {
      opacity: 0.78,
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
    messagesContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
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
    messageAvatarSpacer: {
      width: 30,
      height: 30,
    },
    systemMessageRow: {
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    systemMessageBox: {
      maxWidth: '86%',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardMuted,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    systemMessageText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      textAlign: 'center',
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
    bubbleSending: {
      opacity: 0.82,
    },
    bubbleFailed: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
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
    messageTextFailed: {
      color: colors.danger,
    },
    messageStatus: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 14,
      marginTop: 4,
    },
    messageStatusMine: {
      color: 'rgba(255, 255, 255, 0.78)',
    },
    messageStatusFailed: {
      color: colors.danger,
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
    mentionOptionHovered: {
      backgroundColor: colors.primarySoftHover,
    },
    mentionOptionPressed: {
      opacity: 0.78,
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
    composerInputFrame: {
      flex: 1,
      position: 'relative',
      minHeight: COMPOSER_INPUT_MIN_HEIGHT,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    composerInput: {
      width: '100%',
      minHeight: COMPOSER_INPUT_MIN_HEIGHT,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      backgroundColor: 'transparent',
      borderWidth: 0,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: COMPOSER_INPUT_FONT_SIZE,
      lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
      color: colors.text,
      textAlignVertical: 'top',
    },
    composerMeasureText: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      opacity: 0,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: COMPOSER_INPUT_FONT_SIZE,
      lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
      color: colors.text,
    },
    sendBtn: {
      minHeight: 44,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnHovered: {
      backgroundColor: colors.primaryHover,
    },
    sendBtnPressed: {
      opacity: 0.78,
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
      maxHeight: '88%',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
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
    detailsContent: {
      gap: spacing.lg,
      paddingBottom: spacing.sm,
    },
    detailsSection: {
      gap: spacing.sm,
    },
    detailsEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    detailsNameInput: {
      flex: 1,
      minWidth: 0,
    },
    detailsValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    smallPrimaryBtn: {
      minHeight: 46,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    smallPrimaryText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '800',
    },
    participantHeader: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    addParticipantBtn: {
      minHeight: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    addParticipantText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '800',
    },
    addParticipantOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
      backgroundColor: colors.overlay,
    },
    addParticipantPanel: {
      margin: spacing.lg,
      alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
      width: Platform.OS === 'web' ? '100%' : undefined,
      maxWidth: Platform.OS === 'web' ? 480 : undefined,
      maxHeight: '78%',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    addParticipantList: {
      maxHeight: 360,
    },
    addParticipantListContent: {
      gap: spacing.sm,
      paddingBottom: spacing.xs,
    },
    participantsFrame: {
      maxHeight: 310,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    participantsContent: {
      padding: spacing.sm,
      gap: spacing.sm,
    },
    participantRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.cardMuted,
      padding: spacing.sm,
      gap: spacing.sm,
    },
    friendRequestBtn: {
      minHeight: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    friendRequestBtnDisabled: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    friendRequestText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '800',
    },
    friendRequestTextDisabled: {
      color: colors.textMuted,
    },
  });
