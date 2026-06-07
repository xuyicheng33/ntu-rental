# NTU Rental Finder

Next.js app for browsing rental listings around NTU.

## Run

```bash
npm install
SCRAPER_PROXY=http://127.0.0.1:7897 npm run dev -- -p 3003
```

Open `http://localhost:3003`.

## Listing Sources

The app supports three scrape modes from the UI:

- `Auto`: try PropertyGuru first, then fall back to Hozuko if PropertyGuru is blocked.
- `PropertyGuru`: only use PropertyGuru.
- `Hozuko`: only use Hozuko.

Scraped listings are saved to `data/listing.json`. If a source returns zero listings or is blocked, the scraper does not overwrite existing data.

## PropertyGuru Session

PropertyGuru is protected by Cloudflare. A normal HTTP request, and even a Playwright browser through Clash, can still receive `403` with `cf-mitigated: challenge`.

From the app, click `Update Data`. If PropertyGuru is blocked by Cloudflare, the progress dialog shows `Open PropertyGuru verification`. Click it, finish verification in the Chrome window, then update again.

You can also create a reusable local browser session from the terminal:

```bash
SCRAPER_PROXY=http://127.0.0.1:7897 npm run propertyguru:session
```

A Chrome window will open with the requested listing and a matching rental search. Complete the Cloudflare check and any login or consent prompts. When the actual PropertyGuru listing or search page is visible, return to the terminal and press Enter.

The app button uses an auto-save mode, so after clicking `Open PropertyGuru verification` you only need to finish Cloudflare in Chrome. The local process saves the session as soon as it detects the real PropertyGuru page.

If successful, the script saves the persistent profile plus a storage-state snapshot:

```text
data/propertyguru-profile/
data/propertyguru-storage-state.json
```

The PropertyGuru scraper uses `data/propertyguru-profile/` when it exists, otherwise it falls back to `data/propertyguru-storage-state.json`. Both are ignored by git because they may contain cookies.

The session tool only reports success after the same browser mode used by the scraper can reload PropertyGuru without Cloudflare. Seeing the real page in the manual Chrome window is not enough by itself; if the follow-up scraper check still receives Cloudflare, the session is treated as failed.

If PropertyGuru is still on the Cloudflare challenge page, the browser stays open and the script asks you to try again. Type `q` only if you want to quit without saving a session.

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
