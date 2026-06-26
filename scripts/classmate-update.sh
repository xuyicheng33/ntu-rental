#!/bin/bash
# 同学用：本地爬取 PropertyGuru 数据并推送到 GitHub，Vercel 自动更新线上
# 用法: bash scripts/classmate-update.sh [--with-hozuko]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

PORT=3003
DEV_PID=""

cleanup() {
  [[ -n "$DEV_PID" ]] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

WITH_HOZUKO=false
[[ "${1:-}" == "--with-hozuko" ]] && WITH_HOZUKO=true

# 检测代理
if nc -z 127.0.0.1 7897 2>/dev/null; then
  export SCRAPER_PROXY="http://127.0.0.1:7897"
  echo "Proxy detected at 127.0.0.1:7897"
fi

echo "Starting dev server..."
SCRAPER_HEADLESS=false npm run dev -- -p $PORT &
DEV_PID=$!

echo "Waiting for server..."
for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/api/listings" > /dev/null 2>&1 && break
  sleep 1
done

echo ""
if [[ "$WITH_HOZUKO" == true ]]; then
  echo ""
  echo "=== Scraping Hozuko ==="
  curl -sf -N -X POST "http://localhost:$PORT/api/scrape?source=hozuko" | grep -o '"phase":"[^"]*"\|"listingsFound":[0-9]*' | tr '\n' ' '
  echo ""
fi

echo ""
echo "=== Scraping PropertyGuru ==="
echo "On macOS this uses the default Safari verification path unless you set PROPERTYGURU_BROWSER=chrome yourself."
curl -sf -N -X POST "http://localhost:$PORT/api/scrape?source=propertyguru" | grep -o '"phase":"[^"]*"\|"listingsFound":[0-9]*' | tr '\n' ' '
echo ""

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
