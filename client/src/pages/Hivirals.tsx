// client/src/pages/Hivirals.tsx
// Peekviewer Team — "HiVirals" tab (Anna Bilous, Sandra Moore, Victoria
// Davis only). Queue of HiVirals boost requests sent by support agents from
// Inbox. Per request: the client's profile, then one block per boost day with
// Followers / Likes / Comment columns whose rows are added/removed as needed.
// Edits autosave; End Boost marks it done and notifies all of support.
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Plus, Trash2, X, ChevronDown, ChevronUp, Flag, CalendarPlus } from 'lucide-react';
import { format, addDays } from 'date-fns';
import {
  getHiviralsBoostQueue, updateHiviralsBoost, endHiviralsBoost, deleteHiviralsBoostRequest,
  HiviralsBoostRequestData, HiviralsDay,
} from '../api';
import { EmptyState, CardListSkeleton, ConfirmDialog } from '../components/ui';
import { HiviralsProfileView, HiviralsStatusBadge, HiviralsNorms, HiviralsEndPointSection, hiviralsTotals } from '../components/hivirals';

type SectionKey = 'followers' | 'likes' | 'comments';
type Row = { id: string; date: string } & Record<string, string>;
type ColDef = { key: string; label: string; type?: 'date' | 'textarea'; wide?: boolean };

const SECTIONS: { key: SectionKey; title: string; cols: ColDef[] }[] = [
  {
    key: 'followers',
    title: 'Followers',
    cols: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'username', label: 'Username' },
    ],
  },
  {
    key: 'likes',
    title: 'Likes',
    cols: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'username', label: 'Username (liked from)' },
      { key: 'postUrl', label: 'Liked post link', wide: true },
    ],
  },
  {
    key: 'comments',
    title: 'Comments',
    cols: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'username', label: 'Username (commented from)' },
      { key: 'postUrl', label: 'Commented post link', wide: true },
      { key: 'text', label: 'Comment text', type: 'textarea', wide: true },
    ],
  },
];

const SAVE_DELAY_MS = 800;
const todayIso = () => format(new Date(), 'yyyy-MM-dd');
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function emptyRow(section: SectionKey, date: string): Row {
  const row: Row = { id: newId(), date };
  for (const c of SECTIONS.find((s) => s.key === section)!.cols) if (c.key !== 'date') row[c.key] = '';
  return row;
}

// Each new day continues from the previous one (or the boost start date).
function nextDayDate(r: HiviralsBoostRequestData): string {
  const last = r.days[r.days.length - 1]?.date;
  if (last && /^\d{4}-\d{2}-\d{2}$/.test(last)) return format(addDays(new Date(`${last}T00:00:00`), 1), 'yyyy-MM-dd');
  return r.startDate || todayIso();
}

