#!/bin/bash
set -uo pipefail

# restore-database.sh — restore database from dump file
#
# Supported formats:
#   .dump            Custom-format pg_dump (no encryption). Restored with pg_restore.
#   .sql.gz.enc      Encrypted backup from backup.service.ts (AES-256-CBC).
#                    Decrypted -> gunzip -> restored with pg_restore (custom format).
#
# WHY separate from deploy-fresh-vps.sh:
#   Restore is a DESTRUCTIVE action (--clean drops all tables). It MUST be
#   run manually with explicit confirmation, not hidden inside a fresh-install
#   script. Correct order: restore-database.sh FIRST, then deploy-fresh-vps.sh
#   (so migrate deploy runs on top of restored data, not the other way around).
#
# Usage:
#   bash scripts/restore-database.sh /path/to/backup.dump
#   bash scripts/restore-database.sh /path/to/backup.sql.gz.enc

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP_FILE="${1:-}"

if [ -z "${DUMP_FILE}" ]; then
  echo "❌ Usage: $0 /path/to/dump-file"
  echo "   Supported: .dump (custom format) or .sql.gz.enc (encrypted)"
  exit 1
fi

if [ ! -f "${DUMP_FILE}" ]; then
  echo "❌ File not found: ${DUMP_FILE}"
  exit 1
fi

# Load .env for DATABASE_URL and BACKUP_ENCRYPTION_KEY
# Skip variables that are already exported (allows CLI override).
if [ -f "${REPO_DIR}/.env" ]; then
  while IFS='=' read -r key value; do
    if [[ "$key" =~ ^[A-Z_]+$ ]] && [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "${REPO_DIR}/.env"
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

EXT="${DUMP_FILE##*.}"
case "${EXT}" in
  dump)
    FORMAT="custom"
    ;;
  enc)
    FORMAT="encrypted"
    ;;
  *)
    echo "❌ Unsupported file extension: .${EXT}"
    echo "   Supported: .dump (custom format) or .sql.gz.enc (encrypted)"
    exit 1
    ;;
esac

echo "============================================"
echo "  RESTORE DATABASE"
echo "============================================"
echo "File     : ${DUMP_FILE}"
echo "Format   : ${FORMAT}"
echo "Target   : ${DB_NAME} @ ${DB_HOST}:${DB_PORT} as ${DB_USER}"
echo ""

# ──────────────────────────────────────────────
# Interactive confirmation — DESTRUCTIVE action
# ──────────────────────────────────────────────
echo "⚠️  Ini akan MENGHAPUS SEMUA DATA di database '${DB_NAME}' dan"
echo "   menggantinya dengan isi dari ${DUMP_FILE}. TIDAK BISA DIBATALKAN."
read -p "Ketik 'YA HAPUS' untuk lanjut: " CONFIRM
if [ "${CONFIRM}" != "YA HAPUS" ]; then
  echo "Dibatalkan."
  exit 1
fi
echo ""

# ──────────────────────────────────────────────
# Terminate existing connections
# ──────────────────────────────────────────────
echo "⏳ Terminating existing connections on ${DB_NAME} ..."
PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true
echo "✅ Connections terminated"
echo ""

# ──────────────────────────────────────────────
# Restore based on format
# ──────────────────────────────────────────────
TMP_DIR_RESTORE="/tmp/restore-$$"
mkdir -p "${TMP_DIR_RESTORE}"

set +e

if [ "${FORMAT}" = "custom" ]; then
  echo "🔧 Restoring custom-format dump with pg_restore ..."
  PGPASSWORD="${DB_PASS}" pg_restore \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --clean --if-exists "${DUMP_FILE}" 2>&1
  RESTORE_EXIT=$?
elif [ "${FORMAT}" = "encrypted" ]; then
  echo "🔓 Decrypting ${DUMP_FILE} ..."
  TMP_DECRYPTED="${TMP_DIR_RESTORE}/decrypted.gz"
  TMP_RESTORE="${TMP_DIR_RESTORE}/restore.dump"

  node "${REPO_DIR}/scripts/lib/decrypt-backup.js" "${DUMP_FILE}" "${TMP_DECRYPTED}"
  DECRYPT_EXIT=$?

  if [ ${DECRYPT_EXIT} -ne 0 ]; then
    echo "❌ Decryption failed (exit ${DECRYPT_EXIT})"
    rm -rf "${TMP_DIR_RESTORE}"
    set -e
    exit 1
  fi

  echo "📦 Decompressing ..."
  gunzip -c "${TMP_DECRYPTED}" > "${TMP_RESTORE}"
  GUNZIP_EXIT=$?
  rm -f "${TMP_DECRYPTED}"

  if [ ${GUNZIP_EXIT} -ne 0 ]; then
    echo "❌ gunzip failed (exit ${GUNZIP_EXIT})"
    rm -rf "${TMP_DIR_RESTORE}"
    set -e
    exit 1
  fi

  echo "🔧 Restoring custom-format dump with pg_restore ..."
  PGPASSWORD="${DB_PASS}" pg_restore \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --clean --if-exists "${TMP_RESTORE}" 2>&1
  RESTORE_EXIT=$?

  rm -f "${TMP_RESTORE}"
else
  echo "❌ Unknown format: ${FORMAT}"
  rm -rf "${TMP_DIR_RESTORE}"
  set -e
  exit 1
fi

rm -rf "${TMP_DIR_RESTORE}"

set -e

if [ ${RESTORE_EXIT} -ne 0 ]; then
  echo ""
  echo "⚠️  Restore gagal (exit ${RESTORE_EXIT}). Database mungkin dalam"
  echo "   state PARTIAL. Investigasi sebelum lanjut ke migrate/build."
  exit 1
fi

echo ""
echo "✅ Database restore complete"
echo ""
echo "Langkah selanjutnya:"
echo "  cd ${REPO_DIR}"
echo "  bash scripts/deploy-fresh-vps.sh   # apply migrate + build + pm2"
