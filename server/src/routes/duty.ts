// server/src/routes/duty.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { getRotationPair } from '../rotationSchedule';

const router = Router();
router.use(requireAuth);

function isDutyEligible(user: { role: string; peekDutyEligible: boolean }): boolean {
  return user.role === 'peek_handler' || user.peekDutyEligible;
}

// GET /api/duty — my own status + who's currently online for the Peek Requests tab
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const meRecord = await prisma.user.findUnique({ where: { id: me.id } });
    if (!meRecord) return res.status(404).json({ error: 'User not found' });

    const peekOnline = await prisma.user.findMany({
      where: { peekOnDuty: true },
      select: { name: true },
      orderBy: { name: 'asc' },
    });

    const pair = getRotationPair(new Date());

    return res.json({
      myOnDuty: meRecord.peekOnDuty,
      eligible: isDutyEligible(meRecord),
      peekTeamOnline: peekOnline.map((u) => u.name),
      supportShift: pair ? { morning: pair.morning, night: pair.night } : { morning: null, night: null },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch duty status' });
  }
});

// PATCH /api/duty/me — toggle my own Peek duty status
router.patch('/me', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { onDuty } = req.body as { onDuty?: boolean };
    if (typeof onDuty !== 'boolean') {
      return res.status(400).json({ error: 'onDuty (boolean) is required' });
    }

    const meRecord = await prisma.user.findUnique({ where: { id: me.id } });
    if (!meRecord || !isDutyEligible(meRecord)) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    await prisma.user.update({ where: { id: me.id }, data: { peekOnDuty: onDuty } });
    return res.json({ success: true, onDuty });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update duty status' });
  }
});

export default router;
