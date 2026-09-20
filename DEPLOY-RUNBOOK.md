# DEPLOY-RUNBOOK — Migrasi VPS Baru (Garuda CRM)

Gunakan runbook ini kalau `scripts/deploy-fresh-vps.sh` gagal atau environment
VPS baru berbeda dari asumsi script. Semua perintah di bawah telah diverifikasi
pada VPS production saat ini (Ubuntu 26.04 / Node 20 / PostgreSQL 18 / Redis 8).

---

## 1. Provisioning VPS Baru — Spek Minimum

Berdasarkan resource pakai VPS lama saat ini:

```
free -h
Mem:   1.6G total, 80M free, 508M buff/cache, 408M available
Swap:  3.0G total, 1.5G used, 1.5G free

df -h /
Filesystem Size Used Avail Use%
/dev/sda4   38G   33G  3.3G  91%
```

**Rekomendasi minimum:**
- RAM: 2 GB (1.6 GB total + swap sudah ketat untuk production)
- Disk: 40 GB SSD (3.3 GB kosong saat ini, tumbuh cepat karena logs + DB)
- CPU: 1 vCore cukup untuk awal (usage saat ini rendah)
- OS: Ubuntu 22.04 LTS atau 24.04 LTS (26.04 juga umumnya kompatibel)

Pastikan SSH port 22 terbuka sebelum migrasi (jangan gunakan port custom
selama provisioning awal).

---

## 2. Install Dependency Dasar

Jalankan sebagai root atau dengan sudo:

```bash
# System packages
sudo apt update
sudo apt install -y postgresql postgresql-contrib redis-server \
  postgresql-client pg_dump pg_restore gzip git curl ufw nginx

# Node.js 20 LTS (versi yang dipakai CI — lihat .github/workflows/test.yml)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi versi
node -v    # harus v20.x
npm -v
psql --version   # PostgreSQL 16+ (18 saat ini)
redis-cli --version   # Redis 7+
```

> Catatan: Kalau VPS baru pakai distro lain (Debian, AlmaLinux, dst),
> sesuaikan package manager. Script `deploy-fresh-vps.sh` hanya mengecek
> prerequisites, TIDAK auto-install.

---

## 3. Restore `.env` dari Backup HP

1. Di VPS baru, buat direktori repo:
   ```bash
   mkdir -p /home/ubuntu/garuda
   ```

2. Upload `.env` dari backup HP ke VPS baru:
   ```bash
   # Dari laptop Anda:
   scp /path/backup/.env ubuntu@<IP-VPS-BARU>:/home/ubuntu/garuda/.env
   ```

3. Verifikasi file sampai:
   ```bash
   ls -la /home/ubuntu/garuda/.env
   # Pastikan permission: -rw------- (chmod 600)
   ```

4. **PENTING:** `FIELD_ENCRYPTION_KEY` di `.env` baru HARUS SAMA dengan
   yang lama. Kalau berbeda, semua data terenkripsi
   (`AIProviderConfig.apiKey`, `system_settings` terenkripsi, dst)
   menjadi tidak bisa didekripsi.

---

## 4. Clone Repo + Jalankan Bootstrap Script

```bash
cd /home/ubuntu/garuda
git clone https://github.com/pandjiemadiun/whatsapp-crm.git .
# atau jika repo sudah ada: git pull --ff-only

# Pastikan .env ada (step 3)
ls -la .env

# Jalankan bootstrap script
bash scripts/deploy-fresh-vps.sh
```

Script akan:
- Cek prerequisites
- Pull repo
- Cek `.env`
- `npm install` di `apps/api`, `apps/dashboard`, `apps/pwa`
- `npx prisma generate && npx prisma migrate deploy`
- `npm run build` di `apps/api`
- Install git hook `post-merge`
- Start pm2 ecosystem

---

## 5. Restore Database dari Dump

Restore adalah aksi DESTRUKTIF (`--clean` drop semua tabel). Jalankan
SEBELUM `deploy-fresh-vps.sh` agar `migrate deploy` diterapkan di atas
data yang sudah di-restore.

### 5.1 Format Dump yang Didukung

Script `restore-database.sh` mendukung dua format:

| Ekstensi | Sumber | Isi | Tool restore |
|----------|--------|-----|--------------|
| `.dump` | `pg_dump -F c` manual | Custom-format binary | `pg_restore` |
| `.sql.gz.enc` | `npm run backup:create` | Custom-format + gzip + AES-256-CBC encrypt | decrypt → `pg_restore` |

