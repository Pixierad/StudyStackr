import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.production.local');

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function buildVersion() {
  const deploySha =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    '';
  if (deploySha) return deploySha.slice(0, 7);

  return gitShortSha() || 'local';
}

function buildMetadata() {
  return {
    EXPO_PUBLIC_APP_VERSION: buildVersion(),
    EXPO_PUBLIC_APP_BUILT: timestamp(),
  };
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function dotenvLine(key, value) {
  const normalized = String(value ?? '');
  if (/^[A-Za-z0-9_./:@-]+$/.test(normalized)) {
    return `${key}=${normalized}`;
  }
  return `${key}=${JSON.stringify(normalized)}`;
}

function publicExpoEnv(metadata) {
  const values = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('EXPO_PUBLIC_') && value != null) {
      values[key] = value;
    }
  }

  Object.assign(values, metadata);

  return Object.keys(values)
    .sort()
    .map((key) => dotenvLine(key, values[key]))
    .join('\n') + '\n';
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

const previousEnv = existsSync(envPath) ? await readFile(envPath, 'utf8') : null;

try {
  const metadata = buildMetadata();
  const envFile = publicExpoEnv(metadata);
  const buildEnv = { ...process.env, ...metadata };
  await writeFile(envPath, envFile);

  const version = envFile.match(/^EXPO_PUBLIC_APP_VERSION=(.*)$/m)?.[1] || '';
  const built = envFile.match(/^EXPO_PUBLIC_APP_BUILT=(.*)$/m)?.[1] || '';
  console.log(`Baked web build metadata: ${version}${built ? ` (${built.replaceAll('"', '')})` : ''}`);

  await run(process.execPath, [
    resolve(root, 'node_modules', 'expo', 'bin', 'cli'),
    'export',
    '--platform',
    'web',
    ...process.argv.slice(2),
  ], buildEnv);
  await run(process.execPath, [resolve(root, 'scripts', 'copy-web-static.mjs')], buildEnv);
} finally {
  if (previousEnv == null) {
    if (existsSync(envPath)) await unlink(envPath);
  } else {
    await writeFile(envPath, previousEnv);
  }
}
