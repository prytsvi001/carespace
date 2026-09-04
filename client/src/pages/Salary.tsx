// client/src/pages/Salary.tsx
import React, { useEffect, useState } from 'react';
import { Wallet, Send, LayoutList } from 'lucide-react';
import { getSalary, patchSalary, patchSalaryTeamMeta, sendSalaryNotification } from '../api';
import { BonusEntry, SalaryRow } from '../types';
import { CardListSkeleton, EmptyState, ConfirmDialog } from '../components/ui';
import { SalaryCard } from '../components/SalaryCard';
import { SalarySummaryModal } from '../components/SalarySummaryModal';
import { TeamBonusPanel, tierForTotalParsedProfiles } from '../components/TeamBonusPanel';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_UA = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

// Support Team: База (hours × rate) + Бонус за ревʼю + additional bonuses
// + Загалом. Peekviewer Team: База (flat) + additional bonuses + Загалом.
// No Peek Requests / toggle-bonus lines for either, per spec — Julia's Peek
// Requests bonus, Nicky's Trustpilot bonus, and Peekviewer toggle bonuses
// (Update bonus, uMobix/Struktura boosts) still count toward Загалом, they
// just don't get their own line in the message.
function defaultSalaryMessage(monthUA: string, year: number, row: SalaryRow): string {
  const lines: string[] = [`💰 Твоя зарплата за ${monthUA} ${year}:`, ''];

  if (row.hasSupportDuties) {
    lines.push(`База: $${row.base.toFixed(2)}`);
    if (row.rate != null) {
      lines.push(`Додаткові зміни підтримки: ${row.hours.toFixed(2)} год × $${row.rate.toFixed(2)} = $${row.supportDutiesBonus.toFixed(2)}`);
    }
  } else if (row.team === 'support') {
    lines.push(`База: ${row.hours.toFixed(2)} год × $${(row.rate ?? 0).toFixed(2)} = $${row.base.toFixed(2)}`);
  } else {
    lines.push(`База: $${row.base.toFixed(2)}`);
  }

  if (row.hasReviews) lines.push(`Бонус за ревʼю: $${row.reviewsBonus.toFixed(2)}`);

  for (const b of row.bonuses) {
    lines.push(`• ${b.description}: $${b.amount.toFixed(2)}`);
  }

  lines.push('', `Загалом: $${row.total.toFixed(2)}`, '', 'Якщо є питання — звертайся 🙌');

  return lines.join('\n');
}

type SalaryTeam = 'support' | 'peekviewer';

