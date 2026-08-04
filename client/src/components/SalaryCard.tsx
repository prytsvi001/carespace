// client/src/components/SalaryCard.tsx
// One person's pay summary for the selected month — auto-calculated line
// items (each overridable via EditableField), toggles, a free-text bonus
// list, and a large total. Print scopes to just this card via the
// `salary-print-card` / `salary-print-target` classes (see Salary.tsx).
import React, { useEffect, useRef, useState } from 'react';
import { Printer, Plus, Trash2 } from 'lucide-react';
import { EditableField } from './EditableField';
import { BonusEntry, SalaryRow } from '../types';

function newBonusId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function SalaryCard({
  row, monthLabel, onSaveOverride, onSaveBonuses,
}: {
  row: SalaryRow;
  monthLabel: string;
  onSaveOverride: (key: string, value: number | boolean | null) => void;
  onSaveBonuses: (bonuses: BonusEntry[]) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');

  useEffect(() => {
    const clearPrintTarget = () => cardRef.current?.classList.remove('salary-print-target');
    window.addEventListener('afterprint', clearPrintTarget);
    return () => window.removeEventListener('afterprint', clearPrintTarget);
  }, []);

  const handlePrint = () => {
    cardRef.current?.classList.add('salary-print-target');
    window.print();
  };

  const isEdited = (key: string) => row.editedFields.includes(key);

  const addBonus = () => {
    const amount = Number(newAmount);
    if (!newDesc.trim() || Number.isNaN(amount)) return;
    onSaveBonuses([...row.bonuses, { id: newBonusId(), description: newDesc.trim(), amount }]);
    setNewDesc('');
    setNewAmount('');
  };

  const deleteBonus = (id: string) => {
    onSaveBonuses(row.bonuses.filter((b) => b.id !== id));
  };

  // Sandra is the only support-team person with no reviews bonus and no peek
  // bonus — that combination is when the shift count is shown as a reference.
  const showShiftsReference = row.team === 'support' && !row.hasReviews && !row.hasPeekBonus;

  return (
    <div ref={cardRef} className="salary-print-card bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold text-slate-800">{row.displayName}</h3>
          <p className="text-xs text-slate-400">{monthLabel}</p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="salary-print-hide p-1.5 rounded hover:bg-black/5 transition-colors text-slate-400 hover:text-slate-600"
          title="Print salary summary"
          aria-label="Print salary summary"
        >
          <Printer size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className="pb-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
        <EditableField label="Hours worked" value={row.hours} prefix="" edited={isEdited('hours')}
          onSave={(v) => onSaveOverride('hours', v)} onClear={() => onSaveOverride('hours', null)} />

        {row.rate != null ? (
          <EditableField label="Rate / hr" value={row.rate} edited={isEdited('rate')}
            onSave={(v) => onSaveOverride('rate', v)} onClear={() => onSaveOverride('rate', null)} />
        ) : (
          <EditableField label="Rate / hr (set your rate)" value={0} edited
            onSave={(v) => onSaveOverride('rate', v)} />
        )}

        {showShiftsReference && (
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs" style={{ color: 'rgba(14,14,14,0.45)' }}>Shifts (reference)</span>
            <span className="text-sm" style={{ color: 'rgba(14,14,14,0.65)' }}>{row.shifts}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 py-1">
          <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.65)' }}>Base salary</span>
          <span className="text-sm font-semibold" style={{ color: 'rgba(14,14,14,0.85)' }}>${row.base.toFixed(2)}</span>
        </div>
      </div>

      {row.hasReviews && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label={`Reviews (${row.reviewsCount})`} value={row.reviewsCount} prefix="" edited={isEdited('reviewsCount')}
            onSave={(v) => onSaveOverride('reviewsCount', v)} onClear={() => onSaveOverride('reviewsCount', null)} />
          <EditableField label="Reviews bonus" value={row.reviewsBonus} edited={isEdited('reviewsBonus')}
            onSave={(v) => onSaveOverride('reviewsBonus', v)} onClear={() => onSaveOverride('reviewsBonus', null)} />
        </div>
      )}

      {row.hasPeekBonus && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>Peek Requests done</span>
            <span className="text-sm" style={{ color: 'rgba(14,14,14,0.65)' }}>{row.peekCount ?? 0}</span>
          </div>
          <EditableField label="Peek Requests bonus" value={row.peekBonus} edited={isEdited('peekBonus')}
            onSave={(v) => onSaveOverride('peekBonus', v)} onClear={() => onSaveOverride('peekBonus', null)} />
        </div>
      )}

      {row.toggles.length > 0 && (
        <div className="py-1 space-y-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          {row.toggles.map((t) => (
            <label key={t.key} className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
              <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>{t.label} (${t.amount})</span>
              <input
                type="checkbox"
                checked={t.on}
                onChange={(e) => onSaveOverride(t.key, e.target.checked)}
                className="accent-current"
              />
            </label>
          ))}
        </div>
      )}

      <div className="py-2">
        <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.65)' }}>Additional bonuses</span>
        {row.bonuses.length > 0 && (
          <div className="space-y-1 mt-1">
            {row.bonuses.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'rgba(14,14,14,0.60)' }}>{b.description}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.75)' }}>${b.amount.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => deleteBonus(b.id)}
                    className="salary-print-hide p-0.5 rounded transition-colors"
                    style={{ color: 'rgba(14,14,14,0.30)' }}
                    aria-label="Delete bonus"
                    title="Delete bonus"
                  >
                    <Trash2 size={12} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="salary-print-hide flex gap-1.5 mt-2">
          <input
            className="input text-xs flex-1 py-1"
            placeholder="Description"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <input
            className="input text-xs w-20 py-1"
            type="number"
            step="0.01"
            placeholder="$"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
          <button
            type="button"
            onClick={addBonus}
            className="shrink-0 p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.55)' }}
            aria-label="Add bonus"
            title="Add bonus"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="pt-2 flex items-center justify-between" style={{ borderTop: '1px solid rgba(14,14,14,0.10)' }}>
        <span className="text-sm font-semibold" style={{ color: 'rgba(14,14,14,0.65)' }}>TOTAL</span>
        <EditableField label="" value={row.total} size="lg" edited={isEdited('total')}
          onSave={(v) => onSaveOverride('total', v)} onClear={() => onSaveOverride('total', null)} />
      </div>
    </div>
  );
}
