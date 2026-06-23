#!/bin/bash
set -e

# NTU Rental Finder - 一键更新脚本
# 用法: ./update.sh [--hozuko-only]
#
# 默认运行两个数据源 (PropertyGuru + Hozuko)
# 加 --hozuko-only 只跑 Hozuko (不需要 Safari)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

HOZUKO_ONLY=false
if [[ "$1" == "--hozuko-only" ]]; then
  HOZUKO_ONLY=true
fi

PORT=3003
DEV_PID=""

cleanup() {
  if [[ -n "$DEV_PID" ]]; then
    echo "Stopping dev server..."
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 检查代理
if nc -z 127.0.0.1 7897 2>/dev/null; then
  export SCRAPER_PROXY="http://127.0.0.1:7897"
  echo "Proxy detected at 127.0.0.1:7897"
fi

# 启动 dev server
echo "Starting dev server..."
npm run dev -- -p $PORT &
DEV_PID=$!

echo "Waiting for dev server..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT/api/listings" > /dev/null 2>&1; then
    echo "Dev server ready."
    break
  fi
  sleep 1
done

# Hozuko
echo ""
echo "=== Scraping Hozuko ==="
curl -s -N -X POST "http://localhost:$PORT/api/scrape?source=hozuko" | grep '"phase":"done"' || echo "Hozuko scrape may have failed."

# PropertyGuru (除非 --hozuko-only)
if [[ "$HOZUKO_ONLY" == false ]]; then
  echo ""
  echo "=== Scraping PropertyGuru ==="
  echo "(Make sure Safari has passed Cloudflare for PropertyGuru)"
  curl -s -N -X POST "http://localhost:$PORT/api/scrape?source=propertyguru" | grep '"phase":"done"' || {
    echo "PropertyGuru scrape failed. Continuing with Hozuko data only."
  }
fi

# 部署
echo ""
echo "=== Deploying to Vercel ==="
vercel --prod --yes

echo ""
echo "Done! https://ntu-rental.vercel.app"