export default function Hivirals() {
  const [requests, setRequests] = useState<HiviralsBoostRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'active' | 'ended'>('active');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Days are collapsed by default except the latest one; explicit toggles win.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = async () => {
    try { setRequests(await getHiviralsBoostQueue()); } catch (e) { console.error(e); }
  };
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const timers = saveTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const active = requests.filter((r) => r.status === 'active');
  const ended = requests.filter((r) => r.status === 'ended');
  const displayed = view === 'active' ? active : ended;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Local update + debounced save, so typing into a cell doesn't fire a
  // request per keystroke. Always sends the request's full editable state
  // (days + end point), so back-to-back edits of either can't drop one.
  const patchRequest = (r: HiviralsBoostRequestData, patch: Partial<HiviralsBoostRequestData>) => {
    const next = { ...r, ...patch };
    const id = r.id;
    setRequests((prev) => prev.map((x) => (x.id === id ? next : x)));
    setSaveState((s) => ({ ...s, [id]: 'saving' }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await updateHiviralsBoost(id, {
          days: next.days,
          endFollowersCount: next.endFollowersCount,
          endPostsCount: next.endPostsCount,
          endFollowingCount: next.endFollowingCount,
          endEngagementRate: next.endEngagementRate,
        });
        setSaveState((s) => ({ ...s, [id]: 'saved' }));
      } catch (e) {
        console.error(e);
        setSaveState((s) => ({ ...s, [id]: 'error' }));
      }
    }, SAVE_DELAY_MS);
  };

  const addDay = (r: HiviralsBoostRequestData) => {
    const date = nextDayDate(r);
    const day = {
      id: newId(), date,
      followers: [emptyRow('followers', date)],
      likes: [emptyRow('likes', date)],
      comments: [emptyRow('comments', date)],
    } as unknown as HiviralsDay;
    patchRequest(r, { days: [...r.days, day] });
  };

  const updateDay = (r: HiviralsBoostRequestData, dayId: string, patch: Partial<HiviralsDay>) => {
    patchRequest(r, { days: r.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) });
  };

  const removeDay = (r: HiviralsBoostRequestData, dayId: string) => {
    patchRequest(r, { days: r.days.filter((d) => d.id !== dayId) });
  };

  const handleEnd = async (id: string) => {
    setConfirmEndId(null);
    try {
      const updated = await endHiviralsBoost(id);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: updated.status, endedAt: updated.endedAt } : r)));
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    clearTimeout(saveTimers.current[id]);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try { await deleteHiviralsBoostRequest(id); } catch (e) { console.error(e); load(); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">HiVirals</h2>
        <p className="text-sm text-slate-400">Boost requests from support</p>
      </div>

      <div className="flex gap-1">
        {(['active', 'ended'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all"
            style={view === v
              ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
              : { color: 'rgba(14,14,14,0.45)' }}
          >
            {v === 'active' ? `Active (${active.length})` : `Ended (${ended.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <CardListSkeleton />
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} strokeWidth={1.2} />}
          message={view === 'active' ? 'No active HiVirals boosts.' : 'No ended boosts yet.'}
        />
      ) : (
        <div className="space-y-3">
          {displayed.map((r) => {
            const expanded = expandedIds.has(r.id);
            const totals = hiviralsTotals(r);
            const save = saveState[r.id];
            return (
              <div key={r.id} className="card space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <button className="flex items-start gap-2 text-left min-w-0" onClick={() => toggleExpanded(r.id)}>
                    {expanded
                      ? <ChevronUp size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      : <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-400" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{r.accountName || r.email}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        From {r.requesterName} · {format(new Date(r.createdAt), 'dd MMM yyyy, HH:mm')}
                        {' · '}{r.days.length} day{r.days.length === 1 ? '' : 's'}
                        {' · '}{totals.followers} followers · {totals.likes} likes · {totals.comments} comments
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {save && (
                      <span className={`text-xs ${save === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                        {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : 'Save failed'}
                      </span>
                    )}
                    <HiviralsStatusBadge status={r.status} />
                  </div>
                </div>

                {expanded && (
                  <>
                    <HiviralsProfileView profile={r} />
                    <HiviralsNorms request={r} />

                    <div className="space-y-2">
                      {r.days.map((day, i) => {
                        const open = openDays[day.id] ?? i === r.days.length - 1;
                        return (
                          <DayBlock
                            key={day.id}
                            index={i}
                            day={day}
                            open={open}
                            onToggle={() => setOpenDays((o) => ({ ...o, [day.id]: !open }))}
                            onChange={(patch) => updateDay(r, day.id, patch)}
                            onRemove={() => removeDay(r, day.id)}
                          />
                        );
                      })}
                    </div>

                    <HiviralsEndPointSection request={r} onChange={(patch) => patchRequest(r, patch)} />

                    <div className="flex flex-wrap justify-between gap-2 pt-1">
                      <button
                        onClick={() => addDay(r)}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                        style={{ backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }}
                      >
                        <CalendarPlus size={13} strokeWidth={1.8} />
                        Add day
                      </button>
                      <div className="flex gap-2">
                        {r.status === 'active' && (
                          <button
                            onClick={() => setConfirmEndId(r.id)}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                          >
                            <Flag size={13} strokeWidth={1.8} />
                            End Boost
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDeleteId(r.id)}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                          style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmEndId}
        message="End this boost? Support will be notified that the boost is completed."
        onConfirm={() => { if (confirmEndId) handleEnd(confirmEndId); }}
        onCancel={() => setConfirmEndId(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this HiVirals boost request? This removes it from the HiVirals tab."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function DayBlock({ index, day, open, onToggle, onChange, onRemove }: {
  index: number;
  day: HiviralsDay;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<HiviralsDay>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl p-3 space-y-3" style={{ border: '1px solid rgba(14,14,14,0.09)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <button onClick={onToggle} className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            {open
              ? <ChevronUp size={15} className="text-slate-400" />
              : <ChevronDown size={15} className="text-slate-400" />}
            Day {index + 1}
          </button>
          {open ? (
            <input
              type="date"
              value={day.date}
              onChange={(e) => onChange({ date: e.target.value })}
              className="input text-xs py-1"
            />
          ) : (
            <button onClick={onToggle} className="text-xs text-slate-400">
              {day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? format(new Date(`${day.date}T00:00:00`), 'dd.MM.yyyy') : day.date}
              {' · '}{day.followers.length} followers · {day.likes.length} likes · {day.comments.length} comments
            </button>
          )}
        </div>
        <button
          onClick={onRemove}
          className="p-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
          style={{ color: 'rgba(14,14,14,0.35)' }}
          title="Remove day"
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </div>

      {open && <div className="grid gap-3 lg:grid-cols-3">
        {SECTIONS.map((section) => {
          const rows = day[section.key] as unknown as Row[];
          const setRows = (next: Row[]) => onChange({ [section.key]: next } as Partial<HiviralsDay>);
          return (
            <div key={section.key} className="space-y-2 min-w-0">
              <p className="text-xs font-semibold text-slate-600">
                {section.title} <span className="font-normal text-slate-400">({rows.length})</span>
              </p>
              {rows.map((row, ri) => (
                <div
                  key={row.id}
                  className="rounded-lg p-2 space-y-1.5"
                  style={{ backgroundColor: 'rgba(14,14,14,0.03)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">№ {ri + 1}</span>
                    <button
                      onClick={() => setRows(rows.filter((x) => x.id !== row.id))}
                      className="p-0.5 rounded transition-colors hover:text-red-600"
                      style={{ color: 'rgba(14,14,14,0.30)' }}
                      title="Remove row"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {section.cols.map((col) => {
                      const set = (v: string) => setRows(rows.map((x) => (x.id === row.id ? { ...x, [col.key]: v } : x)));
                      return (
                        <div key={col.key} className={col.wide ? 'col-span-2' : ''}>
                          <label className="block text-[11px] text-slate-400 mb-0.5">{col.label}</label>
                          {col.type === 'textarea' ? (
                            <textarea
                              value={row[col.key] ?? ''}
                              onChange={(e) => set(e.target.value)}
                              rows={2}
                              className="input text-xs w-full resize-y"
                            />
                          ) : (
                            <input
                              type={col.type === 'date' ? 'date' : 'text'}
                              value={row[col.key] ?? ''}
                              onChange={(e) => set(e.target.value)}
                              className="input text-xs w-full"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setRows([...rows, emptyRow(section.key, day.date)])}
                className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors"
                style={{ color: 'rgba(14,14,14,0.55)', backgroundColor: 'rgba(14,14,14,0.04)' }}
              >
                <Plus size={12} strokeWidth={2} />
                Add row
              </button>
            </div>
          );
        })}
      </div>}
    </div>
  );
}
