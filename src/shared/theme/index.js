// Design tokens + theming.
//
// Theme is dynamic: users can pick from a set of preset themes (light,
// dark, moody, cute, midnight, shadow zone, ...) or create their own
// custom theme. A ThemeProvider at the root holds the current selection,
// persists it to AsyncStorage, and exposes it via the useTheme() hook.
//
// Most screens do:
//   const { colors, spacing, radius, typography, shadow } = useTheme();
//   const styles = useMemo(() => makeStyles(...), [...]);
//
// Static things (spacing, radius) don't change with the theme, but we still
// surface them through useTheme() so callers have one import.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '../../services/supabase';

// ── Static tokens ───────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

// ── Surface palettes used by light-based and dark-based presets ─────────────

const LIGHT_SURFACE = {
  bg: '#F5F6FA',
  card: '#FFFFFF',
  cardMuted: '#F0F2F7',
  text: '#1A1D29',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  overlay: 'rgba(17, 24, 39, 0.45)',
  shadow: '#000000',
  success: '#10B981',
  successSoft: '#D1FAE5',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  danger: '#EF4444',
  dangerSoft: '#FEE2E2',
};

const DARK_SURFACE = {
  bg: '#0F1218',
  card: '#1A1F2B',
  cardMuted: '#232838',
  text: '#F3F4F8',
  textMuted: '#9CA3AF',
  textFaint: '#6B7280',
  border: '#2A2F3D',
  borderStrong: '#3A4050',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
  success: '#34D399',
  successSoft: '#134034',
  warning: '#FBBF24',
  warningSoft: '#4D3912',
  danger: '#F87171',
  dangerSoft: '#4D1F1D',
};

// ── Theme presets ───────────────────────────────────────────────────────────
// Each preset defines: a base mode (dark?), a full surface palette, a primary
// accent and its "soft" tint. Soft tints are used for pills, badges, and
// backgrounds of accent-tinted elements.

