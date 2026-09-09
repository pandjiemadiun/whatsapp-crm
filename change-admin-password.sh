#!/bin/bash
#
# change-admin-password.sh
#
# Interactive wrapper untuk reset password AdminUser QloBot/Garuda.
# Menutup masalah: script asli (scripts/reset-admin-password.ts) butuh
# DATABASE_URL yang harus di-export manual dari .env, dan .env bisa ada
# di root repo ATAU di apps/api/ tergantung sejarah insiden env di server
# ini. Script ini mencari sendiri, tidak perlu diingat lagi.
#
# Jalankan dari mana saja di dalam repo:
#   ./change-admin-password.sh
#
set -euo pipefail

# --- 1. Cari root repo (folder yang punya apps/api) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=""

if [ -d "$SCRIPT_DIR/apps/api" ]; then
  REPO_ROOT="$SCRIPT_DIR"
elif [ -d "/home/ubuntu/garuda/apps/api" ]; then
  REPO_ROOT="/home/ubuntu/garuda"
else
  echo "❌ Tidak menemukan repo root (folder yang berisi apps/api)."
  echo "   Jalankan script ini dari dalam repo, atau edit REPO_ROOT manual di script ini."
  exit 1
fi

API_DIR="$REPO_ROOT/apps/api"
RESET_SCRIPT="$REPO_ROOT/scripts/reset-admin-password.ts"

if [ ! -f "$RESET_SCRIPT" ]; then
  echo "❌ Tidak ketemu $RESET_SCRIPT"
  echo "   Cek apakah scriptnya pindah lokasi (cari manual: find $REPO_ROOT -iname 'reset-admin-password.ts')"
  exit 1
fi

# --- 2. Cari .env (root repo ATAU apps/api, urutan prioritas) ---
ENV_FILE=""
if [ -f "$REPO_ROOT/.env" ]; then
  ENV_FILE="$REPO_ROOT/.env"
elif [ -f "$API_DIR/.env" ]; then
  ENV_FILE="$API_DIR/.env"
else
  echo "❌ Tidak ketemu .env di $REPO_ROOT atau $API_DIR"
  echo "   Cek manual: find $REPO_ROOT -maxdepth 3 -iname '.env'"
  exit 1
fi

echo "✅ Repo root : $REPO_ROOT"
echo "✅ .env      : $ENV_FILE"
echo "✅ Script    : $RESET_SCRIPT"
echo ""

# --- 3. Ambil DATABASE_URL dari .env tanpa print isinya ---
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d '=' -f2-)"

if [ -z "$DB_URL" ]; then
  echo "❌ DATABASE_URL tidak ditemukan di $ENV_FILE"
  exit 1
fi

echo "✅ DATABASE_URL ditemukan (tidak ditampilkan demi keamanan)."
echo ""

# --- 4. Tampilkan daftar admin aktif dulu, biar tidak salah pilih email ---
echo "--- Admin aktif saat ini (isActive=true) ---"
DATABASE_URL="$DB_URL" psql "$DB_URL" -c \
  "SELECT email, role, \"isActive\" FROM admin_users WHERE \"isActive\" = true;" 2>/dev/null \
  || echo "(gagal query langsung via psql, lanjut saja — tidak fatal)"
echo ""

# --- 5. Input interaktif ---
read -rp "Email admin yang mau di-reset: " ADMIN_EMAIL

if [ -z "$ADMIN_EMAIL" ]; then
  echo "❌ Email tidak boleh kosong."
  exit 1
fi

while true; do
  read -rsp "Password baru (min 8 karakter, tidak akan tampil di layar): " NEW_PASS
  echo ""
  read -rsp "Ulangi password baru: " NEW_PASS_CONFIRM
  echo ""

  if [ "$NEW_PASS" != "$NEW_PASS_CONFIRM" ]; then
    echo "⚠️  Password tidak sama, coba lagi."
    continue
  fi
  if [ "${#NEW_PASS}" -lt 8 ]; then
    echo "⚠️  Password minimal 8 karakter, coba lagi."
    continue
  fi
  break
done

echo ""
echo "Akan reset password untuk: $ADMIN_EMAIL"
read -rp "Lanjutkan? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Dibatalkan."
  exit 0
fi

# --- 6. Jalankan script asli dengan DATABASE_URL yang sudah ditemukan ---
cd "$API_DIR"
DATABASE_URL="$DB_URL" npx tsx "$RESET_SCRIPT" "$ADMIN_EMAIL" "$NEW_PASS" --yes

echo ""
echo "✅ Selesai. Coba login dengan password baru."
