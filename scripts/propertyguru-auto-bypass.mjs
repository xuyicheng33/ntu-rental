#!/usr/bin/env node
/**
 * PropertyGuru Cloudflare bypass script.
 *
 * Opens Chrome with a persistent profile, navigates to PropertyGuru,
 * and waits for the Cloudflare challenge to be resolved by the browser
 * or by manual user action. Once the real page loads, saves the
 * browser session for the headless scraper to reuse.
 *
 * Usage:
 *   node scripts/propertyguru-auto-bypass.mjs [--proxy URL] [--timeout SECONDS] [--manual-timeout SECONDS]
 *
 * --proxy            Proxy server URL (default: auto-detect Clash at 127.0.0.1:7897)
 * --timeout          Seconds to wait for auto-bypass (default: 30)
 * --manual-timeout   Seconds to wait for manual verification after auto-bypass fails (default: 300)
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const LOCAL_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DEFAULT_URL = 'https://www.propertyguru.com.sg/listing/hdb-for-rent-653c-jurong-west-street-61-500141804';

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const AUTO_TIMEOUT_MS = (parseInt(getArg('--timeout'), 10) || 30) * 1000;
const MANUAL_TIMEOUT_MS = (parseInt(getArg('--manual-timeout'), 10) || 300) * 1000;
const CHECK_INTERVAL_MS = 3000;

// Auto-detect proxy
async function detectProxy() {
  const explicit = getArg('--proxy');
  if (explicit) return explicit;
  if (process.env.SCRAPER_PROXY) return process.env.SCRAPER_PROXY;
  if (process.env.HTTPS_PROXY) return process.env.HTTPS_PROXY;
  const ok = await new Promise(resolve => {
    const s = net.createConnection({ host: '127.0.0.1', port: 7897 });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
  return ok ? 'http://127.0.0.1:7897' : undefined;
}

function isBlocked(title, bodyText, status) {
  return status === 403 ||
    /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure/i.test(`${title}\n${bodyText}`);
}

function hasPropertyGuruContent(bodyText) {
  return /S\$\s*[\d,]+|bed\s*\d|bath\s*\d|HDB|Condo|For Rent|Jurong|PropertyGuru|listing/i.test(bodyText);
}

async function checkPage(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const blocked = isBlocked(title, bodyText, 0);
  const hasContent = hasPropertyGuruContent(bodyText);
  return { title, bodyText, blocked, hasContent, passed: !blocked && hasContent };
}

async function main() {
  const proxy = await detectProxy();
  const executablePath = fs.existsSync(LOCAL_CHROME_PATH) ? LOCAL_CHROME_PATH : undefined;

  console.log('=== PropertyGuru Cloudflare Bypass ===');
  console.log(`Profile: ${PROFILE_DIR}`);
  console.log(`Proxy: ${proxy || 'none (direct connection)'}`);
  console.log(`Auto-bypass timeout: ${Math.round(AUTO_TIMEOUT_MS / 1000)}s`);
  console.log(`Manual timeout: ${Math.round(MANUAL_TIMEOUT_MS / 1000)}s`);
  console.log('');

  // Clean stale lock files from crashed runs
  for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(PROFILE_DIR, lock);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath,
    ...(proxy ? { proxy: { server: proxy } } : {}),
    viewport: { width: 1365, height: 900 },
    locale: 'en-SG',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate',
      '--disable-session-crashed-bubble',
      '--disable-translate',
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete window.__playwright;
      delete window.__pw_manual;
    });

    const page = context.pages()[0] || await context.newPage();

    console.log('[bypass] Navigating to PropertyGuru...');
    await page.goto(DEFAULT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(err => {
      console.error(`[bypass] Navigation error: ${err.message}`);
    });

    // Phase 1: Try auto-bypass (wait for CF to resolve with saved cookies)
    console.log(`[bypass] Phase 1: Waiting ${Math.round(AUTO_TIMEOUT_MS / 1000)}s for auto-bypass...`);
    const phase1Deadline = Date.now() + AUTO_TIMEOUT_MS;
    let passed = false;

    while (Date.now() < phase1Deadline) {
      const result = await checkPage(page);
      if (result.passed) {
        passed = true;
        break;
      }
      const remaining = Math.round((phase1Deadline - Date.now()) / 1000);
      process.stdout.write(`\r[bypass] Waiting... ${remaining}s remaining `);
      await page.waitForTimeout(CHECK_INTERVAL_MS);
    }
    if (!passed) console.log('');

    // Phase 2: Manual mode — keep polling, tell user to complete in browser
    if (!passed) {
      console.log(`\n[bypass] Phase 2: Auto-bypass did not work.`);
      console.log('[bypass] ┌──────────────────────────────────────────────────┐');
      console.log('[bypass] │  Please complete the Cloudflare check in Chrome  │');
      console.log('[bypass] │  The script will detect it automatically.        │');
      console.log('[bypass] └──────────────────────────────────────────────────┘');
      console.log(`[bypass] Waiting up to ${Math.round(MANUAL_TIMEOUT_MS / 1000)}s...\n`);

      const phase2Deadline = Date.now() + MANUAL_TIMEOUT_MS;

      while (Date.now() < phase2Deadline) {
        // Check all PropertyGuru tabs
        for (const p of context.pages()) {
          const url = p.url();
          if (!url.includes('propertyguru.com.sg')) continue;
          const result = await checkPage(p);
          if (result.passed) {
            passed = true;
            console.log(`\n[bypass] Verified on: ${url}`);
            break;
          }
        }
        if (passed) break;

        const remaining = Math.round((phase2Deadline - Date.now()) / 1000);
        process.stdout.write(`\r[bypass] Waiting for manual verification... ${remaining}s `);
        await page.waitForTimeout(CHECK_INTERVAL_MS);
      }
      if (!passed) console.log('');
    }

    if (passed) {
      // Double-check by reloading
      console.log('[bypass] Reloading to confirm...');
      for (const p of context.pages()) {
        if (!p.url().includes('propertyguru.com.sg')) continue;
        await p.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await p.waitForTimeout(3000);
      }

      // Verify at least one page is clean
      let anyPassed = false;
      for (const p of context.pages()) {
        const result = await checkPage(p);
        if (result.passed) {
          anyPassed = true;
          console.log(`[bypass] Confirmed: "${result.title}"`);
          break;
        }
      }

      if (anyPassed) {
        await context.storageState({ path: STORAGE_STATE });
        console.log(`\n[bypass] SUCCESS! Session saved to ${STORAGE_STATE}`);
        console.log('[bypass] You can now run the scraper with PropertyGuru data.');
      } else {
        console.log('\n[bypass] Verification lost after reload. Try again.');
      }
    } else {
      console.log('\n[bypass] Timed out. No session saved.');
      console.log('[bypass] Tip: Try increasing --manual-timeout or check your proxy.');
    }
  } finally {
    await context.close();
  }
}

main().catch(error => {
  console.error('[bypass] Fatal error:', error.message || error);
  process.exit(1);
});
