import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Listing } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { execFile } from 'child_process';

const DATA_DIR = path.join(process.cwd(), 'data');
const LISTINGS_FILE = path.join(DATA_DIR, 'listing.json');
const PROPERTYGURU_STORAGE_STATE = path.join(DATA_DIR, 'propertyguru-storage-state.json');
const PROPERTYGURU_PROFILE_DIR = path.join(DATA_DIR, 'propertyguru-profile');
const CHROME_USER_AGENT = process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

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

const HOZUKO_BASE_SEARCH_URLS = [
  'https://www.hozuko.com/for-rent/properties/in-singapore',
  'https://www.hozuko.com/for-rent/hdb/in-singapore',
  'https://www.hozuko.com/for-rent/condos/in-singapore',
  'https://www.hozuko.com/for-rent/rooms/in-singapore',
  'https://www.hozuko.com/for-rent/2-bedroom/in-singapore',
];
const HOZUKO_NTU_LOCATION_SLUGS = [
  'boon-lay',
  'bukit-batok',
  'bukit-panjang',
  'choa-chu-kang',
  'clementi',
  'jurong-east',
  'jurong-west',
  'pioneer',
  'tengah',
];
const HOZUKO_SEARCH_URLS = [
  ...HOZUKO_BASE_SEARCH_URLS,
  ...HOZUKO_NTU_LOCATION_SLUGS.map(slug => `https://www.hozuko.com/for-rent/properties/in-${slug}`),
];

const DELAY_MS = 1000;
const PAGE_TIMEOUT_MS = 15000;
const FETCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const PROPERTYGURU_MANUAL_WAIT_MS = Number(process.env.PROPERTYGURU_MANUAL_WAIT_MS || 180000);
const PROPERTYGURU_MAX_PAGES_PER_SEARCH = Math.max(1, Number(process.env.PROPERTYGURU_MAX_PAGES_PER_SEARCH || 5));
const LOCAL_CLASH_PROXY = 'http://127.0.0.1:7897';
const NTU_RELATED_AREAS = new Set([
  'Jurong West',
  'Boon Lay',
  'Pioneer',
  'Clementi',
  'Bukit Batok',
  'Choa Chu Kang',
  'Bukit Panjang',
  'Tengah',
  'Jurong East',
]);
const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

export interface ScrapeProgress {
  phase: 'starting' | 'opening' | 'parsing' | 'done' | 'error';
  currentPage: number;
  totalPages: number;
  listingsFound: number;
  message: string;
  action?: 'propertyguru-session';
}

export type ScraperSource = 'auto' | 'propertyguru' | 'hozuko';
export type ProgressCallback = (progress: ScrapeProgress) => void;

interface PropertyGuruSearchPlanItem {
  url: string;
  area: string;
  page: number;
}

interface SafariPropertyGuruResult {
  blocked: boolean;
  title: string;
  url: string;
  bodySample: string;
  listings: Listing[];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('Scrape cancelled.');
  }
}

function buildPropertyGuruSearchPlan(): PropertyGuruSearchPlanItem[] {
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

      return {
        area,
        page,
        url: `https://www.propertyguru.com.sg/property-for-rent?${params.toString()}`,
      };
    });
  });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getBrowserExecutablePath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }

  return LOCAL_CHROME_PATHS.find(browserPath => fs.existsSync(browserPath));
}

function getPropertyGuruStorageState(): string | undefined {
  return fs.existsSync(PROPERTYGURU_STORAGE_STATE) ? PROPERTYGURU_STORAGE_STATE : undefined;
}

function shouldUseHeadlessForPropertyGuru(): boolean {
  if (process.env.SCRAPER_HEADLESS) {
    return process.env.SCRAPER_HEADLESS !== 'false';
  }

  return true;
}

function shouldUseSafariForPropertyGuru(): boolean {
  if (process.env.PROPERTYGURU_BROWSER) {
    return process.env.PROPERTYGURU_BROWSER.toLowerCase() === 'safari';
  }

  return process.platform === 'darwin' && process.env.PROPERTYGURU_VERIFICATION_BROWSER !== 'chrome';
}

function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
}

