#!/bin/bash
#
# chat-engine-flip.sh
#
# Flip engine v2 canary store-a3cd7205 antara aktif (active) dan mati (shadow).
# Menutup 2 flag sekaligus: Redis per-store engine flag + PostgreSQL global
# chatEngine.v2Mode. Auto-restart pm2 di akhir supaya cache langsung ke-refresh
# (tidak perlu nunggu 5 menit atau urus bearer token API).
#
# Pemakaian:
#   ./chat-engine-flip.sh on     -> aktifkan V2 untuk store-a3cd7205
#   ./chat-engine-flip.sh off    -> kembalikan ke V1 (rollback)
#   ./chat-engine-flip.sh status -> cuma cek status sekarang, tidak ubah apa pun
#
set -euo pipefail

STORE_ID="store-a3cd7205"
REDIS_KEY="store:${STORE_ID}:engine"

# --- 1. Cari repo root & .env (pola sama seperti change-admin-password.sh) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=""

if [ -d "$SCRIPT_DIR/apps/api" ]; then
  REPO_ROOT="$SCRIPT_DIR"
elif [ -d "/home/ubuntu/garuda/apps/api" ]; then
  REPO_ROOT="/home/ubuntu/garuda"
else
  echo "❌ Tidak menemukan repo root (folder yang berisi apps/api)."
  exit 1
fi

ENV_FILE=""
if [ -f "$REPO_ROOT/.env" ]; then
  ENV_FILE="$REPO_ROOT/.env"
elif [ -f "$REPO_ROOT/apps/api/.env" ]; then
  ENV_FILE="$REPO_ROOT/apps/api/.env"
else
  echo "❌ Tidak ketemu .env di $REPO_ROOT atau $REPO_ROOT/apps/api"
  exit 1
fi

DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d '=' -f2-)"
REDIS_URL="$(grep -E '^REDIS_URL=' "$ENV_FILE" | head -n1 | cut -d '=' -f2- || echo "")"

if [ -z "$DB_URL" ]; then
  echo "❌ DATABASE_URL tidak ditemukan di $ENV_FILE"
  exit 1
fi

# --- 2. Fungsi cek status ---
show_status() {
  echo "--- Status saat ini ---"
  echo "Redis ($REDIS_KEY):"
  if [ -n "$REDIS_URL" ]; then
    redis-cli -u "$REDIS_URL" GET "$REDIS_KEY" 2>/dev/null || echo "  (kosong / tidak ada / redis-cli gagal konek)"
  else
    redis-cli GET "$REDIS_KEY" 2>/dev/null || echo "  (kosong / tidak ada)"
  fi
  echo ""
  echo "Global flag (chatEngine.v2Mode):"
  psql "$DB_URL" -t -c "SELECT value FROM system_settings WHERE key = 'chatEngine.v2Mode';" 2>/dev/null | xargs || echo "  (gagal query)"
  echo ""
}

MODE="${1:-}"

if [ "$MODE" == "status" ] || [ -z "$MODE" ]; then
  show_status
  echo "Pemakaian: ./chat-engine-flip.sh on | off | status"
  exit 0
fi

if [ "$MODE" != "on" ] && [ "$MODE" != "off" ]; then
  echo "❌ Argumen tidak dikenal: $MODE"
  echo "   Pakai: ./chat-engine-flip.sh on | off | status"
  exit 1
fi

echo "--- Status SEBELUM ---"
show_status

NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

if [ "$MODE" == "on" ]; then
  echo "🔵 Mengaktifkan V2 untuk $STORE_ID ..."
  read -rp "Yakin flip ke ACTIVE? (y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Dibatalkan."
    exit 0
  fi

  PAYLOAD="{\"storeId\":\"${STORE_ID}\",\"engine\":\"v2\",\"enabledAt\":\"${NOW_ISO}\",\"canaryStartDate\":\"${NOW_ISO}\"}"

  if [ -n "$REDIS_URL" ]; then
    redis-cli -u "$REDIS_URL" SETEX "$REDIS_KEY" 604800 "$PAYLOAD"
  else
    redis-cli SETEX "$REDIS_KEY" 604800 "$PAYLOAD"
  fi
  echo "✅ Redis flag di-set ke v2 (auto-expire 7 hari kalau lupa di-revert)."

  psql "$DB_URL" -c "UPDATE system_settings SET value = 'active' WHERE key = 'chatEngine.v2Mode';"
  echo "✅ Global flag di-set ke active."

else
  echo "🟡 Mengembalikan $STORE_ID ke V1 (rollback) ..."
  read -rp "Yakin revert ke V1/shadow? (y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Dibatalkan."
    exit 0
  fi

  if [ -n "$REDIS_URL" ]; then
    redis-cli -u "$REDIS_URL" DEL "$REDIS_KEY"
  else
    redis-cli DEL "$REDIS_KEY"
  fi
  echo "✅ Redis flag dihapus (default balik ke v1)."

  psql "$DB_URL" -c "UPDATE system_settings SET value = 'shadow' WHERE key = 'chatEngine.v2Mode';"
  echo "✅ Global flag dikembalikan ke shadow."
fi

echo ""
echo "🔄 Restart pm2 supaya cache config langsung ke-refresh (bukan nunggu 5 menit) ..."
pm2 restart api
sleep 2

echo ""
echo "--- Status SESUDAH ---"
show_status

echo "✅ Selesai."
