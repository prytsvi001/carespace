// scripts/export-local-data.ts
// Step 1 of the local -> Supabase data migration. Run this while the Prisma
// client is generated for sqlite (the normal local dev state). Dumps every
// real record to a JSON file for scripts/import-data-to-supabase.ts to read
// after the client has been regenerated for postgresql.
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const data = {
    agents: await prisma.agent.findMany(),
    users: await prisma.user.findMany(),
    shiftLogs: await prisma.shiftLog.findMany(),
    calendarEvents: await prisma.calendarEvent.findMany(),
    peakRequests: await prisma.peakRequest.findMany(),
    aiChatQA: await prisma.aIChatQA.findMany(),
    qaReports: await prisma.qAReport.findMany({ include: { issues: true, agentReports: true } }),
    plans: await prisma.plan.findMany(),
    clientReviews: await prisma.clientReview.findMany(),
    quickLinks: await prisma.quickLink.findMany(),
    pdpPlans: await prisma.pdpPlan.findMany({ include: { goals: true, tasks: true, feedback: true } }),
    kpiSettings: await prisma.kpiSettings.findMany(),
  };

  const outPath = path.join(__dirname, 'local-data-export.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  console.log(`Exported to ${outPath}:`);
  for (const [key, value] of Object.entries(data)) {
    console.log(`  ${key}: ${Array.isArray(value) ? value.length : 1}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
