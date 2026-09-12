// client/src/components/boostRequestRows.tsx
// Shared "list of rows" editor for creating several boost requests in one
// submission (e.g. 3 likes links + 2 comments links + 5 followers links),
// used by both BoostRequests.tsx (the Boost tab's own create modal) and
// Inbox.tsx's "Boost Requests" create form.
import React from 'react';
import { Plus, X } from 'lucide-react';

export type BoostType = 'likes' | 'followers' | 'comments';

export interface BoostRequestRow {
  boostType: BoostType;
  link: string;
  quantity: string;
}

export function emptyBoostRequestRow(previousType?: BoostType): BoostRequestRow {
  return { boostType: previousType ?? 'likes', link: '', quantity: '' };
}

function linkLabel(type: BoostType): string {
  return type === 'followers' ? 'Link (account)' : 'Link (post)';
}

// null means at least one row is invalid (empty link or non-positive quantity).
export function cleanBoostRequestRows(
  rows: BoostRequestRow[]
): { boostType: BoostType; link: string; quantity: number }[] | null {
  const cleaned: { boostType: BoostType; link: string; quantity: number }[] = [];
  for (const row of rows) {
    if (!row.link.trim()) return null;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    cleaned.push({ boostType: row.boostType, link: row.link.trim(), quantity: qty });
  }
  return cleaned;
}

export function BoostRequestRowsEditor({
  rows,
  onChange,
}: {
  rows: BoostRequestRow[];
  onChange: (rows: BoostRequestRow[]) => void;
}) {
  const updateRow = (i: number, patch: Partial<BoostRequestRow>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => onChange([...rows, emptyBoostRequestRow(rows[rows.length - 1]?.boostType)]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <select
            value={row.boostType}
            onChange={(e) => updateRow(i, { boostType: e.target.value as BoostType })}
            className="input text-sm w-[110px] shrink-0"
          >
            <option value="likes">Likes</option>
            <option value="followers">Followers</option>
            <option value="comments">Comments</option>
          </select>
          <input
            value={row.link}
            onChange={(e) => updateRow(i, { link: e.target.value })}
            placeholder={linkLabel(row.boostType)}
            className="input text-sm flex-1 min-w-0"
          />
          <input
            type="number"
            min={1}
            value={row.quantity}
            onChange={(e) => updateRow(i, { quantity: e.target.value })}
            placeholder="Qty"
            className="input text-sm w-16 shrink-0"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="shrink-0 p-2 rounded-lg transition-colors hover:bg-red-50 hover:text-red-500"
              style={{ color: 'rgba(14,14,14,0.35)' }}
              aria-label="Remove row"
            >
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
        style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.6)' }}
      >
        <Plus size={13} strokeWidth={1.8} />
        Add another link
      </button>
    </div>
  );
}
