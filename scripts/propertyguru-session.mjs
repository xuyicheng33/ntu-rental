import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const DEFAULT_URL = 'https://www.propertyguru.com.sg/listing/hdb-for-rent-653c-jurong-west-street-61-500141804';
const DEFAULT_SEARCH_URL = 'https://www.propertyguru.com.sg/property-for-rent?market=residential&district_code%5B%5D=WD22&district_code%5B%5D=WD24&district_code%5B%5D=WD23&property_type%5B%5D=1&property_type%5B%5D=2&property_type%5B%5D=3&bedrooms%5B%5D=2&maxprice=3500&sort=date_desc';
const LOCAL_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_VERIFICATION_BROWSER = process.env.PROPERTYGURU_VERIFICATION_BROWSER || 'default';
const CHROME_USER_AGENT = process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const POLL_INTERVAL_MS = 3000;
const AUTO_SAVE_TIMEOUT_MS = 10 * 60 * 1000;

function ask(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function openUrlInDefaultBrowser(url) {
  if (process.platform === 'darwin') {
    await runCommand('open', [url]);
    return;
  }

  if (process.platform === 'win32') {
    await runCommand('cmd', ['/c', 'start', '', url]);
    return;
  }

  await runCommand('xdg-open', [url]);
}

function isBlocked(title, bodyText, status = 0) {
  return status === 403 || /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure/i.test(`${title}\n${bodyText}`);
}

function hasPropertyGuruSignals(url, title, bodyText) {
  if (!/propertyguru\.com\.sg/i.test(url)) return false;

  const visibleContent = `${title}\n${bodyText}`;
  return /S\$\s*[\d,]+|HDB|Condo|For Rent|bed(?:s|rooms?)?\b|bath(?:s|rooms?)?\b|Property Details|Overview/i.test(visibleContent);
}

function createContextOptions(proxy, executablePath, headless) {
  return {
    headless,
    executablePath,
    proxy: proxy ? { server: proxy } : undefined,
    viewport: { width: 1365, height: 900 },
    locale: 'en-SG',
    userAgent: CHROME_USER_AGENT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate',
      '--disable-session-crashed-bubble',
      '--disable-translate',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  };
}

function bringChromeToFront() {
  if (process.platform !== 'darwin') return;

  const script = `
tell application "Google Chrome"
  activate
  repeat with w in windows
    if (title of w contains "PropertyGuru") or (title of w contains "Just a moment") then
      set index of w to 1
      set bounds of w to {40, 40, 1400, 900}
      exit repeat
    end if
  end repeat
end tell
`;

  execFile('osascript', ['-e', script], error => {
    if (error) {
      console.error(`Could not focus Chrome verification window: ${error.message}`);
    }
  });
}

async function inspectPage(page, options = {}) {
  const response = options.reload
    ? await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null)
    : null;
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const status = response?.status() || 0;
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

  return {
    status,
    title,
    url: page.url(),
    blocked: isBlocked(title, bodyText, status),
    hasSignals: hasPropertyGuruSignals(page.url(), title, bodyText),
    bodySample: bodyText.replace(/\s+/g, ' ').slice(0, 180),
  };
}

async function verifySavedSession(proxy, executablePath, targetUrl) {
  const headless = process.env.SCRAPER_HEADLESS === 'true';
  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    createContextOptions(proxy, executablePath, headless),
  );

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    return await inspectPage(page);
  } finally {
    await context.close();
  }
}

async function saveAndVerifySession(context, proxy, executablePath, usableUrl) {
  await context.storageState({ path: STORAGE_STATE });
  await context.close();

  const verified = await verifySavedSession(proxy, executablePath, usableUrl);
  if (!verified.blocked && verified.hasSignals) {
    console.log(`Saved browser storage state to ${STORAGE_STATE}`);
    console.log(`Verified page: ${verified.url}`);
    return { ok: true, storageState: STORAGE_STATE, verifiedUrl: verified.url };
  }

  console.error('PropertyGuru was visible in the manual browser, but scraper verification still failed.');
  console.error(JSON.stringify(verified, null, 2));
  return {
    ok: false,
    error: 'PropertyGuru session was not saved: scraper verification still hits Cloudflare.',
  };
}

