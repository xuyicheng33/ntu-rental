#!/bin/bash
# 服务器定时更新脚本
# Cron 用法: 0 3 * * * /opt/ntu-rental/scripts/server-update.sh >> /var/log/ntu-update.log 2>&1
set -euo pipefail

BASE_URL="http://localhost:3003"
DATA_DIR="$(cd "$(dirname "$0")/../data" && pwd)"
SESSION_FILE="$DATA_DIR/propertyguru-storage-state.json"
SESSION_MAX_AGE_DAYS=6  # session 超过 6 天就认为可能过期

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

scrape() {
  local source="$1"
  local output
  output=$(curl -sf -N -X POST "$BASE_URL/api/scrape?source=$source" 2>&1) || {
    log "ERROR: curl failed for $source"
    return 1
  }
  if echo "$output" | grep -q '"phase":"done"'; then
    local count
    count=$(echo "$output" | grep -o '"listingsFound":[0-9]*' | tail -1 | grep -o '[0-9]*')
    log "$source: OK ($count listings)"
    return 0
  else
    local err
    err=$(echo "$output" | grep -o '"message":"[^"]*"' | head -1)
    log "$source: FAILED $err"
    return 1
  fi
}

session_valid() {
  if [[ ! -f "$SESSION_FILE" ]]; then
    return 1
  fi
  local age_days
  age_days=$(( ( $(date +%s) - $(date -r "$SESSION_FILE" +%s) ) / 86400 ))
  if [[ $age_days -ge $SESSION_MAX_AGE_DAYS ]]; then
    log "PG session age: ${age_days}d (expired threshold: ${SESSION_MAX_AGE_DAYS}d)"
    return 1
  fi
  return 0
}

log "=== NTU Rental daily update ==="

# Hozuko: 无反爬，始终运行
scrape hozuko || true

# PropertyGuru: 需要有效 session
if session_valid; then
  scrape propertyguru || log "PropertyGuru scrape failed — session may have expired"
else
  log "PropertyGuru: session missing or stale."
  log "  在本地 Mac 运行: cd ntu-rental && bash scripts/refresh-pg-session.sh SERVER_IP"
fi

log "=== Done ==="
