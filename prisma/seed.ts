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
];

const USERS: {
  name: string; email: string; role: string; peekDutyEligible?: boolean;
  team?: string; secondaryTeam?: string; peekviewerAdmin?: boolean; hiddenPeekviewerTabs?: string;
}[] = [
  { name: 'Victoria Davis',    email: 'victoria_pryts@struktura.io',        role: 'lead', secondaryTeam: 'peekviewer', peekviewerAdmin: true },
  { name: 'Sandra Moore',      email: 'oleksandra_kraichynska@struktura.io', role: 'head', secondaryTeam: 'peekviewer', peekviewerAdmin: true },
  { name: 'Jonathan Lewis',    email: 'yan_horlatyi@struktura.io',           role: 'agent' },
  { name: 'Julia Manson',      email: 'tetiana_blazhievska@struktura.io',    role: 'agent', peekDutyEligible: true },
  { name: 'Nicky Brown',       email: 'myroslava_horshchar@struktura.io',    role: 'agent' },
  { name: 'Iryna Kolodienko',  email: 'iryna_kolodienko@struktura.io',       role: 'peek_handler', team: 'peekviewer', hiddenPeekviewerTabs: 'references' },
  { name: 'Victoria Horopeka', email: 'victoria_horopeka@struktura.io',      role: 'peek_handler', team: 'peekviewer', hiddenPeekviewerTabs: 'references' },
  { name: 'Tetyana Veremeyenko', email: 'tetiana_veremeenko@struktura.io',   role: 'agent', team: 'peekviewer', hiddenPeekviewerTabs: 'references' },
  { name: 'Anna Bilous',       email: 'anna_bilous@struktura.io',            role: 'agent', team: 'peekviewer', hiddenPeekviewerTabs: 'schedule' },
  { name: 'Yana Fedorova',     email: 'yana_fedorova@struktura.io',          role: 'agent', team: 'peekviewer', peekviewerAdmin: true, hiddenPeekviewerTabs: 'references' },
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
        team: u.team ?? 'support',
        secondaryTeam: u.secondaryTeam ?? null,
        peekviewerAdmin: u.peekviewerAdmin ?? false,
        hiddenPeekviewerTabs: u.hiddenPeekviewerTabs ?? '',
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        agentId: agentByName[u.name]?.id ?? null,
        peekDutyEligible: u.peekDutyEligible ?? false,
        team: u.team ?? 'support',
        secondaryTeam: u.secondaryTeam ?? null,
        peekviewerAdmin: u.peekviewerAdmin ?? false,
        hiddenPeekviewerTabs: u.hiddenPeekviewerTabs ?? '',
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
