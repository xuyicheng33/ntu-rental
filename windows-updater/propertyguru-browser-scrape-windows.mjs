#!/usr/bin/env node
/**
 * Windows direct PropertyGuru scraper.
 *
 * Important: this script verifies and scrapes in the SAME visible persistent
 * browser context. This mirrors the macOS Safari flow and avoids losing the
 * browser trust state by closing the verified browser and launching a new one.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LISTINGS_FILE = path.join(DATA_DIR, 'listing.json');
const STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const USER_AGENT = process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PROPERTYGURU_MAX_PAGES_PER_SEARCH = Math.max(1, Number(process.env.PROPERTYGURU_MAX_PAGES_PER_SEARCH || 5));
const AUTO_TIMEOUT_MS = Math.max(10, Number(process.env.PG_AUTO_TIMEOUT_SECONDS || 120)) * 1000;
const MANUAL_TIMEOUT_MS = Math.max(30, Number(process.env.PG_MANUAL_TIMEOUT_SECONDS || 900)) * 1000;
const CHECK_INTERVAL_MS = 2500;
const PAGE_COOLDOWN_MS = Math.max(0, Number(process.env.PG_PAGE_COOLDOWN_MS || 8000));
const CHALLENGE_COOLDOWN_MS = Math.max(0, Number(process.env.PG_CHALLENGE_COOLDOWN_MS || 15000));

const PROPERTYGURU_SEARCH_AREAS = [
  'Jurong West',
  'Boon Lay',
  'Pioneer',
  'Tengah',
  'Jurong East',
  'Clementi',
  'Bukit Batok',
  'Choa Chu Kang',
  'Bukit Panjang',
];

function log(message) {
  console.log(`[windows-propertyguru-scrape] ${message}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(baseMs, ratio = 0.35) {
  const spread = Math.round(baseMs * ratio);
  return Math.max(0, baseMs - spread + Math.floor(Math.random() * (spread * 2 + 1)));
}

function buildSearchPlan() {
  return PROPERTYGURU_SEARCH_AREAS.flatMap(area => {
    return Array.from({ length: PROPERTYGURU_MAX_PAGES_PER_SEARCH }, (_, index) => {
      const page = index + 1;
      const params = new URLSearchParams({
        freetext: area,
        listingType: 'rent',
        isCommercial: 'false',
        sort: 'date_desc',
        maxPrice: '3500',
      });
      if (page > 1) params.set('page', String(page));
      return { area, page, url: `https://www.propertyguru.com.sg/property-for-rent?${params.toString()}` };
    });
  });
}

function detectSystemChromiumBrowser() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }

  const env = process.env;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    }
  } else {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
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

function cleanProfileLocks() {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const file = path.join(PROFILE_DIR, name);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

function isBlocked(title, bodyText, status = 0) {
  return status === 403 || /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure|Verify you are human|cf-turnstile|challenge-platform/i.test(`${title}\n${bodyText}`);
}

function hasPropertyGuruSignals(url, title, bodyText, cardCount = 0) {
  if (!/propertyguru\.com\.sg/i.test(url)) return false;
  if (cardCount > 0) return true;
  return /S\$\s*[\d,]+|HDB|Condo|For Rent|Property Details|Overview|bed(?:s|rooms?)?\b|bath(?:s|rooms?)?\b|property-for-rent|listing/i.test(`${title}\n${bodyText}`);
}

async function inspectPage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
  const cardCount = await page.locator('[da-listing-id], .listing-card-v2, a[href*="/listing/"]').count().catch(() => 0);
  return {
    title,
    url: page.url(),
    blocked: isBlocked(title, bodyText, 0),
    hasSignals: hasPropertyGuruSignals(page.url(), title, bodyText, cardCount),
    cardCount,
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
    await page.waitForTimeout(150).catch(() => {});
  }
  await page.mouse.wheel(0, 360).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  await page.mouse.wheel(0, -160).catch(() => {});
}

async function tryClickVerification(page) {
  await humanLikeActivity(page);
  const selectors = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    'label:has-text("Verify")',
    'text=/verify you are human/i',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(2500).catch(() => {});
      return true;
    }
  }

  for (const frame of page.frames()) {
    if (!/turnstile|cloudflare|challenge/i.test(frame.url())) continue;
    const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
    if (await checkbox.count().catch(() => 0)) {
      await checkbox.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      return true;
    }
    const frameElement = await frame.frameElement().catch(() => null);
    const box = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
    if (box) {
      const x = box.x + Math.min(42, box.width / 2);
      const y = box.y + Math.min(38, box.height / 2);
      await page.mouse.move(x, y, { steps: 10 }).catch(() => {});
      await page.mouse.click(x, y).catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      return true;
    }
  }
  return false;
}

async function ensureVerifiedAtUrl(page, url, label) {
  if (PAGE_COOLDOWN_MS > 0) {
    const waitMs = jitter(PAGE_COOLDOWN_MS);
    log(`Cooling down ${Math.round(waitMs / 1000)}s before ${label}...`);
    await delay(waitMs);
  }

  log(`Opening ${label}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => {
    log(`Navigation warning for ${label}: ${error.message}`);
  });

  let lastInspection = null;
  const autoDeadline = Date.now() + AUTO_TIMEOUT_MS;
  while (Date.now() < autoDeadline) {
    lastInspection = await inspectPage(page);
    if (!lastInspection.blocked && lastInspection.hasSignals) return lastInspection;
    await tryClickVerification(page);
    const remaining = Math.max(0, Math.round((autoDeadline - Date.now()) / 1000));
    console.log(JSON.stringify({ waiting: true, phase: 'auto', label, remaining, title: lastInspection.title, blocked: lastInspection.blocked, cards: lastInspection.cardCount, url: lastInspection.url }));
    await page.waitForTimeout(CHECK_INTERVAL_MS);
  }

  if (CHALLENGE_COOLDOWN_MS > 0) {
    const waitMs = jitter(CHALLENGE_COOLDOWN_MS, 0.2);
    log(`Challenge detected for ${label}. Cooling down ${Math.round(waitMs / 1000)}s before manual fallback...`);
    await delay(waitMs);
    lastInspection = await inspectPage(page);
    if (!lastInspection.blocked && lastInspection.hasSignals) return lastInspection;
  }

  log(`Manual fallback for ${label}. Complete verification in THIS visible browser window; scraping will continue in the same tab.`);
  const manualDeadline = Date.now() + MANUAL_TIMEOUT_MS;
  while (Date.now() < manualDeadline) {
    lastInspection = await inspectPage(page);
    if (!lastInspection.blocked && lastInspection.hasSignals) return lastInspection;
    const remaining = Math.max(0, Math.round((manualDeadline - Date.now()) / 1000));
    console.log(JSON.stringify({ waiting: true, phase: 'manual', label, remaining, title: lastInspection.title, blocked: lastInspection.blocked, cards: lastInspection.cardCount, url: lastInspection.url }));
    await page.waitForTimeout(CHECK_INTERVAL_MS);
  }

  throw new Error(`Timed out before PropertyGuru verification completed for ${label}.`);
}

async function scrollSearchPage(page) {
  const steps = 5 + Math.floor(Math.random() * 5);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 280 + Math.floor(Math.random() * 380)).catch(() => {});
    await page.waitForTimeout(650 + Math.floor(Math.random() * 850)).catch(() => {});
  }
  await page.waitForTimeout(1800 + Math.floor(Math.random() * 2200)).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(1200 + Math.floor(Math.random() * 1600)).catch(() => {});
}

async function extractListingsFromCurrentPage(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const blocked = /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure|Verify you are human/i.test(document.title + '\n' + bodyText);
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const linesFor = element => (element.innerText || element.textContent || '').split(/\n/).map(normalize).filter(Boolean);
    const badTitle = /^(Contact|Save|Share|Listed on|Ready to Move|Everyone Welcome|Map View|Filters?)$/i;
    const cards = Array.from(document.querySelectorAll('[da-listing-id], .listing-card-v2'));
    const seen = new Set();
    const listings = [];

    for (const card of cards) {
      const link = Array.from(card.querySelectorAll('a[href*="/listing/"]')).find(anchor => anchor.href);
      const href = link ? new URL(link.getAttribute('href'), location.href).href : '';
      const id = card.getAttribute('da-listing-id') || href.match(/(\d{6,})/)?.[1] || href.match(/listing\/([^/?#]+)/)?.[1] || '';
      if (!id || !href || seen.has(id)) continue;
      seen.add(id);

      const text = normalize(card.innerText || card.textContent || '');
      const lines = linesFor(card);
      const priceMatch = text.match(/S\$\s*([\d,]+)\s*\/mo/i);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;
      if (!price) continue;

      const priceIndex = lines.findIndex(line => /S\$\s*[\d,]+\s*\/mo/i.test(line));
      const isGoodTitle = value => value && !badTitle.test(value) && !/^\d+$/.test(value) && !/^S\$/i.test(value) && !/psf$/i.test(value);
      const afterPrice = lines.slice(Math.max(0, priceIndex + 1)).filter(line => !/^S\$/i.test(line) && !/psf$/i.test(line));
      let title = priceIndex > 0 && isGoodTitle(lines[priceIndex - 1]) ? lines[priceIndex - 1] : '';
      if (!title) title = afterPrice.find(isGoodTitle) || card.getAttribute('title') || link?.getAttribute('aria-label') || '';

      const propertyName = afterPrice.find(isGoodTitle) || '';
      const propertyNameIndex = propertyName ? lines.indexOf(propertyName) : -1;
      const addressLine = propertyNameIndex >= 0 ? lines.slice(propertyNameIndex + 1).find(isGoodTitle) || '' : '';
      const address = normalize([propertyName, addressLine].filter(Boolean).join(', ')) || title;

      const imageCandidates = Array.from(card.querySelectorAll('img')).flatMap(img => {
        const values = [
          img.currentSrc,
          img.getAttribute('src'),
          img.getAttribute('data-src'),
          img.getAttribute('data-lazy-src'),
          img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0],
        ];
        return values.filter(Boolean).map(value => new URL(value, location.href).href);
      });
      const imageUrl = imageCandidates.find(candidate =>
        candidate.includes('/listing/') &&
        candidate.includes(id) &&
        !/fallback|avatar|agent/i.test(candidate)
      ) || '';
      if (!imageUrl) continue;

      const imageAlt = Array.from(card.querySelectorAll('img')).map(img => img.getAttribute('alt') || '').join(' ');
      const combined = text + ' ' + imageAlt;
      const readFeatureNumber = daId => {
        const value = card.querySelector(`[da-id="${daId}"]`)?.textContent?.trim().replace(/,/g, '') || '';
        const match = value.match(/\d+/);
        return match ? Number(match[0]) : 0;
      };
      const featureBedrooms = readFeatureNumber('listing-card-v2-bedrooms');
      const featureBathrooms = readFeatureNumber('listing-card-v2-bathrooms');
      const bedMatch = combined.match(/(\d+)\s*(?:beds?|bedrooms?|BR)\b/i);
      const bathMatch = combined.match(/(\d+)\s*(?:baths?|bathrooms?|BA)\b/i);
      const floorSizeMatch = combined.match(/([\d,]+)\s*(?:sqft|sq\s*ft|sqf)\b/i);
      const listedLine = lines.find(line => /^Listed on/i.test(line)) || '';
      const agentName = card.querySelector('[da-id*="agent-name" i], [class*="agent-name" i]')?.textContent?.trim() || '';

      listings.push({
        id,
        source: 'PropertyGuru',
        title: normalize(title),
        price,
        bedrooms: featureBedrooms || (bedMatch ? Number(bedMatch[1]) : /common room|master room|room rental/i.test(combined) ? 1 : 0),
        bathrooms: featureBathrooms || (bathMatch ? Number(bathMatch[1]) : 0),
        floorSize: floorSizeMatch ? Number(floorSizeMatch[1].replace(/,/g, '')) : 0,
        address,
        area: '',
        propertyType: 'HDB',
        url: href,
        imageUrl,
        nearestMrt: lines.find(line => /MRT Station/i.test(line)) || '',
        postedDate: listedLine,
        agentName,
      });
    }

    return { blocked, title: document.title, url: location.href, count: listings.length, listings };
  });
}

function determineArea(address) {
  const addr = address.toLowerCase();
  if (addr.includes('jurong west') || addr.includes('jalan bahar')) return 'Jurong West';
  if (addr.includes('boon lay')) return 'Boon Lay';
  if (addr.includes('pioneer')) return 'Pioneer';
  if (addr.includes('clementi')) return 'Clementi';
  if (addr.includes('bukit batok')) return 'Bukit Batok';
  if (addr.includes('choa chu kang') || addr.includes('cck')) return 'Choa Chu Kang';
  if (addr.includes('bukit panjang') || addr.includes('bp')) return 'Bukit Panjang';
  if (addr.includes('tengah')) return 'Tengah';
  if (addr.includes('jurong east')) return 'Jurong East';
  return 'Other';
}

function determinePropertyType(title, url) {
  const t = `${title} ${url}`.toLowerCase();
  const titleLower = title.toLowerCase();
  if (/\b(common|master)\s+room\b/.test(titleLower) || /\broom\s+for\s+rent\b/.test(titleLower)) return 'Room';
  if (t.includes('hdb')) return 'HDB';
  if (t.includes('condo') || t.includes('apartment') || t.includes('condominium')) return 'Condo';
  if (t.includes('landed') || t.includes('terrace') || t.includes('bungalow')) return 'Landed';
  return 'HDB';
}

function mergeListing(target, seenIds, listing) {
  const key = listing.url || listing.id;
  if (seenIds.has(key)) return false;
  seenIds.add(key);
  target.push(listing);
  return true;
}

function writeListings(listings) {
  if (listings.length === 0) throw new Error('Direct Windows scraper found no listings.');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(LISTINGS_FILE)) fs.copyFileSync(LISTINGS_FILE, `${LISTINGS_FILE}.bak`);
  fs.writeFileSync(LISTINGS_FILE, JSON.stringify({
    version: 1,
    lastUpdated: new Date().toISOString(),
    count: listings.length,
    listings,
  }, null, 2));
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  cleanProfileLocks();

  const proxy = await detectProxy();
  const executablePath = detectSystemChromiumBrowser();
  log(`Project: ${PROJECT_ROOT}`);
  log(`Profile: ${PROFILE_DIR}`);
  log(`Browser: ${executablePath || 'Playwright bundled Chromium'}`);
  log(`Proxy: ${proxy || 'none'}`);

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
    const searchPlan = buildSearchPlan();
    log(`Search plan: ${searchPlan.length} pages, ${PROPERTYGURU_MAX_PAGES_PER_SEARCH} page(s) per area. Set PROPERTYGURU_MAX_PAGES_PER_SEARCH to change this.`);
    log(`Pacing: PG_PAGE_COOLDOWN_MS=${PAGE_COOLDOWN_MS}, PG_CHALLENGE_COOLDOWN_MS=${CHALLENGE_COOLDOWN_MS}.`);
    const allListings = [];
    const seenIds = new Set();
    const stoppedAreas = new Set();

    for (let i = 0; i < searchPlan.length; i++) {
      const item = searchPlan[i];
      if (stoppedAreas.has(item.area)) continue;
      const beforeCount = seenIds.size;
      await ensureVerifiedAtUrl(page, item.url, `${item.area} page ${item.page} (${i + 1}/${searchPlan.length})`);
      await scrollSearchPage(page);
      const result = await extractListingsFromCurrentPage(page);

      if (result.blocked) {
        log(`Challenge appeared while extracting ${item.area} page ${item.page}; staying in the same browser tab for verification.`);
        await ensureVerifiedAtUrl(page, item.url, `${item.area} page ${item.page} reverify`);
        await scrollSearchPage(page);
      }

      const finalResult = result.blocked ? await extractListingsFromCurrentPage(page) : result;
      log(`Parsed ${finalResult.count} listings from ${item.area} page ${item.page}; total before merge: ${allListings.length}`);

      for (const listing of finalResult.listings) {
        listing.source = 'PropertyGuru';
        const detectedArea = determineArea(`${listing.address} ${listing.title}`);
        listing.area = detectedArea === 'Other' ? item.area : detectedArea;
        listing.propertyType = determinePropertyType(listing.title, listing.url);
        mergeListing(allListings, seenIds, listing);
      }

      const newCount = seenIds.size - beforeCount;
      log(`Total unique listings: ${allListings.length}; new on this page: ${newCount}`);
      if (finalResult.listings.length === 0 || (item.page > 1 && newCount === 0)) {
        stoppedAreas.add(item.area);
      }
    }

    await context.storageState({ path: STORAGE_STATE }).catch(() => {});
    writeListings(allListings);
    log(`Done. Saved ${allListings.length} PropertyGuru listings to ${LISTINGS_FILE}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`[windows-propertyguru-scrape] ERROR: ${error.message || error}`);
  process.exit(1);
});
