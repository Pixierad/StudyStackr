// Auth screen with two selectable methods: email+password or email OTP.
//
// The user picks the method with a toggle at the bottom of the card.
//
//   Password mode:
//     signInWithPassword for existing users, signUp for new ones. A
//     sub-toggle switches between sign-in and sign-up.
//
//   OTP mode (two steps):
//     1. signInWithOtp({ email, shouldCreateUser: true }) -- Supabase
//        emails a 6-digit code ({{ .Token }} in the email template).
//     2. verifyOtp({ email, token, type: 'email' }) -- logs the user in.
//
// On success the onAuthStateChange listener in App.js takes over.
// Shown whenever Supabase is configured but no session is present.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useTheme } from '../theme';
import { supabase } from '../supabase';

const RESEND_COOLDOWN_SECONDS = 30;

// Toggle this to re-enable the "check your email" confirmation flow on sign-up.
// When false, after signUp we immediately try signInWithPassword so new users
// land straight in the app. When true, we show the original info message and
// flip the form back to sign-in mode.
// NOTE: this only controls the client-side UX. To fully disable email
// confirmation you also need to turn off "Confirm email" in the Supabase
// dashboard (Auth → Providers → Email).
const REQUIRE_EMAIL_CONFIRMATION = false;

export default function AuthScreen() {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const styles = useMemo(
    () => makeStyles({ colors, spacing, radius, typography }),
    [colors, spacing, radius, typography]
  );

  const [authMethod, setAuthMethod] = useState('password'); // 'password' | 'otp'
  const [pwMode, setPwMode] = useState('signin');           // 'signin'  | 'signup'
  const [otpStep, setOtpStep] = useState('email');          // 'email'   | 'code'

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [resendIn, setResendIn] = useState(0);

  const codeInputRef = useRef(null);

  // Countdown for the "Resend code" link.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  const trimmedEmail = email.trim();
  // Slightly tighter than `/^\S+@\S+\.\S+$/`: rejects "a@b.c" (TLD must be
  // ≥ 2 chars) and explicitly disallows '@' inside the local/domain parts.
  // Still permissive enough that we don't reject real-but-unusual addresses
  // -- final validity is always determined by the server.
  const isValidEmail = (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const isSignIn = pwMode === 'signin';

  // 8 character minimum aligns with NIST SP 800-63B §5.1.1.2 guidance.
  const PASSWORD_MIN_LENGTH = 8;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const clearMessages = () => {
    setError(null);
    setInfo(null);
  };

  const switchAuthMethod = () => {
    clearMessages();
    setBusy(false);
    setCode('');
    setPassword('');
    setOtpStep('email');
    setResendIn(0);
    setAuthMethod((m) => (m === 'password' ? 'otp' : 'password'));
  };

  // ── Password flow ────────────────────────────────────────────────────────
  const canSubmitPassword =
    isValidEmail(trimmedEmail) && password.length >= PASSWORD_MIN_LENGTH && !busy;

  const submitPassword = async () => {
    if (!canSubmitPassword || !supabase) return;
    setBusy(true);
    clearMessages();
    try {
      if (isSignIn) {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (err) throw err;
        // Success -- App.js auth listener takes over.
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (err) throw err;
        // Detect the server's actual policy from the response shape rather
        // than trusting the client-side flag. When email confirmation is
        // ON, Supabase returns a user object but no session -- attempting
        // signInWithPassword in that state produces a generic "Email not
        // confirmed" error that is surfaced verbatim and confuses users.
        const serverWantsConfirmation = !data?.session;

        if (serverWantsConfirmation) {
          setInfo(
            REQUIRE_EMAIL_CONFIRMATION
              ? 'Check your email for a confirmation link, then sign in.'
              : 'Almost there — check your inbox to confirm your email, then sign in.'
          );
          setPwMode('signin');
          setPassword('');
          return;
        }

        // Server returned a session immediately — confirmation is OFF.
        // No further action needed; auth listener will pick it up.
      }
    } catch (e) {
      setError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── OTP flow ─────────────────────────────────────────────────────────────
  const canSendOtp = isValidEmail(trimmedEmail) && !busy;
  const canVerifyOtp = code.replace(/\s/g, '').length >= 6 && !busy;

  const sendOtp = async ({ silent = false } = {}) => {
    if (!supabase) return;
    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    if (!silent) setInfo(null);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { shouldCreateUser: true },
      });
      if (err) throw err;
      setOtpStep('code');
      setInfo(`We sent a 6-digit code to ${trimmedEmail}.`);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setTimeout(() => codeInputRef.current?.focus?.(), 100);
    } catch (e) {
      setError(e?.message || 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!supabase || !canVerifyOtp) return;
    setBusy(true);
    clearMessages();
    try {
      const cleaned = code.replace(/\s/g, '');
      const { error: err } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: cleaned,
        type: 'email',
      });
      if (err) throw err;
      // Success -- App.js auth listener takes over.
    } catch (e) {
      setError(e?.message || 'That code didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const useDifferentEmail = () => {
    setOtpStep('email');
    setCode('');
    setResendIn(0);
    clearMessages();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const title =
    authMethod === 'otp'
      ? otpStep === 'email'
        ? 'Sign in with email'
        : 'Enter your code'
      : isSignIn
      ? 'Welcome back'
      : 'Create your account';

  const subtitle =
    authMethod === 'otp'
      ? otpStep === 'email'
        ? 'We’ll email you a 6-digit code — no password needed.'
        : `Check ${trimmedEmail || 'your inbox'} for the 6-digit code.`
      : isSignIn
      ? 'Sign in to sync your tasks across devices.'
      : 'Sign up to back up your tasks to the cloud.';

  const toggleLabel =
    authMethod === 'password' ? 'Use one-time code instead (CURRENTLY NOT WORKING)' : 'Use password instead';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, shadow.card]}>
          <Text style={styles.brand}>PLACEHOLDER APP NAME (I severely need ideas)</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {/* Email field -- always shown except when OTP is on step 'code' */}
          {!(authMethod === 'otp' && otpStep === 'code') && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!busy}
                onSubmitEditing={() => {
                  if (authMethod === 'password') submitPassword();
                  else if (canSendOtp) sendOtp();
                }}
                returnKeyType={authMethod === 'password' ? 'next' : 'send'}
              />
            </View>
          )}

          {/* Password field */}
          {authMethod === 'password' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                textContentType={isSignIn ? 'password' : 'newPassword'}
                editable={!busy}
                onSubmitEditing={submitPassword}
              />
            </View>
          )}

          {/* OTP code field */}
          {authMethod === 'otp' && otpStep === 'code' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>6-digit code</Text>
              <TextInput
                ref={codeInputRef}
                value={code}
                onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.codeInput]}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                editable={!busy}
                onSubmitEditing={verifyOtp}
                returnKeyType="go"
              />
            </View>
          )}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {info ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>{info}</Text>
            </View>
          ) : null}

          {/* Primary action */}
          {authMethod === 'password' ? (
            <Pressable
              onPress={submitPassword}
              disabled={!canSubmitPassword}
              style={[styles.primaryBtn, !canSubmitPassword && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {isSignIn ? 'Sign in' : 'Sign up'}
                </Text>
              )}
            </Pressable>
          ) : otpStep === 'email' ? (
            <Pressable
              onPress={() => sendOtp()}
              disabled={!canSendOtp}
              style={[styles.primaryBtn, !canSendOtp && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Send code</Text>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={verifyOtp}
              disabled={!canVerifyOtp}
              style={[styles.primaryBtn, !canVerifyOtp && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify and sign in</Text>
              )}
            </Pressable>
          )}

          {/* Method-specific secondary link(s) */}
          {authMethod === 'password' ? (
            <Pressable
              onPress={() => {
                setPwMode(isSignIn ? 'signup' : 'signin');
                clearMessages();
              }}
              hitSlop={8}
              disabled={busy}
              style={styles.switchLink}
            >
              <Text style={styles.switchText}>
                {isSignIn
                  ? 'New here? Create an account'
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          ) : otpStep === 'code' ? (
            <>
              <Pressable
                onPress={() => sendOtp({ silent: true })}
                disabled={busy || resendIn > 0}
                hitSlop={8}
                style={styles.switchLink}
              >
                <Text
                  style={[
                    styles.switchText,
                    (busy || resendIn > 0) && { opacity: 0.5 },
                  ]}
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Text>
              </Pressable>
              <Pressable
                onPress={useDifferentEmail}
                disabled={busy}
                hitSlop={8}
                style={styles.switchLink}
              >
                <Text style={styles.switchText}>Use a different email</Text>
              </Pressable>
            </>
          ) : null}

          {/* Divider + method toggle */}
          <View style={styles.divider} />
          <Pressable
            onPress={switchAuthMethod}
            hitSlop={8}
            disabled={busy}
            style={styles.methodToggle}
          >
            <Text style={[styles.methodToggleText, busy && { opacity: 0.5 }]}>
              {toggleLabel}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = ({ colors, spacing, radius, typography }) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: spacing.xl,
      gap: spacing.md,
      alignSelf: 'center',
      width: '100%',
      maxWidth: 420,
    },
    brand: {
      ...typography.label,
      textTransform: 'uppercase',
      letterSpacing: 2,
      color: colors.primary,
      marginBottom: spacing.xs,
    },
    title: {
      ...typography.title,
    },
    subtitle: {
      ...typography.bodyMuted,
      marginBottom: spacing.md,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    label: {
      ...typography.label,
      textTransform: 'uppercase',
    },
    input: {
      backgroundColor: colors.cardMuted,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
      color: colors.text,
    },
    codeInput: {
      fontSize: 24,
      letterSpacing: 8,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
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
    infoBox: {
      backgroundColor: colors.successSoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    infoText: {
      color: colors.success,
      fontSize: 14,
      fontWeight: '600',
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
      minHeight: 48,
    },
    primaryBtnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    switchLink: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    switchText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.xs,
    },
    methodToggle: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    methodToggleText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
  });
