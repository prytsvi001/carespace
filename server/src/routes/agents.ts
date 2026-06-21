// server/src/routes/agents.ts
import { Router } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/agents
router.get('/', async (_req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' },
    });
    res.json(agents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

export default router;
