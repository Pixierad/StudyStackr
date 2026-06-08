import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public');
const target = resolve(root, 'dist');

async function webBuildVersion() {
  const envPath = resolve(root, '.env.production.local');
  if (!existsSync(envPath)) return '';
  const envFile = await readFile(envPath, 'utf8');
  return envFile.match(/^EXPO_PUBLIC_APP_VERSION=(.*)$/m)?.[1]?.replace(/^"|"$/g, '') || '';
}

if (existsSync(source)) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

const staticVercelConfig = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  cleanUrls: true,
  rewrites: [
    { source: '/login', destination: '/' },
    { source: '/settings', destination: '/' },
    { source: '/study', destination: '/' },
    { source: '/chats', destination: '/' },
    { source: '/chats/:path*', destination: '/' },
    { source: '/subjects', destination: '/' },
    { source: '/friends', destination: '/' },
  ],
};

await mkdir(target, { recursive: true });
await writeFile(
  resolve(target, 'vercel.json'),
  `${JSON.stringify(staticVercelConfig, null, 2)}\n`
);

const indexPath = resolve(target, 'index.html');
if (existsSync(indexPath)) {
  let html = await readFile(indexPath, 'utf8');
  const version = await webBuildVersion();
  const description =
    'School App is an independent schoolwork planner for tasks, subjects, chats, friends, and profile settings.';

  if (!html.includes('name="description"')) {
    html = html.replace(
      '<title>School App</title>',
      `<title>School App</title>\n    <meta name="description" content="${description}" />\n    <link rel="help" href="/contact" />\n    <link rel="terms-of-service" href="/terms" />`
    );
  }

  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>
      <h1>School App</h1>
      <p>School App is an independent schoolwork planner. JavaScript is required to sign in and use the app.</p>
      <p><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/contact">Contact</a></p>
    </noscript>`
  );

  if (version) {
    const cacheBust = encodeURIComponent(version);
    html = html.replace(
      /src="(\/_expo\/static\/js\/[^"?]+\.js)(?:\?v=[^"]*)?"/g,
      `src="$1?v=${cacheBust}"`
    );
  }

  await writeFile(indexPath, html);
}
