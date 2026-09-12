// client/src/components/boostRequestRows.tsx
// Shared "list of rows" editor for creating several boost requests in one
// submission (e.g. 3 likes links + 2 comments links + 5 followers links),
// used by both BoostRequests.tsx (the Boost tab's own create modal) and
// Inbox.tsx's "Boost Requests" create form.
import React from 'react';
import { Plus, X } from 'lucide-react';
import { format } from 'date-fns';

export type BoostType = 'likes' | 'followers' | 'comments';

export const BOOST_TYPE_LABELS: Record<BoostType, string> = {
  likes: 'Likes',
  followers: 'Followers',
  comments: 'Comments',
};

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

// ─── Requester-side view: one block per submission ──────────────────────────
// Everything submitted together via /bulk shares a batchId — the requester
// sees all of it as one card (one status per item), not one card per item.
// Rows with no batchId (created before that field existed) are their own
// single-item "batch".

export interface BoostRequestLike {
  id: string;
  boostType: BoostType;
  link: string;
  quantity: number;
  status: 'in_progress' | 'complete';
  batchId: string | null;
  completedByName?: string | null;
  createdAt: string;
}

export function groupBoostRequestsByBatch<T extends BoostRequestLike>(requests: T[]): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of requests) {
    const key = r.batchId ?? `single-${r.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }
  return order.map((key) => ({ key, items: groups.get(key)! }));
}

const STATUS_STYLE = {
  in_progress: { bg: 'rgba(14,14,14,0.07)', text: 'rgba(14,14,14,0.55)', label: 'In progress' },
  complete: { bg: 'rgba(161,249,110,0.28)', text: '#166534', label: 'Complete' },
};

export function BoostRequestBatchCard<T extends BoostRequestLike>({ items }: { items: T[] }) {
  const completedCount = items.filter((i) => i.status === 'complete').length;
  const allComplete = completedCount === items.length;

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">
          {format(new Date(items[0].createdAt), 'dd MMM yyyy')}
        </span>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={allComplete
            ? { backgroundColor: STATUS_STYLE.complete.bg, color: STATUS_STYLE.complete.text }
            : { backgroundColor: STATUS_STYLE.in_progress.bg, color: STATUS_STYLE.in_progress.text }}
        >
          {completedCount}/{items.length} completed
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: 'rgba(14,14,14,0.06)' }}>
        {items.map((item) => {
          const s = STATUS_STYLE[item.status];
          return (
            <div key={item.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {BOOST_TYPE_LABELS[item.boostType]}
                  </span>
                  <span className="text-xs text-slate-400">Qty: {item.quantity}</span>
                </div>
                <p className="text-sm text-slate-700 break-all mt-1">{item.link}</p>
                {item.completedByName && (
                  <p className="text-xs text-slate-400 mt-1">Completed by {item.completedByName}</p>
                )}
              </div>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: s.bg, color: s.text }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
