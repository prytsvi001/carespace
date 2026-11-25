// server/src/routes/requestSchedule.wave.test.ts
// Reference tests for the wave rotation formula.
// Run with:  npx tsx server/src/routes/requestSchedule.wave.test.ts
import assert from 'assert/strict';
import { waveFirstAgentIndex, waveOwnerIndex, isWaveTransferDay, waveCycleNumber, waveScheduleStartIdx } from './requestSchedule';

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

console.log('4. New-client blocks from Nov 22 (Daria era, then 3-agent era from Dec 1):');
const blocks: [number, string][] = [
  [Date.UTC(2026, 10, 22), 'Daria'], [Date.UTC(2026, 10, 25), 'Tetyana'],
  [Date.UTC(2026, 10, 28), 'Yana'],
  [Date.UTC(2026, 11, 1), 'Tetyana'], [Date.UTC(2026, 11, 4), 'Yana'],
  [Date.UTC(2026, 11, 7), 'Diana'], [Date.UTC(2026, 11, 10), 'Tetyana'],
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

console.log('6. Nov 30 view date (last day of the Daria era):');
expectOwners(nov(30), {
  Yana: [1, 2, 3, 13, 14, 15, 28, 29, 30].map(nov),
  Diana: [4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov),
  Tetyana: [7, 8, 9, 10, 11, 12, 25, 26, 27].map(nov),
  Daria: [22, 23, 24].map(nov),
});

// ─── 01.12 — new schedule from scratch (Daria left) ─────────────────────────
// November waves stay frozen with their 30.11 owners; December waves rotate
// Tetyana → Yana → Diana with 9-day cycles.
const NOV_FROZEN = {
  Yana: [1, 2, 3, 13, 14, 15, 28, 29, 30].map(nov),
  Diana: [4, 5, 6, 16, 17, 18, 19, 20, 21].map(nov),
  Tetyana: [7, 8, 9, 10, 11, 12, 25, 26, 27].map(nov),
  Daria: [22, 23, 24].map(nov),
};

console.log('7. Dec 1 view date (fresh start):');
expectOwners(dec(1), { ...NOV_FROZEN, Tetyana: [...NOV_FROZEN.Tetyana, dec(1)] });

console.log('8. Dec 9 view date (eve of first transfer):');
expectOwners(dec(9), {
  Tetyana: [1, 2, 3].map(dec), Yana: [4, 5, 6].map(dec), Diana: [7, 8, 9].map(dec),
});

console.log('9. Dec 10 view date (transfer Tetyana→Yana→Diana→Tetyana; November untouched):');
expectOwners(dec(10), {
  Tetyana: [7, 8, 9, 10].map(dec), Yana: [1, 2, 3].map(dec), Diana: [4, 5, 6].map(dec),
});
expectOwners(dec(10), NOV_FROZEN);

console.log('10. Dec 19 view date (second transfer):');
expectOwners(dec(19), {
  Yana: [7, 8, 9, 10, 11, 12].map(dec),
  Diana: [1, 2, 3, 13, 14, 15].map(dec),
  Tetyana: [4, 5, 6, 16, 17, 18, 19].map(dec),
});
expectOwners(dec(31), NOV_FROZEN);

console.log('11. No December wave is ever Daria\'s:');
for (let w = dayIndex(dec(1)); w <= dayIndex(dec(31)); w++) {
  for (const v of [dec(15), dec(31)]) {
    if (w <= dayIndex(v)) check(`wave ${w} on ${v} not Daria`, String(AGENTS[waveOwnerIndex(w, dayIndex(v))] !== 'Daria'), 'true');
  }
}

console.log('12. Schedule start (reminders only list current-schedule waves):');
check('Nov 30 schedule start', String(waveScheduleStartIdx(dayIndex(nov(30)))), '0');
check('Dec 1 schedule start', String(waveScheduleStartIdx(dayIndex(dec(1)))), String(dayIndex(dec(1))));

// ─── Transfer days & cycle numbers ───────────────────────────────────────────
console.log('13. Transfer days:');
for (const d of [nov(10), nov(19), dec(10), dec(19), dec(28)]) check(`${d} is transfer`, String(isWaveTransferDay(dayIndex(d))), 'true');
for (const d of [nov(1), nov(22), nov(28), dec(1), dec(4), dec(16)]) check(`${d} is not transfer`, String(isWaveTransferDay(dayIndex(d))), 'false');
console.log('14. Cycle numbers (restart at 1 on Dec 1):');
for (const [d, n] of [[nov(1), 1], [nov(10), 2], [nov(21), 3], [nov(22), 4], [nov(30), 4], [dec(1), 1], [dec(9), 1], [dec(10), 2], [dec(28), 4]] as const) {
  check(`${d} cycle`, String(waveCycleNumber(dayIndex(d))), String(n));
}

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