export default function Salary() {
  const [team, setTeam] = useState<SalaryTeam>('support');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [totalParsedProfiles, setTotalParsedProfiles] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // silent=true skips the loading flag entirely — used to reconcile with the
  // server in the background after a save, without flashing the whole grid
  // back to the skeleton loader. The optimistic recompute() below already
  // shows the correct number instantly; this just keeps it honest.
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getSalary({ year, month, team });
      setRows(data.rows);
      setTotalParsedProfiles(data.totalParsedProfiles ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [team, year, month]);

  const handleSaveOverride = async (row: SalaryRow, key: string, value: number | boolean | null) => {
    // Optimistic update so the field/badge/total reflect the change immediately
    setRows((prev) => prev.map((r) => (r.personKey === row.personKey ? recompute(r, key, value) : r)));
    try {
      await patchSalary(row.personKey, { year, month, team, overrides: { [key]: value } });
    } catch (e) {
      console.error(e);
    } finally {
      loadData(true);
    }
  };

  const handleSaveBonuses = async (row: SalaryRow, bonuses: BonusEntry[]) => {
    setRows((prev) => prev.map((r) => (r.personKey === row.personKey ? recomputeBonuses(r, bonuses) : r)));
    try {
      await patchSalary(row.personKey, { year, month, team, bonuses });
    } catch (e) {
      console.error(e);
    } finally {
      loadData(true);
    }
  };

  // Team-wide figure (Peekviewer only) — same bonus tier applies to every
  // agent's total the moment it's entered/changed.
  const handleSaveTeamMeta = async (value: number | null) => {
    setTotalParsedProfiles(value);
    setRows((prev) => prev.map((r) => recomputeTeamBonus(r, value)));
    try {
      await patchSalaryTeamMeta({ year, month, team: 'peekviewer', totalParsedProfiles: value });
    } catch (e) {
      console.error(e);
    } finally {
      loadData(true);
    }
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const monthLabelUA = MONTH_NAMES_UA[month - 1];

  const messageFor = (row: SalaryRow) => defaultSalaryMessage(monthLabelUA, year, row);

  const handleSend = async (row: SalaryRow, message: string) => {
    await sendSalaryNotification(row.personKey, { year, month, team, message });
    await loadData(true);
  };

  const notifiableCount = rows.filter((r) => r.canNotify).length;

  const handleSendAll = async () => {
    setConfirmSendAll(false);
    setSendingAll(true);
    try {
      for (const row of rows) {
        if (!row.canNotify) continue;
        try {
          await sendSalaryNotification(row.personKey, { year, month, team, message: messageFor(row) });
        } catch (e) {
          console.error(e);
        }
      }
    } finally {
      setSendingAll(false);
      await loadData(true);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Salary</h2>
          <p className="text-sm text-slate-400">Monthly pay for the Support and Peekviewer teams</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="input w-auto text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Support / Peekviewer sub-tabs */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['support', 'peekviewer'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTeam(t)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium transition-all"
              style={team === t ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' } : { color: 'rgba(14,14,14,0.45)' }}
            >
              {t === 'support' ? 'Support Team' : 'Peekviewer Team'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSummary(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-95"
            style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
          >
            <LayoutList size={13} strokeWidth={1.8} />
            Summary
          </button>
          {!loading && notifiableCount > 0 && (
            <button
              type="button"
              onClick={() => setConfirmSendAll(true)}
              disabled={sendingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-95 disabled:opacity-50"
              style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
            >
              <Send size={13} strokeWidth={1.8} />
              {sendingAll ? 'Sending…' : 'Send all salary notifications'}
            </button>
          )}
        </div>
      </div>

      {!loading && team === 'peekviewer' && (
        <TeamBonusPanel value={totalParsedProfiles} onSave={handleSaveTeamMeta} />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <CardListSkeleton count={3} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Wallet size={44} strokeWidth={1} />} message="No salary data for this month" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((row) => (
            <SalaryCard
              key={row.personKey}
              row={row}
              monthLabel={monthLabel}
              defaultMessage={messageFor(row)}
              teamTotalSet={totalParsedProfiles != null}
              onSaveOverride={(key, value) => handleSaveOverride(row, key, value)}
              onSaveBonuses={(bonuses) => handleSaveBonuses(row, bonuses)}
              onSend={(message) => handleSend(row, message)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmSendAll}
        message={`Send salary notifications to ${notifiableCount} ${notifiableCount === 1 ? 'person' : 'people'}?`}
        onConfirm={handleSendAll}
        onCancel={() => setConfirmSendAll(false)}
      />

      <SalarySummaryModal
        open={showSummary}
        onClose={() => setShowSummary(false)}
        year={year}
        month={month}
        monthLabel={monthLabel}
      />
    </div>
  );
}

// Mirrors server/src/routes/salary.ts's computeSalary() tier table, so
// reviewsCount edits can recompute reviewsBonus client-side too.
const REVIEW_TIERS = [
  { min: 1, max: 10, perReview: 5 },
  { min: 11, max: 20, perReview: 6 },
  { min: 21, max: Infinity, perReview: 7 },
];
function reviewsBonusForCount(count: number): number {
  const tier = REVIEW_TIERS.find((t) => count >= t.min && count <= t.max);
  return tier ? count * tier.perReview : 0;
}

// Mirrors server/src/salaryConfig.ts's individualParseBonusFor().
function individualParseBonusForClient(parsedProfiles: number): number {
  if (parsedProfiles <= 160) return 0;
  if (parsedProfiles <= 185) return round2((parsedProfiles - 160) * 1.0);
  return round2(25 * 1.0 + (parsedProfiles - 185) * 1.5);
}

// Local optimistic recompute so a single field edit reflects immediately —
// the silent background reload in loadData(true) still corrects it shortly
// after using the server's authoritative numbers (this matters most for
// "clear override" edits, where the true auto-calculated value isn't known
// client-side — those briefly keep showing the old number, then correct).
function recompute(row: SalaryRow, key: string, value: number | boolean | null): SalaryRow {
  const editedFields = new Set(row.editedFields);
  if (value === null) editedFields.delete(key);
  else editedFields.add(key);

  const next: SalaryRow = { ...row, editedFields: Array.from(editedFields) };

  if (key === 'hours') next.hours = value === null ? row.hours : Number(value);
  if (key === 'rate') next.rate = value === null ? row.rate : Number(value);
  if (key === 'reviewsCount') next.reviewsCount = value === null ? row.reviewsCount : Number(value);
  if (key === 'reviewsBonus') next.reviewsBonus = value === null ? row.reviewsBonus : Number(value);
  if (key === 'peekCount') next.peekCount = value === null ? row.peekCount : Number(value);
  if (key === 'peekBonus') next.peekBonus = value === null ? row.peekBonus : Number(value);
  if (key === 'resolvedCount') next.resolvedCount = value === null ? row.resolvedCount : Number(value);
  if (key === 'supportDutiesBonus') next.supportDutiesBonus = value === null ? row.supportDutiesBonus : Number(value);
  if (key === 'base') next.base = value === null ? row.base : Number(value);
  if (key === 'total') next.total = value === null ? row.total : Number(value);
  if (key === 'parsedProfiles') next.parsedProfiles = value === null ? null : Number(value);
  next.toggles = row.toggles.map((t) => (t.key === key ? { ...t, on: !!value } : t));

  // individualParseBonus (Peekviewer only) recomputes from parsedProfiles on
  // every edit — it has no server-side override of its own, so it always
  // derives fresh from the current parsedProfiles value.
  next.individualParseBonus = next.parsedProfiles == null ? 0 : individualParseBonusForClient(next.parsedProfiles);

  // reviewsBonus auto-recomputes from the tier table when reviewsCount
  // changes, unless reviewsBonus itself has separately been overridden.
  if (key === 'reviewsCount' && !next.editedFields.includes('reviewsBonus')) {
    next.reviewsBonus = reviewsBonusForCount(next.reviewsCount);
  }

  // peekBonus (Julia only) auto-recomputes at $0.80/request when peekCount
  // changes, unless peekBonus itself has separately been overridden.
  if (key === 'peekCount' && !next.editedFields.includes('peekBonus')) {
    next.peekBonus = round2((next.peekCount ?? 0) * 0.80);
  }

  // base only derives from hours * rate for regular hourly support agents —
  // Sandra (hasSupportDuties) and Peekviewer's base is flat/independent.
  if (key !== 'base' && !next.editedFields.includes('base') && row.team === 'support' && !row.hasSupportDuties) {
    next.base = next.rate != null ? round2(next.hours * next.rate) : 0;
  }

  // supportDutiesBonus (Sandra only) auto-derives from hours * rate unless overridden.
  if (row.hasSupportDuties && key !== 'supportDutiesBonus' && !next.editedFields.includes('supportDutiesBonus')) {
    next.supportDutiesBonus = next.rate != null ? round2(next.hours * next.rate) : 0;
  }

  if (!next.editedFields.includes('total')) {
    const toggleAmount = next.toggles.reduce((s, t) => s + (t.on ? t.amount : 0), 0);
    next.total = round2(next.base + next.reviewsBonus + next.peekBonus + next.supportDutiesBonus + toggleAmount + next.bonusesTotal + next.teamBonus + next.individualParseBonus);
  }

  return next;
}

function recomputeBonuses(row: SalaryRow, bonuses: BonusEntry[]): SalaryRow {
  const bonusesTotal = round2(bonuses.reduce((s, b) => s + (Number(b.amount) || 0), 0));
  const next: SalaryRow = { ...row, bonuses, bonusesTotal };
  if (!row.editedFields.includes('total')) {
    const toggleAmount = next.toggles.reduce((s, t) => s + (t.on ? t.amount : 0), 0);
    next.total = round2(next.base + next.reviewsBonus + next.peekBonus + next.supportDutiesBonus + toggleAmount + bonusesTotal + next.teamBonus + next.individualParseBonus);
  }
  return next;
}

// Recomputes one row's teamBonus (and total) after Sandra edits the team's
// total parsed profiles — same bonus applies to every Peekviewer agent.
function recomputeTeamBonus(row: SalaryRow, totalParsedProfiles: number | null): SalaryRow {
  const teamBonus = totalParsedProfiles == null ? 0 : tierForTotalParsedProfiles(totalParsedProfiles).bonus;
  const next: SalaryRow = { ...row, teamBonus };
  if (!row.editedFields.includes('total')) {
    const toggleAmount = next.toggles.reduce((s, t) => s + (t.on ? t.amount : 0), 0);
    next.total = round2(next.base + next.reviewsBonus + next.peekBonus + next.supportDutiesBonus + toggleAmount + next.bonusesTotal + teamBonus + next.individualParseBonus);
  }
  return next;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
