// client/src/components/TeamBonusPanel.tsx
// Peekviewer Team-only, above all agent cards: Sandra enters how many
// profiles the whole team parsed that month, which sets a flat per-agent
// bonus tier applied to every Peekviewer agent's total (see SalaryCard).
import React, { useEffect, useState } from 'react';

const TIERS = [
  { min: 950, max: Infinity, bonus: 30, label: '950+' },
  { min: 850, max: 949, bonus: 10, label: '850–949' },
  { min: 0, max: 849, bonus: 0, label: '< 850' },
] as const;

export function tierForTotalParsedProfiles(value: number): { label: string; bonus: number } {
  const tier = TIERS.find((t) => value >= t.min && value <= t.max) ?? TIERS[TIERS.length - 1];
  return { label: tier.label, bonus: tier.bonus };
}

export function TeamBonusPanel({
  value, onSave,
}: {
  value: number | null;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));

  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    if (draft.trim() === '') { onSave(null); return; }
    const n = Number(draft);
    if (!Number.isNaN(n)) onSave(n);
  };

  const tier = value != null ? tierForTotalParsedProfiles(value) : null;

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <label className="text-xs font-medium block mb-1" style={{ color: 'rgba(14,14,14,0.55)' }}>
        Total profiles parsed
      </label>
      <input
        type="number"
        required
        className="input w-40 text-sm"
        placeholder="e.g. 900"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {tier ? (
        <p className="text-xs mt-2 font-medium" style={{ color: '#2F9E44' }}>
          {tier.label} → +${tier.bonus} кожній ✓
        </p>
      ) : (
        <p className="text-xs mt-2 flex items-start gap-1 text-amber-600">
          <span className="shrink-0">⚠️</span>
          <span>Enter the amount of team parsed profiles to calculate the bonus</span>
        </p>
      )}
    </div>
  );
}
