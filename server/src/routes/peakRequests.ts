// server/src/routes/peakRequests.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/peak-requests?status=NEW&agentId=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, agentId, limit = '50', offset = '0', includeArchived, search } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };
    if (search) {
      where.OR = [
        { requestText: { contains: search as string } },
        { contactEmail: { contains: search as string } },
        { comments: { contains: search as string } },
      ];
    }
    if (status) where.status = status as string;
    if (agentId) where.agentId = agentId as string;

    const [requests, total] = await Promise.all([
      prisma.peakRequest.findMany({
        where,
        include: { agent: true },
        orderBy: { requestDate: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.peakRequest.count({ where }),
    ]);

    res.json({ requests, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch peak requests' });
  }
});

// GET /api/peak-requests/new-count
router.get('/new-count', async (req: Request, res: Response) => {
  try {
    const count = await prisma.peakRequest.count({
      where: { archived: false, status: 'NEW' },
    });
    res.json({ count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch new requests count' });
  }
});

// POST /api/peak-requests
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, contactEmail, profileNickname, requestText, requestDate, comments } = req.body;

    if (!agentId || !requestText || !requestDate) {
      return res.status(400).json({ error: 'agentId, requestText, and requestDate are required' });
    }

    const request = await prisma.peakRequest.create({
      data: {
        agentId,
        contactEmail: contactEmail || null,
        profileNickname: profileNickname || null,
        requestText,
        requestDate: new Date(requestDate),
        status: 'NEW',
        comments: comments || null,
      },
      include: { agent: true },
    });

    return res.status(201).json(request);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create peak request' });
  }
});

// PUT /api/peak-requests/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, contactEmail, profileNickname, requestText, requestDate, comments } = req.body;

    if (!agentId || !requestText || !requestDate) {
      return res.status(400).json({ error: 'agentId, requestText, and requestDate are required' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data: {
        agentId,
        contactEmail: contactEmail || null,
        profileNickname: profileNickname || null,
        requestText,
        requestDate: new Date(requestDate),
        comments: comments || null,
      },
      include: { agent: true },
    });

    return res.json(request);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update peak request' });
  }
});

// PATCH /api/peak-requests/:id/fields  — lightweight inline update (comments, tags)
router.patch('/:id/fields', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comments, tags } = req.body;

    const data: Record<string, unknown> = {};
    if (comments !== undefined) data.comments = comments || null;
    if (tags !== undefined) data.tags = tags;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data,
      include: { agent: true },
    });

    return res.json(request);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update fields' });
  }
});

// PATCH /api/peak-requests/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['NEW', 'IN_PROGRESS', 'DONE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data: { status },
      include: { agent: true },
    });

    return res.json(request);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE (archive) /api/peak-requests/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.peakRequest.update({
      where: { id },
      data: { archived: true },
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive peak request' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.peakRequest.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete peak request' });
  }
});

export default router;
