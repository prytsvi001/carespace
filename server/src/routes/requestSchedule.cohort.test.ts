// server/src/routes/requestSchedule.wave.test.ts
// Reference tests for the wave rotation formula.
// Run with:  npx tsx server/src/routes/requestSchedule.wave.test.ts
import assert from 'assert/strict';
import { waveFirstAgentIndex, waveOwnerIndex } from './requestSchedule';

const COHORT_EPOCH_MS = Date.UTC(2026, 10, 1);
const MS_PER_DAY = 86_400_000;

function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - COHORT_EPOCH_MS) / MS_PER_DAY);
}

const AGENTS = ['Diana', 'Tetyana', 'Yana'] as const;

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

// ─── Reference check 4: 28 листопада ────────────────────────────────────────
// Diana веде 1–3, 13–15 і 25–30, Tetyana веде 4–6 і 16–21, Yana веде 7–12 і 22–24
console.log('4. Nov 28 view date:');
for (const d of [1, 2, 3, 13, 14, 15, 25, 26, 27, 28, 29, 30]) check(`Nov ${d} on Nov 28`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-28'), 'Diana');
for (const d of [4, 5, 6, 16, 17, 18, 19, 20, 21])              check(`Nov ${d} on Nov 28`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-28'), 'Tetyana');
for (const d of [7, 8, 9, 10, 11, 12, 22, 23, 24])              check(`Nov ${d} on Nov 28`, agentOn(`2026-11-${String(d).padStart(2,'0')}`, '2026-11-28'), 'Yana');

// ─── Reference check 5: 1 грудня — перший агент нових клієнтів = Tetyana ────
console.log('5. Dec 1 first agent:');
check('Dec 1 firstAgent', firstAgent('2026-12-01'), 'Tetyana');

// ─── Transfer days ───────────────────────────────────────────────────────────
console.log('6. Transfer days (dayIndex % 9 === 0):');
for (const d of ['2026-11-01', '2026-11-10', '2026-11-19', '2026-11-28', '2026-12-07']) {
  const idx = dayIndex(d);
  check(`${d} is transfer day`, String(idx % 9 === 0), 'true');
}

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
