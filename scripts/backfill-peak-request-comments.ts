// scripts/backfill-peak-request-comments.ts
//
// PeakRequest.comments used to be a single free-text note (overwritten on every
// edit). It's now a JSON-encoded array of { authorId, authorName, text, createdAt }
// so cards can show a running comment thread. This one-off script converts any
// row still holding the old plain-text value into a one-item array, so existing
// notes keep showing up instead of silently disappearing behind JSON.parse.
//
// Idempotent — rows that already hold a valid JSON array are left untouched, so
// it's safe to run again (e.g. once against the production database after that
// schema is synced with `prisma db push`).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const requests = await prisma.peakRequest.findMany({ select: { id: true, comments: true, updatedAt: true } });

  let migrated = 0;
  for (const r of requests) {
    let isJsonArray = false;
    try { isJsonArray = Array.isArray(JSON.parse(r.comments)); } catch { /* not JSON */ }
    if (isJsonArray) continue;

    const legacyComment = [{
      authorId: null,
      authorName: 'Legacy note',
      text: r.comments,
      createdAt: r.updatedAt.toISOString(),
    }];
    await prisma.peakRequest.update({ where: { id: r.id }, data: { comments: JSON.stringify(legacyComment) } });
    migrated++;
  }

  console.log(`Backfilled ${migrated} of ${requests.length} PeakRequest row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
