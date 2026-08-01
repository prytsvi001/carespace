// scripts/backfill-peak-request-client-cards.ts
//
// PeakRequest used to be one flat row per submitted request; the "Client Card"
// redesign groups requests from the same client (matched by contactEmail +
// profileNickname) under one ClientCard, with the newest request as the
// active one and the rest as read-only history. This one-off script creates
// the ClientCard rows for all EXISTING PeakRequest data and links each row to
// its card via clientCardId, which the app code (going forward) always sets
// on create — this script only needs to handle the backlog.
//
// Idempotent — rows that already have a clientCardId are left untouched, so
// it's safe to run again (e.g. once against the production database after
// that schema is synced).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Same normalization used in server/src/routes/peakRequests.ts's match-or-create
// and identity-edit collision check — keep these three in sync if ever changed.
function normalizeMatchKey(email: string | null, nickname: string | null): string | null {
  const e = email?.trim().toLowerCase();
  const n = nickname?.trim().toLowerCase();
  if (!e || !n) return null;
  return `${e}|${n}`;
}

async function main() {
  const requests = await prisma.peakRequest.findMany({
    where: { clientCardId: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  if (requests.length === 0) {
    console.log('No PeakRequest rows without a clientCardId — nothing to do.');
    return;
  }

  // Group by matchKey; a null key (blank email or nickname) gets its own
  // singleton group per row, keyed by the row's own id so it never collides
  // with another blank-identity row.
  const groups = new Map<string, typeof requests>();
  for (const r of requests) {
    const key = normalizeMatchKey(r.contactEmail, r.profileNickname) ?? `__singleton__${r.id}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  let cardsCreated = 0;
  let rowsLinked = 0;

  for (const [key, group] of groups) {
    // group is sorted asc by createdAt/id (inherited from the query above)
    const latest = group[group.length - 1];
    const earliest = group[0];
    const lastActivityAt = new Date(Math.max(...group.map((r) => r.updatedAt.getTime())));

    const card = await prisma.clientCard.create({
      data: {
        contactEmail: latest.contactEmail,
        profileNickname: latest.profileNickname,
        matchKey: key.startsWith('__singleton__') ? null : key,
        status: latest.status,
        archived: latest.archived,
        doneAt: latest.doneAt,
        lastActivityAt,
        createdAt: earliest.createdAt,
      },
    });
    cardsCreated++;

    await prisma.peakRequest.updateMany({
      where: { id: { in: group.map((r) => r.id) } },
      data: { clientCardId: card.id },
    });
    rowsLinked += group.length;
  }

  console.log(`Created ${cardsCreated} ClientCard row(s), linked ${rowsLinked} of ${requests.length} PeakRequest row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
