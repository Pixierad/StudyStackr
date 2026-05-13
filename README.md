# SchoolApp - Task Tracker

A clean Expo app for tracking schoolwork across web and mobile. Create tasks, tag them by subject, set due dates, customize the theme, and sync your data with Supabase.

## Features

- **Tasks**: title, description, subject, due date, done/not done.
- **Subjects**: custom classes with optional room, teacher, and color.
- **Filters**: All, Today, Upcoming, Overdue, and Done with live counts.
- **Progress**: home screen completion summary.
- **Smart dates**: Today, Tomorrow, In 3 days, and calendar labels.
- **Accounts**: Supabase email/password and one-time-code sign-in.
- **Cloud sync**: tasks, subjects, profile name, and theme settings sync through Supabase.
- **Offline fallback**: local AsyncStorage cache lets the app load recent data if Supabase is temporarily unavailable.
- **Offline saves**: edits made while disconnected are queued locally and replayed when the app can reach Supabase again.
- **Themes**: preset themes plus custom light/dark themes.
- **Web deploys**: Expo web export deployed to Vercel.

## Project Structure

```text
SchoolApp/
├── App.js                         Main app shell, auth-aware loading, filters, modals
├── app.json                       Expo app config
├── package.json                   Scripts and dependencies
├── deploy.ps1                     Signed commit, web export, and Vercel deploy helper
├── supabase-setup.sql             Supabase tables, RLS policies, indexes, profile trigger
├── vercel.json                    Vercel static hosting config
├── assets/                        App icons and splash assets
└── src/
    ├── supabase.js                Supabase client and session helper
    ├── storage.js                 Data access layer with Supabase + local cache fallback
    ├── theme.js                   Theme tokens, custom themes, persistence
    ├── changelog.js               In-app release notes
    ├── utils/
    │   ├── dates.js               Date formatting and due status helpers
    │   └── subjects.js            Subject lookup and color helpers
    └── components/
        ├── AuthScreen.js
        ├── ChangelogSheet.js
        ├── EmptyState.js
        ├── FilterTabs.js
        ├── SettingsSheet.js
        ├── SubjectManager.js
        ├── TaskCard.js
        └── TaskForm.js
```

## Setup

Install dependencies:

```powershell
npm install
```

Copy the example env file and add your Supabase project values:

```powershell
Copy-Item .env.local.example .env.local
```

Then run the SQL in `supabase-setup.sql` inside the Supabase SQL Editor. It creates `profiles`, `subjects`, and `tasks`, enables row-level security, and adds per-user policies.

Start the app:

```powershell
npm run web
```

## Data Model

Supabase stores user-owned rows:

- `profiles`: display name, selected theme, custom themes.
- `subjects`: subject name, room, teacher, color.
- `tasks`: task title, description, subject name, due date, completion state, created timestamp.

The client also keeps an AsyncStorage cache per user so the UI can load quickly and fall back if Supabase is unavailable. When a network write fails because the device is offline, the write is stored in a per-user pending queue and replayed on the next successful data load.

## Deploying To Vercel

The deploy helper signs and pushes a commit, exports the Expo web bundle, and deploys `dist/` to Vercel:

```powershell
npm run deploy -- "Deploy: message here"
```

For first-time setup, link the Vercel project locally and make sure commit signing is configured if your Vercel project rejects unverified commits.

## Mobile App Roadmap

- Add EAS build config with iOS bundle ID and Android package name.
- Add app-store version/build number management.
- Decide whether Supabase sessions should move from AsyncStorage to SecureStore for native builds.
- Add reminders with `expo-notifications`.
- Add conflict-aware offline sync using `updated_at` columns and retry state.
- Add automated smoke tests for task, subject, auth, and sync flows.
