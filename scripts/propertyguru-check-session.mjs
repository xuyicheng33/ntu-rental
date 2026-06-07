import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const DEFAULT_URL = 'https://www.propertyguru.com.sg/listing/hdb-for-rent-653c-jurong-west-street-61-500141804';
const LOCAL_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function isBlocked(title, bodyText, status) {
  return status === 403 || /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure/i.test(`${title}\n${bodyText}`);
}

function hasListingSignals(title, bodyText) {
  return /S\$\s*[\d,]+|HDB|Condo|For Rent|bed(?:s|rooms?)?\b|bath(?:s|rooms?)?\b|Property Details|Overview/i.test(`${title}\n${bodyText}`);
}

async function inspectContext(context, targetUrl, mode) {
  const page = context.pages()[0] || await context.newPage();
  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const status = response?.status() || 0;
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

  if (isBlocked(title, bodyText, status)) {
    console.error(JSON.stringify({ ok: false, mode, status, title, reason: 'Cloudflare challenge still active' }, null, 2));
    return 3;
  }

  const ok = hasListingSignals(title, bodyText);
  console.log(JSON.stringify({
    ok,
    mode,
    status,
    title,
    url: page.url(),
    bodySample: bodyText.slice(0, 300),
  }, null, 2));
  return ok ? 0 : 4;
}

async function main() {
  const hasProfile = fs.existsSync(PROFILE_DIR);
  const hasStorageState = fs.existsSync(STORAGE_STATE);

  if (!hasProfile && !hasStorageState) {
    console.error(`No saved PropertyGuru profile found at ${PROFILE_DIR}`);
    console.error(`No saved PropertyGuru storage state found at ${STORAGE_STATE}`);
    console.error('Run: SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:session');
    process.exit(2);
  }

  const proxy = process.env.SCRAPER_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
  const targetUrl = process.argv[2] || DEFAULT_URL;
  const executablePath = fs.existsSync(LOCAL_CHROME_PATH) ? LOCAL_CHROME_PATH : undefined;

  if (hasProfile) {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.SCRAPER_HEADLESS === 'false' ? false : true,
      executablePath,
      proxy: proxy ? { server: proxy } : undefined,
      locale: 'en-SG',
      viewport: { width: 1365, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    let exitCode = 1;
    try {
      exitCode = await inspectContext(context, targetUrl, 'persistent-profile');
    } finally {
      await context.close();
    }
    process.exit(exitCode);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    proxy: proxy ? { server: proxy } : undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      storageState: STORAGE_STATE,
      locale: 'en-SG',
      viewport: { width: 1365, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    });
    const exitCode = await inspectContext(context, targetUrl, 'storage-state');
    process.exit(exitCode);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