export const THEME_PRESETS = {
  light: {
    label: 'Light',
    emoji: '\u2600\uFE0F',
    isDark: false,
    surface: LIGHT_SURFACE,
    primary: '#FF3E38',
    primarySoft: '#FFE4E3',
    description: 'Crisp and bright for daytime use.',
  },
  dark: {
    label: 'Dark',
    emoji: '\u{1F319}',
    isDark: true,
    surface: DARK_SURFACE,
    primary: '#FF3E38',
    primarySoft: '#4D1F1D',
    description: 'Easier on the eyes in low light.',
  },
  moody: {
    label: 'Moody',
    emoji: '\u{1F52E}',
    isDark: true,
    surface: {
      bg: '#1A1022',
      card: '#2A1E3B',
      cardMuted: '#3A2A4F',
      text: '#F0E4F7',
      textMuted: '#BBA5CC',
      textFaint: '#8877A0',
      border: '#3A2A4F',
      borderStrong: '#523D6B',
      overlay: 'rgba(0, 0, 0, 0.7)',
      shadow: '#000000',
      success: '#5ED8A6',
      successSoft: '#1F4031',
      warning: '#F2B97E',
      warningSoft: '#442E1A',
      danger: '#FF7A8A',
      dangerSoft: '#4B1F2A',
    },
    primary: '#C084FC',
    primarySoft: '#3D2A5C',
    description: 'Rich purples and hushed lighting.',
  },
  cute: {
    label: 'Cute',
    emoji: '\u{1F338}',
    isDark: false,
    surface: {
      bg: '#FFF0F5',
      card: '#FFFFFF',
      cardMuted: '#FFE4EB',
      text: '#4A2E3B',
      textMuted: '#8B6377',
      textFaint: '#B992A3',
      border: '#FCD5E0',
      borderStrong: '#F6A8C0',
      overlay: 'rgba(178, 78, 110, 0.35)',
      shadow: '#C86A87',
      success: '#7ED3A0',
      successSoft: '#D7F7E3',
      warning: '#F4B860',
      warningSoft: '#FFE9C8',
      danger: '#FF6B8E',
      dangerSoft: '#FFD5DF',
    },
    primary: '#eca4c8',
    primarySoft: '#FCE7F3',
    description: 'Soft pastels with a little sparkle.',
  },
  midnight: {
    label: 'Midnight',
    emoji: '\u2728',
    isDark: true,
    surface: {
      bg: '#040814',
      card: '#0B1325',
      cardMuted: '#141D35',
      text: '#E5EDFF',
      textMuted: '#8FA3CC',
      textFaint: '#5E7299',
      border: '#152041',
      borderStrong: '#22305E',
      overlay: 'rgba(0, 0, 0, 0.75)',
      shadow: '#000000',
      success: '#5ADB9A',
      successSoft: '#0F3A2A',
      warning: '#F1C77A',
      warningSoft: '#3D2F13',
      danger: '#FF7B7B',
      dangerSoft: '#4A1D1D',
    },
    primary: '#60A5FA',
    primarySoft: '#1A2A55',
    description: 'Deep blue like a starlit sky.',
  },
  shadow: {
    label: 'Spooky',
    emoji: '\u{1F5E1}\uFE0F',
    isDark: true,
    surface: {
      bg: '#080808',
      card: '#141414',
      cardMuted: '#1F1F1F',
      text: '#EDEDED',
      textMuted: '#9A9A9A',
      textFaint: '#6B6B6B',
      border: '#242424',
      borderStrong: '#3A3A3A',
      overlay: 'rgba(0, 0, 0, 0.8)',
      shadow: '#000000',
      success: '#4ADE80',
      successSoft: '#0F2E1D',
      warning: '#FBBF24',
      warningSoft: '#3B2C0C',
      danger: '#F87171',
      dangerSoft: '#3B1414',
    },
    primary: '#DC2626',
    primarySoft: '#3B0C0C',
    description: 'All darkness, a single ember glowing.',
  },
  mint: {
    label: 'Fresh Mint',
    emoji: '\u{1F33F}',
    isDark: false,
    surface: {
      bg: '#F0FAF6',
      card: '#FFFFFF',
      cardMuted: '#DDF3E9',
      text: '#15302A',
      textMuted: '#5A7A6E',
      textFaint: '#93ACA2',
      border: '#C7E8D9',
      borderStrong: '#A3D4BE',
      overlay: 'rgba(20, 60, 50, 0.4)',
      shadow: '#2E6F5E',
      success: '#10B981',
      successSoft: '#D1FAE5',
      warning: '#F59E0B',
      warningSoft: '#FEF3C7',
      danger: '#EF4444',
      dangerSoft: '#FEE2E2',
    },
    primary: '#059669',
    primarySoft: '#CCFBEF',
    description: 'Crisp greens for a clean vibe.',
  },
  sunset: {
    label: 'Sunset',
    emoji: '\u{1F305}',
    isDark: false,
    surface: {
      bg: '#FFF5EC',
      card: '#FFFFFF',
      cardMuted: '#FFE6D2',
      text: '#3B1E0F',
      textMuted: '#865C42',
      textFaint: '#B58F76',
      border: '#FAD3B5',
      borderStrong: '#F2B487',
      overlay: 'rgba(120, 60, 20, 0.45)',
      shadow: '#7A3A14',
      success: '#10B981',
      successSoft: '#D1FAE5',
      warning: '#F59E0B',
      warningSoft: '#FEF3C7',
      danger: '#EF4444',
      dangerSoft: '#FEE2E2',
    },
    primary: '#F97316',
    primarySoft: '#FFDFC2',
    description: 'Warm orange like fading daylight.',
  },
};

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS);
export const CUSTOM_THEME_PREFIX = 'custom:';

// ── Subject palettes (mode-aware) ───────────────────────────────────────────

const LIGHT_SUBJECT_PALETTE = [
  { bg: '#EEF0FF', fg: '#4C5BE0' }, // indigo
  { bg: '#E0F2FE', fg: '#0369A1' }, // sky
  { bg: '#DCFCE7', fg: '#15803D' }, // green
  { bg: '#FEF3C7', fg: '#B45309' }, // amber
  { bg: '#FCE7F3', fg: '#BE185D' }, // pink
  { bg: '#EDE9FE', fg: '#6D28D9' }, // violet
  { bg: '#FFE4E6', fg: '#BE123C' }, // rose
  { bg: '#CCFBF1', fg: '#0F766E' }, // teal
];

const DARK_SUBJECT_PALETTE = [
  { bg: '#262C4D', fg: '#A5B2FF' }, // indigo
  { bg: '#103347', fg: '#7DD3FC' }, // sky
  { bg: '#123A2A', fg: '#86EFAC' }, // green
  { bg: '#3D3212', fg: '#FCD34D' }, // amber
  { bg: '#3D1E33', fg: '#F9A8D4' }, // pink
  { bg: '#2B1F4D', fg: '#C4B5FD' }, // violet
  { bg: '#3D1D28', fg: '#FDA4AF' }, // rose
  { bg: '#0F3F3A', fg: '#5EEAD4' }, // teal
];

