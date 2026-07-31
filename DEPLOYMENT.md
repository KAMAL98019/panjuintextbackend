# Panju Intext ERP — VPS Deployment (Git flow)

Target setup:
- **VPS**: Hostinger, Ubuntu, IP `148.230.67.115`, login `root`
- **Code**: pulled from your Git repository (replace `<YOUR-REPO-URL>` everywhere below,
  e.g. `https://github.com/yourname/panjuintext.git`)
- **Admin panel**: https://admin.panjuintext.in (React, built on the VPS, served by Nginx)
- **API**: https://api.panjuintext.in (Node/Express behind Nginx, run by pm2)
- **Database**: MySQL on the same VPS
- **Secrets**: `.env` is NEVER in git — pasted manually on the server once
- Public website on `www.panjuintext.in` is untouched.

---

## Phase 0 — Verify your pushed repo (one minute, do it now)

Open your repo on github.com and confirm ALL of these exist:

- `backend/src/` and `backend/prisma/` and **`backend/assets/`** (the letterhead + pad artwork PNGs)
- `frontend/src/` and `frontend/public/images/` (logo + pad images)
- `frontend/.env.production` containing `REACT_APP_API_URL=https://api.panjuintext.in/api`
- NOT present: `node_modules/`, `backend/.env`, `.wwebjs_auth/`

If `frontend/` shows as an empty folder or a greyed icon, the frontend was pushed as a
"submodule" by mistake — on your PC delete `frontend/.git` if it exists, then
`git add frontend && git commit -m "add frontend files" && git push`.

**Private repo?** Create a GitHub token (Settings → Developer settings → Fine-grained tokens →
repo read-only) and clone with `https://<TOKEN>@github.com/yourname/panjuintext.git`.

---

## Phase 1 — DNS (already done ✓)

`admin.panjuintext.in` and `api.panjuintext.in` both point to `148.230.67.115` and resolve.

---

## Phase 2 — VPS base setup

```bash
ssh root@148.230.67.115
```

```bash
apt update && apt upgrade -y

# Node.js 20 (NOT "apt install npm")
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

# MySQL, Nginx, git
apt install -y mysql-server nginx git

# pm2 keeps the backend alive and starts it on reboot
npm install -g pm2

# Google Chrome — required for WhatsApp (whatsapp-web.js drives a real browser).
# Deliberately NOT `apt install chromium-browser`: on Ubuntu 22.04+ that package is just a
# transitional wrapper that pulls in the SNAP build, which has a well-documented slow cold-start
# (10-30s+, squashfs mount overhead) — this is why WhatsApp connect/QR felt slow. The real .deb
# below launches in ~1-2s instead.
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list
apt update && apt install -y google-chrome-stable

# firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

---

## Phase 3 — Database

```bash
mysql -e "CREATE DATABASE panjuintext CHARACTER SET utf8mb4;
CREATE USER 'panju'@'localhost' IDENTIFIED BY 'REPLACE-WITH-STRONG-DB-PASSWORD';
GRANT ALL PRIVILEGES ON panjuintext.* TO 'panju'@'localhost';
FLUSH PRIVILEGES;"
```

Keep that password — it goes into `.env` next.

---

## Phase 4 — Clone the repo

```bash
cd /var/www
git clone <YOUR-REPO-URL> panjuintext
cd /var/www/panjuintext
```

---

## Phase 5 — Backend (.env pasted manually)

```bash
cd /var/www/panjuintext/backend
nano .env
```

Paste this into nano, fix the 3 marked values, then Ctrl+O Enter, Ctrl+X:

```
DATABASE_URL="mysql://panju:REPLACE-WITH-STRONG-DB-PASSWORD@localhost:3306/panjuintext"
JWT_SECRET="REPLACE-WITH-LONG-RANDOM-STRING"
JWT_EXPIRES_IN="7d"
PORT=5000
CLIENT_URL="https://admin.panjuintext.in"
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
```

- JWT secret generator: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `CLIENT_URL` is the CORS allow-list — must be exactly the admin URL
- If you deployed before this Chrome fix, your `.env` may still say `chromium-browser` — update it
  to `/usr/bin/google-chrome-stable` after running the install command in Phase 2, then
  `pm2 restart panju-api`
- ⚠️ **Never run** `echo "PUPPETEER_EXECUTABLE_PATH=..." >> .env` more than once — it appends a
  duplicate line and the key will appear twice, which can confuse some loaders. Always edit with
  `nano .env` and check there is only one `PUPPETEER_EXECUTABLE_PATH` line.

Then install and start:

```bash
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js     # creates the admin login + demo data (delete demos from the UI later)

pm2 start src/index.js --name panju-api
pm2 startup             # run the command it prints
pm2 save
curl http://localhost:5000/api/health   # expect {"success":true,...}
```

---

## Phase 6 — Frontend (built on the VPS)

```bash
cd /var/www/panjuintext/frontend
npm install
npm run build           # takes 1–3 minutes; output goes to frontend/build
```

(The API URL comes from `frontend/.env.production` in the repo — no editing needed.)

Nginx:

```bash
cat > /etc/nginx/sites-available/panjuintext << 'EOF'
# Admin panel (React build)
server {
    listen 80;
    server_name admin.panjuintext.in;
    root /var/www/panjuintext/frontend/build;
    index index.html;

    # keep relative /uploads (company logo) working from the admin origin
    location /uploads/ {
        proxy_pass http://localhost:5000;
    }
    # React SPA: refreshing /quotations/5 must serve index.html
    location / {
        try_files $uri /index.html;
    }
}

