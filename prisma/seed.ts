// prisma/seed.ts
// Safe to run at any time — only upserts agents and users.
// Never deletes or modifies shift logs, calendar events, QA entries, or peak requests.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AGENTS = [
  'Victoria Davis',
  'Nicky Brown',
  'Julia Manson',
  'Jonathan Lewis',
  'Sandra Moore',
  'Victoria Zosim',
];

const USERS: { name: string; email: string; role: string; peekDutyEligible?: boolean }[] = [
  { name: 'Victoria Davis',    email: 'victoria_pryts@struktura.io',        role: 'lead' },
  { name: 'Sandra Moore',      email: 'oleksandra_kraichynska@struktura.io', role: 'head' },
  { name: 'Jonathan Lewis',    email: 'yan_horlatyi@struktura.io',           role: 'agent' },
  { name: 'Julia Manson',      email: 'tetiana_blazhievska@struktura.io',    role: 'agent', peekDutyEligible: true },
  { name: 'Nicky Brown',       email: 'myroslava_horshchar@struktura.io',    role: 'agent' },
  { name: 'Iryna Kolodienko',  email: 'iryna_kolodienko@struktura.io',       role: 'peek_handler' },
  { name: 'Victoria Horopeka', email: 'victoria_horopeka@struktura.io',      role: 'peek_handler' },
  { name: 'Victoria Zosim',    email: 'vika_zosim@struktura.io',             role: 'agent' },
];

async function main() {
  console.log('🌱 Seeding agents and users...');

  // Upsert agents — create if missing, skip if already exists
  const agents: { id: string; name: string }[] = [];
  for (const name of AGENTS) {
    const agent = await prisma.agent.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    agents.push(agent);
  }
  console.log(`✅ Upserted ${agents.length} agents`);

  // Upsert users linked to their agent records
  const agentByName = Object.fromEntries(agents.map((a) => [a.name, a]));
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name, role: u.role, agentId: agentByName[u.name]?.id ?? null,
        peekDutyEligible: u.peekDutyEligible ?? false,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        agentId: agentByName[u.name]?.id ?? null,
        peekDutyEligible: u.peekDutyEligible ?? false,
      },
    });
  }
  console.log(`✅ Upserted ${USERS.length} users`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
