# Panju Intext Backend — Docker Deployment (WhatsApp fix, same pattern as A2 Insurance)

This replaces how the **backend** process runs — `pm2 restart panju-api` running a bare
`node src/index.js` becomes a Docker container. Everything else is unchanged:

- Nginx still reverse-proxies to `localhost:5000` — no Nginx config changes.
- MySQL still runs directly on the VPS host (not containerized).
- The frontend build (`npm run build` served by Nginx) is untouched.

**Why**: the root cause of slow WhatsApp connect/QR was `apt install chromium-browser` on
Ubuntu 24.04 resolving to the **snap**-packaged Chromium, which has a well-documented slow
cold-start (10-30s+, squashfs mount overhead). The Dockerfile installs the real
`google-chrome-stable` `.deb` instead — same fix A2 Insurance already uses, launches in ~1-2s.

> If you just want the speed fix without adopting Docker yet, you can also apply it directly to
> the existing pm2 setup — see the updated Phase 2/5 of `DEPLOYMENT.md`. This guide is for the
> full Docker migration specifically, since that's what was asked for.

I haven't been able to test this against your actual VPS (no access) — the first run may need a
small adjustment. Go through it slowly rather than assuming every step is exactly right.

---

## One-time: install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
docker --version
```

---

## Build the image

```bash
cd /var/www/panjuintext/backend
docker build -t panjuintext-backend .
```

This takes a few minutes the first time (installing Chrome + npm packages). Re-run this after
every `git pull` that touches the backend.

---

## First run

```bash
cd /var/www/panjuintext/backend
cp .env.docker .env.docker.local
nano .env.docker.local   # fill in the real DATABASE_URL password + JWT_SECRET from your existing .env
```

```bash
docker run -d \
  --name panjuintext-backend \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 5000:5000 \
  --env-file .env.docker.local \
  -v /var/www/panjuintext/backend/.wwebjs_auth:/app/.wwebjs_auth \
  -v /var/www/panjuintext/backend/uploads:/app/uploads \
  panjuintext-backend
```

The two `-v` mounts matter: without them, WhatsApp sessions (`.wwebjs_auth`) and uploaded files
(company logo, `uploads/`) would be wiped out every time the image gets rebuilt, since they'd
otherwise live only inside the container's throwaway filesystem layer.

`--add-host=host.docker.internal:host-gateway` is what lets the container reach MySQL running on
the VPS host itself — without it, `host.docker.internal` in `DATABASE_URL` won't resolve.

---

## Verify

```bash
docker ps                              # should show panjuintext-backend as Up
docker logs -f panjuintext-backend     # watch startup + WhatsApp connect logs
curl http://localhost:5000/api/health  # or whatever your health/root route is — confirm it responds
```

Then open `admin.panjuintext.in/whatsapp` and time how fast the QR appears — should be seconds,
not tens of seconds.

---

## Redeploying after a `git pull`

```bash
cd /var/www/panjuintext/backend
git pull origin main
docker build -t panjuintext-backend .
docker stop panjuintext-backend
docker rm panjuintext-backend
docker run -d \
  --name panjuintext-backend \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 5000:5000 \
  --env-file .env.docker.local \
  -v /var/www/panjuintext/backend/.wwebjs_auth:/app/.wwebjs_auth \
  -v /var/www/panjuintext/backend/uploads:/app/uploads \
  panjuintext-backend
```

Prisma schema changes still need `docker exec panjuintext-backend npx prisma db push` after the
container is up (or run it once via `docker exec` — it talks to the same host MySQL either way).

---

## Rolling back to pm2 if something goes wrong

Nothing about the pm2 setup was removed — `ecosystem`/pm2 config still works exactly as before.
To go back: `docker stop panjuintext-backend`, then `pm2 restart panju-api` (or `pm2 start` if it
was stopped). Both can't hold port 5000 at the same time, so stop one before starting the other.
