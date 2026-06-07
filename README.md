# NTU Rental Finder

Next.js app for browsing rental listings around NTU.

## Run

```bash
npm install
SCRAPER_PROXY=http://127.0.0.1:7897 npm run dev -- -p 3003
```

Open `http://localhost:3003`.

## Deploy

Vercel works well for the public site as a static snapshot. The deployed app uses the committed `data/listing.json` file, filters listings in the browser, and hides the local-only scrape controls.

```bash
npm run build:static
```

This is the build command configured in `vercel.json`, so Vercel can deploy the repo directly. Live PropertyGuru scraping still runs only on the local Mac because it depends on Safari and AppleScript; after refreshing data locally, commit the updated `data/listing.json` and redeploy.

## Listing Sources

The app supports three scrape modes from the UI:

- `Auto`: try PropertyGuru first, then fall back to Hozuko if PropertyGuru is blocked.
- `PropertyGuru`: only use PropertyGuru.
- `Hozuko`: only use Hozuko.

Scraped listings are saved to `data/listing.json`. If a source returns zero listings or is blocked, the scraper does not overwrite existing data.

Hozuko does not expose a normal `page=2` style pagination flow in the rendered HTML. The scraper therefore gathers a broader result set by scanning multiple real search entry points: broad Singapore category pages plus NTU-adjacent area pages such as Jurong West, Jurong East, Boon Lay, Pioneer, Tengah, Clementi, Bukit Batok, Bukit Panjang, and Choa Chu Kang. It then deduplicates by listing URL, filters to NTU-adjacent areas, and fetches each detail page to use that listing's own `og:image` as the card image.

## PropertyGuru Session

PropertyGuru is protected by Cloudflare. A normal HTTP request, and even a Playwright browser through Clash, can still receive `403` with `cf-mitigated: challenge`.

From the app, click `Update Data`. If PropertyGuru is blocked by Cloudflare, the progress dialog shows `Open PropertyGuru verification`. Click it to open PropertyGuru in your system default browser, such as Safari on macOS. Finish verification there, then update again.

You can also open the same verification URLs from the terminal:

```bash
SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:session
```

Your default browser will open with the requested listing and a matching rental search. Complete the Cloudflare check and any login or consent prompts. When the actual PropertyGuru listing or search page is visible, return to the terminal and press Enter.

Default-browser verification is meant to avoid launching an automated Chrome window. It does not create a Playwright storage-state file because Safari/default-browser cookies are not automatically available to Playwright Chromium.

On macOS, after Safari verification succeeds, the PropertyGuru scraper reads the verified Safari tab through AppleScript. Enable Safari `Develop > Allow JavaScript from Apple Events` first. The scraper opens NTU-adjacent `freetext` searches such as Jurong West, Boon Lay, Pioneer, Tengah, Jurong East, Clementi, Bukit Batok, Choa Chu Kang, and Bukit Panjang. It scans up to `PROPERTYGURU_MAX_PAGES_PER_SEARCH` pages per area, defaulting to `5`, and stops early for an area when later pages return no new listings.

PropertyGuru images are strict-matched: a listing is saved only when the card image URL contains that listing's PropertyGuru id. This avoids fallback SVGs, agent avatars, or images from another listing.

The older Chrome-based session mode is still available when you explicitly need a reusable Playwright profile:

```bash
PROPERTYGURU_VERIFICATION_BROWSER=chrome SCRAPER_HEADLESS=false SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:session
```

If successful, the Chrome mode saves the persistent profile plus a storage-state snapshot:

```text
data/propertyguru-profile/
data/propertyguru-storage-state.json
```

The PropertyGuru scraper uses `data/propertyguru-profile/` when it exists, otherwise it falls back to `data/propertyguru-storage-state.json`. Both are ignored by git because they may contain cookies.

The session tool only reports success after the same browser mode used by the scraper can reload PropertyGuru without Cloudflare. Seeing the real page in the manual Chrome window is not enough by itself; if the follow-up scraper check still receives Cloudflare, the session is treated as failed.

If PropertyGuru is still on the Cloudflare challenge page, the browser stays open and the script asks you to try again. Type `q` only if you want to quit without saving a session.

For local development, the PropertyGuru scraper now runs headless by default even when a saved Chrome profile exists. If you want the old visible-Chrome verification behavior, set both `SCRAPER_HEADLESS=false` and `PROPERTYGURU_VERIFICATION_BROWSER=chrome`.

Check the saved session with:

```bash
SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:check-session
```

If that command returns `ok: true`, refresh the app with source set to `PropertyGuru`, or call:

```bash
curl -N -X POST 'http://localhost:3003/api/scrape?source=propertyguru'
```

If it reports `Cloudflare challenge still active`, the saved local profile is not currently reusable by the scraper. Use `Auto` mode to fall back to Hozuko while you troubleshoot proxy/browser verification.

## Verify

```bash
npm run lint
npm run build
curl 'http://localhost:3003/api/listings?sortBy=newest'
curl -N -X POST 'http://localhost:3003/api/scrape?source=propertyguru'
```

`/api/listings` should return `isSampleData:false` when real scrape data exists.