async function openPropertyGuruSession(options = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const browserMode = options.browserMode || DEFAULT_VERIFICATION_BROWSER;
  if (browserMode !== 'chrome') {
    const targetUrl = options.targetUrl || DEFAULT_URL;
    console.log('Opening PropertyGuru verification in the system default browser.');
    console.log(`Browser mode: ${browserMode}`);
    console.log(`URL: ${targetUrl}`);
    console.log('');
    await openUrlInDefaultBrowser(targetUrl);
    if (targetUrl === DEFAULT_URL) {
      await openUrlInDefaultBrowser(DEFAULT_SEARCH_URL);
    }
    console.log('Opened PropertyGuru verification in default browser.');
    console.log('Finish Cloudflare in that browser window.');
    console.log('Note: default-browser verification does not create Playwright storage state.');

    if (options.interactive ?? true) {
      await ask('\nPress Enter after PropertyGuru is visible in your default browser...');
    }

    return {
      ok: true,
      opened: true,
      browserMode,
      message: 'PropertyGuru verification opened in the system default browser.',
    };
  }

  const proxy = process.env.SCRAPER_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
  const targetUrl = options.targetUrl || DEFAULT_URL;
  const executablePath = fs.existsSync(LOCAL_CHROME_PATH) ? LOCAL_CHROME_PATH : undefined;
  const interactive = options.interactive ?? true;

  console.log('Opening PropertyGuru in a persistent Chrome profile.');
  console.log(`URL: ${targetUrl}`);
  console.log(`Proxy: ${proxy || 'none'}`);
  console.log(`Profile: ${PROFILE_DIR}`);
  console.log('');
  console.log('In the browser window, finish the Cloudflare check and any login/consent prompts.');
  console.log('Two tabs will open: the requested listing and a matching rental search. Use either tab to finish verification.');
  console.log('When the actual PropertyGuru listing/search page is visible, return here and press Enter.');

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    createContextOptions(proxy, executablePath, false),
  );

  const page = context.pages()[0] || await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => {
    console.error(`Initial navigation failed: ${error.message}`);
  });
  bringChromeToFront();

  if (targetUrl === DEFAULT_URL) {
    const searchPage = await context.newPage();
    await searchPage.goto(DEFAULT_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => {
      console.error(`Search navigation failed: ${error.message}`);
    });
    await searchPage.bringToFront().catch(() => {});
    bringChromeToFront();
  }

  if (!interactive) {
    console.log('Auto-save mode: leave this process running. It will save the session once the real PropertyGuru page is visible.');
    const deadline = Date.now() + AUTO_SAVE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const inspections = [];
      for (const candidate of context.pages()) {
        if (candidate.url().includes('propertyguru.com.sg')) {
          inspections.push(await inspectPage(candidate));
        }
      }

      const usable = inspections.find(result => !result.blocked && result.hasSignals);
      if (usable) {
        return await saveAndVerifySession(context, proxy, executablePath, usable.url);
      }

      const latest = inspections.at(-1);
      console.log(JSON.stringify({
        ok: false,
        waiting: true,
        secondsRemaining: Math.max(0, Math.round((deadline - Date.now()) / 1000)),
        url: latest?.url || '',
        title: latest?.title || '',
        blocked: latest?.blocked ?? true,
      }));
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    await context.close();
    return { ok: false, error: 'Timed out before PropertyGuru verification finished.' };
  }

  while (true) {
    const answer = await ask('\nPress Enter after PropertyGuru is visible in the browser, or type q to quit...');
    if (answer.toLowerCase() === 'q') {
      if (fs.existsSync(STORAGE_STATE)) fs.rmSync(STORAGE_STATE, { force: true });
      await context.close();
      process.exitCode = 2;
      return;
    }

    const pages = context.pages();
    const inspections = [];
    for (const candidate of pages) {
      if (candidate.url().includes('propertyguru.com.sg')) {
        inspections.push(await inspectPage(candidate, { reload: true }));
      }
    }

    const usable = inspections.find(result => !result.blocked && result.hasSignals);
    if (usable) {
      const result = await saveAndVerifySession(context, proxy, executablePath, usable.url);
      if (result.ok) {
        console.log('PropertyGuru session looks usable. Now run: SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:check-session');
      }
      return result;
    }

    console.error('PropertyGuru is not verified yet. Browser remains open.');
    for (const result of inspections) {
      console.error(JSON.stringify(result, null, 2));
    }
    console.error('Finish the Cloudflare check until the real listing/search content is visible, then press Enter again. Type q to quit.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const autoSave = args.includes('--auto-save');
  const browserArg = args.find(arg => arg.startsWith('--browser='));
  const browserMode = browserArg?.split('=')[1] || DEFAULT_VERIFICATION_BROWSER;
  const targetUrl = args.find(arg => !arg.startsWith('--')) || DEFAULT_URL;
  const result = await openPropertyGuruSession({ targetUrl, interactive: !autoSave, browserMode });
  if (result?.ok === false) {
    console.error(result.error || 'PropertyGuru session was not saved.');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export { openPropertyGuruSession };
