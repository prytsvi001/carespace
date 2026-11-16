// server/src/routes/requestSchedule.wave.test.ts
// Reference tests for the wave rotation formula.
// Run with:  npx tsx server/src/routes/requestSchedule.wave.test.ts
import assert from 'assert/strict';
import { waveFirstAgentIndex, waveOwnerIndex, isWaveTransferDay, waveCycleNumber } from './requestSchedule';

const COHORT_EPOCH_MS = Date.UTC(2026, 10, 1);
const MS_PER_DAY = 86_400_000;

function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - COHORT_EPOCH_MS) / MS_PER_DAY);
}

const AGENTS = ['Diana', 'Tetyana', 'Yana', 'Daria'] as const;

function agentOn(waveDate: string, viewDate: string): typeof AGENTS[number] {
  return AGENTS[waveOwnerIndex(dayIndex(waveDate), dayIndex(viewDate))];
}

function firstAgent(waveDate: string): typeof AGENTS[number] {
  return AGENTS[waveFirstAgentIndex(dayIndex(waveDate))];
}

let passed = 0;
let failed = 0;

function check(label: string, actual: string, expected: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL  ${label}: expected ${expected}, got ${actual}`);
  }
}

// ─── Reference check 1: 10 листопада ────────────────────────────────────────
// Diana веде 7–12, Tetyana веде 1–3, Yana веде 4–6
console.log('1. Nov 10 view date:');
for (const d of [7, 8, 9, 10, 11, 12]) check(`Nov ${d} on Nov 10`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-10'), 'Diana');
for (const d of [1, 2, 3])             check(`Nov ${d} on Nov 10`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-10'), 'Tetyana');
for (const d of [4, 5, 6])             check(`Nov ${d} on Nov 10`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-10'), 'Yana');

// ─── Reference check 2: 13 листопада ────────────────────────────────────────
// Diana веде 7–12, Tetyana веде 1–3 і 13–15, Yana веде 4–6
console.log('2. Nov 13 view date:');
for (const d of [7, 8, 9, 10, 11, 12])  check(`Nov ${d} on Nov 13`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-13'), 'Diana');
for (const d of [1, 2, 3, 13, 14, 15])  check(`Nov ${d} on Nov 13`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-13'), 'Tetyana');
for (const d of [4, 5, 6])              check(`Nov ${d} on Nov 13`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-13'), 'Yana');

// ─── Reference check 3: 19 листопада ────────────────────────────────────────
// Diana веде 4–6 і 16–21, Tetyana веде 7–12, Yana веде 1–3 і 13–15
console.log('3. Nov 19 view date:');
for (const d of [4, 5, 6, 16, 17, 18, 19, 20, 21]) check(`Nov ${d} on Nov 19`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-19'), 'Diana');
for (const d of [7, 8, 9, 10, 11, 12])              check(`Nov ${d} on Nov 19`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-19'), 'Tetyana');
for (const d of [1, 2, 3, 13, 14, 15])              check(`Nov ${d} on Nov 19`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-19'), 'Yana');

// ─── 22.11 — Daria Biletska joins (4 agents, 12-day cycles) ─────────────────
const nov = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const dec = (d: number) => `2026-12-${String(d).padStart(2, '0')}`;
function expectOwners(viewDate: string, owners: Record<string, string[]>) {
  for (const [agent, dates] of Object.entries(owners)) {
    for (const d of dates) check(`${d} on ${viewDate}`, agentOn(d, viewDate), agent);
  }
}

console.log('4. New-client blocks from Nov 22:');
const blocks: [number, string][] = [
  [Date.UTC(2026, 10, 22), 'Daria'], [Date.UTC(2026, 10, 25), 'Tetyana'],
  [Date.UTC(2026, 10, 28), 'Yana'], [Date.UTC(2026, 11, 1), 'Diana'],
  [Date.UTC(2026, 11, 4), 'Daria'], [Date.UTC(2026, 11, 7), 'Tetyana'],
];
for (const [ms, agent] of blocks) {
  for (let k = 0; k < 3; k++) {
    const d = new Date(ms + k * MS_PER_DAY).toISOString().slice(0, 10);
    check(`${d} firstAgent`, firstAgent(d), agent);
  }
}

console.log('5. Nov 22 view date (no transfer, Daria starts):');
expectOwners(nov(22), {
  Yana: [1, 2, 3, 13, 14, 15].map(nov),
  Diana: [4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov),
  Tetyana: [7, 8, 9, 10, 11, 12].map(nov),
  Daria: [nov(22)],
});

console.log('6. Dec 3 view date (eve of first 4-agent transfer):');
expectOwners(dec(3), {
  Yana: [...[1, 2, 3, 13, 14, 15, 28, 29, 30].map(nov)],
  Diana: [...[4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov), ...[1, 2, 3].map(dec)],
  Tetyana: [7, 8, 9, 10, 11, 12, 25, 26, 27].map(nov),
  Daria: [22, 23, 24].map(nov),
});

console.log('7. Dec 4 view date (transfer Diana→Daria→Tetyana→Yana→Diana):');
expectOwners(dec(4), {
  Diana: [1, 2, 3, 13, 14, 15, 28, 29, 30].map(nov),
  Daria: [...[4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov), ...[1, 2, 3, 4].map(dec)],
  Yana: [7, 8, 9, 10, 11, 12, 25, 26, 27].map(nov),
  Tetyana: [22, 23, 24].map(nov),
});

console.log('8. Dec 16 view date (second 4-agent transfer):');
expectOwners(dec(16), {
  Daria: [...[1, 2, 3, 13, 14, 15, 28, 29, 30].map(nov), ...[13, 14, 15, 16].map(dec)],
  Tetyana: [...[4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov), ...[1, 2, 3, 4, 5, 6].map(dec)],
  Diana: [...[7, 8, 9, 10, 11, 12, 25, 26, 27].map(nov), ...[10, 11, 12].map(dec)],
  Yana: [...[22, 23, 24].map(nov), ...[7, 8, 9].map(dec)],
});

// ─── Transfer days & cycle numbers ───────────────────────────────────────────
console.log('9. Transfer days:');
for (const d of [nov(10), nov(19), dec(4), dec(16), dec(28)]) check(`${d} is transfer`, String(isWaveTransferDay(dayIndex(d))), 'true');
for (const d of [nov(1), nov(22), nov(28), dec(7)]) check(`${d} is not transfer`, String(isWaveTransferDay(dayIndex(d))), 'false');
console.log('10. Cycle numbers:');
for (const [d, n] of [[nov(1), 1], [nov(10), 2], [nov(21), 3], [nov(22), 4], [dec(3), 4], [dec(4), 5]] as const) {
  check(`${d} cycle`, String(waveCycleNumber(dayIndex(d))), String(n));
}

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
