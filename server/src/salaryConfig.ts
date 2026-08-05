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
  { personKey: 'tetyana_veremeyenko', displayName: 'Tetyana Veremeyenko', team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 500, toggles: [{ key: 'uMobixOn', label: 'uMobix boost', amount: 10 }, { key: 'strukturaOn', label: 'Struktura boost', amount: 5 }] },
  { personKey: 'iryna_kolodiyenko',   displayName: 'Iryna Kolodiyenko',   team: 'peekviewer', formula: { type: 'fixed_base' }, fixedBase: 500, toggles: [{ key: 'updateOn', label: 'Update bonus', amount: 150 }, { key: 'smmDutyOn', label: 'SMM duty', amount: 150 }], userName: 'Iryna Kolodienko', hasResolvedRequestCount: true },
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
