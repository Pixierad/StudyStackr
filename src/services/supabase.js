// Supabase client.
//
// Reads two env vars at build time (must be prefixed with EXPO_PUBLIC_ so
// Expo inlines them into the JS bundle):
//   EXPO_PUBLIC_SUPABASE_URL       -- your project URL
//   EXPO_PUBLIC_SUPABASE_ANON_KEY  -- the anon (public) key. Safe to ship.
//
// If either var is missing the app falls back to a local-only AsyncStorage
// mode -- no auth screen, no remote sync. That lets the app keep running
// while Supabase is being set up.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Convenience helper used by the storage service -- returns the current user id
// (or null if signed out / not configured). Throws no errors.
export async function currentUserId() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
