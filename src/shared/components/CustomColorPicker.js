import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isValidHex, useTheme } from '../theme';

function normalizeHex(value) {
  if (!isValidHex(value)) return null;
  const hex = value.trim().slice(1);
  return `#${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex}`.toUpperCase();
}

function channelHex(channels) {
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// Each instance keeps a draft so dismissing the popup never changes the form.
export default function CustomColorPicker({ value, onChange }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('#000000');
  const [hexInput, setHexInput] = useState(draft);
  const validHex = normalizeHex(hexInput);
  const channels = [1, 3, 5].map((offset) => parseInt(draft.slice(offset, offset + 2), 16));
  const update = (hex) => { setDraft(hex); setHexInput(hex); };
  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a custom colour"
        onPress={() => { update(normalizeHex(value) || normalizeHex(colors.primary) || '#000000'); setOpen(true); }}
        style={[styles.trigger, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={[styles.swatch, { backgroundColor: normalizeHex(value) || colors.primary, borderColor: colors.border }]} />
        <Text style={{ color: colors.text, fontWeight: '600' }}>Custom colour…</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Cancel colour selection" accessibilityRole="button" />
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityViewIsModal>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Custom colour</Text>
              <View style={[styles.preview, { backgroundColor: draft, borderColor: colors.border }]} />
              {Platform.OS === 'web' ? React.createElement('input', {
                type: 'color', value: draft, 'aria-label': 'Colour spectrum',
                onChange: (event) => update(event.target.value.toUpperCase()),
                style: { width: '100%', height: 48, cursor: 'pointer', border: 0, padding: 0, background: 'transparent' },
              }) : null}
              {['Red', 'Green', 'Blue'].map((label, index) => (
                <ColorChannel key={label} label={label} channels={channels} index={index} colors={colors}
                  onChange={(next) => update(channelHex(channels.map((value, i) => i === index ? next : value)))} />
              ))}
              <Text style={{ color: colors.text, fontWeight: '600' }}>Hex colour</Text>
              <TextInput
                value={hexInput}
                onChangeText={(text) => {
                  const next = text.startsWith('#') ? text : `#${text}`;
                  setHexInput(next);
                  const normalized = normalizeHex(next);
                  if (normalized) setDraft(normalized);
                }}
                accessibilityLabel="Hex colour"
                autoCapitalize="characters" autoCorrect={false} maxLength={7}
                style={[styles.input, { color: colors.text, borderColor: validHex ? colors.border : colors.danger }]}
              />
              {!validHex ? <Text style={{ color: colors.danger }}>Enter a colour like #3B82F6 or #38F.</Text> : null}
              <View style={styles.actions}>
                <Pressable onPress={close} accessibilityRole="button" style={[styles.button, { backgroundColor: colors.cardMuted }]}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable disabled={!validHex} accessibilityRole="button" accessibilityState={{ disabled: !validHex }}
                  onPress={() => { if (validHex) { onChange(validHex); close(); } }}
                  style={[styles.button, { backgroundColor: colors.primary, opacity: validHex ? 1 : 0.5 }]}>
                  <Text style={{ color: colors.primaryText, fontWeight: '700' }}>Use colour</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ColorChannel({ label, channels, index, colors, onChange }) {
  const [width, setWidth] = useState(1);
  const value = channels[index];
  const at = (level) => channelHex(channels.map((channel, i) => i === index ? level : channel));
  const updateFromTouch = (event) => onChange(Math.max(0, Math.min(255, Math.round(event.nativeEvent.locationX / width * 255))));
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.textMuted }}>{label} · {value}</Text>
      {Platform.OS === 'web' ? React.createElement('input', {
        type: 'range', min: 0, max: 255, step: 1, value, 'aria-label': label,
        onChange: (event) => onChange(Number(event.target.value)),
        style: { width: '100%', margin: 0, accentColor: colors.primary, height: 28 },
      }) : (
        <View accessibilityRole="adjustable" accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 255, now: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => onChange(Math.max(0, Math.min(255, value + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}
          onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={updateFromTouch} onResponderMove={updateFromTouch}
          onResponderTerminationRequest={() => false}
          style={styles.channel}>
          <View pointerEvents="none" style={styles.gradient}>
            {Array.from({ length: 32 }, (_, i) => <View key={i} style={{ flex: 1, backgroundColor: at(Math.round(i / 31 * 255)) }} />)}
          </View>
          <View pointerEvents="none" style={[styles.thumb, { left: (width - 20) * value / 255 }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: { width: '100%', maxWidth: 400, maxHeight: '90%', borderWidth: 1, borderRadius: 20, overflow: 'hidden' },
  content: { padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  preview: { height: 64, borderRadius: 12, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  channel: { height: 44, justifyContent: 'center' },
  gradient: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden' },
  thumb: { position: 'absolute', width: 20, height: 28, borderRadius: 10, backgroundColor: '#fff', borderColor: '#555', borderWidth: 2 },
});
