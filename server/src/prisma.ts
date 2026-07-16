// server/src/prisma.ts
import { PrismaClient } from '@prisma/client';

// Reuse a single client across hot-reloads (dev) and warm serverless
// invocations (Vercel) instead of opening a new connection pool each time.
const globalForPrisma = global as unknown as { __prisma?: PrismaClient };

const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

export default prisma;
