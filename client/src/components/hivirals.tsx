// client/src/components/hivirals.tsx
// HiVirals boost requests — shared pieces used by Inbox's "HiVirals Boost
// Request" view (support agents create, share drafts, track requests) and the
// Peekviewer "HiVirals" tab (Anna/Sandra Moore/Victoria Davis work them).
import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Send, Trash2, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import {
  HiviralsBoostProfile, HiviralsBoostRequestData, HiviralsPlan, HiviralsEndPoint,
  getMySentHiviralsBoostRequests, createHiviralsBoostRequest, deleteHiviralsBoostRequest,
  getHiviralsDrafts, createHiviralsDraft, saveHiviralsDraft, submitHiviralsDraft, deleteHiviralsDraft,
} from '../api';
import { CardListSkeleton, ConfirmDialog, RichText, AutoTextarea } from './ui';

type FieldDef = { key: keyof HiviralsBoostProfile; label: string; kind?: 'date' | 'textarea' | 'plan' | 'links'; placeholder?: string };

// One-month boost norms per plan — shown to Anna against what's been logged.
export const HIVIRALS_PLANS: Record<HiviralsPlan, { label: string; norms: { followers: number; comments: number; likes: number } }> = {
  starter:  { label: 'Starter',  norms: { followers: 200, comments: 100, likes: 900 } },
  business: { label: 'Business', norms: { followers: 400, comments: 160, likes: 1500 } },
  pro:      { label: 'PRO',      norms: { followers: 700, comments: 300, likes: 2500 } },
};
const isPlan = (v: string): v is HiviralsPlan => v in HIVIRALS_PLANS;

const STAT_FIELDS: { label: string; start: keyof HiviralsBoostProfile; end: keyof HiviralsEndPoint }[] = [
  { label: 'Кількість фоловерів', start: 'followersCount', end: 'endFollowersCount' },
  { label: 'Кількість постів',    start: 'postsCount',     end: 'endPostsCount' },
  { label: 'Кількість фоловінг',  start: 'followingCount', end: 'endFollowingCount' },
  { label: 'Engagement rate',     start: 'engagementRate', end: 'endEngagementRate' },
];

// Links are stored one per line; edited as a list with "+".
const splitLinks = (v: string) => v.split('\n');
const nonEmptyLinks = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);

// Grouped exactly as the request form is laid out — the HiVirals tab shows
// the same groups read-only.
export const HIVIRALS_FIELD_GROUPS: { title?: string; cols: string; fields: FieldDef[] }[] = [
  {
    cols: 'sm:grid-cols-2',
    fields: [
      { key: 'email', label: 'Email' },
      { key: 'plan', label: 'Plan', kind: 'plan' },
      { key: 'accountName', label: 'Назва акаунта' },
    ],
  },
  {
    cols: 'sm:grid-cols-2',
    fields: [
      { key: 'startDate', label: 'Дата початку', kind: 'date' },
      { key: 'endDate', label: 'Дата кінця', kind: 'date' },
    ],
  },
  {
    title: 'Старт поінт',
    cols: 'grid-cols-2 sm:grid-cols-4',
    fields: STAT_FIELDS.map((s) => ({ key: s.start, label: s.label })),
  },
  {
    cols: 'grid-cols-1',
    fields: [
      { key: 'niche', label: 'Niche (theme)', kind: 'textarea' },
      { key: 'interests', label: 'Зони інтересу', kind: 'textarea' },
    ],
  },
  {
    title: 'Соціальна сітка (бульбашка)',
    cols: 'grid-cols-1',
    fields: [
      { key: 'publicLinks', label: 'Посилання на пабліки', kind: 'links', placeholder: 'https://…' },
      { key: 'postLinks', label: 'Посилання на пости (коментарі)', kind: 'links', placeholder: 'https://…' },
    ],
  },
  {
    cols: 'grid-cols-1',
    fields: [
      { key: 'hashtags', label: 'Хештеги', kind: 'textarea' },
      { key: 'notes', label: 'Additional notes', kind: 'textarea' },
    ],
  },
];

