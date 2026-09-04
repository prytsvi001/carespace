// server/src/salaryConfig.ts
// Fixed roster + pay formulas for the Salary tab. Peekviewer team members are
// mostly not Users/Agents in this app at all (e.g. Yana Fedorova has no
// login), so the roster lives here as plain config rather than being derived
// from the User/Agent tables — only the Support team's auto-pulled figures
// (hours, reviews, Peek Requests) touch the database.

export type ToggleKey = 'trustpilotOn' | 'updateOn' | 'uMobixOn' | 'strukturaOn' | 'smmDutyOn';

export type SalaryFormula =
  | { type: 'hourly_tiered_reviews'; rate: number }        // Jonathan, Julia, Nicky, Victoria Davis
  | { type: 'fixed_base_with_support_duties' }             // Sandra — base is a flat editable number, not hours-based; any hours she covers as extra support duty are tracked (and paid) separately
  | { type: 'fixed_base' };                                // all Peekviewer team

export interface SalaryPerson {
  personKey: string;
  displayName: string;
  team: 'support' | 'peekviewer';
  formula: SalaryFormula;
  fixedBase?: number;
  toggles?: Array<{ key: ToggleKey; label: string; amount: number }>;
  hasPeekBonus?: boolean; // Julia only
  agentName?: string;     // matches Agent.name, for support-team auto-pull; absent for peekviewer
  userName?: string;      // matches User.name exactly, for notifications — only set when it differs from (or isn't covered by) agentName
  hasResolvedRequestCount?: boolean; // Viktoria Horopeka / Iryna Kolodiyenko — reference-only count of Peek Requests they personally resolved that month (PeekResolutionCredit), no bonus math attached (their existing Update bonus toggle already covers that)
}

export const REVIEW_TIERS = [
  { min: 1, max: 10, perReview: 5 },
  { min: 11, max: 20, perReview: 6 },
  { min: 21, max: Infinity, perReview: 7 },
];

export function reviewsBonusForCount(count: number): number {
  const tier = REVIEW_TIERS.find(t => count >= t.min && count <= t.max);
  return tier ? count * tier.perReview : 0;
}

// displayName here is the person's real name, shown only on the Salary tab —
// agentName/userName stay the system pseudonym used everywhere else in the
// app (Agent.name / User.name), so auto-pull and notification lookups are
// unaffected by this Salary-only relabeling.
export const SUPPORT_ROSTER: SalaryPerson[] = [
  { personKey: 'jonathan_lewis', displayName: 'Yan Horlatyi',          team: 'support', agentName: 'Jonathan Lewis', formula: { type: 'hourly_tiered_reviews', rate: 5 } },
  { personKey: 'sandra_moore',   displayName: 'Oleksandra Kraichynska', team: 'support', agentName: 'Sandra Moore',   formula: { type: 'fixed_base_with_support_duties' } },
  { personKey: 'julia_manson',   displayName: 'Tetiana Blazhievska',   team: 'support', agentName: 'Julia Manson',   formula: { type: 'hourly_tiered_reviews', rate: 6.25 }, hasPeekBonus: true },
  { personKey: 'nicky_brown',    displayName: 'Myroslava Horshchar',   team: 'support', agentName: 'Nicky Brown',    formula: { type: 'hourly_tiered_reviews', rate: 6 }, toggles: [{ key: 'trustpilotOn', label: 'Trustpilot bonus', amount: 80 }] },
  { personKey: 'victoria_davis', displayName: 'Viktoriia Pryts',       team: 'support', agentName: 'Victoria Davis', formula: { type: 'hourly_tiered_reviews', rate: 10 } },
];

export const PEEKVIEWER_ROSTER: SalaryPerson[] = [
  { personKey: 'yana_fedorova',       displayName: 'Yana Fedorova',       team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 600 },
  { personKey: 'viktoria_horopeka',   displayName: 'Viktoria Horopeka',   team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 500, toggles: [{ key: 'updateOn', label: 'Update bonus', amount: 150 }, { key: 'smmDutyOn', label: 'SMM duty', amount: 150 }], userName: 'Victoria Horopeka', hasResolvedRequestCount: true },
  { personKey: 'tetyana_veremeyenko', displayName: 'Tetyana Veremeyenko', team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 500, toggles: [{ key: 'strukturaOn', label: 'Struktura boost', amount: 10 }] },
  { personKey: 'iryna_kolodiyenko',   displayName: 'Iryna Kolodiyenko',   team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 500, toggles: [{ key: 'updateOn', label: 'Update bonus', amount: 150 }], userName: 'Iryna Kolodienko', hasResolvedRequestCount: true },
  { personKey: 'zlata_alekseenko',    displayName: 'Zlata Alekseenko',    team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 400 },
  { personKey: 'anna_bilous',         displayName: 'Anna Bilous',         team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 300 },
];

export function rosterForTeam(team: 'support' | 'peekviewer'): SalaryPerson[] {
  return team === 'support' ? SUPPORT_ROSTER : PEEKVIEWER_ROSTER;
}

// The exact User.name to resolve for salary notifications — undefined means
// this person has no linked account (e.g. Yana Fedorova).
export function notifyUserNameFor(person: SalaryPerson): string | undefined {
  return person.userName ?? person.agentName;
}

// Reserved SalaryRecord.personKey for the Peekviewer Team's team-wide "total
// profiles parsed" figure — it applies to the whole team for the month, not
// one person, but reuses the same SalaryRecord table/overrides JSON (keyed
// like everyone else on personKey+year+month) rather than a new table.
export const TEAM_META_PERSON_KEY = '_peekviewer_team_meta';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Team bonus (Peekviewer Team only) — added per agent, based on the team's
// total monthly parsed-profile count entered by Sandra Moore.
export const TEAM_BONUS_TIERS = [
  { min: 950, max: Infinity, bonus: 30, label: '950+' },
  { min: 850, max: 949, bonus: 10, label: '850–949' },
  { min: 0, max: 849, bonus: 0, label: '< 850' },
] as const;

export function teamBonusPerAgentFor(totalParsedProfiles: number): number {
  const tier = TEAM_BONUS_TIERS.find(t => totalParsedProfiles >= t.min && totalParsedProfiles <= t.max);
  return tier ? tier.bonus : 0;
}

// Individual "parsed profiles" bonus (Peekviewer Team only) — 0–160: no
// bonus; 161–185: $1.00 per parse above 160; 186+: the first 25 parses above
// 160 stay at $1.00 each (i.e. the 161–185 band), every parse above 185 is
// $1.50. E.g. 200 parses = 25×$1.00 + 15×$1.50 = $47.50.
export function individualParseBonusFor(parsedProfiles: number): number {
  if (parsedProfiles <= 160) return 0;
  if (parsedProfiles <= 185) return round2((parsedProfiles - 160) * 1.0);
  return round2(25 * 1.0 + (parsedProfiles - 185) * 1.5);
}
