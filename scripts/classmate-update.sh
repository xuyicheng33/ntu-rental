#!/bin/bash
# 同学用：本地爬取数据并推送到 GitHub，Vercel 自动更新线上
# 用法: bash scripts/classmate-update.sh [--hozuko-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

PORT=3003
DEV_PID=""

cleanup() {
  [[ -n "$DEV_PID" ]] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

HOZUKO_ONLY=false
[[ "${1:-}" == "--hozuko-only" ]] && HOZUKO_ONLY=true

# 检测代理
if nc -z 127.0.0.1 7897 2>/dev/null; then
  export SCRAPER_PROXY="http://127.0.0.1:7897"
  echo "Proxy detected at 127.0.0.1:7897"
fi

echo "Starting dev server..."
SCRAPER_HEADLESS=false PROPERTYGURU_VERIFICATION_BROWSER=chrome npm run dev -- -p $PORT &
DEV_PID=$!

echo "Waiting for server..."
for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/api/listings" > /dev/null 2>&1 && break
  sleep 1
done

echo ""
echo "=== Scraping Hozuko ==="
curl -sf -N -X POST "http://localhost:$PORT/api/scrape?source=hozuko" | grep -o '"phase":"[^"]*"\|"listingsFound":[0-9]*' | tr '\n' ' '
echo ""

if [[ "$HOZUKO_ONLY" == false ]]; then
  echo ""
  echo "=== PropertyGuru: Opening browser for Cloudflare check ==="
  echo "A browser window will open. Complete the Cloudflare check, then the script continues automatically."
  node scripts/propertyguru-auto-bypass.mjs && {
    echo ""
    echo "=== Scraping PropertyGuru ==="
    curl -sf -N -X POST "http://localhost:$PORT/api/scrape?source=propertyguru" | grep -o '"phase":"[^"]*"\|"listingsFound":[0-9]*' | tr '\n' ' ' || \
      echo "PropertyGuru failed, continuing with Hozuko data only."
    echo ""
  } || echo "Cloudflare bypass failed, continuing with Hozuko data only."
fi

# 停止 dev server
kill "$DEV_PID" 2>/dev/null || true
DEV_PID=""

# 检查 data/listing.json 是否有更新
if ! git diff --quiet data/listing.json 2>/dev/null && [[ -f data/listing.json ]]; then
  COUNT=$(node -e "const d=require('./data/listing.json'); console.log(d.count || d.listings?.length || 0)")
  DATE=$(date '+%Y-%m-%d')
  echo ""
  echo "=== Pushing to GitHub ==="
  git add data/listing.json
  git commit -m "data: refresh listings ${DATE} (${COUNT} listings)"
  git push
  echo ""
  echo "Done! Vercel will rebuild automatically."
  echo "Check: https://ntu-rental.vercel.app (takes ~1 min)"
else
  echo ""
  echo "No changes to listing.json, nothing to push."
fi
