import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
const key = uid => `@studystackr:flashcards:${uid || 'local'}:v1`;
export async function loadLibrary(uid) {
  const cached = await AsyncStorage.getItem(key(uid));
  const pending = await AsyncStorage.getItem(`${key(uid)}:pending`);
  if (cached && pending) return JSON.parse(cached);
  if (uid && supabase) {
    const { data, error } = await supabase.from('flashcard_libraries').select('data').eq('user_id', uid).maybeSingle();
    if (error) {
      if (cached) return JSON.parse(cached);
      throw new Error('Could not load flashcards. Check your connection and database migration.');
    }
    if (data) { await AsyncStorage.setItem(key(uid), JSON.stringify(data.data)); return data.data; }
  }
  return cached ? JSON.parse(cached) : { folders: [], sets: [] };
}
export async function saveLibrary(uid, library) {
  await AsyncStorage.setItem(key(uid), JSON.stringify(library));
  if (uid && supabase) {
    await AsyncStorage.setItem(`${key(uid)}:pending`, 'true');
    const { error } = await supabase.from('flashcard_libraries').upsert({ user_id: uid, data: library });
    if (error) return 'Saved on this device. Cloud sync failed; use Sync library to retry.';
    await AsyncStorage.removeItem(`${key(uid)}:pending`);
  }
  return '';
}
export async function discoverSets(query) {
  if (!supabase) throw new Error('Sign in to browse community sets.');
  const { data, error } = await supabase.from('public_flashcard_sets').select('*').ilike('title', `%${query.replace(/[%_]/g, '')}%`).order('updated_at', { ascending: false }).limit(50);
  if (error) throw new Error('Public sets are unavailable. Check your connection and apply the flashcards migration.');
  return data || [];
}
export async function publishSet(uid, set, publish) {
  if (!uid || !supabase) throw new Error('Sign in to publish a set.');
  const result = publish ? await supabase.from('public_flashcard_sets').upsert({ id: set.id, user_id: uid, title: set.title, subject: set.subject, cards: set.cards.map(({ front, back }) => ({ front, back })), updated_at: new Date().toISOString() }) : await supabase.from('public_flashcard_sets').delete().eq('id', set.id).eq('user_id', uid);
  if (result.error) throw new Error('Could not update publishing. Check your connection and database migration.');
}
