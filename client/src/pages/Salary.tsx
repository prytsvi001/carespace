// client/src/pages/Salary.tsx
import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { getSalary, patchSalary } from '../api';
import { BonusEntry, SalaryRow } from '../types';
import { CardListSkeleton, EmptyState } from '../components/ui';
import { SalaryCard } from '../components/SalaryCard';
import '../styles/salary-print.css';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type SalaryTeam = 'support' | 'peekviewer';

export default function Salary() {
  const [team, setTeam] = useState<SalaryTeam>('support');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getSalary({ year, month, team });
      setRows(data.rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [team, year, month]);

  const handleSaveOverride = async (row: SalaryRow, key: string, value: number | boolean | null) => {
    // Optimistic update so the field/badge/total reflect the change immediately
    setRows((prev) => prev.map((r) => (r.personKey === row.personKey ? { ...r, ...recompute(r, key, value) } : r)));
    try {
      await patchSalary(row.personKey, { year, month, team, overrides: { [key]: value } });
    } catch (e) {
      console.error(e);
    } finally {
      loadData();
    }
  };

  const handleSaveBonuses = async (row: SalaryRow, bonuses: BonusEntry[]) => {
    setRows((prev) => prev.map((r) => (r.personKey === row.personKey ? { ...r, bonuses } : r)));
    try {
      await patchSalary(row.personKey, { year, month, team, bonuses });
    } catch (e) {
      console.error(e);
    } finally {
      loadData();
    }
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 salary-print-hide">
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
      <div className="flex gap-1 salary-print-hide">
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
              onSaveOverride={(key, value) => handleSaveOverride(row, key, value)}
              onSaveBonuses={(bonuses) => handleSaveBonuses(row, bonuses)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Local optimistic recompute so a single field edit reflects immediately —
// full authoritative numbers still come back from the reload triggered right after.
function recompute(row: SalaryRow, key: string, value: number | boolean | null): Partial<SalaryRow> {
  const editedFields = new Set(row.editedFields);
  if (value === null) editedFields.delete(key);
  else editedFields.add(key);

  if (key === 'total') {
    return { total: value === null ? row.total : Number(value), editedFields: Array.from(editedFields) };
  }

  const next: SalaryRow = { ...row };
  if (key === 'hours') next.hours = value === null ? row.hours : Number(value);
  if (key === 'rate') next.rate = value === null ? row.rate : Number(value);
  if (key === 'reviewsCount') next.reviewsCount = value === null ? row.reviewsCount : Number(value);
  if (key === 'reviewsBonus') next.reviewsBonus = value === null ? row.reviewsBonus : Number(value);
  if (key === 'peekBonus') next.peekBonus = value === null ? row.peekBonus : Number(value);
  next.toggles = row.toggles.map((t) => (t.key === key ? { ...t, on: !!value } : t));

  const toggleAmount = next.toggles.reduce((s, t) => s + (t.on ? t.amount : 0), 0);
  const base = next.rate != null ? next.hours * next.rate : row.base;
  next.base = row.team === 'peekviewer' ? row.base : base;
  next.bonusesTotal = row.bonusesTotal;
  next.total = round2(next.base + next.reviewsBonus + next.peekBonus + toggleAmount + next.bonusesTotal);
  next.editedFields = Array.from(editedFields);
  return next;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
