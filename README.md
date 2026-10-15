# StudyStackr - Task Tracker

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
StudyStackr/
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

For existing databases, run `migrations/20260908_data_integrity.sql` in the
Supabase SQL Editor as the database owner. The same migration is included at
the end of `supabase-setup.sql` for new installations. It runs in one transaction
and is safe to repeat. It restores missing profiles without changing existing
profile details or deleting accounts and their saved data. It briefly locks the
affected tables while validating and installing constraints; apply during a quiet
period. Unexpected invalid historical records cause a rollback instead of being
silently removed.

Also run `migrations/20260908_profile_account_deletion.sql` after the integrity
migration (both are included in the full setup). It enables deleting an account
by deleting its row from `public.profiles` in the database dashboard. That action
permanently deletes the matching Auth user and its dependent data, including
tasks, subjects, study sessions, friendships, and rooms created by that user.
Installing the migration itself does not delete any accounts. Auth-first deletion
also works; failure in either direction rolls back the whole deletion. Existing
RLS policies remain unchanged, so ordinary app clients cannot delete profiles.
Profile ID changes and profile truncation while accounts exist remain blocked.
The database automatically creates a profile on signup and requires all application
user references to have a profile. Email confirmation is unaffected.
Friendship pairs must be added/removed together, room creators and message senders
must belong to their room, and message receipts must reference a member of the
message's room. Existing RPCs perform these writes transactionally. The migration
also validates study-session times, room expiry, friend-request response state,
and message length/sender presence.

Task and study-session subject names remain optional historical labels, not
foreign keys: the current app allows subjects to be renamed/deleted separately.
These constraints cover defined relationships; they cannot prevent every possible
application error or changes made by an administrator disabling protections.

SQL regression checks run against an isolated PGlite PostgreSQL runtime, with no
live database connection. Install the test-only runtime outside the app and run:

```powershell
npm.cmd install --prefix "$env:TEMP/studystackr-sql-tests" --no-save --ignore-scripts --no-audit --no-fund @electric-sql/pglite
node scripts/test-data-integrity.mjs "$env:TEMP/studystackr-sql-tests/node_modules/@electric-sql/pglite/dist/index.js"
```

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

Cloudflare Pages' built-in SPA fallback serves `index.html` at app routes such as `/login`, `/study`, `/friends`, `/subjects`, and `/chats/:id`, preserving the URL on direct visits and refreshes. Do not add a top-level `404.html` or explicit rewrites to `/index.html`: the former disables the fallback, and the latter causes Pages to canonicalize the URL to `/` with a 308 redirect. Static pages such as `/privacy`, `/terms`, and `/contact` use Pages' automatic extensionless HTML handling. The comments-only `public/_redirects` replaces old rewrite rules during export. The `public/_headers` file adds basic security headers and requires browser revalidation for deployed files so users do not stay pinned to stale Expo entry bundles after a successful deploy. The web export helper also appends the build version to Expo script URLs so a new deploy has a new browser cache key even when Metro reuses a bundle filename.

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
$env:CLOUDFLARE_PAGES_PROJECT='studystackr'
npm run deploy -- "Deploy: message here"
```

Chat receipt support: apply `migrations/20260905_chat_receipts.sql` in the Supabase SQL editor for an existing database. Fresh installations include it in `supabase-setup.sql`. Receipts record the first time a recipient fetches a message in an active chat (delivered) and views the bottom of that chat (read), and refresh every five seconds while the chat is active. Historical timestamps are not inferred. Until the migration is applied, messages still work and receipt details show as unavailable.

Run receipt marker checks with `node --test src/features/chat/messageReceipts.test.mjs`.

## Mobile App Roadmap

- Add EAS build config with iOS bundle ID and Android package name.
- Add app-store version/build number management.
- Decide whether Supabase sessions should move from AsyncStorage to SecureStore for native builds.
- Add reminders with `expo-notifications`.
- Add conflict-aware offline sync using `updated_at` columns and retry state.
- Add automated smoke tests for task, subject, auth, and sync flows.


### Timetables

The Timetable tab supports one repeating week or two alternating weeks. Assign the current week to Week 1 or Week 2; rotation advances every Monday. Add and edit lessons with a subject, teacher, room, and start/end times. Existing subject details can prefill lessons. Switching to one week preserves Week 2 lessons.

For existing Supabase databases, run `migrations/20261006_timetables.sql` in the SQL Editor before using this feature. New databases include the table in `supabase-setup.sql`. Timetables are stored per user with offline caching; local mode stores them on the device.


### Flashcards

The Flashcards page (`/flashcards` on web, Cards on mobile) supports private sets,
folders and subject filters; editable card pairs; Know / Don't know study groups;
animated flipping with reduced-motion support; and multiple-choice, fill-in-the-blank
and written quizzes. Marking accepts minor spelling changes and reordered key words,
not arbitrary semantic paraphrases. Feedback shows correct answers in green and
incorrect submitted answers in red. Multiple-choice distractors come from other cards
in the selected group; a group with only one unique answer uses written questions.

Import copied/exported pairs from Quizlet, Gizmo or other sources using tabs, CSV,
semicolons or pipes. Preview validates every row. Direct Quizlet/Gizmo URL scraping
is not supported. Editing a set also lets you move it between folders and subjects.
Public discovery searches sets explicitly published by StudyStackr users, rather than
searching third-party websites. Publishing and removing public copies require an
account and connection. Updates to private cards do not change the public copy until
published again.

Apply `migrations/20261015_flashcards.sql` to an existing Supabase database (included
in `supabase-setup.sql` for new installations). Row-level security protects private
libraries and restricts public-set writes to their owners. Libraries cache locally;
failed cloud saves keep the local version and show a Sync library retry action.
Concurrent edits on multiple devices use the last saved library.

### Outlook timetable import

Timetable accepts a published Outlook HTTPS ICS link, or pasted ICS file contents.
The import previews weekly lessons, prevents overlaps and duplicates, and appends
only after confirmation. It is a snapshot, not a live calendar subscription. Choose
one- or two-week rotation before importing. Weekly and fortnightly recurring events
are supported; one-off events and recurrence exceptions are reported for manual entry.
Imported times use the device timezone. Imported lessons continue repeating even
past an Outlook recurrence end date, so review term boundaries in the timetable.

The web link fetcher is a Cloudflare Pages Function at
`functions/api/outlook-calendar.js`. Deploy the repository with Pages Functions support;
a plain static `dist` upload alone does not include it. It only fetches HTTPS ICS
links on the three supported Outlook hosts, rejects redirects, limits responses to
2 MB, times out, and disables caching. Local Expo web development can use pasted ICS
contents; native apps fetch the published link directly. Calendar URLs are not saved
in the timetable.

Run feature logic checks with:

```powershell
node --test src/features/flashcards/flashcardUtils.test.mjs src/features/timetable/outlookImport.test.mjs src/features/timetable/timetableUtils.test.mjs apps/website/authRouting.test.mjs
```