export function emptyHiviralsProfile(): HiviralsBoostProfile {
  return {
    email: '', plan: '', accountName: '', startDate: '', endDate: '',
    followersCount: '', postsCount: '', followingCount: '', engagementRate: '',
    niche: '', interests: '', publicLinks: '', postLinks: '', hashtags: '', notes: '',
  };
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return format(new Date(`${value}T00:00:00`), 'dd.MM.yyyy');
}

export function HiviralsStatusBadge({ status }: { status: HiviralsBoostRequestData['status'] }) {
  return (
    <span
      className="text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0"
      style={status === 'ended'
        ? { backgroundColor: 'rgba(161,249,110,0.28)', color: '#166534' }
        : { backgroundColor: 'rgba(245,158,11,0.14)', color: '#b45309' }}
    >
      {status === 'ended' ? 'Boost ended' : 'In progress'}
    </span>
  );
}

// Read-only profile — empty fields are skipped.
export function HiviralsProfileView({ profile }: { profile: HiviralsBoostProfile }) {
  return (
    <div className="space-y-3">
      {HIVIRALS_FIELD_GROUPS.map((group, gi) => {
        const filled = group.fields.filter((f) => profile[f.key]?.trim());
        if (filled.length === 0) return null;
        return (
          <div key={gi} className="space-y-1.5">
            {group.title && <p className="text-xs font-semibold text-slate-600">{group.title}</p>}
            <div className={`grid gap-x-4 gap-y-2 ${group.cols}`}>
              {filled.map((f) => (
                <div key={f.key} className="min-w-0">
                  <p className="text-xs text-slate-400">{f.label}</p>
                  {f.kind === 'textarea' || f.kind === 'links'
                    ? <RichText text={f.kind === 'links' ? nonEmptyLinks(profile[f.key]).join('\n') : profile[f.key]} className="text-sm text-slate-700 whitespace-pre-wrap break-words" />
                    : <p className="text-sm text-slate-700 break-words">
                        {f.kind === 'date' ? formatDate(profile[f.key])
                          : f.kind === 'plan' && isPlan(profile[f.key]) ? HIVIRALS_PLANS[profile[f.key] as HiviralsPlan].label
                          : profile[f.key]}
                      </p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LinksInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const links = splitLinks(value);
  const setAt = (i: number, v: string) => onChange(links.map((l, idx) => (idx === i ? v.replace(/\n/g, ' ') : l)).join('\n'));
  const removeAt = (i: number) => onChange(links.filter((_, idx) => idx !== i).join('\n'));
  return (
    <div className="space-y-1.5">
      {links.map((link, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={link}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={placeholder}
            className="input text-sm flex-1 min-w-0"
          />
          {links.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="p-1 rounded-lg transition-colors hover:text-red-600"
              style={{ color: 'rgba(14,14,14,0.35)' }}
              title="Remove link"
            >
              <X size={13} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...links, ''].join('\n'))}
        className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors"
        style={{ color: 'rgba(14,14,14,0.55)', backgroundColor: 'rgba(14,14,14,0.04)' }}
      >
        <Plus size={12} strokeWidth={2} />
        Add link
      </button>
    </div>
  );
}

// Plan norms vs. what's been logged across all days (Anna's view).
export function HiviralsNorms({ request }: { request: HiviralsBoostRequestData }) {
  if (!isPlan(request.plan)) return null;
  const { label, norms } = HIVIRALS_PLANS[request.plan];
  const totals = hiviralsTotals(request);
  const items: { key: keyof typeof norms; label: string }[] = [
    { key: 'followers', label: 'Followers' },
    { key: 'comments', label: 'Comments' },
    { key: 'likes', label: 'Likes' },
  ];
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: 'rgba(161,249,110,0.10)' }}>
      <p className="text-xs font-semibold text-slate-600">Норми плану {label} — one month boost</p>
      <div className="grid grid-cols-3 gap-3">
        {items.map((it) => {
          const done = totals[it.key];
          const target = norms[it.key];
          return (
            <div key={it.key} className="min-w-0">
              <p className="text-xs text-slate-400">{it.label}</p>
              <p className="text-sm font-semibold text-slate-800">
                {done} <span className="font-normal text-slate-400">/ {target}</span>
              </p>
              <div className="h-1.5 rounded-full mt-1" style={{ backgroundColor: 'rgba(14,14,14,0.08)' }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, (done / target) * 100)}%`, backgroundColor: done >= target ? '#22c55e' : '#A1F96E' }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// End point — same four stats as the start point. Anna edits it; everyone
// else (the requester in Inbox) sees it read-only next to the start values.
export function HiviralsEndPointSection({ request, onChange }: {
  request: HiviralsBoostRequestData;
  onChange?: (patch: Partial<HiviralsEndPoint>) => void;
}) {
  if (!onChange && STAT_FIELDS.every((s) => !request[s.end]?.trim())) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-slate-600">Енд поінт</p>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {STAT_FIELDS.map((s) => (
          <div key={s.end} className="min-w-0">
            <label className="block text-xs text-slate-400 mb-1">
              {s.label}
              {request[s.start] && <span className="text-slate-300"> (старт: {request[s.start]})</span>}
            </label>
            {onChange ? (
              <input
                value={request[s.end]}
                onChange={(e) => onChange({ [s.end]: e.target.value })}
                className="input text-sm w-full"
              />
            ) : (
              <p className="text-sm text-slate-700">{request[s.end] || '—'}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HiviralsProfileForm({ value, onChange }: { value: HiviralsBoostProfile; onChange: (v: HiviralsBoostProfile) => void }) {
  const set = (key: keyof HiviralsBoostProfile, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-4">
      {HIVIRALS_FIELD_GROUPS.map((group, gi) => (
        <div key={gi} className="space-y-2">
          {group.title && <p className="text-xs font-semibold text-slate-600">{group.title}</p>}
          <div className={`grid gap-3 ${group.cols}`}>
            {group.fields.map((f) => (
              <div key={f.key} className="min-w-0">
                <label className="block text-xs text-slate-400 mb-1">
                  {f.label}{(f.key === 'email' || f.key === 'plan') && <span className="text-red-400"> *</span>}
                </label>
                {f.kind === 'plan' ? (
                  <div className="flex gap-1.5">
                    {(Object.keys(HIVIRALS_PLANS) as HiviralsPlan[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => set('plan', p)}
                        className="flex-1 text-sm font-medium px-3 py-1.5 rounded-lg transition-all"
                        style={value.plan === p
                          ? { backgroundColor: '#A1F96E', color: '#0E0E0E' }
                          : { backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.55)' }}
                      >
                        {HIVIRALS_PLANS[p].label}
                      </button>
                    ))}
                  </div>
                ) : f.kind === 'links' ? (
                  <LinksInput value={value[f.key]} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
                ) : f.kind === 'textarea' ? (
                  <AutoTextarea
                    value={value[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="input text-sm w-full"
                  />
                ) : (
                  <input
                    type={f.kind === 'date' ? 'date' : f.key === 'email' ? 'email' : 'text'}
                    value={value[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="input text-sm w-full"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function hiviralsTotals(r: HiviralsBoostRequestData) {
  return r.days.reduce(
    (acc, d) => ({
      followers: acc.followers + d.followers.length,
      likes: acc.likes + d.likes.length,
      comments: acc.comments + d.comments.length,
    }),
    { followers: 0, likes: 0, comments: 0 }
  );
}

const DRAFT_SAVE_DELAY_MS = 1000;
const hasContent = (p: HiviralsBoostProfile) => Object.values(p).some((v) => v.trim());
const cleanLinks = (p: HiviralsBoostProfile): HiviralsBoostProfile => ({
  ...p,
  publicLinks: nonEmptyLinks(p.publicLinks).join('\n'),
  postLinks: nonEmptyLinks(p.postLinks).join('\n'),
});
const toProfile = (r: HiviralsBoostRequestData): HiviralsBoostProfile => {
  const p = emptyHiviralsProfile();
  for (const k of Object.keys(p) as (keyof HiviralsBoostProfile)[]) p[k] = r[k] ?? '';
  return p;
};

// Inbox → "HiVirals Boost Request": create form, the shared drafts every
// support agent sees (one agent often starts a request and another finishes
// it), and the caller's own sent requests. The form autosaves as a draft as
// soon as anything is typed. Owns its own state so Inbox.tsx only mounts it.
export function HiviralsSentView() {
  const [requests, setRequests] = useState<HiviralsBoostRequestData[]>([]);
  const [drafts, setDrafts] = useState<HiviralsBoostRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<HiviralsBoostProfile>(emptyHiviralsProfile);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSave, setDraftSave] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteDraftId, setConfirmDeleteDraftId] = useState<string | null>(null);

  // Refs so the debounced save always sees the latest draft id / form, and a
  // second keystroke during the first save can't create a duplicate draft.
  const draftIdRef = useRef<string | null>(null);
  const formRef = useRef(form);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const savingDraft = useRef<Promise<void> | null>(null);

  const load = async () => {
    try { setRequests(await getMySentHiviralsBoostRequests()); } catch (e) { console.error(e); }
    try { setDrafts(await getHiviralsDrafts()); } catch (e) { console.error(e); }
  };
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const id = setInterval(load, 30_000);
    return () => { clearInterval(id); clearTimeout(saveTimer.current); };
  }, []);

  const saveDraftNow = async () => {
    clearTimeout(saveTimer.current);
    if (savingDraft.current) await savingDraft.current;
    const current = formRef.current;
    if (!draftIdRef.current && !hasContent(current)) return;
    setDraftSave('saving');
    savingDraft.current = (async () => {
      try {
        if (draftIdRef.current) {
          await saveHiviralsDraft(draftIdRef.current, current);
        } else {
          const created = await createHiviralsDraft(current);
          draftIdRef.current = created.id;
          setDraftId(created.id);
        }
        setDraftSave('saved');
      } catch (e: any) {
        console.error(e);
        setDraftSave('error');
        if (e?.response?.status === 404) setError('This draft was already sent or deleted by another agent.');
      } finally {
        savingDraft.current = null;
      }
    })();
    await savingDraft.current;
  };

  const handleFormChange = (next: HiviralsBoostProfile) => {
    setForm(next);
    formRef.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
  };

  const openForm = (draft?: HiviralsBoostRequestData) => {
    const profile = draft ? toProfile(draft) : emptyHiviralsProfile();
    setForm(profile);
    formRef.current = profile;
    draftIdRef.current = draft?.id ?? null;
    setDraftId(draft?.id ?? null);
    setDraftSave(null);
    setError('');
    setShowForm(true);
  };

  // Closing keeps the draft — it stays in the shared Drafts list.
  const closeForm = async () => {
    setShowForm(false);
    await saveDraftNow();
    draftIdRef.current = null;
    setDraftId(null);
    load();
  };

  const handleSend = async () => {
    const final = cleanLinks(formRef.current);
    if (!final.email.trim()) { setError('Email is required.'); return; }
    if (!isPlan(final.plan)) { setError('Please choose a plan.'); return; }
    clearTimeout(saveTimer.current);
    if (savingDraft.current) await savingDraft.current;
    setSaving(true);
    setError('');
    try {
      const sent = draftIdRef.current
        ? await submitHiviralsDraft(draftIdRef.current, final)
        : await createHiviralsBoostRequest(final);
      setRequests((prev) => [sent, ...prev]);
      setDrafts((prev) => prev.filter((d) => d.id !== sent.id));
      draftIdRef.current = null;
      setDraftId(null);
      setShowForm(false);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    setConfirmDeleteDraftId(null);
    if (id === draftIdRef.current) {
      clearTimeout(saveTimer.current);
      draftIdRef.current = null;
      setDraftId(null);
      setShowForm(false);
    }
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try { await deleteHiviralsDraft(id); } catch (e) { console.error(e); load(); }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try { await deleteHiviralsBoostRequest(id, 'requester'); } catch (e) { console.error(e); load(); }
  };

  const otherDrafts = drafts.filter((d) => d.id !== draftId);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={showForm ? closeForm : () => openForm()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0"
          style={showForm
            ? { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.50)' }
            : { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }}
        >
          {showForm ? <><X size={13} strokeWidth={2} /> Close</> : <><Plus size={13} strokeWidth={2} /> Create new request</>}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">New HiVirals boost request</p>
            {draftSave && (
              <span className={`text-xs ${draftSave === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                {draftSave === 'saving' ? 'Saving draft…' : draftSave === 'saved' ? 'Draft saved · visible to all support' : 'Draft not saved'}
              </span>
            )}
          </div>
          <HiviralsProfileForm value={form} onChange={handleFormChange} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-between gap-2">
            {draftId ? (
              <button
                onClick={() => setConfirmDeleteDraftId(draftId)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
              >
                <Trash2 size={13} strokeWidth={1.8} />
                Delete draft
              </button>
            ) : <span />}
            <button
              onClick={handleSend}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
            >
              <Send size={13} strokeWidth={1.8} />
              {saving ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {otherDrafts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">
            Drafts ({otherDrafts.length}) <span className="font-normal text-slate-400">— not sent yet, visible to all support agents</span>
          </p>
          {otherDrafts.map((d) => (
            <div key={d.id} className="card flex items-center justify-between gap-3" style={{ borderStyle: 'dashed' }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{d.accountName || d.email || 'Untitled draft'}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Started by {d.requesterName}
                  {d.draftEditorName && d.draftEditorName !== d.requesterName && ` · last edited by ${d.draftEditorName}`}
                  {' · '}{format(new Date(d.updatedAt), 'dd MMM, HH:mm')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={async () => { if (showForm) await closeForm(); openForm(d); }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }}
                >
                  Continue
                </button>
                <button
                  onClick={() => setConfirmDeleteDraftId(d.id)}
                  className="p-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                  style={{ color: 'rgba(14,14,14,0.35)' }}
                  title="Delete draft"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : requests.length === 0 ? (
        <div className="py-14 text-center">
          <Sparkles size={40} strokeWidth={1} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No HiVirals boost requests sent yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const totals = hiviralsTotals(r);
            const expanded = expandedId === r.id;
            return (
              <div key={r.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <button className="text-left min-w-0" onClick={() => setExpandedId(expanded ? null : r.id)}>
                    <p className="text-sm font-semibold text-slate-800 truncate">{r.accountName || r.email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {format(new Date(r.createdAt), 'dd MMM yyyy')}
                      {' · '}{r.days.length} day{r.days.length === 1 ? '' : 's'}
                      {' · '}{totals.followers} followers · {totals.likes} likes · {totals.comments} comments
                    </p>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <HiviralsStatusBadge status={r.status} />
                    <button
                      onClick={() => setConfirmDeleteId(r.id)}
                      className="p-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                      style={{ color: 'rgba(14,14,14,0.35)' }}
                      title="Delete"
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <>
                    <HiviralsProfileView profile={r} />
                    <HiviralsEndPointSection request={r} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this HiVirals boost request from your list? This only removes it from your own view."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteDraftId}
        message="Delete this draft? It will disappear for all support agents."
        onConfirm={() => { if (confirmDeleteDraftId) handleDeleteDraft(confirmDeleteDraftId); }}
        onCancel={() => setConfirmDeleteDraftId(null)}
      />
    </div>
  );
}
