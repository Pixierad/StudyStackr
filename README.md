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
|-- App.js                         Expo entry point
|-- app.json                       Expo app config
|-- package.json                   Web/mobile scripts and dependencies
|-- deploy.ps1                     Signed commit, web export, and Vercel deploy helper
|-- supabase-setup.sql             Supabase tables, RLS policies, indexes, profile trigger
|-- vercel.json                    Vercel static hosting config
|-- assets/                        App icons and splash assets
`-- src/
    |-- application/               Root orchestration, app chrome, notification helpers
    |-- features/                  Feature-owned UI and repository scripts
    |   |-- auth/
    |   |-- changelog/
    |   |-- chat/
    |   |-- friends/
    |   |-- profile/
    |   |-- settings/
    |   |-- subjects/
    |   `-- tasks/
    |-- services/                  Supabase client and shared storage backend
    `-- shared/                    Reusable components, theme, platform adapters, utilities
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

Then run the SQL in `supabase-setup.sql` inside the Supabase SQL Editor. It creates `profiles`, `friends`, `subjects`, and `tasks`, enables row-level security, and adds per-user policies.

Start the web app:

```powershell
npm run dev:web
```

Start the mobile app:

```powershell
npm run dev:mobile
```

## Data Model

Supabase stores user-owned rows:

- `profiles`: display name, username, avatar, selected theme, custom themes.
- `friends`: each user's saved friend list.
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
