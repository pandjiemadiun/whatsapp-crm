#!/bin/bash
set -euo pipefail

# Auto-detect repo root: use script location's git root, or current dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/../.git/config" ]; then
  REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
elif [ -d ".git" ]; then
  REPO_DIR="$(pwd)"
else
  REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "/home/ubuntu/garuda")"
fi

# Load .env if present so all subsequent steps have env vars
if [ -f "${REPO_DIR}/.env" ]; then
  set -a
  source "${REPO_DIR}/.env"
  set +a
fi

DUMP_FILE="${1:-}"
SKIP_PREREQ="${SKIP_PREREQ:-0}"
DRY_RUN="${DRY_RUN:-0}"

echo "============================================"
echo "  DEPLOY-FRESH-VPS — idempotent bootstrap"
echo "============================================"
echo "Repo dir : ${REPO_DIR}"
echo "Dump file: ${DUMP_FILE:-<none>}"
echo "Dry run  : ${DRY_RUN}"
echo ""

if [ "${DRY_RUN}" = "1" ]; then
  echo "⚠️  DRY-RUN mode — no changes will be made."
  echo ""
fi

run() {
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# ──────────────────────────────────────────────
# 1. Prerequisite check
# ──────────────────────────────────────────────
if [ "${SKIP_PREREQ}" != "1" ]; then
  MISSING=()
  command -v node >/dev/null 2>&1 || MISSING+=("node")
  command -v npm >/dev/null 2>&1 || MISSING+=("npm")
  command -v pg_dump >/dev/null 2>&1 || MISSING+=("pg_dump (postgresql-client)")
  command -v pg_restore >/dev/null 2>&1 || MISSING+=("pg_restore (postgresql-client)")
  command -v redis-cli >/dev/null 2>&1 || MISSING+=("redis-tools")
  command -v gunzip >/dev/null 2>&1 || MISSING+=("gzip")

  if [ ${#MISSING[@]} -gt 0 ]; then
    echo "❌ Prerequisites missing: ${MISSING[*]}"
    echo ""
    echo "Install on Ubuntu with:"
    echo "  sudo apt update && sudo apt install -y ${MISSING[*]}"
    echo ""
    echo "Node.js (use nvm or NodeSource — pick ONE):"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt install -y nodejs"
    echo ""
    exit 1
  fi

  NODE_VERSION=$(node -v | sed 's/^v//')
  NODE_MAJOR=${NODE_VERSION%%.*}
  echo "✅ Node ${NODE_VERSION} found"
  echo "✅ npm $(npm -v) found"
  echo "✅ pg_dump / pg_restore found"
  echo "✅ redis-cli found"
  echo "✅ gunzip found"
  echo ""
fi

# ──────────────────────────────────────────────
# 2. Clone / pull repo (idempotent)
# ──────────────────────────────────────────────
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "📥 Cloning repo into ${REPO_DIR} ..."
  run git clone https://github.com/pandjiemadiun/whatsapp-crm.git "${REPO_DIR}"
else
  echo "🔄 Repo already exists, pulling latest ..."
  cd "${REPO_DIR}"
  run git pull --ff-only || {
    echo "⚠️  git pull had conflicts. Resolve manually, then re-run this script."
    exit 1
  }
fi
cd "${REPO_DIR}"
echo "✅ Repo ready at $(git rev-parse --show-toplevel)"
echo "   HEAD: $(git log --oneline -1)"
echo ""

# ──────────────────────────────────────────────
# 3. Check .env exists
# ──────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "❌ .env NOT FOUND at ${REPO_DIR}/.env"
  echo ""
  echo "Copy .env dari backup HP Anda ke path di atas dulu."
  echo "Script TIDAK akan generate secret sendiri."
  echo ""
  echo "Contoh:"
  echo "  scp /path/backup/.env ubuntu@<IP-VPS-BARU>:${REPO_DIR}/.env"
  echo ""
  exit 1
fi
echo "✅ .env exists at ${REPO_DIR}/.env"
echo ""

# ──────────────────────────────────────────────
# 4. npm install di setiap apps/* yang punya package.json
# ──────────────────────────────────────────────
echo "📦 Installing npm dependencies ..."
for app in apps/*; do
  if [ -f "${app}/package.json" ]; then
    APP_NAME=$(basename "${app}")
    echo "  → ${APP_NAME} ..."
    if [ ! -d "${app}/node_modules" ]; then
      cd "${app}"
      run npm install
      cd "${REPO_DIR}"
    else
      echo "    (node_modules already present, skip — hapus folder untuk reinstall)"
    fi
  fi
done
echo "✅ npm install done"
echo ""

# ──────────────────────────────────────────────
# 5. Prisma generate → migrate deploy
# ──────────────────────────────────────────────
echo "🔧 Prisma: generate + migrate deploy ..."
cd apps/api

# Load .env so Prisma can find DATABASE_URL etc.
if [ -f "../../.env" ]; then
  set -a
  source "../../.env"
  set +a
fi

run npx prisma generate
run npx prisma migrate deploy
cd "${REPO_DIR}"
echo "✅ Prisma ready"
echo ""

# ──────────────────────────────────────────────
# 6. Build apps/api
# ──────────────────────────────────────────────
echo "🔨 Building apps/api ..."
cd apps/api

# Load .env so build-time constants are available
if [ -f "../../.env" ]; then
  set -a
  source "../../.env"
  set +a
fi

run npm run build
cd "${REPO_DIR}"
echo "✅ Build done"
echo ""

# ──────────────────────────────────────────────
# 7. Optional DB restore
# ──────────────────────────────────────────────
if [ -n "${DUMP_FILE}" ]; then
  echo "🗄️  Restoring DB from dump: ${DUMP_FILE}"
  if [ ! -f "${DUMP_FILE}" ]; then
    echo "❌ Dump file not found: ${DUMP_FILE}"
    exit 1
  fi

  DB_URL="${DATABASE_URL:?DATABASE_URL harus di-set di .env}"
  DB_USER=$(echo "${DB_URL}" | sed -n 's|.*://\([^:]*\):.*|\1|p')
  DB_PASS=$(echo "${DB_URL}" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  DB_HOST=$(echo "${DB_URL}" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  DB_PORT=$(echo "${DB_URL}" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_NAME=$(echo "${DB_URL}" | sed -n 's|.*/\([^?]*\).*|\1|p')

  if [ -z "${DB_NAME}" ]; then
    echo "❌ Cannot parse DB name from DATABASE_URL"
    exit 1
  fi

  TMP_GZ="/tmp/restore-$$.gz"
  cp "${DUMP_FILE}" "${TMP_GZ}"

  echo "  Terminating existing connections on ${DB_NAME} ..."
  PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true

  echo "  Running pg_restore --clean --if-exists ..."
  gunzip -c "${TMP_GZ}" | PGPASSWORD="${DB_PASS}" pg_restore \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --clean --if-exists 2>&1

  RESTORE_EXIT=$?
  rm -f "${TMP_GZ}"

  if [ ${RESTORE_EXIT} -ne 0 ]; then
    echo "⚠️  pg_restore exited with code ${RESTORE_EXIT} — check output above."
    echo "   Database may be partially restored. Inspect before continuing."
  else
    echo "✅ Database restore complete"
  fi
  echo ""
else
  echo "⏭️  No dump file provided, skipping DB restore."
  echo "   Usage: $0 /path/to/backup.dump.gz"
  echo ""
fi

# ──────────────────────────────────────────────
# 8. Install git hook post-merge
# ──────────────────────────────────────────────
echo "🪝 Installing post-merge git hook ..."
HOOK_DIR="${REPO_DIR}/.git/hooks"
HOOK_FILE="${HOOK_DIR}/post-merge"

run mkdir -p "${HOOK_DIR}"

if [ "${DRY_RUN}" = "1" ]; then
  echo "[dry-run] Would write hook to ${HOOK_FILE}"
else
  cat > "${HOOK_FILE}" <<'HOOK_EOF'
#!/bin/bash
set -e
echo "[post-merge hook] Rebuilding apps/api..."
cd apps/api && npm run build
echo "[post-merge hook] Build done. Restart pm2 manually: pm2 restart api"
HOOK_EOF
  chmod +x "${HOOK_FILE}"
  echo "✅ Hook installed at ${HOOK_FILE}"
fi
echo ""

# ──────────────────────────────────────────────
# 9. Setup pm2
# ──────────────────────────────────────────────
echo "🚀 Setting up pm2 ..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "❌ pm2 not found. Install with: npm install -g pm2"
  exit 1
fi

cd "${REPO_DIR}"

# Check if pm2 startup has already been set up
if systemctl is-enabled pm2-root.service >/dev/null 2>&1; then
  echo "✅ pm2 startup sudah pernah di-setup"
else
  echo "⚠️  pm2 startup BELUM di-setup. Jalankan manual dengan sudo:"
  echo "   sudo pm2 startup"
  echo "   pm2 save"
  echo ""
fi

# Start / reload ecosystem
run pm2 startOrReload ecosystem.config.js
run pm2 save

echo "✅ pm2 apps started:"
pm2 list
echo ""

# ──────────────────────────────────────────────
# 10. Manual checklist (tidak bisa diotomasi)
# ──────────────────────────────────────────────
echo "============================================"
echo "  CHECKLIST MANUAL — WAJIB DILAKUKAN"
echo "============================================"
echo ""
echo "1. Nginx reverse proxy config"
echo "   - Buat /etc/nginx/sites-available/<DOMAIN> (lihat template di DEPLOY-RUNBOOK.md)"
echo "   - Test: sudo nginx -t"
echo "   - Enable: sudo ln -s /etc/nginx/sites-available/<DOMAIN> /etc/nginx/sites-enabled/"
echo ""
echo "2. Certbot SSL"
echo "   - sudo certbot --nginx -d <DOMAIN> -d api.<DOMAIN>"
echo "   - Verifikasi auto-renew: sudo certbot renew --dry-run"
echo ""
echo "3. DNS pointing"
echo "   - Pastikan A record <DOMAIN> dan api.<DOMAIN> mengarah ke IP VPS baru."
echo ""
echo "4. Firewall (UFW)"
echo "   - sudo ufw allow 22/tcp"
echo "   - sudo ufw allow 80/tcp"
echo "   - sudo ufw allow 443/tcp"
echo "   - sudo ufw deny 3000/tcp    # API"
echo "   - sudo ufw deny 8080/tcp    # Dashboard"
echo "   - sudo ufw deny 8081/tcp    # PWA"
echo "   - sudo ufw deny 6379/tcp    # Redis"
echo "   - sudo ufw deny 5432/tcp    # PostgreSQL"
echo "   - sudo ufw enable"
echo ""
echo "5. Verifikasi akhir"
echo "   - curl -s http://localhost:3000/api/health"
echo "   - pm2 status"
echo "   - Test 1 chat manual via WA/PWA"
echo ""
echo "============================================"
echo "  SCRIPT SELESAI"
echo "============================================"
