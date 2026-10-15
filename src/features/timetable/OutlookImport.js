import React, { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../shared/theme';
import { newId } from '../../services/storage';
import { parseOutlookCalendar } from './outlookImport.mjs';

export default function OutlookImport({ data, persist, saving }) {
  const { colors: c } = useTheme();
  const [link, setLink] = useState(''), [text, setText] = useState(''), [preview, setPreview] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const button = (label, onPress) => <Pressable accessibilityRole="button" disabled={saving || loading} onPress={onPress} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border }}><Text style={{ color: c.primary }}>{label}</Text></Pressable>;
  async function fetchCalendar() {
    setLoading(true); setError(''); setPreview(null);
    try {
      const url = new URL(link.trim().replace(/^webcal:/i, 'https:'));
      if (url.protocol !== 'https:' || !['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname) || !url.pathname.toLowerCase().endsWith('.ics')) throw new Error('Paste a published Outlook ICS link.');
      const response = await fetch(Platform.OS === 'web' ? `/api/outlook-calendar?url=${encodeURIComponent(url.href)}` : url.href);
      const body = await response.text();
      const isHtml = /text\/html/i.test(response.headers.get('content-type') || '') || /^\s*<!doctype html|^\s*<html/i.test(body);
      if (Platform.OS === 'web' && (response.status === 404 || response.status === 405 || isHtml)) throw new Error('The calendar import server is unavailable on this site. Run or deploy the Cloudflare Pages Functions, or paste the ICS contents below.');
      if (!response.ok) throw new Error(Platform.OS === 'web' && /text\/plain/i.test(response.headers.get('content-type') || '') && body.length < 600 ? body : `Calendar request failed (HTTP ${response.status}). Try again or paste the ICS contents below.`);
      const parsed = parseOutlookCalendar(body, data); setPreview(parsed);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  const inputStyle = { color: c.text, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 };
  return <View style={{ gap: 12, padding: 18, borderRadius: 16, backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }}>
    <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>Import from Outlook</Text>
    <Text style={{ color: c.textMuted, lineHeight: 22 }}>In Outlook, open Settings → Calendar → Shared calendars → Publish a calendar, then copy the ICS link. This imports a snapshot of weekly lessons into your timetable. Review the preview before adding them. Times use this device’s timezone; imported lessons continue repeating until you edit or delete them.</Text>
    <TextInput accessibilityLabel="Published Outlook ICS link" autoCapitalize="none" value={link} onChangeText={v => { setLink(v); setPreview(null); }} placeholder="https://outlook.office.com/…/calendar.ics" placeholderTextColor={c.textFaint} style={inputStyle} />
    {button(loading ? 'Loading calendar…' : 'Preview Outlook link', fetchCalendar)}
    <Text style={{ color: c.textMuted }}>Alternatively, open the downloaded .ics file in a text editor and paste its contents. Local web development uses this option unless a Cloudflare Functions server is running.</Text>
    <TextInput accessibilityLabel="ICS calendar contents" multiline value={text} onChangeText={v => { setText(v); setPreview(null); }} style={[inputStyle, { minHeight: 90 }]} />
    {button('Preview pasted calendar', () => { try { setPreview(parseOutlookCalendar(text, data)); setError(''); } catch (e) { setError(e.message); } })}
    {error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text> : null}
    {preview ? <><Text style={{ color: c.text, fontWeight: '600' }}>{preview.lessons.length} new lessons · {preview.warnings.length} skipped or needing attention</Text>
      {preview.lessons.map(v => <Text key={v.id} style={{ color: c.text }}>Week {v.week} · {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][v.day]} · {v.start}–{v.end} · {v.subject} {v.room}</Text>)}
      {preview.warnings.map((v, i) => <Text key={i} style={{ color: c.warning }}>{v}</Text>)}
      {preview.lessons.length ? button('Add previewed lessons', async () => {
        // Revalidate against current timetable in case it changed after previewing.
        const { lessonError } = await import('./timetableUtils.mjs');
        const added = [];
        for (const lesson of preview.lessons) { const error = lessonError(lesson, [...data.lessons, ...added]); if (error) { setError(`${lesson.subject}: ${error} Preview again.`); return; } added.push({ ...lesson, id: newId() }); }
        if (await persist({ ...data, lessons: [...data.lessons, ...added] })) { setPreview(null); setText(''); setLink(''); setError(''); }
      }) : null}
      {button('Cancel import', () => setPreview(null))}</> : null}
  </View>;
}
