# TeamSpace — Deployment Guide

This document covers everything needed to deploy TeamSpace on company infrastructure.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js 20 + Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL 16 (production) / SQLite (development only) |
| Auth | Google OAuth 2.0 via Passport.js — session-based (no JWTs) |
| Reverse proxy | Nginx (included in Docker Compose) |

---

## Architecture (Docker Compose)

```
Browser
  └─► Nginx :80
        ├─ GET /           → serves React SPA from client/dist/
        └─ /api/*          → proxies to Express app :3001
                                └─► PostgreSQL :5432
```

SSL termination is expected to happen at the infrastructure level (load balancer,
Cloudflare, or an outer nginx). The provided Docker Compose listens on plain HTTP
port 80 — your infrastructure should terminate TLS before traffic reaches it.

---

## Prerequisites

- Docker 24+ and Docker Compose v2+
- A registered Google Cloud project with OAuth 2.0 credentials (see section below)
- A domain name pointing to the server (needed before registering Google OAuth URIs)

---

## Step 1 — One-time Google Cloud Console setup

1. Go to **https://console.cloud.google.com → APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Set the following (replace `your-domain.com` with the actual domain):

   | Field | Value |
   |---|---|
   | Authorized JavaScript origins | `https://your-domain.com` |
   | Authorized redirect URIs | `https://your-domain.com/api/auth/google/callback` |

5. Click **Create** and copy the **Client ID** and **Client Secret** — you will need them in Step 2.

> If deploying to multiple environments (staging + production), create a separate
> OAuth client for each one.

---

## Step 2 — Create the production .env file

Copy the example and fill in every value:

```bash
cp .env.production.example .env.production
```

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Password for the Docker-managed PostgreSQL container. Pick something strong. |
| `DATABASE_URL` | Full PostgreSQL connection string. Must use the same password as above when running via Docker Compose. |
| `PORT` | Port the Express server listens on inside the container. Leave as `3001`. |
| `NODE_ENV` | Must be `production`. |
| `CLIENT_URL` | The public URL of the app, e.g. `https://your-domain.com`. No trailing slash. Used for CORS. |
| `SESSION_SECRET` | Long random string used to sign session cookies. Generate with `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console (Step 1). |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console (Step 1). |
| `GOOGLE_CALLBACK_URL` | Must exactly match the redirect URI registered in Google Cloud Console: `https://your-domain.com/api/auth/google/callback` |

> Never commit `.env.production` to git. The repository's `.gitignore` already
> excludes `.env` files.

---

## Step 3 — Build and start

```bash
# Build both images and start all services in the background
docker compose --env-file .env.production up --build -d
```

The first build takes ~3–5 minutes (installs npm deps, compiles TypeScript, bundles React).
Subsequent builds are cached and are much faster.

Check that all three containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                   SERVICE    STATUS    PORTS
teamspace-postgres-1   postgres   running   5432/tcp
teamspace-app-1        app        running   3001/tcp
teamspace-nginx-1      nginx      running   0.0.0.0:80->80/tcp
```

---

## Step 4 — Set up the database schema

Run once after first start (pushes schema to the fresh PostgreSQL database):

```bash
docker compose exec app npx prisma db push --schema=./prisma/schema.prisma
```

---

## Step 5 — Seed user accounts

The app uses Google OAuth — only users whose emails are pre-seeded in the database
can log in. Edit the seed file first, then run it:

```bash
# Open the seed file and replace the placeholder emails with real ones
#   prisma/seed.ts — update the `users` array with actual names and email addresses
#
# Then run:
docker compose exec app npx tsx prisma/seed.ts
```

The seed is idempotent (uses upsert) — it can be re-run safely to add new users
without affecting existing data.

---

## Step 6 — Verify the deployment

1. Open `http://your-server-ip` in a browser
2. Click **Sign in with Google**
3. Complete the OAuth flow with a seeded user's Google account
4. You should land on the TeamSpace dashboard

---

## Updating the application

```bash
# Pull latest source
git pull

# Rebuild images and restart (down-time: ~30 seconds)
docker compose --env-file .env.production up --build -d

# Apply any schema changes
docker compose exec app npx prisma db push --schema=./prisma/schema.prisma
```

---

## Useful maintenance commands

```bash
# View live logs
docker compose logs -f

# View logs for a single service
docker compose logs -f app

# Open a PostgreSQL shell
docker compose exec postgres psql -U teamspace teamspace

# Stop all services
docker compose down

# Stop and wipe the database volume (destructive!)
docker compose down -v
```

---

## Adding new allowed users

Edit `prisma/seed.ts`, add the user to the `users` array, then re-seed:

```bash
docker compose exec app npx tsx prisma/seed.ts
```

The new user can then log in with their Google account.

---

## Manual deployment (without Docker)

If you prefer to manage the server manually:

### Prerequisites
- Node.js 20 LTS
- PostgreSQL 16
- nginx

### Build steps

```bash
# 1. Install dependencies
npm install

# 2. Update prisma/schema.prisma — change the datasource provider:
#    provider = "sqlite"  →  provider = "postgresql"
#    (the DATABASE_URL env var already points to PostgreSQL)

# 3. Generate Prisma client
npx prisma generate --schema=./prisma/schema.prisma

# 4. Build frontend
npm run build --workspace=client
# Output: client/dist/

# 5. Build backend
npm run build --workspace=server
# Output: server/dist/

# 6. Set environment variables (see Step 2 above)

# 7. Push schema to database
npx prisma db push --schema=./prisma/schema.prisma

# 8. Seed users
npx tsx prisma/seed.ts

# 9. Start the server
cd server && node dist/index.js
```

### Nginx configuration for manual deployment

Use the file at `nginx/nginx.conf` as a starting point. The key parts:
- Serve `client/dist/` as the document root
- Proxy `/api` to the Node.js server on port 3001
- `try_files $uri $uri/ /index.html` for SPA routing

---

## Environment variables — complete reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL: `postgresql://user:pass@host:5432/db` |
| `PORT` | No | `3001` | Express listen port |
| `NODE_ENV` | Yes | — | Set to `production` |
| `CLIENT_URL` | Yes | — | Frontend origin, used for CORS |
| `SESSION_SECRET` | Yes | — | Signs session cookies; rotate to invalidate all sessions |
| `GOOGLE_CLIENT_ID` | Yes | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | — | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | Yes | — | Must match Google Cloud Console exactly |
| `POSTGRES_PASSWORD` | Docker only | — | Sets password for the managed postgres container |

---

## Security notes

- Sessions are stored server-side (express-session with memory store by default in production).
  For multi-instance deployments, replace the session store with Redis or PostgreSQL-backed sessions.
- The `SESSION_SECRET` should be rotated periodically. Rotating it invalidates all active sessions
  (all users will need to log in again).
- Only users whose email addresses are present in the `User` table can authenticate.
  Google OAuth will redirect them back with an error if their email is not found.
