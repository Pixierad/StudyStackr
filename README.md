# SchoolApp - Task Tracker

A clean Expo app for tracking schoolwork across web and mobile. Create tasks, tag them by subject, set due dates, customize the theme, and sync your data with Supabase.

## Features

- **Tasks**: title, description, subject, due date, done/not done.
- **Subjects**: custom classes with optional room, teacher, and color.
- **Filters**: All, Today, Upcoming, Overdue, and Done with live counts.
- **Progress**: home screen completion summary.
- **Study**: heatmaps, counted study hours, recent sessions, stopwatch, Pomodoro, and custom timers.
- **Smart dates**: Today, Tomorrow, In 3 days, and calendar labels.
- **Accounts**: Supabase email/password and one-time-code sign-in.
- **Cloud sync**: tasks, subjects, study sessions, profile details, and theme settings sync through Supabase.
- **Offline fallback**: local AsyncStorage cache lets the app load recent data if Supabase is temporarily unavailable.
- **Offline saves**: edits made while disconnected are queued locally and replayed when the app can reach Supabase again.
- **Themes**: preset themes plus custom light/dark themes.
- **Web deploys**: Expo web export deployed from the static `dist/` folder.

## Project Structure

```text
SchoolApp/
|-- App.js                         Native/mobile entry point -> apps/mobile
|-- App.web.js                     Website entry point -> apps/website
|-- app.json                       Expo app config
|-- package.json                   Web/mobile scripts and dependencies
|-- deploy.ps1                     Commit, push, web export, and Cloudflare Pages handoff helper
|-- supabase-setup.sql             Supabase tables, RLS policies, indexes, profile trigger
|-- public/                        Static trust pages plus Cloudflare Pages routing/header files
|-- apps/
|   |-- mobile/                    Expo / React Native app shell
|   `-- website/                   Desktop web shell and route ownership
|-- packages/
|   `-- core/                      Shared data/domain exports for app + website
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
npm run dev:website
```

Start the mobile app:

```powershell
npm run dev:app
```

## Data Model

Supabase stores user-owned rows:

- `profiles`: display name, username, avatar, account creation date, selected theme, custom themes.
- `friends`: each user's saved friend list.
- `subjects`: subject name, room, teacher, color.
- `tasks`: task title, description, subject name, due date, completion state, created timestamp.
- `study_sessions`: session title, timer mode, optional subject, duration, planned duration, start/end timestamps, and notes.

The client also keeps an AsyncStorage cache per user so the UI can load quickly and fall back if Supabase is unavailable. When a network write fails because the device is offline, the write is stored in a per-user pending queue and replayed on the next successful data load.

## Deploying To Cloudflare Pages

Cloudflare Pages can build and host the static Expo web export directly from this repo.

Use these Pages build settings:

```text
Framework preset: None
Build command: npm run build:web
Build output directory: dist
Root directory: /
```

Add these environment variables in Cloudflare Pages under **Settings > Environment variables**:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Both values are required for the web login and sign-out flow. If either one is
missing, the website will stay on `/login` and show a configuration message
instead of silently opening the local-only app.

The `public/_redirects` file rewrites app routes such as `/login`, `/study`, `/friends`, `/subjects`, and `/chats/:id` to `index.html` so direct visits and refreshes work on Cloudflare Pages. The `public/_headers` file adds basic security headers and requires browser revalidation for deployed files so users do not stay pinned to stale Expo entry bundles after a successful deploy. The web export helper also appends the build version to Expo script URLs so a new deploy has a new browser cache key even when Metro reuses a bundle filename.

After adding a production custom domain in Cloudflare, update Supabase auth settings:

- **Site URL**: `https://your-domain.example`
- **Redirect URLs**:
  - `https://your-domain.example`
  - `https://your-domain.example/login`
  - any Cloudflare preview URL you intentionally use for auth testing

Before switching traffic fully, verify:

```powershell
npm run check:web
```

Then test these deployed paths:

- `/`
- `/login`
- `/study`
- `/friends`
- `/subjects`
- `/chats`
- `/privacy`
- `/terms`
- `/contact`

Once Cloudflare and Supabase auth are working on the custom domain, stop sharing generated preview URLs and use only the custom domain for production.

The deploy helper now stages changes, commits, pushes to GitHub, builds the web bundle, and hands off to Cloudflare Pages:

```powershell
npm run deploy -- "Deploy: message here"
```

Use this mode when the Cloudflare Pages project is connected to GitHub. Cloudflare will deploy after the push.

For a direct `dist/` upload with Wrangler, set:

```powershell
$env:CLOUDFLARE_PAGES_DIRECT='1'
$env:CLOUDFLARE_PAGES_PROJECT='schoolapp'
npm run deploy -- "Deploy: message here"
```

## Mobile App Roadmap

- Add EAS build config with iOS bundle ID and Android package name.
- Add app-store version/build number management.
- Decide whether Supabase sessions should move from AsyncStorage to SecureStore for native builds.
- Add reminders with `expo-notifications`.
- Add conflict-aware offline sync using `updated_at` columns and retry state.
- Add automated smoke tests for task, subject, auth, and sync flows.