// Stable hash → palette slot, so a given subject name always gets the same
// color within a mode.
function hashSubject(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

// ── Color utilities ─────────────────────────────────────────────────────────
// Custom themes only ask the user for a primary color. We derive a matching
// "soft" variant from that hex so badges and pills look right.

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgb(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Lighten / darken by mixing with white (amount in 0..1 toward white)
// or black (negative amount toward black).
function mix(hex, towardHex, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(towardHex);
  const t = clamp(amount, 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function softFromPrimary(primary, isDark) {
  // Light themes: mix toward white, Dark themes: mix toward black, to get
  // a gentle backdrop for accent-tinted pills.
  return isDark ? mix(primary, '#000000', 0.7) : mix(primary, '#FFFFFF', 0.82);
}

export function isValidHex(hex) {
  if (typeof hex !== 'string') return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex.trim());
}

// ── buildTheme ──────────────────────────────────────────────────────────────
// Given a resolved theme definition (one of THEME_PRESETS or a user-defined
// custom theme object), produce the full set of design tokens used by the
// rest of the app.

function resolveThemeDef(themeKey, customThemes) {
  if (themeKey && THEME_PRESETS[themeKey]) return THEME_PRESETS[themeKey];
  if (themeKey && Array.isArray(customThemes)) {
    const found = customThemes.find((t) => t.key === themeKey);
    if (found) return found;
  }
  return THEME_PRESETS.light;
}

export function buildTheme(themeKey = 'light', customThemes = []) {
  const def = resolveThemeDef(themeKey, customThemes);
  const isDark = !!def.isDark;
  const surface = def.surface ?? (isDark ? DARK_SURFACE : LIGHT_SURFACE);

  const colors = {
    ...surface,
    primary: def.primary,
    primarySoft: def.primarySoft ?? softFromPrimary(def.primary, isDark),
    primaryText: '#FFFFFF',
  };
  colors.cardHover = isDark ? mix(colors.card, colors.primary, 0.16) : mix(colors.card, colors.primary, 0.055);
  colors.cardMutedHover = isDark
    ? mix(colors.cardMuted, colors.primary, 0.18)
    : mix(colors.cardMuted, colors.primary, 0.07);
  colors.borderHover = isDark
    ? mix(colors.borderStrong, colors.primary, 0.45)
    : mix(colors.borderStrong, colors.primary, 0.35);
  colors.primaryHover = isDark
    ? mix(colors.primary, '#FFFFFF', 0.14)
    : mix(colors.primary, '#000000', 0.1);
  colors.primarySoftHover = isDark
    ? mix(colors.primarySoft, colors.primary, 0.18)
    : mix(colors.primarySoft, colors.primary, 0.1);
  colors.dangerSoftHover = isDark
    ? mix(colors.dangerSoft, '#FFFFFF', 0.1)
    : mix(colors.dangerSoft, colors.danger, 0.08);
  colors.successSoftHover = isDark
    ? mix(colors.successSoft, '#FFFFFF', 0.1)
    : mix(colors.successSoft, colors.success, 0.08);

  const typography = {
    title:      { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
    heading:    { fontSize: 20, fontWeight: '600', color: colors.text },
    subheading: { fontSize: 16, fontWeight: '600', color: colors.text },
    body:       { fontSize: 15, color: colors.text },
    bodyMuted:  { fontSize: 14, color: colors.textMuted },
    caption:    { fontSize: 12, color: colors.textFaint, fontWeight: '500' },
    label:      { fontSize: 13, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
  };

  const shadow = {
    card: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    float: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.5 : 0.15,
      shadowRadius: 12,
      elevation: 6,
    },
  };

  const subjectPalette = isDark ? DARK_SUBJECT_PALETTE : LIGHT_SUBJECT_PALETTE;
  const fallback = {
    bg: surface.cardMuted,
    fg: surface.textMuted,
  };

  function colorForSubject(name) {
    if (!name) return fallback;
    return subjectPalette[hashSubject(name) % subjectPalette.length];
  }

  return {
    themeKey,
    themeLabel: def.label,
    themeEmoji: def.emoji,
    themeDescription: def.description,
    isCustom: !!def.isCustom,
    isDark,
    colors,
    spacing,
    radius,
    typography,
    shadow,
    colorForSubject,
  };
}

// A lightweight version used by SettingsSheet previews without rebuilding
// every token: returns just the colors + isDark for a given theme key.
export function previewColorsFor(themeKey, customThemes = []) {
  const def = resolveThemeDef(themeKey, customThemes);
  const isDark = !!def.isDark;
  const surface = def.surface ?? (isDark ? DARK_SURFACE : LIGHT_SURFACE);
  return {
    isDark,
    bg: surface.bg,
    card: surface.card,
    text: surface.text,
    textMuted: surface.textMuted,
    border: surface.border,
    primary: def.primary,
    primarySoft: def.primarySoft ?? softFromPrimary(def.primary, isDark),
    label: def.label,
    emoji: def.emoji,
    description: def.description,
    isCustom: !!def.isCustom,
  };
}

// ── Custom theme helpers ────────────────────────────────────────────────────
// A custom theme is an object of shape:
//   { key, label, isDark, primary, primarySoft, surface, isCustom: true }
// The `surface` is inherited from the base (light/dark) so we don't have to
// ask the user for 20 colors.

export function makeCustomTheme({ name, baseIsDark, primary }) {
  const trimmedName = (name || '').trim() || 'My theme';
  const isDark = !!baseIsDark;
  const safePrimary = isValidHex(primary) ? primary : '#5B6CFF';
  return {
    key: `${CUSTOM_THEME_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: trimmedName,
    emoji: isDark ? '\u{1F311}' : '\u{1F3A8}',
    isDark,
    surface: isDark ? DARK_SURFACE : LIGHT_SURFACE,
    primary: safePrimary,
    primarySoft: softFromPrimary(safePrimary, isDark),
    description: isDark ? 'Custom dark theme.' : 'Custom light theme.',
    isCustom: true,
  };
}

// ── Cloud helper ────────────────────────────────────────────────────────────
// ── Context + Provider + hook ───────────────────────────────────────────────

// Bare keys are used in local-only mode (no session) and as the legacy
// fallback. User-scoped keys prevent one user's theme from leaking to
// another user on the same device.
const THEME_KEY_BARE = '@simpleapp:theme:key:v2';
const CUSTOM_THEMES_KEY_BARE = '@simpleapp:theme:customs:v1';
// Legacy keys from the pre-theme-overhaul version — migrated on load.
const LEGACY_MODE_KEY = '@simpleapp:theme:mode:v1';
const LEGACY_ACCENT_KEY = '@simpleapp:theme:accent:v1';

function themeKeyFor(userId) {
  return userId ? `@simpleapp:theme:key:v2:${userId}` : THEME_KEY_BARE;
}
function customThemesKeyFor(userId) {
  return userId ? `@simpleapp:theme:customs:v1:${userId}` : CUSTOM_THEMES_KEY_BARE;
}

const DEFAULT_THEME = 'light';

const ThemeContext = createContext({
  ...buildTheme(DEFAULT_THEME, []),
  customThemes: [],
  setTheme: () => {},
  addCustomTheme: () => null,
  deleteCustomTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeKey, setThemeKey] = useState(DEFAULT_THEME);
  const [customThemes, setCustomThemes] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [activeUserId, setActiveUserId] = useState(isSupabaseConfigured ? undefined : null);
  const skipNextPersistRef = useRef(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setActiveUserId(data?.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setActiveUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // Load saved prefs whenever the active account changes.
  // Cloud mode: fetch theme_key + custom_themes from Supabase profiles, fall
  // back to user-scoped AsyncStorage cache if offline/no row.
  // Local mode: read from bare AsyncStorage keys (with legacy mode migration).
  useEffect(() => {
    if (activeUserId === undefined) return;
    let cancelled = false;
    skipNextPersistRef.current = true;
    setHydrated(false);
    (async () => {
      try {
        const uid = activeUserId;
        let loadedKey = null;
        let loadedCustoms = [];

        if (uid) {
          // ── Cloud path ──────────────────────────────────────────────────
          try {
            const { data, error } = await supabase
              .from('profiles')
              .select('theme_key, custom_themes')
              .eq('id', uid)
              .maybeSingle();
            if (error) throw error;
            loadedKey = data?.theme_key ?? null;
            const rawCustoms = data?.custom_themes;
            if (Array.isArray(rawCustoms)) {
              loadedCustoms = rawCustoms.filter((t) => t && t.key);
            }
            // Cache locally for offline use.
            if (loadedKey) {
              AsyncStorage.setItem(themeKeyFor(uid), loadedKey).catch(() => {});
            }
            AsyncStorage.setItem(customThemesKeyFor(uid), JSON.stringify(loadedCustoms)).catch(() => {});
          } catch (e) {
            console.warn('Supabase loadTheme failed, falling back to cache:', e?.message);
            try {
              loadedKey = await AsyncStorage.getItem(themeKeyFor(uid));
              const raw = await AsyncStorage.getItem(customThemesKeyFor(uid));
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) loadedCustoms = parsed.filter((t) => t && t.key);
              }
            } catch { /* leave defaults */ }
          }
        } else {
          // ── Local path (with legacy migration) ─────────────────────────
          const [storedKey, storedCustomsRaw, legacyMode, legacyAccent] = await Promise.all([
            AsyncStorage.getItem(THEME_KEY_BARE),
            AsyncStorage.getItem(CUSTOM_THEMES_KEY_BARE),
            AsyncStorage.getItem(LEGACY_MODE_KEY),
            AsyncStorage.getItem(LEGACY_ACCENT_KEY),
          ]);

          if (storedCustomsRaw) {
            try {
              const parsed = JSON.parse(storedCustomsRaw);
              if (Array.isArray(parsed)) loadedCustoms = parsed.filter((t) => t && t.key);
            } catch { /* ignore */ }
          }

          if (storedKey) {
            loadedKey = storedKey;
          } else if (legacyMode === 'dark') {
            // Best-effort migration: fall back to 'dark' preset.
            loadedKey = 'dark';
          } else if (legacyMode === 'light') {
            loadedKey = 'light';
          }
          // legacyAccent is dropped silently — accent is now part of the theme.
        }

        if (cancelled) return;
        setCustomThemes(loadedCustoms);
        if (loadedKey && (THEME_PRESETS[loadedKey] || loadedCustoms.some((t) => t.key === loadedKey))) {
          setThemeKey(loadedKey);
        } else {
          setThemeKey(DEFAULT_THEME);
        }
      } catch (e) {
        console.warn('Failed to load theme prefs:', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeUserId]);

  // Persist changes whenever themeKey or customThemes changes (after hydration).
  // Cloud mode: write user-scoped AsyncStorage cache + upsert to Supabase.
  // Local mode: write bare AsyncStorage keys.
  useEffect(() => {
    if (!hydrated || activeUserId === undefined) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    (async () => {
      try {
        const uid = activeUserId;
        if (uid) {
          AsyncStorage.setItem(themeKeyFor(uid), themeKey).catch(() => {});
          AsyncStorage.setItem(customThemesKeyFor(uid), JSON.stringify(customThemes)).catch(() => {});
          const { error } = await supabase
            .from('profiles')
            .upsert({ id: uid, theme_key: themeKey, custom_themes: customThemes }, { onConflict: 'id' });
          if (error) console.warn('Failed to save theme to Supabase:', error.message);
        } else {
          AsyncStorage.setItem(themeKeyFor(null), themeKey).catch(() => {});
          AsyncStorage.setItem(customThemesKeyFor(null), JSON.stringify(customThemes)).catch(() => {});
        }
      } catch (e) {
        console.warn('Failed to persist theme prefs:', e);
      }
    })();
  }, [themeKey, customThemes, hydrated, activeUserId]);

  const setTheme = useCallback((key) => {
    setThemeKey(key);
  }, []);

  const addCustomTheme = useCallback((partial) => {
    const theme = makeCustomTheme(partial);
    setCustomThemes((prev) => [...prev, theme]);
    setThemeKey(theme.key); // auto-select the newly created theme
    return theme;
  }, []);

  const deleteCustomTheme = useCallback((key) => {
    setCustomThemes((prev) => prev.filter((t) => t.key !== key));
    setThemeKey((curr) => (curr === key ? DEFAULT_THEME : curr));
  }, []);

  const value = useMemo(() => {
    const theme = buildTheme(themeKey, customThemes);
    return {
      ...theme,
      customThemes,
      setTheme,
      addCustomTheme,
      deleteCustomTheme,
    };
  }, [themeKey, customThemes, setTheme, addCustomTheme, deleteCustomTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