# API
server {
    listen 80;
    server_name api.panjuintext.in;
    client_max_body_size 20m;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/panjuintext /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# smoke test from the VPS itself:
curl -H "Host: api.panjuintext.in" http://localhost/api/health
```

---

## Phase 7 — HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d admin.panjuintext.in -d api.panjuintext.in
```

Choose **Redirect** when asked. Renewal is automatic.

---

## Phase 8 — First-run checklist

1. `https://api.panjuintext.in/api/health` → `{"success":true,...}`
2. `https://admin.panjuintext.in` → log in `admin@panjuintext.com` / `Admin@123`
3. **Immediately** change the password: Settings → Reset Password
4. Settings → set **Owner WhatsApp Number** and **Next Quotation Number** (e.g. 131)
5. WhatsApp page → Connect both sessions, scan both QRs once
   (server sessions are separate from your PC's; they survive reboots via pm2)

   If WhatsApp shows "disabled — Chrome not available" in pm2 logs, run a clean restart:
   ```bash
   # Verify Chrome is installed
   which google-chrome-stable

   # Clear any stale browser lock files left by a previous crash
   rm -f /var/www/panjuintext/backend/.wwebjs_auth/session-CustomerDocs/Singleton*
   rm -f /var/www/panjuintext/backend/.wwebjs_auth/session-Greetings/Singleton*

   # Full clean PM2 restart (delete + start, not just restart)
   pm2 delete panju-api
   pm2 start /var/www/panjuintext/backend/src/index.js --name panju-api
   pm2 save

   # Watch LIVE logs only (--lines 0 skips old cached history)
   pm2 logs panju-api --lines 0
   ```
6. One test quotation end-to-end: confirm → memo → payment → share on WhatsApp
7. Delete the demo customers/quotations from the UI

---

## Updating the site later (the whole point of the git flow)

On your PC: commit + push as usual. Then on the VPS:

```bash
cd /var/www/panjuintext
git pull

# backend changed?
cd backend && npm install && npx prisma db push && pm2 stop panju-api && npx prisma generate && pm2 start panju-api

# frontend changed?
cd ../frontend && npm install && npm run build
```

Or set up the one-command deploy script once:

```bash
cat > /root/deploy.sh << 'EOF'
#!/bin/bash
set -e
cd /var/www/panjuintext
git pull
cd backend && npm install && npx prisma db push
pm2 stop panju-api
npx prisma generate
pm2 start panju-api
cd ../frontend && npm install && npm run build
echo "✓ Deployed $(git -C /var/www/panjuintext log -1 --oneline)"
EOF
chmod +x /root/deploy.sh
```

From then on, every update is just: **push from your PC → run `/root/deploy.sh` on the VPS**.

`.env` survives updates automatically — it's not in git, and `git pull` never touches it.

---

## Daily-driver commands

| What | Command |
|------|---------|
| Deploy latest push | `/root/deploy.sh` |
| Backend logs (live, no history) | `pm2 logs panju-api --lines 0` |
| Backend logs (last 50 lines) | `pm2 logs panju-api --lines 50` |
| Restart backend | `pm2 restart panju-api` |
| Full clean restart (fixes lock issues) | `pm2 delete panju-api && pm2 start /var/www/panjuintext/backend/src/index.js --name panju-api && pm2 save` |
| Backend status | `pm2 status` |
| Clear stale WhatsApp lock files | `rm -f /var/www/panjuintext/backend/.wwebjs_auth/session-*/Singleton*` |
| Reload Nginx after config edit | `nginx -t && systemctl reload nginx` |
| Manual DB backup | `mysqldump panjuintext > /root/panju-$(date +%F).sql` |

Nightly DB backup cron:

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * mysqldump panjuintext > /root/backup-panjuintext.sql") | crontab -
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `git pull` asks for username/password every time | Use the token URL: `git remote set-url origin https://<TOKEN>@github.com/yourname/panjuintext.git` |
| `502 Bad Gateway` on api subdomain | Backend down → `pm2 logs panju-api --lines 50`, fix, `pm2 restart panju-api` |
| Login fails with CORS error in console | `.env` `CLIENT_URL` must be exactly `https://admin.panjuintext.in`, then `pm2 restart panju-api` |
| WhatsApp shows "disabled — Chrome not available" | Chrome not installed — run: `apt update && apt install -y google-chrome-stable`, verify: `which google-chrome-stable`, then clean-restart PM2 (see Phase 8 step 5) |
| WhatsApp stuck looping "stale browser lock" | Clear lock files: `rm -f /var/www/panjuintext/backend/.wwebjs_auth/session-*/Singleton*` then do a full clean restart: `pm2 delete panju-api && pm2 start /var/www/panjuintext/backend/src/index.js --name panju-api && pm2 save` |
| `.env` has a key appearing twice | Edit with `nano .env`, delete the duplicate line, Ctrl+O → Enter → Ctrl+X, then `pm2 restart panju-api` |
| WhatsApp stuck "Connecting" | Run `pm2 logs panju-api --lines 0` and watch live — if no QR appears after 60s use "Force Reconnect" in the UI |
| Blank page on refresh of inner routes | Nginx `try_files $uri /index.html;` missing |
| PDFs missing letterhead/pad artwork | `backend/assets/*.png` missing from the repo — check Phase 0 |
| `npm run build` killed on VPS | Small VPS ran out of RAM — add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
