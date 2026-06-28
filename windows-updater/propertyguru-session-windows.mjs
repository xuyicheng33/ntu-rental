#!/usr/bin/env node
/**
 * PropertyGuru session bootstrapper for Windows one-click updates.
 *
 * Strategy:
 * - launch a real visible Chrome/Edge/Chromium browser with a persistent profile
 * - reuse that profile across runs
 * - automatically wait, scroll, move/click common verification surfaces when present
 * - if automatic verification does not pass, keep the browser open for manual fallback
 * - save storage state once a real PropertyGuru page is visible
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const DEFAULT_URL = 'https://www.propertyguru.com.sg/property-for-rent?freetext=Jurong%20West&listingType=rent&isCommercial=false&sort=date_desc&maxPrice=3500';
const USER_AGENT = process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const eq = args.find(arg => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1];
  return fallback;
};
const AUTO_TIMEOUT_MS = Math.max(10, Number(getArg('--auto-timeout', process.env.PG_AUTO_TIMEOUT_SECONDS || 120))) * 1000;
const MANUAL_TIMEOUT_MS = Math.max(30, Number(getArg('--manual-timeout', process.env.PG_MANUAL_TIMEOUT_SECONDS || 900))) * 1000;
const CHECK_INTERVAL_MS = 2500;
const TARGET_URL = addFreshParam(getArg('--url', DEFAULT_URL));

function log(message) {
  console.log(`[propertyguru-session] ${message}`);
}

function addFreshParam(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('oneClickVerifyAt', String(Date.now()));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function pathExists(value) {
  return Boolean(value) && fs.existsSync(value);
}

function candidateBrowserPaths() {
  const env = process.env;
  const candidates = [];

  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    candidates.push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  }

  if (process.platform === 'win32') {
    const programFiles = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const base of programFiles) {
      candidates.push(
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }

  return [...new Set(candidates)].filter(pathExists);
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

async function detectProxy() {
  if (process.env.SCRAPER_PROXY) return process.env.SCRAPER_PROXY;
  if (process.env.HTTPS_PROXY) return process.env.HTTPS_PROXY;
  if (process.env.HTTP_PROXY) return process.env.HTTP_PROXY;
  if (await canConnect('127.0.0.1', 7897)) return 'http://127.0.0.1:7897';
  if (await canConnect('127.0.0.1', 7890)) return 'http://127.0.0.1:7890';
  return undefined;
}

function isBlocked(title, bodyText, status = 0) {
  return status === 403 || /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure|Verify you are human|cf-turnstile|challenge-platform/i.test(`${title}\n${bodyText}`);
}

function hasPropertyGuruSignals(url, title, bodyText) {
  if (!/propertyguru\.com\.sg/i.test(url)) return false;
  return /S\$\s*[\d,]+|HDB|Condo|For Rent|Property Details|Overview|bed(?:s|rooms?)?\b|bath(?:s|rooms?)?\b|property-for-rent|listing/i.test(`${title}\n${bodyText}`);
}

async function inspectPage(page, options = {}) {
  let response = null;
  if (options.reload) {
    response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  const status = response?.status() || 0;
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
  return {
    status,
    title,
    url: page.url(),
    blocked: isBlocked(title, bodyText, status),
    hasSignals: hasPropertyGuruSignals(page.url(), title, bodyText),
    bodySample: bodyText.replace(/\s+/g, ' ').slice(0, 240),
  };
}

async function humanLikeActivity(page) {
  const viewport = page.viewportSize() || { width: 1365, height: 900 };
  const points = [
    [Math.round(viewport.width * 0.25), Math.round(viewport.height * 0.35)],
    [Math.round(viewport.width * 0.52), Math.round(viewport.height * 0.52)],
    [Math.round(viewport.width * 0.43), Math.round(viewport.height * 0.42)],
  ];
  for (const [x, y] of points) {
    await page.mouse.move(x, y, { steps: 12 }).catch(() => {});
    await page.waitForTimeout(180).catch(() => {});
  }
  await page.mouse.wheel(0, 420).catch(() => {});
  await page.waitForTimeout(350).catch(() => {});
  await page.mouse.wheel(0, -220).catch(() => {});
}

async function tryClickVerification(page) {
  await humanLikeActivity(page);

  const pageSelectors = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    'label:has-text("Verify")',
    'text=/verify you are human/i',
  ];
  for (const selector of pageSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1500, trial: false }).catch(() => {});
      await page.waitForTimeout(2500).catch(() => {});
      return true;
    }
  }

  for (const frame of page.frames()) {
    const frameUrl = frame.url();
    if (!/turnstile|cloudflare|challenge/i.test(frameUrl)) continue;

    const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
    if (await checkbox.count().catch(() => 0)) {
      await checkbox.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      return true;
    }

    const frameElement = await frame.frameElement().catch(() => null);
    const box = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
    if (box) {
      await page.mouse.move(box.x + Math.min(42, box.width / 2), box.y + Math.min(38, box.height / 2), { steps: 10 }).catch(() => {});
      await page.mouse.click(box.x + Math.min(42, box.width / 2), box.y + Math.min(38, box.height / 2)).catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      return true;
    }
  }

  return false;
}

function cleanProfileLocks() {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const file = path.join(PROFILE_DIR, name);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

async function saveAndVerify(context, page) {
  const result = await inspectPage(page, { reload: true });
  if (result.blocked || !result.hasSignals) {
    return { ok: false, result };
  }
  await context.storageState({ path: STORAGE_STATE });
  return { ok: true, result };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  cleanProfileLocks();

  const proxy = await detectProxy();
  const executablePath = candidateBrowserPaths()[0];

  log(`Project: ${PROJECT_ROOT}`);
  log(`Profile: ${PROFILE_DIR}`);
  log(`Storage: ${STORAGE_STATE}`);
  log(`Browser: ${executablePath || 'Playwright bundled Chromium'}`);
  log(`Proxy: ${proxy || 'none'}`);
  log(`URL: ${TARGET_URL}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath,
    proxy: proxy ? { server: proxy } : undefined,
    viewport: { width: 1365, height: 900 },
    locale: 'en-SG',
    userAgent: USER_AGENT,
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
      Object.defineProperty(navigator, 'languages', { get: () => ['en-SG', 'en', 'zh-CN', 'zh'] });
      window.chrome = window.chrome || { runtime: {} };
      delete window.__playwright;
      delete window.__pw_manual;
      delete window.__PW_inspect;
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => {
      log(`Initial navigation warning: ${error.message}`);
    });

    const autoDeadline = Date.now() + AUTO_TIMEOUT_MS;
    let lastInspection = null;
    let clicked = false;
    log(`Auto phase: waiting up to ${Math.round(AUTO_TIMEOUT_MS / 1000)}s.`);

    while (Date.now() < autoDeadline) {
      lastInspection = await inspectPage(page);
      if (!lastInspection.blocked && lastInspection.hasSignals) {
        const saved = await saveAndVerify(context, page);
        if (saved.ok) {
          log(`SUCCESS: verified automatically: ${saved.result.url}`);
          return;
        }
      }

      if (!clicked || /turnstile|verify|cloudflare|challenge/i.test(`${lastInspection.title}\n${lastInspection.bodySample}`)) {
        clicked = await tryClickVerification(page) || clicked;
      }

      const remaining = Math.max(0, Math.round((autoDeadline - Date.now()) / 1000));
      console.log(JSON.stringify({ waiting: true, phase: 'auto', remaining, title: lastInspection.title, blocked: lastInspection.blocked, url: lastInspection.url }));
      await page.waitForTimeout(CHECK_INTERVAL_MS);
    }

    log('Auto phase did not finish. Manual fallback is active.');
    log('Please complete the verification in the visible browser window. The script will continue automatically after the real PropertyGuru page appears.');

    const manualDeadline = Date.now() + MANUAL_TIMEOUT_MS;
    while (Date.now() < manualDeadline) {
      for (const candidate of context.pages()) {
        if (!candidate.url().includes('propertyguru.com.sg')) continue;
        lastInspection = await inspectPage(candidate);
        if (!lastInspection.blocked && lastInspection.hasSignals) {
          const saved = await saveAndVerify(context, candidate);
          if (saved.ok) {
            log(`SUCCESS: verified with manual fallback: ${saved.result.url}`);
            return;
          }
        }
      }

      const remaining = Math.max(0, Math.round((manualDeadline - Date.now()) / 1000));
      console.log(JSON.stringify({ waiting: true, phase: 'manual', remaining, title: lastInspection?.title || '', blocked: lastInspection?.blocked ?? true, url: lastInspection?.url || '' }));
      await page.waitForTimeout(CHECK_INTERVAL_MS);
    }

    throw new Error('Timed out before PropertyGuru verification completed.');
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`[propertyguru-session] ERROR: ${error.message || error}`);
  process.exit(2);
});
