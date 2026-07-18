// server/src/rotationSchedule.ts
// Shared rotation schedule — must stay in sync with ShiftCalendar.tsx.
// Used by both statistics.ts (hours calculation) and duty.ts (who's on
// support shift today).
export const ROTATION_BLOCKS = [
  { morning: 'Nicky Brown', night: 'Julia Manson' },
  { morning: 'Jonathan Lewis', night: 'Victoria Davis' },
  { morning: 'Julia Manson', night: 'Nicky Brown' },
  { morning: 'Victoria Davis', night: 'Jonathan Lewis' },
] as const;

export function getRotationPair(date: Date): { morning: string; night: string } | null {
  const ROTATION_START_UTC = Date.UTC(2026, 5, 1); // 2026-06-01
  const dayUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceStart = Math.round((dayUTC - ROTATION_START_UTC) / (24 * 60 * 60 * 1000));
  if (daysSinceStart < 0) return null;
  const block = Math.floor(daysSinceStart / 4) % ROTATION_BLOCKS.length;
  return ROTATION_BLOCKS[block];
}
