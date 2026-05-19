import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public');
const target = resolve(root, 'dist');

if (existsSync(source)) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

const indexPath = resolve(target, 'index.html');
if (existsSync(indexPath)) {
  let html = await readFile(indexPath, 'utf8');
  const description =
    'School App is an independent schoolwork planner for tasks, subjects, chats, friends, and profile settings.';

  if (!html.includes('name="description"')) {
    html = html.replace(
      '<title>School App</title>',
      `<title>School App</title>\n    <meta name="description" content="${description}" />\n    <link rel="help" href="/contact.html" />\n    <link rel="terms-of-service" href="/terms.html" />`
    );
  }

  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>
      <h1>School App</h1>
      <p>School App is an independent schoolwork planner. JavaScript is required to sign in and use the app.</p>
      <p><a href="/privacy.html">Privacy</a> <a href="/terms.html">Terms</a> <a href="/contact.html">Contact</a></p>
    </noscript>`
  );

  await writeFile(indexPath, html);
}
