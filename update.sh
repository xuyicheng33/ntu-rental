#!/usr/bin/env bash
set -Eeuo pipefail

# NTU Rental Finder - one-click PropertyGuru refresh and Vercel deploy.
#
# Finder users: double-click Update-PropertyGuru.command.
# Terminal users: ./update.sh
#
# Why this uses build/start instead of next dev:
# long PropertyGuru + Safari scraping can exhaust the Next dev/Turbopack
# process. A local production server is slower to start but much steadier.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3003}"
MIN_LISTINGS="${MIN_LISTINGS:-100}"
PROJECT_NAME="${VERCEL_PROJECT_NAME:-ntu-rental}"
SCRAPE_SOURCE="propertyguru"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$SCRIPT_DIR/tmp/update-$RUN_ID"
SERVER_LOG="$TMP_DIR/next-start.log"
SCRAPE_LOG="$TMP_DIR/propertyguru-scrape.log"
BACKUP_FILE="$TMP_DIR/listing-before-update.json"
SERVER_PID=""

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "Stopping local Next server..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

wait_for_server() {
  local url="$1"
  local attempts="${2:-60}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

json_count() {
  node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log((d.listings||[]).length)" "$1"
}

summarize_json() {
  node - <<'NODE'
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/listing.json', 'utf8'));
const listings = d.listings || [];
const sources = [...new Set(listings.map(item => item.source))];
const areas = Object.entries(listings.reduce((memo, item) => {
  memo[item.area] = (memo[item.area] || 0) + 1;
  return memo;
}, {})).sort((a, b) => b[1] - a[1]);

console.log(JSON.stringify({
  count: listings.length,
  lastUpdated: d.lastUpdated,
  sources,
  topAreas: areas.slice(0, 10),
}, null, 2));
NODE
}

validate_listing_json() {
  node - "$MIN_LISTINGS" <<'NODE'
const fs = require('fs');
const minListings = Number(process.argv[2] || 100);
const d = JSON.parse(fs.readFileSync('data/listing.json', 'utf8'));
const listings = d.listings || [];
const missing = listings.filter(item => !item.id || !item.title || !item.price || !item.url || !item.imageUrl);
const nonPg = listings.filter(item => item.source !== 'PropertyGuru');
const urls = new Set();
let duplicateUrls = 0;

for (const item of listings) {
  if (urls.has(item.url)) duplicateUrls += 1;
  urls.add(item.url);
}

const result = {
  count: listings.length,
  minListings,
  lastUpdated: d.lastUpdated,
  sources: [...new Set(listings.map(item => item.source))],
  duplicateUrls,
  missingRequired: missing.length,
};

console.log(JSON.stringify(result, null, 2));

if (listings.length < minListings) {
  console.error(`Listing count ${listings.length} is below MIN_LISTINGS=${minListings}.`);
  process.exit(2);
}
if (nonPg.length > 0) {
  console.error(`Expected PropertyGuru-only data, found ${nonPg.length} non-PropertyGuru listings.`);
  process.exit(3);
}
if (missing.length > 0 || duplicateUrls > 0) {
  console.error('Listing data failed quality checks.');
  process.exit(4);
}
NODE
}

restore_backup() {
  if [[ -f "$BACKUP_FILE" ]]; then
    cp "$BACKUP_FILE" data/listing.json
    log "Restored data/listing.json from backup."
  fi
}

mkdir -p "$TMP_DIR"

log "Preflight checks..."
require_command git
require_command node
require_command npm
require_command curl

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  printf '\nWorking tree is not clean. Continue anyway and only manage data/listing.json? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "Stopped to avoid mixing this update with existing local changes." ;;
  esac
fi

log "Syncing latest main..."
git fetch origin main
git pull --ff-only

if [[ -f data/listing.json ]]; then
  cp data/listing.json "$BACKUP_FILE"
  log "Backed up current data to $BACKUP_FILE ($(json_count "$BACKUP_FILE") listings)."
fi

if nc -z 127.0.0.1 7897 >/dev/null 2>&1; then
  export SCRAPER_PROXY="${SCRAPER_PROXY:-http://127.0.0.1:7897}"
  log "Proxy detected: $SCRAPER_PROXY"
else
  log "No proxy detected at 127.0.0.1:7897. Continuing without SCRAPER_PROXY."
fi

if [[ "${NODE_OPTIONS:-}" != *max-old-space-size* ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Close that process or run with PORT=3004 ./update.sh."
fi

log "Building local production server for scraping..."
rm -rf .next
npm run build

log "Starting local production server on port $PORT..."
npm run start -- -p "$PORT" >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

if ! wait_for_server "http://127.0.0.1:$PORT/api/listings?sortBy=newest" 60; then
  tail -80 "$SERVER_LOG" || true
  fail "Local Next server did not become ready."
fi
log "Local server is ready."

log "Opening one fresh PropertyGuru verification page..."
PROPERTYGURU_VERIFICATION_BROWSER=default node scripts/propertyguru-session.mjs --auto-save

cat <<EOF

PropertyGuru verification is now open in your browser.
1. Finish the Cloudflare / human verification if it appears.
2. Make sure a real PropertyGuru listing or search page is visible.
3. Come back to this Terminal window and press Enter.

EOF
read -r _

log "Scraping PropertyGuru..."
set +e
curl -sS -N -X POST "http://127.0.0.1:$PORT/api/scrape?source=$SCRAPE_SOURCE" | tee "$SCRAPE_LOG"
scrape_status=${PIPESTATUS[0]}
set -e

if [[ "$scrape_status" -ne 0 ]] || ! grep -q '"phase":"done"' "$SCRAPE_LOG"; then
  restore_backup
  tail -80 "$SERVER_LOG" || true
  fail "PropertyGuru scrape did not finish cleanly. See $SCRAPE_LOG"
fi

log "Validating scraped data..."
if ! validate_listing_json; then
  restore_backup
  fail "Scraped data failed validation; restored previous data."
fi

log "Scrape summary:"
summarize_json

cleanup
SERVER_PID=""

log "Running final checks..."
npm run lint
npm run build:static

if git diff --quiet -- data/listing.json; then
  log "No data changes to commit. Deployment is already up to date."
  exit 0
fi

log "Committing data/listing.json..."
git add data/listing.json
git commit -m "data: refresh PropertyGuru listings $(date +%Y-%m-%d)"

log "Pushing to GitHub..."
git push origin main

if command -v vercel >/dev/null 2>&1; then
  log "Waiting briefly for Vercel deployment to appear..."
  sleep 8
  vercel ls "$PROJECT_NAME" --yes | head -30 || true
else
  log "Vercel CLI not found; GitHub push should still trigger Vercel deployment."
fi

log "Done. Production URL: https://ntu-rental.vercel.app"
