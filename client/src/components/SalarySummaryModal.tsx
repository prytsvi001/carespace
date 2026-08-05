// client/src/components/SalarySummaryModal.tsx
// Read-only rollup of every agent's total for the selected month, across
// both Support Team and Peekviewer Team, plus a CSV export of the same data.
import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { getSalary } from '../api';
import { SalaryRow } from '../types';
import { Modal, Spinner } from './ui';

type SummaryTeam = 'support' | 'peekviewer';

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildCsv(monthLabel: string, supportRows: SalaryRow[], peekviewerRows: SalaryRow[]): string {
  const lines: string[] = [];

  lines.push('Support Team');
  lines.push('Name,Month,Total');
  for (const r of supportRows) {
    lines.push([csvField(r.displayName), csvField(monthLabel), r.total.toFixed(2)].join(','));
  }
  lines.push('');
  lines.push('Peekviewer Team');
  lines.push('Name,Month,Total');
  for (const r of peekviewerRows) {
    lines.push([csvField(r.displayName), csvField(monthLabel), r.total.toFixed(2)].join(','));
  }

  return lines.join('\n');
}

export function SalarySummaryModal({
  open, onClose, year, month, monthLabel,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  month: number;
  monthLabel: string;
}) {
  const [view, setView] = useState<SummaryTeam>('support');
  const [supportRows, setSupportRows] = useState<SalaryRow[]>([]);
  const [peekviewerRows, setPeekviewerRows] = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      getSalary({ year, month, team: 'support' }),
      getSalary({ year, month, team: 'peekviewer' }),
    ])
      .then(([support, peekviewer]) => {
        setSupportRows(support.rows);
        setPeekviewerRows(peekviewer.rows);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [open, year, month]);

  const rows = view === 'support' ? supportRows : peekviewerRows;

  const handleDownload = () => {
    const csv = buildCsv(monthLabel, supportRows, peekviewerRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileMonth = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    a.download = `carespace-salary-summary-${fileMonth}-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Salary Summary — ${monthLabel}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="flex gap-1">
          {(['support', 'peekviewer'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setView(t)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium transition-all"
              style={view === t ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' } : { color: 'rgba(14,14,14,0.45)' }}
            >
              {t === 'support' ? 'Support Team' : 'Peekviewer Team'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="space-y-1">
            {rows.map((r) => (
              <div key={r.personKey} className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(14,14,14,0.06)' }}>
                <span className="text-sm" style={{ color: 'rgba(14,14,14,0.75)' }}>
                  {r.displayName} — {monthLabel}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'rgba(14,14,14,0.85)' }}>
                  Total: ${r.total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleDownload}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-95 disabled:opacity-50"
          style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
        >
          <Download size={14} strokeWidth={2} />
          Download Summary
        </button>
      </div>
    </Modal>
  );
}
