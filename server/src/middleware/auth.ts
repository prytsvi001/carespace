// server/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// Gates the Peekviewer-team-only routes (Boost, Proxy, Row Accounts) — home team
// or, for Victoria Davis/Sandra Moore, their secondary team.
export function requirePeekviewerTeam(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as Express.User | undefined;
  if (user && (user.team === 'peekviewer' || user.secondaryTeam === 'peekviewer')) {
    next();
    return;
  }
  res.status(403).json({ error: 'Not permitted' });
}
