import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from '../../src/shared/theme';
import { supabase, isSupabaseConfigured } from '../../src/services/supabase';
import {
  createLocalAdminSession,
  isLocalAdminAccessAllowed,
  LOCAL_ADMIN_SESSION_STORAGE_KEY,
} from '../../src/features/auth/localAdminCredentials';

const AuthScreen = React.lazy(() => import('../../src/features/auth/AuthScreen'));
const SignedInApp = React.lazy(() => import('../../src/application/SignedInApp'));

const allowLocalWebsiteMode = process.env.EXPO_PUBLIC_ALLOW_WEB_LOCAL_MODE === 'true';

function writeWebPath(path, { replace = true } = {}) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]?.(null, '', path);
}

function isLoginPath() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const normalized = `/${String(window.location.pathname || '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')}`;
  return normalized === '/login';
}

export default function WebsiteApp() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <WebsiteAuthGate />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function WebsiteAuthGate() {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const authConfigurationMissing = !isSupabaseConfigured && !allowLocalWebsiteMode;
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let mounted = true;

    (async () => {
      const savedLocalAdmin = await AsyncStorage.getItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
      if (!mounted) return;
      if (savedLocalAdmin === 'true') {
        if (!isLocalAdminAccessAllowed()) {
          await AsyncStorage.removeItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
          const { data } = await supabase.auth.getSession();
          if (mounted) setSession(data?.session ?? null);
          return;
        }
        await supabase.auth.signOut().catch(() => {});
        if (mounted) setSession(createLocalAdminSession());
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data?.session ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      const savedLocalAdmin = await AsyncStorage.getItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
      if (savedLocalAdmin === 'true' && isLocalAdminAccessAllowed()) return;
      setSession(nextSession ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (authConfigurationMissing) {
      writeWebPath('/login');
      return;
    }
    if (!isSupabaseConfigured || session === undefined) return;
    if (!session) {
      writeWebPath('/login');
      return;
    }
    if (isLoginPath()) writeWebPath('/');
  }, [authConfigurationMissing, session]);

  const handleLocalAdminSignIn = useCallback(async () => {
    if (!isLocalAdminAccessAllowed()) return;
    await AsyncStorage.setItem(LOCAL_ADMIN_SESSION_STORAGE_KEY, 'true');
    if (supabase) await supabase.auth.signOut().catch(() => {});
    setSession(createLocalAdminSession());
  }, []);

  if (authConfigurationMissing) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AuthConfigurationMissing styles={styles} />
      </SafeAreaView>
    );
  }

  if (session === undefined) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (isSupabaseConfigured && !session) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Suspense fallback={<AuthFallback />}>
          <AuthScreen onLocalAdminSignIn={handleLocalAdminSignIn} />
        </Suspense>
      </SafeAreaView>
    );
  }

  return (
    <Suspense fallback={<AppFallback />}>
      <SignedInApp session={session} setSession={setSession} />
    </Suspense>
  );
}

function AuthFallback() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <SafeAreaView style={styles.loadingWrap}>
      <ActivityIndicator size="large" color={colors.primary} />
    </SafeAreaView>
  );
}

function AppFallback() {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  return (
    <SafeAreaView style={styles.loadingWrap}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ActivityIndicator size="large" color={colors.primary} />
    </SafeAreaView>
  );
}

function AuthConfigurationMissing({ styles }) {
  return (
    <View style={styles.configWrap}>
      <View style={styles.configCard}>
        <Text style={styles.configTitle}>Login is not configured</Text>
        <Text style={styles.configText}>
          This web build is missing the Supabase public environment variables, so it cannot show the sign-in form.
        </Text>
        <View style={styles.configCodeBox}>
          <Text style={styles.configCode}>EXPO_PUBLIC_SUPABASE_URL</Text>
          <Text style={styles.configCode}>EXPO_PUBLIC_SUPABASE_ANON_KEY</Text>
        </View>
        <Text style={styles.configText}>
          Add both variables in Cloudflare Pages, then redeploy the site.
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    loadingWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    configWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.bg,
    },
    configCard: {
      width: '100%',
      maxWidth: 460,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 24,
      gap: 14,
    },
    configTitle: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '900',
    },
    configText: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
    },
    configCodeBox: {
      borderRadius: 8,
      backgroundColor: colors.cardMuted,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 8,
    },
    configCode: {
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: 13,
      fontWeight: '700',
    },
  });
