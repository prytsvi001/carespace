// server/src/index.ts
import './loadEnv'; // MUST be first — loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';

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
import kpiRouter from './routes/kpi';
import { requireAuth } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-before-deploy',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
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
app.use('/api/kpi',         kpiRouter);        // requireAuth applied inside router

app.listen(PORT, () => {
  console.log(`🚀 TeamSpace API running on http://localhost:${PORT}`);
});

export default app;