function runAppleScript(script: string, timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function readPropertyGuruWithSafari(url: string): Promise<SafariPropertyGuruResult> {
  const extractor = `
(() => {
  const bodyText = document.body?.innerText || '';
  const blocked = /Cloudflare|Just a moment|正在进行安全验证|Enable JavaScript and cookies|Checking if the site connection is secure/i.test(document.title + '\\n' + bodyText);
  const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
  const linesFor = element => (element.innerText || element.textContent || '').split(/\\n/).map(normalize).filter(Boolean);
  const badTitle = /^(Contact|Save|Share|Listed on|Ready to Move|Everyone Welcome|Map View|Filters?)$/i;
  const cards = Array.from(document.querySelectorAll('[da-listing-id], .listing-card-v2'));
  const seen = new Set();
  const listings = [];

  for (const card of cards) {
    const link = Array.from(card.querySelectorAll('a[href*="/listing/"]')).find(anchor => anchor.href);
    const href = link ? new URL(link.getAttribute('href'), location.href).href : '';
    const id = card.getAttribute('da-listing-id') || href.match(/(\\d{6,})/)?.[1] || href.match(/listing\\/([^/?#]+)/)?.[1] || '';
    if (!id || !href || seen.has(id)) continue;
    seen.add(id);

    const text = normalize(card.innerText || card.textContent || '');
    const lines = linesFor(card);
    const priceMatch = text.match(/S\\$\\s*([\\d,]+)\\s*\\/mo/i);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;
    if (!price) continue;

    const priceIndex = lines.findIndex(line => /S\\$\\s*[\\d,]+\\s*\\/mo/i.test(line));
    const isGoodTitle = value => value && !badTitle.test(value) && !/^\\d+$/.test(value) && !/^S\\$/i.test(value) && !/psf$/i.test(value);
    const afterPrice = lines.slice(Math.max(0, priceIndex + 1)).filter(line => !/^S\\$/i.test(line) && !/psf$/i.test(line));
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
        img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\\s+/)[0],
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
      const value = card.querySelector(\`[da-id="\${daId}"]\`)?.textContent?.trim().replace(/,/g, '') || '';
      const match = value.match(/\\d+/);
      return match ? Number(match[0]) : 0;
    };
    const featureBedrooms = readFeatureNumber('listing-card-v2-bedrooms');
    const featureBathrooms = readFeatureNumber('listing-card-v2-bathrooms');
    const bedMatch = combined.match(/(\\d+)\\s*(?:beds?|bedrooms?|BR)\\b/i);
    const bathMatch = combined.match(/(\\d+)\\s*(?:baths?|bathrooms?|BA)\\b/i);
    const floorSizeMatch = combined.match(/([\\d,]+)\\s*(?:sqft|sq\\s*ft|sqf)\\b/i);
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

  return JSON.stringify({
    blocked,
    title: document.title,
    url: location.href,
    bodySample: bodyText.replace(/\\s+/g, ' ').slice(0, 240),
    listings,
  });
})()
`;

  const script = `
set targetUrl to "${escapeAppleScriptString(url)}"
set jsCode to "${escapeAppleScriptString(extractor)}"
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document with properties {URL:targetUrl}
    set targetTab to current tab of window 1
  else
    set targetTab to current tab of window 1
    set URL of targetTab to targetUrl
  end if
  repeat 30 times
    delay 1
    try
      set state to do JavaScript "document.readyState" in targetTab
      if state is "complete" then exit repeat
    end try
  end repeat
  repeat 10 times
    try
      do JavaScript "window.scrollBy(0, Math.max(700, Math.floor(window.innerHeight * 0.85)))" in targetTab
    end try
    delay 0.25
  end repeat
  try
    do JavaScript "window.scrollTo(0, 0)" in targetTab
  end try
  delay 1
  return do JavaScript jsCode in targetTab
end tell
`;

  try {
    return JSON.parse(await runAppleScript(script, 45000)) as SafariPropertyGuruResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Allow JavaScript from Apple Events|not authorized|not allowed|未获授权|Apple 事件/i.test(message)) {
      throw new Error('PropertyGuru Safari access is not enabled. In Safari, enable Develop > Allow JavaScript from Apple Events, finish Cloudflare, then retry PropertyGuru.');
    }

    throw error;
  }
}

