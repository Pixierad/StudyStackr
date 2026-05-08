// Application changelog.
//
// Each entry is rendered chronologically (newest first) in the in-app
// changelog sheet. Add a new entry at the TOP whenever you ship something
// users would like to know about. Keep notes short and human-readable.
//
// Fields:
//   version  -- semver-ish identifier. Used as the cache key for "last seen"
//               so users only get the unread dot when this string changes.
//   date     -- ISO date (YYYY-MM-DD). Shown as a subtitle.
//   title    -- short headline for this release.
//   notes    -- array of bullet strings. Use category prefixes (e.g.
//               "New:", "Fixed:", "Improved:") for scannability.
//
// Bumping the *first* (latest) version lights up the "What's new" badge in
// the header for everyone whose lastSeen marker is older.

export const CHANGELOG = [
  {
    version: '1.1.1 (Not released)',
    date: '8/5/2025',
    title: 'Look forward to:',
    notes: [
      'Coming soon: Study timer and being able to track study sessions for subjects',
      'Coming soon: Repeating events.',
      'Improvement: Universal theme',
      'Bug fixes and more'
    ],
  },
  {
    version: '1.1.0 (PATCH)',
    date: '25/4/2026',
    title: 'Hotfix: deployment rejection fixed',
    notes: [
      'Fixed an issue where Vercel would reject the latest deployment due to no SSH key for the repo (my bad).',
      'New: legit nothing lol.'
    ],
  },
  {
    version: '1.1.0',
    date: '25/4/2026',
    title: 'Reliability pass and What\'s new',
    notes: [
      'New: "What\'s new" panel — see recent improvements from the Settings sheet.',
      'Fixed: avoid re-uploading every task on cold boot (saves Supabase quota).',
      'Fixed: signing out no longer overwrites legacy local-only data.',
      'Fixed: legacy local data is now migrated to your account on first sign-in.',
      'Fixed: toggling a single task only writes that one row to the cloud.',
      'Improved: due-date colour and "In N days" copy now agree (one-week window).',
      'Improved: "Resend code" countdown is more reliable; smoother sheet dismiss.',
    ],
  },
  {
    version: '1.0.0',
    date: '30/3/2026',
    title: 'Initial public release',
    notes: [
      'New: tasks with due dates, subjects, and progress tracking.',
      'New: subject manager with rooms, teachers, and custom colours.',
      'New: dark mode and custom theme builder.',
      'New: optional cloud sync via Supabase (email or one-time code).',
    ],
  },
];

export function latestChangelogVersion() {
  return CHANGELOG[0]?.version ?? null;
}
