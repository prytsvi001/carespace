// server/src/app.ts
// Express app setup, shared between the local dev entry (src/index.ts) and
// the Vercel serverless entry (api/index.ts). Contains no app.listen().
import './loadEnv'; // MUST be first — loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';

import agentsRouter from './routes/agents';
import shiftLogsRouter from './routes/shiftLogs';
import calendarRouter from './routes/calendar';
import qaRouter from './routes/qa';
import peakRequestsRouter from './routes/peakRequests';
import statisticsRouter from './routes/statistics';
import authRouter from './routes/auth';      // also configures passport strategies
import plansRouter from './routes/plans';
import inboxRouter from './routes/inbox';
import reviewsRouter from './routes/reviews';
import qaReportsRouter from './routes/qaReports';
import pdpRouter from './routes/pdp';
import quickLinksRouter from './routes/quickLinks';
import shortcutsRouter from './routes/shortcuts';
import personalShortcutsRouter from './routes/personalShortcuts';
import peekCalendarRouter from './routes/peekCalendar';
import updatesRouter from './routes/updates';
import kpiRouter from './routes/kpi';
import dutyRouter from './routes/duty';
import telegramRouter from './routes/telegram';
import cronRouter from './routes/cron';
import backupRouter from './routes/backup';
import salaryRouter from './routes/salary';
import { requireAuth } from './middleware/auth';

const app = express();

// Vercel (and most PaaS) sit behind a reverse proxy — without this, Express
// can't tell the request was HTTPS, which breaks `cookie.secure` in production.
app.set('trust proxy', 1);

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// A handful of routes accept small base64-encoded images and need more than
// Express's default ~100kb json body limit. These MUST be registered before
// the blanket express.json() below, not just declared again at the route level
// inside their own router files — body-parser no-ops (skips re-reading the
// stream) if a request's body was already parsed by an earlier instance, so a
// route-level `express.json({limit:'6mb'})` registered AFTER the app-wide
// default has already run never actually takes effect: the default's smaller
// limit silently 413s anything over ~100kb before the larger override is ever
// reached. (Confirmed: this was already happening in production for the
// Quick Actions image-paste feature.)
app.use('/api/shortcuts', express.json({ limit: '6mb' }));
app.use('/api/personal-shortcuts', express.json({ limit: '6mb' }));
app.use('/api/auth/avatar', express.json({ limit: '2mb' }));

app.use(express.json());

// express-session's default MemoryStore doesn't survive serverless cold
// starts / multiple warm instances, so production sessions are backed by
// Postgres. Local dev keeps MemoryStore — DATABASE_URL there is a SQLite
// file path, not something `pg` can connect to.
const sessionStore =
  process.env.NODE_ENV === 'production'
    ? new (pgSession(session))({
        pool: new Pool({ connectionString: process.env.DATABASE_URL }),
        tableName: 'session',
        createTableIfMissing: true,
      })
    : undefined;

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-change-before-deploy',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      // SameSite=None (only in prod, where secure:true is required alongside
      // it) so the session cookie is sent on requests from the
      // chrome-extension:// origin the CareSpace Quick Actions extension
      // runs in — those are cross-site requests, and the default/Lax
      // wouldn't attach the cookie to a fetch() the way it does to a
      // top-level navigation.
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ── Public routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── Protected routes ─────────────────────────────────────────────────────────
app.use('/api/agents',        requireAuth, agentsRouter);
app.use('/api/shift-logs',    requireAuth, shiftLogsRouter);
app.use('/api/calendar',      requireAuth, calendarRouter);
app.use('/api/qa',            requireAuth, qaRouter);
app.use('/api/peak-requests', requireAuth, peakRequestsRouter);
app.use('/api/statistics',    requireAuth, statisticsRouter);
app.use('/api/plans',   plansRouter);   // requireAuth applied inside router
app.use('/api/inbox',   inboxRouter);   // requireAuth applied inside router
app.use('/api/reviews',    reviewsRouter);    // requireAuth applied inside router
app.use('/api/qa-reports', qaReportsRouter); // requireAuth applied inside router
app.use('/api/pdp',         pdpRouter);        // requireAuth applied inside router
app.use('/api/quick-links', quickLinksRouter); // requireAuth applied inside router
app.use('/api/shortcuts',   shortcutsRouter);   // requireAuth applied inside router
app.use('/api/personal-shortcuts', personalShortcutsRouter); // requireAuth + userId-scoped everywhere, no admin override
app.use('/api/peek-calendar', peekCalendarRouter); // requireAuth + per-user access check applied inside router
app.use('/api/updates', updatesRouter); // requireAuth + head/lead-only writes, peek_handler excluded entirely
app.use('/api/kpi',         kpiRouter);        // requireAuth applied inside router
app.use('/api/duty',        dutyRouter);       // requireAuth applied inside router
app.use('/api/telegram',    telegramRouter);   // requireAuth applied per-route (webhook has none)
app.use('/api/cron',        cronRouter);       // secret-header check applied inside router, not requireAuth
app.use('/api/backup',      requireAuth, backupRouter); // requireAuth + head/lead-only check applied inside router
app.use('/api/salary',      requireAuth, salaryRouter); // requireAuth + head/lead-only check applied inside router

export default app;
