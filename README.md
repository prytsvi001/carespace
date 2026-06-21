# 🧩 TeamSpace — Support Team Workspace

A web application for the support team replacing Google Sheets for shift tracking, statistics, and QA.

## Team
Victoria Davis · Nicky Brown · Julia Manson · Jonathan Lewis · Sandra Moore

## Stack
- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Charts**: Recharts
- **Drag & Drop**: @dnd-kit/core

---

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm 9+

### 1. Clone & install

```bash
git clone <repo>
cd teamspace
npm install
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL
```

Example `DATABASE_URL`:
```
postgresql://postgres:password@localhost:5432/teamspace
```

### 3. Database setup

```bash
# Run migrations
npm run db:migrate

# Seed with test data (5 agents + 30 days of dummy logs)
npm run db:seed
```

### 4. Start development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

---

## Modules

### 1. Daily Log 📋
- Select agent and shift type to log a new shift
- Record: chats, tickets, calls, refund requests, comments
- Summary strip shows team totals for any selected date
- All team members can see all logs

### 2. Statistics 📊
- Monthly dashboard per agent
- Bar chart: Chats, Tickets, Calls, Refunds per agent
- Detailed table with hours, shift counts, all metrics
- Team totals strip at the top

### 3. Shift Calendar 📅
- Monthly calendar view
- **Drag & drop** events to reschedule
- Click any day to add an event
- Event types: Shift, Vacation, Sick Leave, Birthday Off, Day Off
- Color-coded by type

### 4. AI Chats QA 🤖
- Log problematic bot chat responses
- Fields: Channel, Chat text, Date, Issue comment
- Filter by channel and date range
- Expand/collapse long chat transcripts

### 5. Peak Requests 💡
- Kanban board: New → In Progress → Done
- Agent submits feature/product requests
- One-click status transitions
- Filter by agent or status

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and backend |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed test data |
| `npm run db:studio` | Open Prisma Studio (GUI) |
| `npm run build` | Build for production |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| GET/POST | `/api/shift-logs` | Get/create shift logs |
| GET | `/api/shift-logs/today` | Today's logs |
| PUT/DELETE | `/api/shift-logs/:id` | Update/archive log |
| GET/POST | `/api/calendar` | Calendar events |
| PUT/DELETE | `/api/calendar/:id` | Update/archive event |
| GET/POST | `/api/qa` | QA entries |
| PUT/DELETE | `/api/qa/:id` | Update/archive QA |
| GET/POST | `/api/peak-requests` | Peak requests |
| PATCH | `/api/peak-requests/:id/status` | Update status |
| DELETE | `/api/peak-requests/:id` | Archive request |
| GET | `/api/statistics` | Monthly stats |
| GET | `/api/statistics/agent/:id` | Agent trend |

---

## Shift Hours
- ☀️ **Morning Shift** (09:00–17:00): **11 hours** (8 working + 3 bonus)
- 🌙 **Night Shift** (17:00–01:00): **8 hours**

## Data Policy
- All dates/times stored in UTC
- No hard deletes — data is archived (`archived: true`)
- SPA — no page reloads on form submissions

---

## Production Deployment

See **[DEPLOY.md](./DEPLOY.md)** for the full deployment guide, including:
- Docker Compose setup (recommended)
- Google Cloud Console OAuth configuration
- All environment variables
- Database migration and user seeding