> **Catatan:** Backup `.sql.gz.enc` dari `backup.service.ts` sebenarnya
> berisi custom-format dump (bukan plain SQL), sehingga setelah dekripsi
> dan decompress tetap menggunakan `pg_restore`. File ini dienkripsi dengan
> AES-256-CBC, key derivation `scryptSync(BACKUP_ENCRYPTION_KEY, 'garuda-backup-salt', 32)`.
> Beberapa backup lama dibuat dengan encryption key kosong (belum di-set di
> `.env`); script otomatis fallback ke empty key untuk kompatibilitas.

### 5.2 Upload Dump ke VPS Baru

```bash
# Custom format dump (manual pg_dump)
scp /path/to/db-dump-20260920.dump ubuntu@<IP-VPS-BARU>:/tmp/

# Encrypted backup (dari npm run backup:create)
scp /path/to/backup_2026-09-20T17-03-03-637Z_bdc8654b.sql.gz.enc ubuntu@<IP-VPS-BARU>:/tmp/
```

### 5.3 Restore via Script (disarankan)

```bash
# Pastikan .env sudah di-restore dengan FIELD_ENCRYPTION_KEY yang benar
cd /home/ubuntu/garuda

# Custom format dump
bash scripts/restore-database.sh /tmp/db-dump-20260920.dump

# Encrypted backup
bash scripts/restore-database.sh /tmp/backup_2026-09-20T17-03-03-637Z_bdc8654b.sql.gz.enc
```

Script akan:
1. Cek `.env` dan parse `DATABASE_URL`
2. Tanya konfirmasi "YA HAPUS" sebelum aksi destruktif
3. Terminate existing connections
4. Decrypt (untuk `.sql.gz.enc`) → gunzip → `pg_restore --clean --if-exists`
5. Hapus file intermediate setelah selesai

### 5.4 Restore Manual (jika script gagal)

```bash
# Parse DATABASE_URL
DB_URL=$(grep '^DATABASE_URL=' /home/ubuntu/garuda/.env | cut -d'=' -f2-)
DB_USER=$(echo "$DB_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
DB_PORT=$(echo "$DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

echo "DB: ${DB_NAME} @ ${DB_HOST}:${DB_PORT} as ${DB_USER}"

# Kill existing connections
PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true

# Custom format: pg_restore langsung ke file
PGPASSWORD="${DB_PASS}" pg_restore \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --clean --if-exists /path/to/backup.dump 2>&1

echo "Exit code: $?"
```

> **WASPADA:** `--clean --if-exists` akan DROP schema yang ada sebelum restore.
> Pastikan dump berasal dari backup yang valid. Jangan restore dump dari
> production ke staging atau sebaliknya tanpa persetujuan owner.

---

## 6. Nginx Config

Buat file `/etc/nginx/sites-available/qlobot` (ganti `<DOMAIN>` dengan
domain aktual, misal `qlobot.web.id`):

```nginx
# /etc/nginx/sites-available/qlobot
upstream api_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream dashboard_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

upstream pwa_backend {
    server 127.0.0.1:8081;
    keepalive 32;
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name <DOMAIN> api.<DOMAIN>;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS — API
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.<DOMAIN>;

    ssl_certificate /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    client_max_body_size 50M;

    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}

# HTTPS — Dashboard
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name dashboard.<DOMAIN>;

    ssl_certificate /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://dashboard_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTPS — PWA
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name <DOMAIN> www.<DOMAIN>;

    ssl_certificate /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://pwa_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan dan test:
```bash
sudo ln -s /etc/nginx/sites-available/qlobot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # hapus default site
sudo nginx -t    # harus output: syntax is ok, test is successful
sudo systemctl reload nginx
```

> Catatan: Template di atas menggunakan subdomain `api.<DOMAIN>` untuk API.
> Sesuaikan dengan struktur domain yang Anda pakai.

---

## 7. Certbot SSL

```bash
# Install certbot jika belum
sudo apt install -y certbot python3-certbot-nginx

# Dapatkan sertifikat (akan otomatis edit nginx config)
sudo certbot --nginx -d <DOMAIN> -d api.<DOMAIN> -d www.<DOMAIN>

# Verifikasi auto-renew
sudo certbot renew --dry-run
```

Jika certbot gagal karena port 80/443 diblokir firewall, buka dulu:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

---

## 8. PM2 Startup + Auto-Restart

```bash
# Setup systemd unit (HANYA jalankan sekali per VPS)
sudo pm2 startup

# Output akan menunjukkan command untuk dijalankan, misal:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
# Jalankan command itu, lalu:
pm2 save

# Verifikasi
systemctl status pm2-root.service
```

Jika `pm2 startup` sudah pernah dijalankan sebelumnya (ada unit systemd),
script `deploy-fresh-vps.sh` akan mendeteksi dan skip.

Untuk restart manual setelah deploy:
```bash
pm2 restart api dashboard pwa
pm2 save
```

---

## 9. Firewall — UFW

**HANYA buka port yang benar-benar dibutuhkan. Tutup semua port lain.**

```bash
# Reset ke default deny
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Izinkan port yang dibutuhkan
sudo ufw allow 22/tcp      # SSH — ubah kalau pakai port custom
sudo ufw allow 80/tcp      # HTTP (redirect ke HTTPS)
sudo ufw allow 443/tcp     # HTTPS

