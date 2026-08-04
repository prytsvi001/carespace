// client/src/components/EditableField.tsx
// Click-to-edit numeric field used on Salary cards — click the value to edit
// it, pencil icon fades in on hover, and an "edited" badge (+ reset) shows
// when the value is a manual override rather than the auto-calculated one.
import React, { useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';

export function EditableField({
  label, value, edited, onSave, onClear, prefix = '$', size = 'sm',
}: {
  label: string;
  value: number;
  edited?: boolean;
  onSave: (value: number) => void;
  onClear?: () => void;
  prefix?: string;
  size?: 'sm' | 'lg';
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const startEdit = () => { setDraft(String(value)); setIsEditing(true); };
  const commit = () => {
    const n = Number(draft);
    if (!Number.isNaN(n)) onSave(n);
    setIsEditing(false);
  };

  const valueClass = size === 'lg' ? 'text-2xl font-bold' : 'text-sm font-medium';

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      {label && <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>{label}</span>}
      <div className="group flex items-center gap-1.5">
        {isEditing ? (
          <input
            autoFocus
            type="number"
            step="0.01"
            className={`input text-right py-0.5 ${size === 'lg' ? 'w-32 text-xl' : 'w-24 text-sm'}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className={`flex items-center gap-1 rounded px-1 -mx-1 transition-colors hover:bg-black/[0.03] ${valueClass}`}
            style={{ color: size === 'lg' ? '#0E0E0E' : 'rgba(14,14,14,0.80)' }}
          >
            {prefix}{value.toFixed(2)}
            <Pencil size={size === 'lg' ? 14 : 11} strokeWidth={1.8} className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />
          </button>
        )}
        {edited && (
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(212,168,71,0.15)', color: '#D4A847' }}
            title="Manually overridden"
          >
            edited
          </span>
        )}
        {edited && onClear && !isEditing && (
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 rounded transition-colors"
            style={{ color: 'rgba(14,14,14,0.35)' }}
            title="Reset to auto-calculated value"
            aria-label="Reset to auto-calculated value"
          >
            <RotateCcw size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}
