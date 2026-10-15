import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../shared/theme';
import { newId } from '../../services/storage';
import { answerMatches, buildQuiz, parseCards } from './flashcardUtils.mjs';
import { discoverSets, loadLibrary, publishSet, saveLibrary } from './flashcardRepository';

function FlipCard({ card, colors }) {
  const value = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduced); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced); return () => sub.remove(); }, []);
  useEffect(() => { value.stopAnimation(); value.setValue(0); setFlipped(false); }, [card.id]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${flipped ? 'Answer' : 'Question'}: ${flipped ? card.back : card.front}. Activate to flip.`} onPress={() => { Animated.timing(value, { toValue: flipped ? 0 : 1, duration: reduced ? 0 : 420, useNativeDriver: Platform.OS !== 'web' }).start(); setFlipped(!flipped); }} style={{ height: 280 }}>
    {[false, true].map(back => <Animated.View key={String(back)} aria-hidden={flipped !== back} style={{ position: 'absolute', width: '100%', height: '100%', padding: 28, borderRadius: 22, borderWidth: 1, borderColor: colors.primary, backgroundColor: back ? colors.primarySoft : colors.card, alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden', transform: [{ perspective: 1200 }, { rotateY: value.interpolate({ inputRange: [0, 1], outputRange: back ? ['180deg', '360deg'] : ['0deg', '180deg'] }) }] }}>
      <Text style={{ color: colors.textMuted, marginBottom: 20 }}>{back ? 'ANSWER' : 'QUESTION'} · Tap to flip</Text><Text style={{ color: colors.text, fontSize: 24, textAlign: 'center' }}>{back ? card.back : card.front}</Text>
    </Animated.View>)}
  </Pressable>;
}
export default function FlashcardsPage({ subjects = [], storageScope, onBackToTasks }) {
  const { colors: c } = useTheme(); const s = styles(c);
  const [library, setLibrary] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('library'), [selected, setSelected] = useState(null), [draft, setDraft] = useState(null);
  const [folder, setFolder] = useState(''), [subject, setSubject] = useState(''), [search, setSearch] = useState(''), [folderName, setFolderName] = useState('');
  const [results, setResults] = useState([]), [searched, setSearched] = useState(false), [filter, setFilter] = useState('all'), [index, setIndex] = useState(0);
  const [quiz, setQuiz] = useState(null), [answer, setAnswer] = useState(''), [marked, setMarked] = useState(null), [score, setScore] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; loadLibrary(storageScope).then(v => { if (active) setLibrary(v); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [storageScope, retry]);
  async function commit(next) { setBusy(true); try { const warning = await saveLibrary(storageScope, next); setLibrary(next); setError(warning); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); } }
  async function attempt(fn) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const button = (label, action, active = false) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: active, disabled: busy }} disabled={busy} onPress={action} style={[s.button, active && { borderColor: c.primary, backgroundColor: c.primarySoft }]}><Text style={{ color: active ? c.primary : c.text, fontWeight: '600' }}>{label}</Text></Pressable>;
  const input = (label, value, change, multiline = false) => <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} multiline={multiline} placeholderTextColor={c.textFaint} style={[s.input, multiline && { minHeight: 150, textAlignVertical: 'top' }]} /></View>;
  if (!library) return <View style={s.box}>{error ? <><Text style={s.error}>{error}</Text>{button('Retry', () => { setError(''); setRetry(retry + 1); })}</> : <ActivityIndicator color={c.primary} />}</View>;
  const set = library.sets.find(v => v.id === selected);
  const cards = set?.cards.filter(v => filter === 'all' || v.status === filter) || [];
  const card = cards[index % (cards.length || 1)];
  const question = quiz?.questions[quiz.index];
  function resetStudy() { setIndex(0); setFilter('all'); setQuiz(null); }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
    <View style={s.row}><Text style={s.title}>Flashcards</Text>{onBackToTasks && button('Back to tasks', onBackToTasks)}</View>
    <Text style={s.muted}>Build your library. Practise what matters. See what sticks.</Text>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View style={s.row}>{button('My library', () => { setTab('library'); setSelected(null); setDraft(null); setQuiz(null); }, tab === 'library')}{button('Discover public sets', () => { setTab('discover'); setSelected(null); setDraft(null); setQuiz(null); }, tab === 'discover')}{button('Create / import set', () => { setDraft({ title: '', folder: '', subject: '', text: '', separator: '\t' }); setSelected(null); setQuiz(null); setTab('library'); })}{button('Sync library', () => commit(library))}</View>
    {draft && !draft.deleting ? <View style={s.box}>
      <Text style={s.heading}>{draft.id ? 'Edit set' : 'Create or import a set'}</Text>
      {input('Set title', draft.title, title => setDraft({ ...draft, title }))}
      {input('Folder (new or existing)', draft.folder, folder => setDraft({ ...draft, folder }))}
      {input('Subject', draft.subject, subject => setDraft({ ...draft, subject }))}
      <View style={s.row}>{subjects.map(v => button(v.name, () => setDraft({ ...draft, subject: v.name }), draft.subject === v.name))}</View>
      <Text style={s.muted}>Quizlet: export your terms and definitions, then paste below. For Gizmo and other sources, copy or export question–answer pairs. Website links alone cannot be imported. One card per row; quoted CSV fields can contain commas or new lines.</Text>
      <View style={s.row}>{[['Tab', '\t'], ['Comma (CSV)', ','], ['Semicolon', ';'], ['Pipe', '|']].map(([name, separator]) => button(name, () => setDraft({ ...draft, separator }), draft.separator === separator))}</View>
      {input('Questions and answers', draft.text, text => setDraft({ ...draft, text }), true)}
      {button('Preview import', () => { try { setDraft({ ...draft, preview: parseCards(draft.text, draft.separator) }); setError(''); } catch (e) { setError(e.message); } })}
      {draft.preview ? <Text style={s.muted}>{draft.preview.length} cards · First: {draft.preview[0].front} → {draft.preview[0].back}</Text> : null}
      <View style={s.row}>{button('Save set', async () => { try {
        if (draft.title.trim().length > 200) throw new Error('Keep set titles under 200 characters.');
        if (!draft.title.trim()) throw new Error('Enter a set title.');
        const imported = parseCards(draft.text, draft.separator);
        const previous = library.sets.find(v => v.id === draft.id);
        const next = { id: draft.id || newId(), title: draft.title.trim(), folder: draft.folder.trim(), subject: draft.subject.trim(), cards: imported.map(v => { const old = previous?.cards.find(x => x.front === v.front && x.back === v.back); return old || v; }) };
        if (await commit({ ...library, folders: [...new Set([...library.folders, next.folder].filter(Boolean))], sets: [...library.sets.filter(v => v.id !== next.id), next] })) { setDraft(null); setSelected(next.id); resetStudy(); }
      } catch (e) { setError(e.message); } })}{button('Cancel', () => setDraft(null))}</View>
    </View> : null}
    {tab === 'discover' ? <View style={s.box}>
      <Text style={s.heading}>Community library</Text><Text style={s.muted}>Browse sets published by StudyStackr users. Save a private copy to organise and study it.</Text>
      {input('Search public set titles', search, setSearch)}{button('Search', () => attempt(async () => { setResults(await discoverSets(search)); setSearched(true); }))}
      {searched && !results.length ? <Text style={s.muted}>No public sets found.</Text> : null}
      {results.map(v => <View key={v.id} style={s.box}><Text style={s.heading}>{v.title}</Text><Text style={s.muted}>{v.subject || 'Unassigned'} · {v.cards.length} cards</Text>{button(`Save copy of ${v.title}`, async () => { const copy = { id: newId(), title: v.title, subject: v.subject, folder: '', cards: v.cards.map((x, i) => ({ ...x, id: `${newId()}-${i}`, status: 'unknown' })) }; if (await commit({ ...library, sets: [...library.sets, copy] })) { setSelected(copy.id); setTab('library'); resetStudy(); } })}</View>)}
    </View> : null}
    {tab === 'library' && !set && !draft ? <>
      <View style={s.box}><Text style={s.heading}>Folders and subjects</Text>{input('New folder', folderName, setFolderName)}{button('Create folder', async () => { if (folderName.trim() && await commit({ ...library, folders: [...new Set([...library.folders, folderName.trim()])] })) setFolderName(''); })}
        <View style={s.row}>{button('All folders', () => setFolder(''), !folder)}{library.folders.map(v => button(v, () => setFolder(v), folder === v))}</View>
        {folder ? button(`Delete folder ${folder} (keep sets)`, async () => { if (await commit({ ...library, folders: library.folders.filter(v => v !== folder), sets: library.sets.map(v => v.folder === folder ? { ...v, folder: '' } : v) })) setFolder(''); }) : null}
        <View style={s.row}>{button('All subjects', () => setSubject(''), !subject)}{[...new Set([...subjects.map(v => v.name), ...library.sets.map(v => v.subject)].filter(Boolean))].map(v => button(v, () => setSubject(v), subject === v))}</View>
      </View>
      {!library.sets.length ? <Text style={s.muted}>Your library is empty. Create a set or import your existing cards.</Text> : null}
      {library.sets.filter(v => (!folder || v.folder === folder) && (!subject || v.subject === subject)).map(v => <View style={s.box} key={v.id}><Text style={s.heading}>{v.title}</Text><Text style={s.muted}>{v.folder || 'No folder'} · {v.subject || 'No subject'} · {v.cards.length} cards · {v.cards.filter(x => x.status === 'known').length} known</Text>{button(`Study ${v.title}`, () => { setSelected(v.id); resetStudy(); })}</View>)}
    </> : null}
    {set && !draft ? <>
      <View style={s.box}><Text style={s.heading}>{set.title}</Text><Text style={s.muted}>{set.folder || 'No folder'} · {set.subject || 'No subject'}</Text>
        <View style={s.row}>{button('Back to library', () => { setSelected(null); setQuiz(null); })}{button('Edit / move set', () => { setDraft({ ...set, separator: '\t', text: set.cards.map(v => [v.front, v.back].map(x => `"${x.replace(/"/g, '""')}"`).join('\t')).join('\n') }); setQuiz(null); })}{button('Publish / update public copy', () => attempt(() => publishSet(storageScope, set, true)))}{button('Remove public copy', () => attempt(() => publishSet(storageScope, set, false)))}{button('Delete set', () => setDraft({ ...set, deleting: true }))}</View>
        <Text style={s.muted}>Publishing shares the questions, answers and subject with signed-in users. Local edits require publishing again to update the public copy.</Text>
      </View>
      {!quiz ? <>
        <View style={s.row}>{[['All cards', 'all'], ["Don’t know", 'unknown'], ['Know', 'known']].map(([label, status]) => button(`${label} (${set.cards.filter(v => status === 'all' || v.status === status).length})`, () => { setFilter(status); setIndex(0); }, filter === status))}</View>
        {card ? <><Text style={s.muted}>Card {index % cards.length + 1} of {cards.length}</Text><FlipCard card={card} colors={c} /><View style={s.row}>{button('Previous', () => setIndex((index + cards.length - 1) % cards.length))}{[['Don’t know', 'unknown'], ['Know', 'known']].map(([label, status]) => button(label, async () => { if (await commit({ ...library, sets: library.sets.map(v => v.id === set.id ? { ...v, cards: v.cards.map(x => x.id === card.id ? { ...x, status } : x) } : v) })) setIndex(filter === 'all' ? (index + 1) % cards.length : 0); }, card.status === status))}{button('Next', () => setIndex((index + 1) % cards.length))}</View></> : <Text style={s.muted}>No cards in this group. Choose another group.</Text>}
        <View style={s.box}><Text style={s.heading}>Quiz this group</Text><Text style={s.muted}>Written answers allow small typos and reordered wording. Include the key facts, numbers and negatives. Multiple choice uses other answers in this set; single-answer sets use written questions.</Text><View style={s.row}>{[['Multiple choice', 'choice'], ['Fill in the blank', 'blank'], ['Write the answer', 'written']].map(([label, mode]) => button(label, () => { if (!cards.length) { setError('Choose a group with cards first.'); return; } setQuiz({ questions: buildQuiz(cards, mode), index: 0 }); setAnswer(''); setMarked(null); setScore(0); }))}</View></View>
      </> : question ? <View style={s.box}>
        <Text style={s.muted}>Question {quiz.index + 1} of {quiz.questions.length} · {score} correct</Text><Text style={s.heading}>{question.prompt}</Text>
        {question.mode === 'blank' ? <Text style={s.heading}>{question.before}<Text style={marked !== null ? { color: c.success } : null}>{marked !== null ? question.answer : ' ______ '}</Text>{question.after}</Text> : null}
        {question.options ? question.options.map(option => <Pressable key={option} accessibilityRole="button" disabled={marked !== null} onPress={() => setAnswer(option)} style={[s.button, { borderColor: marked !== null && option === question.answer ? c.success : marked === false && answer === option ? c.danger : answer === option ? c.primary : c.border }]}><Text style={{ color: marked !== null && option === question.answer ? c.success : marked === false && answer === option ? c.danger : c.text }}>{option}</Text></Pressable>) : <TextInput accessibilityLabel="Your answer" editable={marked === null} value={answer} onChangeText={setAnswer} multiline style={[s.input, marked !== null && { color: marked ? c.success : c.danger, borderColor: marked ? c.success : c.danger }]} />}
        {marked === null ? button('Check answer', () => { if (!answer.trim()) return; const ok = question.options ? answer === question.answer : answerMatches(answer, question.answer); setMarked(ok); if (ok) setScore(score + 1); }) : <><Text accessibilityLiveRegion="polite" style={{ color: marked ? c.success : c.danger }}>{marked ? 'Correct!' : `Incorrect. Your answer: ${answer}`}</Text><Text style={{ color: c.success }}>Correct answer: {question.answer}</Text>{button('Next question', () => { setQuiz({ ...quiz, index: quiz.index + 1 }); setMarked(null); setAnswer(''); })}</>}
        {button('End quiz', () => setQuiz(null))}
      </View> : <View style={s.box}><Text style={s.heading}>Quiz complete · {score} / {quiz.questions.length}</Text>{button('Back to cards', () => setQuiz(null))}</View>}
    </> : null}
    {draft?.deleting ? <View style={s.box}><Text style={s.label}>Delete this set and its public copy?</Text>{button('Confirm delete', () => attempt(async () => { if (storageScope) await publishSet(storageScope, draft, false); if (await commit({ ...library, sets: library.sets.filter(v => v.id !== draft.id) })) { setDraft(null); setSelected(null); } }))}{button('Keep set', () => setDraft(null))}</View> : null}
  </ScrollView>;
}
const styles = c => StyleSheet.create({ page: { padding: 24, paddingBottom: 130, gap: 16, maxWidth: 1100, width: '100%', alignSelf: 'center' }, box: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, padding: 20, borderRadius: 18, gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, title: { color: c.text, fontSize: 28, fontWeight: '700', flex: 1 }, heading: { color: c.text, fontSize: 20, fontWeight: '700' }, label: { color: c.text, fontWeight: '600' }, muted: { color: c.textMuted, lineHeight: 22 }, error: { color: c.danger }, input: { color: c.text, borderColor: c.border, borderWidth: 1, padding: 12, borderRadius: 10, fontSize: 16 }, button: { borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12, backgroundColor: c.cardMuted } });