# Blokir aplikasi dari akses langsung internet
sudo ufw deny 3000/tcp     # API
sudo ufw deny 8080/tcp     # Dashboard
sudo ufw deny 8081/tcp     # PWA
sudo ufw deny 6379/tcp     # Redis (hanya localhost)
sudo ufw deny 5432/tcp     # PostgreSQL (hanya localhost)

# Aktifkan
sudo ufw enable

# Verifikasi
sudo ufw status verbose
```

> **JANGAN** buka port aplikasi (3000/8080/8081) ke internet. Semua harus
> lewat nginx reverse proxy di port 443.

---

## 10. Verifikasi Akhir — Smoke Test

Jalankan berurutan dan pastikan SEMUA hijau sebelum mengumumkan "live":

```bash
# 1. API health
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok"} atau JSON dengan status healthy

# 2. PM2 status
pm2 status
# Expected: semua app (api, dashboard, pwa) status "online", restart count rendah

# 3. Cek logs tidak ada error fatal
pm2 logs api --lines 50 --nostream
# Expected: tidak ada "Error", "Cannot find module", "ENOENT"

# 4. Database connection
PGPASSWORD="$(grep '^DATABASE_URL=' .env | sed 's/.*://' | sed 's/@.*//')" \
  psql -h "$(grep '^DATABASE_URL=' .env | sed -n 's|.*@\([^:/]*\).*|\1|p')" \
  -U "$(grep '^DATABASE_URL=' .env | sed -n 's|.*://\([^:]*\):.*|\1|p')" \
  -d "$(grep '^DATABASE_URL=' .env | sed -n 's|.*/\([^?]*\).*|\1|p')" \
  -c "SELECT count(*) FROM Store;"
# Expected: angka row (kalau restore sudah dilakukan)

# 5. Prisma migrate status
cd apps/api && npx prisma migrate status && cd /home/ubuntu/garuda
# Expected: "No pending migrations"

# 6. Test 1 chat manual
# Via PWA: buka https://<DOMAIN>, login sebagai customer, kirim "halo"
# Via WA (jika GOWA sudah connect): kirim pesan ke nomor gateway
# Expected: balasan otomatis dalam 5-10 detik, tidak crash

# 7. Cek git hook aktif
git pull --no-ff  # dry-run pull untuk test hook (atau merge dummy branch)
# Expected: output "[post-merge hook] Rebuilding apps/api..." + build done
```

---

## Troubleshooting Cepat

| Masalah | Solusi |
|---------|--------|
| `npm install` gagal di Node 24 | Pakai Node 20 LTS (CI standar). Project target ES2020. |
| `prisma migrate deploy` gagal | Cek `DATABASE_URL` benar. Cek PostgreSQL running. Jangan pakai `migrate dev` di production. |
| `pm2 startOrReload` gagal | Cek `ecosystem.config.js` path `cwd` benar. Cek `dist/index.js` ada di `apps/api/dist/`. |
| App online tapi API 500 | Cek `pm2 logs api`. Mungkin `dist/` stale — build ulang + `pm2 restart api`. |
| PM2 app stuck `errored` setelah reload | Coba `pm2 delete <app> && pm2 start ecosystem.config.js --only <app>` sebelum debug lebih dalam. |
| SSL cert gagal | Pastikan port 80/443 terbuka. Pastikan DNS sudah propagate (`dig <DOMAIN>`). |
| Chat tidak balas | Cek `GOWA_API_URL` benar. Cek `GOWA_BASIC_AUTH_USER/PASS`. Cek Redis connected (`redis-cli ping`). |
| Data terenkripsi tidak bisa dibaca | `FIELD_ENCRYPTION_KEY` di `.env` berbeda dengan yang di VPS lama. SAMAKAN sebelum restore. |

---

## Catatan Penting

- **FIELD_ENCRYPTION_KEY adalah single point of failure.** Kalau hilang/berubah,
  semua data terenkripsi (API key provider, dsb) tidak bisa didekripsi kembali.
  Simpan di tempat aman (password manager, bukan cuma di server).

- **Script `deploy-fresh-vps.sh` adalah helper, bukan ganti runbook ini.**
  VPS baru bisa berbeda OS/versi. Jika script gagal, gunakan langkah manual
  di atas sebagai fallback.

- **Jangan pernah commit `.env` ke git.** Lihat insiden 22 Agu 2026 di RAILS.md §6.
