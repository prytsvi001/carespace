// scripts/import-data-to-supabase.ts
// Step 2 of the local -> Supabase data migration. Run this AFTER
// scripts/export-local-data.ts and AFTER regenerating the Prisma client
// for postgresql (schema switched to postgres, same as the Vercel build).
// Reads the JSON dump and writes it into Supabase, remapping every
// agentId/userId foreign key by name/email since Supabase's Agent/User
// rows were seeded with fresh ids.
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const dumpPath = path.join(__dirname, 'local-data-export.json');
  const data = JSON.parse(fs.readFileSync(dumpPath, 'utf8'), (_key, value) =>
    typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : value
  );

  const targetAgents = await prisma.agent.findMany();
  const targetUsers = await prisma.user.findMany();

  const agentIdByName = new Map(targetAgents.map((a: any) => [a.name, a.id]));
  const userIdByEmail = new Map(targetUsers.map((u: any) => [u.email, u.id]));
  const agentNameById = new Map(data.agents.map((a: any) => [a.id, a.name]));
  const userEmailById = new Map(data.users.map((u: any) => [u.id, u.email]));

  function remapAgentId(oldAgentId: string): string {
    const name = agentNameById.get(oldAgentId);
    const newId = name ? agentIdByName.get(name) : undefined;
    if (!newId) throw new Error(`No matching Supabase agent for local agentId ${oldAgentId} (name: ${name})`);
    return newId as string;
  }

  function remapUserId(oldUserId: string): string {
    const email = userEmailById.get(oldUserId);
    const newId = email ? userIdByEmail.get(email) : undefined;
    if (!newId) throw new Error(`No matching Supabase user for local userId ${oldUserId} (email: ${email})`);
    return newId as string;
  }

  let created = 0;

  for (const s of data.shiftLogs) {
    await prisma.shiftLog.create({ data: { ...s, agentId: remapAgentId(s.agentId) } });
    created++;
  }

  for (const c of data.calendarEvents) {
    await prisma.calendarEvent.create({ data: { ...c, agentId: remapAgentId(c.agentId) } });
    created++;
  }

  for (const p of data.peakRequests) {
    await prisma.peakRequest.create({ data: { ...p, agentId: remapAgentId(p.agentId) } });
    created++;
  }

  for (const q of data.aiChatQA) {
    await prisma.aIChatQA.create({ data: q });
    created++;
  }

  for (const r of data.qaReports) {
    const { issues, agentReports, ...report } = r;
    await prisma.qAReport.create({ data: report });
    created++;
    for (const issue of issues) {
      await prisma.qAIssue.create({ data: { ...issue, agentId: remapAgentId(issue.agentId) } });
      created++;
    }
    for (const ar of agentReports) {
      await prisma.qAAgentReport.create({ data: { ...ar, agentId: remapAgentId(ar.agentId) } });
      created++;
    }
  }

  for (const p of data.plans) {
    await prisma.plan.create({ data: { ...p, userId: remapUserId(p.userId) } });
    created++;
  }

  for (const c of data.clientReviews) {
    await prisma.clientReview.create({ data: { ...c, userId: remapUserId(c.userId) } });
    created++;
  }

  for (const q of data.quickLinks) {
    await prisma.quickLink.create({ data: { ...q, userId: remapUserId(q.userId) } });
    created++;
  }

  for (const plan of data.pdpPlans) {
    const { goals, tasks, feedback, ...planData } = plan;
    await prisma.pdpPlan.create({ data: { ...planData, userId: remapUserId(planData.userId) } });
    created++;
    for (const goal of goals) {
      await prisma.pdpGoal.create({ data: goal });
      created++;
    }
    for (const task of tasks) {
      await prisma.pdpTask.create({ data: task });
      created++;
    }
    if (feedback) {
      await prisma.pdpFeedback.create({ data: feedback });
      created++;
    }
  }

  for (const k of data.kpiSettings) {
    await prisma.kpiSettings.upsert({ where: { id: k.id }, update: k, create: k });
    created++;
  }

  console.log(`Migration complete — ${created} rows written to Supabase.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
