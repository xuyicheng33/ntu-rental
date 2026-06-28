#!/usr/bin/env node
/**
 * NTU Rental Finder Windows one-click updater.
 *
 * End-to-end flow:
 * git sync -> npm install -> Playwright install -> PropertyGuru session
 * -> local Next server -> scrape -> validate -> lint/build -> commit/push.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(PROJECT_ROOT, 'tmp', `windows-update-${timestampForPath()}`);
const DATA_FILE = path.join(PROJECT_ROOT, 'data', 'listing.json');
const BACKUP_FILE = path.join(TMP_ROOT, 'listing-before-update.json');
const SCRAPE_LOG = path.join(TMP_ROOT, 'propertyguru-scrape.log');
const SERVER_LOG = path.join(TMP_ROOT, 'next-start.log');
const MIN_LISTINGS = Number(process.env.MIN_LISTINGS || 100);
const DEFAULT_PORT = Number(process.env.PORT || 3003);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let serverProcess = null;

function timestampForPath() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function todayForCommit() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function log(message) {
  console.log(`\n[${new Date().toLocaleTimeString()}] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function commandName(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return npmCmd;
  if (command === 'npx') return npxCmd;
  return command;
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName(command), args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    }

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve({ stdout, stderr, code });
      else {
        const err = new Error(`${command} ${args.join(' ')} exited with code ${code}${stderr ? `\n${stderr}` : ''}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function commandExists(command, args = ['--version']) {
  try {
    await run(command, args, { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function canConnect(host, port, timeoutMs = 400) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = ok => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (!(await canConnect('127.0.0.1', port))) return port;
  }
  fail(`No free port found from ${startPort} to ${startPort + 19}.`);
}

async function waitForServer(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  fail(`Local Next server did not become ready: ${url}`);
}

async function detectProxyEnv(baseEnv) {
  if (baseEnv.SCRAPER_PROXY || baseEnv.HTTPS_PROXY || baseEnv.HTTP_PROXY) return baseEnv;
  if (await canConnect('127.0.0.1', 7897)) return { ...baseEnv, SCRAPER_PROXY: 'http://127.0.0.1:7897' };
  if (await canConnect('127.0.0.1', 7890)) return { ...baseEnv, SCRAPER_PROXY: 'http://127.0.0.1:7890' };
  return baseEnv;
}


function normalizeLockfileForWindowsNpm() {
  const lockPath = path.join(PROJECT_ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return;

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  let changed = false;

  for (const [key, value] of Object.entries(lock.packages || {})) {
    if (!value || typeof value !== 'object') continue;

    // Some npm versions can generate optional nested wasm dependency placeholders
    // that contain only { optional: true }. Windows npm then fails with
    // "Invalid Version" before it can repair the lockfile. These entries are
    // safe to remove because the parent optional dependency declares the real
    // dependency range and npm can resolve it when that platform needs it.
    if (value.optional === true && !value.version && !value.resolved && !value.integrity) {
      delete lock.packages[key];
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    log('Normalized package-lock.json optional dependency placeholders for Windows npm.');
  }
}

function validateListingJson() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const listings = Array.isArray(data.listings) ? data.listings : [];
  const missing = listings.filter(item => !item.id || !item.title || !item.price || !item.url || !item.imageUrl);
  const nonPropertyGuru = listings.filter(item => item.source !== 'PropertyGuru');
  const urls = new Set();
  let duplicateUrls = 0;
  for (const item of listings) {
    if (urls.has(item.url)) duplicateUrls += 1;
    urls.add(item.url);
  }
  const summary = {
    count: listings.length,
    minListings: MIN_LISTINGS,
    lastUpdated: data.lastUpdated,
    sources: [...new Set(listings.map(item => item.source))],
    missingRequired: missing.length,
    duplicateUrls,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (listings.length < MIN_LISTINGS) fail(`Listing count ${listings.length} is below MIN_LISTINGS=${MIN_LISTINGS}.`);
  if (nonPropertyGuru.length > 0) fail(`Expected PropertyGuru-only data, found ${nonPropertyGuru.length} non-PropertyGuru listings.`);
  if (missing.length > 0 || duplicateUrls > 0) fail('Listing data failed quality checks.');
  return summary;
}

function restoreBackup() {
  if (fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(BACKUP_FILE, DATA_FILE);
    log('Restored data/listing.json from backup.');
  }
}

function startServer(port, env) {
  const out = fs.createWriteStream(SERVER_LOG, { flags: 'a' });
  const child = spawn(commandName('npm'), ['run', 'start', '--', '-p', String(port)], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('exit', code => {
    if (serverProcess === child) {
      console.log(`\n[next-server] exited with code ${code}`);
    }
  });
  serverProcess = child;
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  log('Stopping local Next server...');
  serverProcess.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  serverProcess = null;
}

async function scrape(port) {
  const url = `http://127.0.0.1:${port}/api/scrape?source=propertyguru`;
  const response = await fetch(url, { method: 'POST' });
  const text = await response.text();
  fs.writeFileSync(SCRAPE_LOG, text);
  console.log(text);
  if (!response.ok) fail(`Scrape HTTP request failed: ${response.status}`);

  const events = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map(match => {
    try { return JSON.parse(match[1]); } catch { return null; }
  }).filter(Boolean);
  const finalEvent = events.at(-1);
  if (!finalEvent || finalEvent.phase !== 'done') {
    fail(`PropertyGuru scrape did not finish cleanly. Last event: ${JSON.stringify(finalEvent)}`);
  }
  return finalEvent;
}

async function ensureCleanEnoughTree() {
  const status = (await run('git', ['status', '--porcelain'], { capture: true })).stdout.trim();
  if (!status) return;
  console.log(status);
  if (process.env.ONECLICK_ALLOW_DIRTY === 'true') return;
  const answer = await ask('\nWorking tree is not clean. Continue and only commit data/listing.json? [y/N] ');
  if (!/^y(es)?$/i.test(answer)) fail('Stopped to avoid mixing this update with existing local changes.');
}

async function gitHasDataChanges() {
  try {
    await run('git', ['diff', '--quiet', '--', 'data/listing.json'], { capture: true });
    return false;
  } catch {
    return true;
  }
}

async function main() {
  process.chdir(PROJECT_ROOT);
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  process.on('SIGINT', async () => {
    await stopServer();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await stopServer();
    process.exit(143);
  });

  log('NTU Rental Finder Windows one-click updater started.');
  log(`Project root: ${PROJECT_ROOT}`);
  log(`Logs: ${TMP_ROOT}`);

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) fail('package.json not found. Put windows-updater inside the project root.');

  log('Preflight checks...');
  for (const command of ['git', 'node', 'npm']) {
    if (!(await commandExists(command))) fail(`Missing command: ${command}. Please install it first.`);
  }

  await ensureCleanEnoughTree();

  log('Syncing latest main from GitHub...');
  await run('git', ['fetch', 'origin', 'main']);
  await run('git', ['pull', '--ff-only']);

  normalizeLockfileForWindowsNpm();

  log('Installing npm dependencies...');
  const installArgs = process.platform === 'win32'
    ? ['install', '--no-audit', '--no-fund']
    : ['ci'];
  await run('npm', installArgs);

  log('Installing Playwright Chromium browser...');
  await run('npx', ['playwright', 'install', 'chromium']);

  let env = {
    ...process.env,
    NODE_ENV: 'production',
    NODE_OPTIONS: process.env.NODE_OPTIONS?.includes('max-old-space-size')
      ? process.env.NODE_OPTIONS
      : `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim(),
    SCRAPER_HEADLESS: 'false',
    PROPERTYGURU_VERIFICATION_BROWSER: 'chrome',
    PROPERTYGURU_BROWSER: 'chrome',
  };
  env = await detectProxyEnv(env);
  log(`Proxy: ${env.SCRAPER_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || 'none'}`);

  log('Preparing PropertyGuru browser session. Automatic first, manual fallback if needed...');
  await run('node', [path.join('windows-updater', 'propertyguru-session-windows.mjs'), '--auto-timeout', process.env.PG_AUTO_TIMEOUT_SECONDS || '120', '--manual-timeout', process.env.PG_MANUAL_TIMEOUT_SECONDS || '900'], { env });

  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    log(`Backed up existing data/listing.json to ${BACKUP_FILE}.`);
  }

  const port = await findFreePort(DEFAULT_PORT);
  env.PORT = String(port);

  log('Building local production server...');
  await run('npm', ['run', 'build'], { env });

  log(`Starting local production server on port ${port}...`);
  startServer(port, env);
  await waitForServer(`http://127.0.0.1:${port}/api/listings?sortBy=newest`);
  log('Local server is ready.');

  try {
    log('Scraping PropertyGuru...');
    await scrape(port);

    log('Validating data/listing.json...');
    validateListingJson();
  } catch (error) {
    restoreBackup();
    throw error;
  } finally {
    await stopServer();
  }

  log('Running final checks...');
  await run('npm', ['run', 'lint'], { env });
  await run('npm', ['run', 'build:static'], { env: { ...env, NEXT_PUBLIC_STATIC_SITE: 'true' } });

  if (!(await gitHasDataChanges())) {
    log('No data changes to commit. Production data is already up to date.');
    return;
  }

  log('Committing updated listing data...');
  await run('git', ['add', 'data/listing.json']);
  await run('git', ['commit', '-m', `data: refresh PropertyGuru listings ${todayForCommit()}`]);

  log('Pushing to GitHub. Vercel should redeploy automatically after this push...');
  await run('git', ['push', 'origin', 'main']);

  log('Done. Production URL: https://ntu-rental.vercel.app');
}

main().catch(async error => {
  await stopServer();
  console.error(`\nERROR: ${error.message || error}`);
  console.error(`Logs are in: ${TMP_ROOT}`);
  process.exit(1);
});
