#!/bin/bash
# 本地 Mac 运行：刷新 PropertyGuru session 并同步到服务器
# 用法: bash scripts/refresh-pg-session.sh [user@server] [server_path]
# 示例: bash scripts/refresh-pg-session.sh root@1.2.3.4
set -euo pipefail

SERVER="${1:-}"
SERVER_PATH="${2:-/opt/ntu-rental/data}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"
SESSION_FILE="$DATA_DIR/propertyguru-storage-state.json"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

cd "$SCRIPT_DIR/.."

log "=== PropertyGuru Session Refresh ==="

# 用 auto-bypass 脚本过 Cloudflare（会自动打开 Chrome）
node scripts/propertyguru-auto-bypass.mjs

if [[ ! -f "$SESSION_FILE" ]]; then
  echo "ERROR: session file not created. Bypass failed."
  exit 1
fi

log "Session saved locally: $SESSION_FILE"

# 验证 session
log "Verifying session..."
if ! node scripts/propertyguru-check-session.mjs 2>&1 | grep -q '"ok": true'; then
  log "WARNING: session verification failed. Uploading anyway."
fi

# 同步到服务器（可选）
if [[ -n "$SERVER" ]]; then
  log "Uploading session to $SERVER:$SERVER_PATH ..."
  scp "$SESSION_FILE" "$SERVER:$SERVER_PATH/propertyguru-storage-state.json"
  log "Done. Server will use new session on next run."
else
  log "No server specified. Session saved locally only."
  log "To upload: scp $SESSION_FILE user@server:$SERVER_PATH/"
fi