function canConnect(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
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

async function getProxyServer(): Promise<string | undefined> {
  if (process.env.SCRAPER_PROXY) return process.env.SCRAPER_PROXY;
  if (await canConnect('127.0.0.1', 7897)) return LOCAL_CLASH_PROXY;

  return (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy
  );
}

export function getLastUpdated(): string | null {
  try {
    if (fs.existsSync(LISTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf-8'));
      return data.lastUpdated || null;
    }
  } catch {}
  return null;
}

export function readListings(): Listing[] {
  try {
    if (fs.existsSync(LISTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf-8'));
      return Array.isArray(data.listings) ? data.listings : [];
    }
  } catch {}
  return [];
}

function writeListings(listings: Listing[]) {
  if (listings.length === 0) {
    throw new Error('Scraper found no listings; existing data was left unchanged.');
  }

  ensureDataDir();

  // Backup existing file before overwrite
  if (fs.existsSync(LISTINGS_FILE)) {
    try {
      const backupFile = LISTINGS_FILE + '.bak';
      fs.copyFileSync(LISTINGS_FILE, backupFile);
    } catch (error) {
      console.warn('Failed to backup listing.json:', error);
    }
  }

  const data = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    count: listings.length,
    listings,
  };
  fs.writeFileSync(LISTINGS_FILE, JSON.stringify(data, null, 2));
}

function determineArea(address: string): string {
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

function determinePropertyType(title: string, url: string): Listing['propertyType'] {
  const t = (title + ' ' + url).toLowerCase();
  const titleLower = title.toLowerCase();
  if (/\b(common|master)\s+room\b/.test(titleLower) || /\broom\s+for\s+rent\b/.test(titleLower)) return 'Room';
  if (t.includes('hdb')) return 'HDB';
  if (t.includes('condo') || t.includes('apartment') || t.includes('condominium')) return 'Condo';
  if (t.includes('landed') || t.includes('terrace') || t.includes('bungalow')) return 'Landed';
  return 'HDB';
}

async function parseListingsFromPage(page: Page): Promise<Listing[]> {
  return page.evaluate(() => {
    const listings: Listing[] = [];
    const links = document.querySelectorAll('a[href*="/listing/"]');
    const seen = new Set<string>();

    links.forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      const match = href.match(/listing\/(.+?)(?:\?|$)/);
      if (!match || seen.has(match[1])) return;
      seen.add(match[1]);

      const card = link.closest('div[class*="card"], div[class*="listing"], article, li') || link;
      const text = card.textContent || '';

      const priceMatch = text.match(/S?\$[\s]*(\d[\d,]*)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;

      const bedMatch = text.match(/(\d+)\s*(?:bed|bedroom|room)/i);
      const bedrooms = bedMatch ? parseInt(bedMatch[1]) : 0;

      const bathMatch = text.match(/(\d+)\s*(?:bath|bathroom)/i);
      const bathrooms = bathMatch ? parseInt(bathMatch[1]) : 0;

      const sizeMatch = text.match(/(\d+)\s*(?:sqft|sq\s*ft|sqf)/i);
      const floorSize = sizeMatch ? parseInt(sizeMatch[1]) : 0;

      const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
      const title = titleEl?.textContent?.trim() || '';

      const addrEl = card.querySelector('[class*="address"], [class*="Address"], [class*="location"]');
      const address = addrEl?.textContent?.trim() || '';

      const imgEl = card.querySelector('img');
      const imageUrl = imgEl?.src || '';

      if (price > 0 && title) {
        listings.push({
          id: match[1],
          source: 'PropertyGuru',
          title,
          price,
          bedrooms,
          bathrooms,
          floorSize,
          address: address || title,
          area: '',
          propertyType: 'HDB',
          url: href,
          imageUrl,
          nearestMrt: '',
          postedDate: '',
          agentName: '',
        });
      }
    });

    return listings;
  });
}

async function parsePropertyGuruDetailPage(page: Page): Promise<Listing[]> {
  return page.evaluate(() => {
    const text = document.body?.textContent || '';
    const url = window.location.href;
    const id = url.match(/listing\/([^/?#]+)/)?.[1] || url;
    const meta = (name: string) =>
      document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim() || '';

    const jsonLdNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const jsonLdObjects = jsonLdNodes.flatMap(node => {
      try {
        const parsed = JSON.parse(node.textContent || 'null');
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    });

    const jsonText = JSON.stringify(jsonLdObjects);
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      meta('og:title') ||
      document.title.replace(/\s*\|\s*PropertyGuru.*$/i, '').trim();

    const priceSource = `${text}\n${jsonText}\n${meta('og:description')}`;
    const priceMatch = priceSource.match(/S?\$\s*([\d,]+)\s*(?:\/mo|per month|monthly)?/i);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

    const bedroomsMatch = priceSource.match(/(\d+)\s*(?:beds?|bedrooms?|BR)\b/i);
    const bathroomsMatch = priceSource.match(/(\d+)\s*(?:baths?|bathrooms?|BA)\b/i);
    const floorSizeMatch = priceSource.match(/([\d,]+)\s*(?:sqft|sq\s*ft|sqf)\b/i);

    const possibleAddress =
      document.querySelector('[data-testid*="address" i], [class*="address" i], [class*="location" i]')?.textContent?.trim() ||
      meta('og:street-address') ||
      meta('place:location:latitude') && meta('og:description') ||
      title;

    if (!title || !price || !url.includes('/listing/')) return [];

    return [{
      id,
      source: 'PropertyGuru',
      title,
      price,
      bedrooms: bedroomsMatch ? parseInt(bedroomsMatch[1], 10) : 0,
      bathrooms: bathroomsMatch ? parseInt(bathroomsMatch[1], 10) : 0,
      floorSize: floorSizeMatch ? parseInt(floorSizeMatch[1].replace(/,/g, ''), 10) : 0,
      address: possibleAddress || title,
      area: '',
      propertyType: 'HDB',
      url,
      imageUrl: meta('og:image'),
      nearestMrt: '',
      postedDate: '',
      agentName: '',
    }];
  });
}

function parseNextData(html: string): Listing[] {
  const listings: Listing[] = [];

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const props = nextData?.props?.pageProps;
      const searchResults = props?.searchResult?.listings
        || props?.listings
        || props?.initialState?.searchResult?.listings
        || [];

      for (const item of searchResults) {
        const listing: Listing = {
          id: String(item.id || item.listingId || ''),
          source: 'PropertyGuru',
          title: item.title || item.name || '',
          price: item.price || item.rent || 0,
          bedrooms: item.bedrooms || item.bed || 0,
          bathrooms: item.bathrooms || item.bath || 0,
          floorSize: item.floorSize || item.floor_area_sqm || item.size || 0,
          address: item.address || item.street || item.location || '',
          area: '',
          propertyType: 'HDB',
          url: item.url || item.link || `https://www.propertyguru.com.sg/listing/${item.id}`,
          imageUrl: item.imageUrl || item.image || item.photo || '',
          nearestMrt: item.nearestMrt || item.mrt || '',
          postedDate: item.postedDate || item.date || '',
          agentName: item.agentName || item.agent || '',
        };

        if (listing.id && listing.price > 0) {
          listings.push(listing);
        }
      }
    } catch {}
  }

  return listings;
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
  }
}

function readJsonStringValue(html: string, startIndex: number, escapedDelimiter: boolean): { value: string; endIndex: number } | null {
  let raw = '';

  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];

    if (char === '\\') {
      const next = html[i + 1];
      if (escapedDelimiter && next === '"') {
        return { value: decodeJsonString(raw), endIndex: i + 2 };
      }

      raw += char;
      if (next !== undefined) {
        raw += next;
        i++;
      }
      continue;
    }

    if (!escapedDelimiter && char === '"') {
      return { value: decodeJsonString(raw), endIndex: i + 1 };
    }

    raw += char;
  }

  return null;
}

function findMarkerWithin(html: string, marker: string, fromIndex: number, maxDistance: number): number {
  const index = html.indexOf(marker, fromIndex);
  return index >= 0 && index - fromIndex <= maxDistance ? index : -1;
}

function extractHozukoShareData(html: string): Array<{ shareTitle: string; shareText: string; shareUrl: string }> {
  const data: Array<{ shareTitle: string; shareText: string; shareUrl: string }> = [];
  const markers = [
    {
      title: 'shareTitle\\":\\"',
      text: 'shareText\\":\\"',
      url: 'shareUrl\\":\\"',
      escapedDelimiter: true,
    },
    {
      title: '"shareTitle":"',
      text: '"shareText":"',
      url: '"shareUrl":"',
      escapedDelimiter: false,
    },
  ];

  for (const markerSet of markers) {
    let searchIndex = 0;

    while (searchIndex < html.length) {
      const titleIndex = html.indexOf(markerSet.title, searchIndex);
      if (titleIndex < 0) break;

      const title = readJsonStringValue(html, titleIndex + markerSet.title.length, markerSet.escapedDelimiter);
      if (!title) break;

      const textIndex = findMarkerWithin(html, markerSet.text, title.endIndex, 1200);
      if (textIndex < 0) {
        searchIndex = title.endIndex;
        continue;
      }

      const text = readJsonStringValue(html, textIndex + markerSet.text.length, markerSet.escapedDelimiter);
      if (!text) {
        searchIndex = title.endIndex;
        continue;
      }

      const urlIndex = findMarkerWithin(html, markerSet.url, text.endIndex, 1200);
      if (urlIndex < 0) {
        searchIndex = text.endIndex;
        continue;
      }

      const url = readJsonStringValue(html, urlIndex + markerSet.url.length, markerSet.escapedDelimiter);
      if (!url) {
        searchIndex = text.endIndex;
        continue;
      }

      data.push({
        shareTitle: title.value,
        shareText: text.value,
        shareUrl: url.value,
      });
      searchIndex = url.endIndex;
    }
  }

  return data;
}

function parseHozukoListings(html: string): Listing[] {
  const listings: Listing[] = [];
  const seenIds = new Set<string>();

  for (const { shareTitle, shareText, shareUrl } of extractHozukoShareData(html)) {
    const id = shareUrl.split('/').pop() || shareTitle;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const titleParts = shareTitle.split(' · ').map(part => part.trim());
    const title = titleParts[0] || shareTitle;
    const address = titleParts[1] || title;
    const priceMatch = shareTitle.match(/S\$\s*([\d,]+)\s*\/mo/i);
    const bedMatch = shareText.match(/(\d+)\s*beds?/i) || shareTitle.match(/(\d+)-bedroom/i);
    const bathMatch = shareText.match(/(\d+)\s*baths?/i);
    const areaFromTitle = title.match(/for Rent in ([^·]+)/i)?.[1]?.trim();
    const propertyType = determinePropertyType(title, shareUrl);
    const area = determineArea(`${areaFromTitle || ''} ${address}`);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

    if (!shareUrl || !price || !title) continue;

    listings.push({
      id,
      source: 'Hozuko',
      title,
      price,
      bedrooms: bedMatch ? parseInt(bedMatch[1], 10) : propertyType === 'Room' ? 1 : 0,
      bathrooms: bathMatch ? parseInt(bathMatch[1], 10) : 0,
      floorSize: 0,
      address,
      area: area === 'Other' && areaFromTitle ? areaFromTitle : area,
      propertyType,
      url: shareUrl,
      imageUrl: '',
      nearestMrt: '',
      postedDate: new Date().toISOString(),
      agentName: '',
    });
  }

  return listings;
}

function normalizeHozukoImageUrl(url: string): string {
  return url
    .replace(/\\\//g, '/')
    .replace(/\/thumbnail(?=($|[?#]))/, '/public');
}

function findMetaContent(html: string, names: string[]): string {
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propertyFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${escapedName}["'][^>]+content=["']([^"']+)["']`, 'i');
    const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedName}["']`, 'i');
    const match = html.match(propertyFirst) || html.match(contentFirst);
    if (match?.[1]) return normalizeHozukoImageUrl(match[1]);
  }

  return '';
}

function parseHozukoDetailImage(html: string): string {
  const metaImage = findMetaContent(html, ['og:image', 'twitter:image']);
  if (metaImage) return metaImage;

  const firstImage = html.match(/https:\/\/imagedelivery\.net\/[^\s"'<>]+\/(?:public|thumbnail)/i)?.[0] || '';
  return firstImage ? normalizeHozukoImageUrl(firstImage) : '';
}

async function enrichHozukoListingImages(listings: Listing[], signal?: AbortSignal): Promise<void> {
  const concurrency = 8;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < listings.length) {
      throwIfAborted(signal);
      const listing = listings[nextIndex++];

      try {
        const html = await fetchText(listing.url, signal);
        const imageUrl = parseHozukoDetailImage(html);
        if (imageUrl) listing.imageUrl = imageUrl;
      } catch (error) {
        console.warn(`Failed to fetch Hozuko detail image for ${listing.url}:`, error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, listings.length) }, () => worker()));
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': CHROME_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-SG,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        },
      });

      if (!response.ok) {
        const mitigated = response.headers.get('cf-mitigated');
        throw new Error(`${response.status} ${response.statusText}${mitigated ? ` (${mitigated})` : ''}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (signal?.aborted) throw lastError;

      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`fetchText attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${lastError.message}. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function mergeListing(target: Listing[], seenIds: Set<string>, listing: Listing) {
  const key = listing.url || listing.id;
  if (seenIds.has(key)) return;
  seenIds.add(key);
  target.push(listing);
}

async function scrapeHozukoListings(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<Listing[]> {
  const allListings: Listing[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < HOZUKO_SEARCH_URLS.length; i++) {
    throwIfAborted(signal);
    const url = HOZUKO_SEARCH_URLS[i];
    onProgress?.({
      phase: 'opening',
      currentPage: i + 1,
      totalPages: HOZUKO_SEARCH_URLS.length,
      listingsFound: allListings.length,
      message: `Opening Hozuko page ${i + 1}...`,
    });

    const html = await fetchText(url, signal);
    throwIfAborted(signal);
    const listings = parseHozukoListings(html);

    onProgress?.({
      phase: 'parsing',
      currentPage: i + 1,
      totalPages: HOZUKO_SEARCH_URLS.length,
      listingsFound: allListings.length,
      message: `Parsing Hozuko page ${i + 1}...`,
    });

    for (const listing of listings) {
      mergeListing(allListings, seenIds, listing);
    }
  }

  const ntuListings = allListings.filter(listing => NTU_RELATED_AREAS.has(listing.area));
  const selectedListings = ntuListings.length >= 5 ? ntuListings : allListings;

  onProgress?.({
    phase: 'parsing',
    currentPage: HOZUKO_SEARCH_URLS.length,
    totalPages: HOZUKO_SEARCH_URLS.length,
    listingsFound: selectedListings.length,
    message: `Fetching verified Hozuko listing images...`,
  });
  await enrichHozukoListingImages(selectedListings, signal);

  return selectedListings;
}

async function createPropertyGuruContext(proxyServer: string | undefined): Promise<{ context: BrowserContext; browser: Browser | null; usesPersistentProfile: boolean; isHeadless: boolean }> {
  const hasPersistentProfile = fs.existsSync(PROPERTYGURU_PROFILE_DIR);
  const isHeadless = shouldUseHeadlessForPropertyGuru();
  const contextOptions = {
    userAgent: CHROME_USER_AGENT,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
  };
  const launchOptions = {
    headless: isHeadless,
    executablePath: getBrowserExecutablePath(),
    proxy: proxyServer ? { server: proxyServer } : undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (hasPersistentProfile) {
    const context = await chromium.launchPersistentContext(PROPERTYGURU_PROFILE_DIR, {
      ...launchOptions,
      ...contextOptions,
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
    });
    return { context, browser: null, usesPersistentProfile: true, isHeadless };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    ...contextOptions,
    storageState: getPropertyGuruStorageState(),
  });
  return { context, browser, usesPersistentProfile: false, isHeadless };
}

function isPropertyGuruSessionError(message: string): boolean {
  return /PropertyGuru|Cloudflare|propertyguru:session/i.test(message);
}

function isPropertyGuruBlocked(status: number, headers: Record<string, string>, html: string): boolean {
  return status === 403 ||
    Boolean(headers['cf-mitigated']) ||
    html.includes('cf-mitigated') ||
    html.includes('Just a moment') ||
    html.includes('Performing security verification') ||
    html.includes('安全验证');
}

async function waitForManualPropertyGuruVerification(page: Page, signal?: AbortSignal): Promise<string | null> {
  const deadline = Date.now() + PROPERTYGURU_MANUAL_WAIT_MS;

  await page.bringToFront().catch(() => {});
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await delay(3000);

    const html = await page.content().catch(() => '');
    const title = await page.title().catch(() => '');
    if (html && !isPropertyGuruBlocked(0, {}, `${title}\n${html}`)) {
      return html;
    }
  }

  return null;
}

async function scrapePropertyGuruListingsWithSafari(searchPlan: PropertyGuruSearchPlanItem[], onProgress?: ProgressCallback, signal?: AbortSignal): Promise<Listing[]> {
  const allListings: Listing[] = [];
  const seenIds = new Set<string>();
  const stoppedAreas = new Set<string>();

  for (let i = 0; i < searchPlan.length; i++) {
    throwIfAborted(signal);
    const item = searchPlan[i];
    if (stoppedAreas.has(item.area)) continue;

    onProgress?.({
      phase: 'opening',
      currentPage: i + 1,
      totalPages: searchPlan.length,
      listingsFound: allListings.length,
      message: `Opening PropertyGuru ${item.area} page ${item.page} in Safari...`,
    });

    const beforeCount = seenIds.size;
    const result = await readPropertyGuruWithSafari(item.url);
    if (result.blocked) {
      if (allListings.length > 0) {
        onProgress?.({
          phase: 'parsing',
          currentPage: i + 1,
          totalPages: searchPlan.length,
          listingsFound: allListings.length,
          message: `PropertyGuru asked for Cloudflare again after ${allListings.length} listings; saving collected Safari results...`,
        });
        break;
      }

      throw new Error(`PropertyGuru Safari tab is still blocked by Cloudflare (${result.title || result.bodySample}). Open PropertyGuru verification in Safari, finish Cloudflare there, then retry PropertyGuru.`);
    }

    onProgress?.({
      phase: 'parsing',
      currentPage: i + 1,
      totalPages: searchPlan.length,
      listingsFound: allListings.length,
      message: `Parsing PropertyGuru ${item.area} page ${item.page} from Safari...`,
    });

    for (const listing of result.listings) {
      listing.source = 'PropertyGuru';
      const detectedArea = determineArea(`${listing.address} ${listing.title}`);
      listing.area = detectedArea === 'Other' ? item.area : detectedArea;
      listing.propertyType = determinePropertyType(listing.title, listing.url);
      mergeListing(allListings, seenIds, listing);
    }

    const newCount = seenIds.size - beforeCount;
    if (result.listings.length === 0 || (item.page > 1 && newCount === 0)) {
      stoppedAreas.add(item.area);
    }
  }

  return allListings;
}

async function scrapePropertyGuruListings(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<Listing[]> {
  const searchPlan = buildPropertyGuruSearchPlan();
  if (shouldUseSafariForPropertyGuru()) {
    return scrapePropertyGuruListingsWithSafari(searchPlan, onProgress, signal);
  }

  const proxyServer = await getProxyServer();
  const storageState = getPropertyGuruStorageState();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const allListings: Listing[] = [];
  const seenIds = new Set<string>();
  let usesPersistentProfile = false;
  let isHeadless = true;

  try {
    const created = await createPropertyGuruContext(proxyServer);
    browser = created.browser;
    context = created.context;
    usesPersistentProfile = created.usesPersistentProfile;
    isHeadless = created.isHeadless;

    const page = await context.newPage();

    for (let i = 0; i < searchPlan.length; i++) {
      throwIfAborted(signal);
      const { url, area, page: searchPage } = searchPlan[i];
      onProgress?.({
        phase: 'opening',
        currentPage: i + 1,
        totalPages: searchPlan.length,
        listingsFound: allListings.length,
        message: `Opening PropertyGuru ${area} page ${searchPage}${proxyServer ? ` via ${proxyServer}` : ''}${usesPersistentProfile ? ` with saved browser profile${isHeadless ? '' : ' in visible Chrome'}` : storageState ? ' with saved session' : ''}...`,
      });

      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      await delay(DELAY_MS);
      throwIfAborted(signal);

      const status = response?.status() || 0;
      const headers = response?.headers() || {};
      let html = await page.content();

      if (isPropertyGuruBlocked(status, headers, html)) {
        if (!isHeadless && usesPersistentProfile && process.env.PROPERTYGURU_VERIFICATION_BROWSER === 'chrome') {
          onProgress?.({
            phase: 'opening',
            currentPage: i + 1,
            totalPages: searchPlan.length,
            listingsFound: allListings.length,
            message: `PropertyGuru is asking for Cloudflare verification. Finish it in the visible Chrome window; scraper will continue automatically...`,
          });

          const verifiedHtml = await waitForManualPropertyGuruVerification(page, signal);
          if (verifiedHtml) {
            html = verifiedHtml;
          } else {
            throw new Error(`PropertyGuru manual verification timed out after ${Math.round(PROPERTYGURU_MANUAL_WAIT_MS / 1000)} seconds.`);
          }
        } else {
          throw new Error(`PropertyGuru blocked by Cloudflare challenge${proxyServer ? ` even via ${proxyServer}` : ''}. Open PropertyGuru verification in your default browser, finish Cloudflare there, then retry PropertyGuru.`);
        }
      }

      onProgress?.({
        phase: 'parsing',
        currentPage: i + 1,
        totalPages: searchPlan.length,
        listingsFound: allListings.length,
        message: `Parsing PropertyGuru ${area} page ${searchPage}...`,
      });

      const listings = parseNextData(html);
      const detailListings = listings.length > 0 ? [] : await parsePropertyGuruDetailPage(page);
      const fallbackListings = listings.length > 0
        ? listings
        : detailListings.length > 0
          ? detailListings
          : await parseListingsFromPage(page);

      for (const listing of fallbackListings) {
        listing.source = 'PropertyGuru';
        const detectedArea = determineArea(`${listing.address} ${listing.title}`);
        listing.area = detectedArea === 'Other' ? area : detectedArea;
        listing.propertyType = determinePropertyType(listing.title, listing.url);
        mergeListing(allListings, seenIds, listing);
      }
    }
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }

  return allListings;
}

export async function scrapeListings(
  onProgress?: ProgressCallback,
  source: ScraperSource = 'auto',
  signal?: AbortSignal,
): Promise<{ count: number; listings: Listing[]; source: string }> {
  const emit = (progress: ScrapeProgress) => {
    onProgress?.(progress);
  };

  const sourceOrder: Exclude<ScraperSource, 'auto'>[] = source === 'auto' ? ['propertyguru', 'hozuko'] : [source];
  const totalPages = sourceOrder.reduce((total, item) => {
    return total + (item === 'propertyguru' ? buildPropertyGuruSearchPlan().length : HOZUKO_SEARCH_URLS.length);
  }, 0);

  emit({ phase: 'starting', currentPage: 0, totalPages, listingsFound: 0, message: `Starting scraper (${source})...` });

  let allListings: Listing[] = [];
  let successfulSource = '';
  const sourceErrors: string[] = [];
  let pageOffset = 0;
  let needsPropertyGuruSession = false;

  for (const sourceName of sourceOrder) {
    const sourcePageCount = sourceName === 'propertyguru' ? buildPropertyGuruSearchPlan().length : HOZUKO_SEARCH_URLS.length;
    const emitSourceProgress: ProgressCallback = (progress) => {
      emit({
        ...progress,
        currentPage: Math.min(totalPages, pageOffset + progress.currentPage),
        totalPages,
      });
    };

    try {
      throwIfAborted(signal);
      const listings = sourceName === 'propertyguru'
        ? await scrapePropertyGuruListings(emitSourceProgress, signal)
        : await scrapeHozukoListings(emitSourceProgress, signal);

      if (listings.length === 0) {
        throw new Error(`${sourceName} returned 0 listings`);
      }

      allListings = listings;
      successfulSource = sourceName;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceErrors.push(`${sourceName}: ${message}`);
      if (sourceName === 'propertyguru' && isPropertyGuruSessionError(message)) {
        needsPropertyGuruSession = true;
        if (source === 'auto') {
          emit({
            phase: 'opening',
            currentPage: Math.min(totalPages, pageOffset + sourcePageCount),
            totalPages,
            listingsFound: allListings.length,
            message: `${message} Falling back to Hozuko.`,
            action: 'propertyguru-session',
          });
        }
      }
      console.error(`Failed to scrape ${sourceName}:`, error);
    }

    pageOffset += sourcePageCount;
  }

  try {
    writeListings(allListings);
    emit({
      phase: 'done',
      currentPage: totalPages,
      totalPages,
      listingsFound: allListings.length,
      message: `Done! ${allListings.length} listings saved from ${successfulSource}${sourceErrors.length ? ` (${sourceErrors.join('; ')})` : ''}`,
      action: needsPropertyGuruSession ? 'propertyguru-session' : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save listings';
    const normalizedMessage = message.replace(/\.+$/, '');
    const details = sourceErrors.length ? `${normalizedMessage}. Sources tried: ${sourceErrors.join('; ')}` : message;
    emit({
      phase: 'error',
      currentPage: totalPages,
      totalPages,
      listingsFound: allListings.length,
      message: details,
      action: needsPropertyGuruSession ? 'propertyguru-session' : undefined,
    });
    throw new Error(details);
  }

  return { count: allListings.length, listings: allListings, source: successfulSource };
}
