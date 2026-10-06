import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../shared/theme';
import { loadTimetable, saveTimetable, newId } from '../../services/storage';
import { DAYS, currentRotation, lessonError, mondayISO } from './timetableUtils.mjs';

export default function TimetablePage({ subjects = [], storageScope, isDesktopWeb, onBackToTasks }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors, isDesktopWeb);
  const [data, setData] = useState(null);
  const [week, setWeek] = useState(1);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    let cancelled = false;
    setData(null);
    loadTimetable().then(value => {
      if (cancelled) return;
      setData(value); setWeek(currentRotation(value)); setError('');
    }).catch(() => { if (!cancelled) setError('Could not load your timetable. Please retry.'); });
    return () => { cancelled = true; };
  }, [storageScope, retry]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setNow(new Date()); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  async function persist(next) {
    setSaving(true); setError('');
    try { await saveTimetable(next); setData(next); return true; }
    catch (e) { setError(`Could not save timetable: ${e.message || 'Please try again.'}`); return false; }
    finally { setSaving(false); }
  }
  function button(label, onPress, selected = false) {
    return <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected, disabled: saving }} disabled={saving} onPress={onPress} style={[styles.button, selected && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><Text style={{ color: selected ? colors.primary : colors.text, fontWeight: '600' }}>{label}</Text></Pressable>;
  }
  function field(label, key, placeholder) {
    return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={draft[key]} placeholder={placeholder} placeholderTextColor={colors.textFaint} onChangeText={value => setDraft(old => ({ ...old, [key]: value }))} style={styles.input} /></View>;
  }
  if (!data) return <View style={styles.loading}>{error ? <><Text style={styles.error}>{error}</Text>{button('Retry', () => { setError(''); setRetry(value => value + 1); })}</> : <ActivityIndicator color={colors.primary} />}{onBackToTasks ? button('Back to tasks', onBackToTasks) : null}</View>;
  const rotation = currentRotation(data, now);
  const today = (now.getDay() + 6) % 7;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    {!isDesktopWeb ? <View style={styles.row}>{button('Back to tasks', onBackToTasks)}<Text style={styles.title}>Timetable</Text></View> : null}
    <View style={styles.card}>
      <Text style={styles.title}>Your school week</Text>
      <Text style={styles.muted}>This week: Week {rotation} · Week beginning {mondayISO(now)}</Text>
      <Text style={styles.label}>Timetable rotation</Text>
      <View style={styles.row}>{[1, 2].map(count => button(`${count}-week timetable`, async () => {
        if (await persist({ ...data, weekCount: count, anchorMonday: mondayISO(now), anchorWeek: rotation })) { setWeek(count === 1 ? 1 : rotation); setDraft(null); }
      }, data.weekCount === count))}</View>
      {data.weekCount === 2 ? <><Text style={styles.label}>Assign the current week</Text><View style={styles.row}>{[1, 2].map(value => button(`Current week is Week ${value}`, async () => {
        if (await persist({ ...data, anchorMonday: mondayISO(now), anchorWeek: value })) setWeek(value);
      }, rotation === value))}</View><Text style={styles.muted}>Weeks alternate automatically every Monday.</Text></> : <Text style={styles.muted}>The same timetable repeats every week. Week 2 lessons are kept if you switch rotations.</Text>}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.row}>{Array.from({ length: data.weekCount }, (_, i) => button(`View Week ${i + 1}`, () => { setWeek(i + 1); setDraft(null); setError(''); }, week === i + 1))}</View>
    {draft ? <View style={styles.card}>
      <Text style={styles.title}>{data.lessons.some(item => item.id === draft.id) ? 'Edit lesson' : 'Add lesson'} · Week {draft.week}</Text>
      <View style={styles.row}>{DAYS.map((day, i) => button(day, () => setDraft(old => ({ ...old, day: i })), draft.day === i))}</View>
      {subjects.length ? <><Text style={styles.label}>Use an existing subject</Text><View style={styles.row}>{subjects.map(subject => button(subject.name, () => setDraft(old => ({ ...old, subject: subject.name, teacher: subject.teacher || '', room: subject.room || '' })), draft.subject === subject.name))}</View></> : null}
      {field('Subject', 'subject', 'e.g. Mathematics')}
      <View style={styles.row}>{field('Teacher', 'teacher', 'e.g. Ms Smith')}{field('Room', 'room', 'e.g. B12')}</View>
      <View style={styles.row}>{field('Start time', 'start', '09:00')}{field('End time', 'end', '10:00')}</View>
      <View style={styles.row}>{button(saving ? 'Saving…' : 'Save lesson', async () => {
        const cleaned = { ...draft, subject: draft.subject.trim(), teacher: draft.teacher.trim(), room: draft.room.trim(), start: draft.start.trim(), end: draft.end.trim() };
        const validation = lessonError(cleaned, data.lessons);
        if (validation) { setError(validation); return; }
        if (await persist({ ...data, lessons: [...data.lessons.filter(item => item.id !== draft.id), cleaned] })) setDraft(null);
      })}{button('Cancel', () => { setDraft(null); setError(''); })}</View>
    </View> : null}
    {DAYS.map((day, index) => {
      const lessons = data.lessons.filter(item => item.week === week && item.day === index).sort((a, b) => a.start.localeCompare(b.start));
      return <View key={day} style={[styles.card, today === index && rotation === week && { borderColor: colors.primary }]}>
        <View style={styles.row}><Text style={styles.day}>{day}{today === index && rotation === week ? ' · Today' : ''}</Text>{button(`+ Add ${day} lesson`, () => { setError(''); setDraft({ id: newId(), week, day: index, subject: '', teacher: '', room: '', start: '09:00', end: '10:00' }); })}</View>
        {!lessons.length ? <Text style={styles.muted}>No lessons scheduled</Text> : lessons.map(lesson => <View key={lesson.id} style={styles.lesson}>
          <View style={{ flex: 1 }}><Text style={styles.label}>{lesson.start}–{lesson.end} · {lesson.subject}</Text><Text style={styles.muted}>{[lesson.teacher && `Teacher: ${lesson.teacher}`, lesson.room && `Room: ${lesson.room}`].filter(Boolean).join(' · ') || 'No teacher or room added'}</Text></View>
          <View style={styles.row}>{button('Edit', () => { setDraft({ ...lesson }); setError(''); })}{button('Delete', async () => { if (await persist({ ...data, lessons: data.lessons.filter(item => item.id !== lesson.id) })) { if (draft?.id === lesson.id) setDraft(null); } })}</View>
        </View>)}
      </View>;
    })}
  </ScrollView>;
}
function makeStyles(colors, desktop) {
  return StyleSheet.create({
    page: { padding: desktop ? 24 : 16, paddingBottom: desktop ? 32 : 120, gap: 16 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 18, gap: 12 },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    day: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
    label: { color: colors.text, fontWeight: '600', fontSize: 14 },
    muted: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    button: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
    field: { flexGrow: 1, minWidth: 130, gap: 6 },
    input: { borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 10, padding: 12, fontSize: 16 },
    lesson: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 },
    error: { color: colors.danger, padding: 8 },
  });
}
