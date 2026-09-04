// server/src/routes/auth.ts
import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import prisma from '../prisma';

// Extend Express.User globally so req.user is typed throughout the server
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      role: string;
      agentId: string | null;
      telegramChatId: string | null;
      avatarUrl: string | null;
      salaryAccess: boolean;
    }
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3001/api/auth/google/callback',
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('No email returned from Google'));

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return done(null, false);

        // Persist googleId on first login
        if (!user.googleId) {
          await prisma.user.update({ where: { email }, data: { googleId: profile.id } });
        }

        return done(null, {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          agentId: user.agentId,
          telegramChatId: user.telegramChatId,
          avatarUrl: user.avatarUrl,
          salaryAccess: user.salaryAccess,
        });
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, (user as Express.User).id));

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return done(null, false);
    done(null, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agentId: user.agentId,
      telegramChatId: user.telegramChatId,
      avatarUrl: user.avatarUrl,
      salaryAccess: user.salaryAccess,
    });
  } catch (err) {
    done(err);
  }
});

const router = Router();

// Initiates Google OAuth flow
router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

// Google callback — redirects to client on success or failure
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.CLIENT_URL || 'http://localhost:5173'}/?error=unauthorized`,
  }),
  (_req: Request, res: Response) => {
    res.redirect(process.env.CLIENT_URL || 'http://localhost:5173');
  }
);

// Returns current session user (called by client on app load)
router.get('/me', (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.user);
});

// Sets or clears (avatarUrl: null) the current user's profile photo. The 2mb
// body limit (client already resizes/recompresses to a small JPEG data URL
// before sending, so this is generous headroom) is applied in app.ts, not
// here — see the comment there for why a route-level express.json() override
// would silently never take effect.
router.put('/avatar', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const { avatarUrl } = req.body as { avatarUrl?: string | null };
  if (avatarUrl && !/^data:image\//.test(avatarUrl)) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  try {
    const updated = await prisma.user.update({
      where: { id: (req.user as Express.User).id },
      data: { avatarUrl: avatarUrl || null },
    });
    res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      agentId: updated.agentId,
      telegramChatId: updated.telegramChatId,
      avatarUrl: updated.avatarUrl,
      salaryAccess: updated.salaryAccess,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// Logout
router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ success: true });
  });
});

export default router;
