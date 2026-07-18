// client/src/pages/MyKPI.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getKpiSettings, updateKpiSettings } from '../api';
import { AutoTextarea } from '../components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResponseTimeRow { channel: string; firstResponse: string; replyTime: string; }
interface BonusRow { range: string; bonus: string; }
interface ScoreThreshold { result: string; score: string; }

type KpiSection = 'chats' | 'tickets' | 'calls' | 'general';

interface CustomBlock {
  id: string;
  title: string;
  section: KpiSection;
  content: string;
  createdBy: string;
  createdAt: string;
}

interface KpiData {
  chatResponseTimes: ResponseTimeRow[];
  ticketResponseTimes: ResponseTimeRow[];
  callResponseTimes: ResponseTimeRow[];
  chatPriorities: string[];
  ticketPriorities: string[];
  callPriorities: string[];
  reviewsKpi: { rules: string[]; bonusTable: BonusRow[]; };
  qaScore: { thresholds: ScoreThreshold[]; communicationErrors: string[]; technicalErrors: string[]; };
  customBlocks: CustomBlock[];
  deletedBuiltins: string[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_KPI: KpiData = {
  chatResponseTimes: [
    { channel: 'Chats (Tech support)', firstResponse: 'up to 20 sec', replyTime: '20 sec – 15 min' },
  ],
  ticketResponseTimes: [
    { channel: 'Tickets', firstResponse: 'up to 20 min', replyTime: 'up to 3 hours' },
  ],
  callResponseTimes: [],
  chatPriorities: [
    'Failure Payments',
    'Refund chats',
    'Installation chats (new clients)',
    'Usual chats (existing clients)',
  ],
  ticketPriorities: [],
  callPriorities: [],
  reviewsKpi: {
    rules: [
      'Minimum per month: 10 reviews, of which at least 3–5 on Trustpilot',
      'Deadline: check all sites by the 30th of each month',
      'Each review must contain: code word/phrase, agent name, or other identifier',
    ],
    bonusTable: [
      { range: '1–10', bonus: '$5' },
      { range: '11–20', bonus: '$6' },
      { range: '21+', bonus: '$7' },
    ],
  },
  qaScore: {
    thresholds: [
      { result: 'Good', score: '98–100%' },
      { result: 'Average', score: '96–98%' },
      { result: 'Poor', score: 'below 96%' },
    ],
    communicationErrors: [],
    technicalErrors: [],
  },
  customBlocks: [],
  deletedBuiltins: [],
};

// QA badge styles (chip on the result cell)
const QA_BADGE_STYLES: Record<string, React.CSSProperties> = {
  Good:    { backgroundColor: 'rgba(161,249,110,0.22)', color: '#166534' },
  Average: { backgroundColor: 'rgba(245,158,11,0.10)',  color: '#b45309' },
  Poor:    { backgroundColor: 'rgba(239,68,68,0.10)',   color: '#b91c1c' },
};

// QA row tints (subtle background on the whole row in read mode)
const QA_ROW_TINTS: Record<string, React.CSSProperties> = {
  Good:    { backgroundColor: 'rgba(161,249,110,0.07)' },
  Average: { backgroundColor: 'rgba(245,158,11,0.05)'  },
  Poor:    { backgroundColor: 'rgba(239,68,68,0.05)'   },
};

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── MultilineText ─────────────────────────────────────────────────────────────

function MultilineText({
  text,
  className = 'text-sm text-slate-700',
}: {
  text: string;
  className?: string;
}) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length <= 1) {
    return <span className={className}>{text.trim()}</span>;
  }
  const [first, ...rest] = lines;
  return (
    <span>
      <span className={className}>{first}</span>
      <span className="block mt-0.5 space-y-0.5">
        {rest.map((line, i) => (
          <span key={i} className="flex items-start gap-1.5">
            <span className="shrink-0 select-none" style={{ color: 'rgba(14,14,14,0.35)', marginTop: '1px' }}>–</span>
            <span className={className} style={{ fontWeight: 'normal' }}>{line.trim()}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

// Section header with lime vertical accent bar + hairline divider
function PageSectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-[3px] h-3.5 rounded-full" style={{ backgroundColor: '#A1F96E' }} />
        <span
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'rgba(14,14,14,0.55)' }}
        >
          {label}
        </span>
      </div>
      <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(14,14,14,0.07)' }} />
    </div>
  );
}

// Empty section placeholder shown when all blocks in a section are gone
function SectionEmptyPlaceholder() {
  return (
    <div
      className="rounded-xl py-5 px-4 text-center text-sm"
      style={{ border: '1px dashed rgba(14,14,14,0.14)', color: 'rgba(14,14,14,0.35)' }}
    >
      No blocks in this section — add one below
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2.5" style={{ color: 'rgba(14,14,14,0.40)' }}>
      {children}
    </p>
  );
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c} className="text-left pb-2.5 text-[10px] font-semibold uppercase tracking-widest pr-4 whitespace-nowrap" style={{ color: 'rgba(14,14,14,0.40)' }}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function EditableList({
  items,
  onChange,
  placeholder = 'Enter item text. Use new lines for sub-items.',
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <AutoTextarea
            className="input text-sm flex-1"
            value={item}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="shrink-0 transition-colors"
            style={{ color: 'rgba(14,14,14,0.35)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.35)')}
            title="Remove"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      <button
        className="btn-secondary text-xs flex items-center gap-1.5 mt-1"
        onClick={() => onChange([...items, ''])}
      >
        <Plus size={12} strokeWidth={2} />
        Add item
      </button>
    </div>
  );
}

// lime left border applied to all block cards
const CARD_ACCENT_STYLE: React.CSSProperties = {
  borderLeft: '3px solid rgba(161,249,110,0.55)',
};

function BlockCard({
  title,
  isAdmin,
  isEditing,
  saving,
  confirmingDelete,
  onEdit,
  onSave,
  onCancel,
  children,
  headerExtras,
}: {
  title: string;
  isAdmin: boolean;
  isEditing: boolean;
  saving: boolean;
  confirmingDelete?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  children: React.ReactNode;
  headerExtras?: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4" style={CARD_ACCENT_STYLE}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-800" style={{ fontSize: '0.875rem' }}>{title}</h3>
        {isAdmin && !isEditing && (
          <div className="flex items-center gap-2 shrink-0">
            {headerExtras}
            {!confirmingDelete && (
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={onEdit}>
                <Pencil size={11} strokeWidth={1.8} />
                Edit
              </button>
            )}
          </div>
        )}
        {isAdmin && isEditing && (
          <div className="flex gap-2 shrink-0">
            <button className="btn-secondary text-xs" onClick={onCancel} disabled={saving}>Cancel</button>
            <button className="btn-accent text-xs flex items-center gap-1.5" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyKPI() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [kpi, setKpi] = useState<KpiData>(DEFAULT_KPI);
  const [loading, setLoading] = useState(true);
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [draft, setDraft] = useState<KpiData>(deepClone(DEFAULT_KPI));
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // add-block form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState<KpiSection>('chats');
  const [newContent, setNewContent] = useState('');
  const [formErrors, setFormErrors] = useState<{ title?: string; content?: string }>({});
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    getKpiSettings()
      .then((data: KpiData) => {
        setKpi(data);
        setDraft(deepClone(data));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleEdit = (blockId: string) => {
    setDraft(deepClone(kpi));
    setEditingBlock(blockId);
    if (blockId === 'qaScore') {
      setExpandedSections((prev) => new Set([...prev, 'comm', 'tech']));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateKpiSettings(draft);
      setKpi(updated);
      setEditingBlock(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingBlock(null);
    setDraft(deepClone(kpi));
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Unified delete handler: accepts a pure function that returns the new KpiData
  const handleDeleteBlock = async (applyDelete: (k: KpiData) => KpiData) => {
    const newKpi = applyDelete(kpi);
    try {
      const updated = await updateKpiSettings(newKpi);
      setKpi(updated);
      setDraft(deepClone(updated));
    } catch (e) {
      console.error(e);
    }
    setConfirmDeleteId(null);
  };

  const handleAddBlock = async () => {
    const errors: { title?: string; content?: string } = {};
    if (!newTitle.trim()) errors.title = 'Title is required';
    if (!newContent.trim()) errors.content = 'Content is required';
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    setAddSaving(true);
    const block: CustomBlock = {
      id: generateId(),
      title: newTitle.trim(),
      section: newSection,
      content: newContent.trim(),
      createdBy: user?.id || '',
      createdAt: new Date().toISOString(),
    };
    const newKpi: KpiData = { ...kpi, customBlocks: [...(kpi.customBlocks || []), block] };
    try {
      const updated = await updateKpiSettings(newKpi);
      setKpi(updated);
      setDraft(deepClone(updated));
      setShowAddForm(false);
      setNewTitle('');
      setNewContent('');
      setNewSection('chats');
      setFormErrors({});
    } catch (e) {
      console.error(e);
    } finally {
      setAddSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
        Loading…
      </div>
    );
  }

  // ── Delete confirmation UI factory ─────────────────────────────────────────
  // Returns headerExtras + confirmingDelete flag for BlockCard.
  // confirmId: the ID stored in confirmDeleteId for this block.
  // applyDelete: pure fn to produce the new KpiData on confirmation.

  const mkDeleteExtras = (
    confirmId: string,
    applyDelete: (k: KpiData) => KpiData,
  ): { headerExtras: React.ReactNode; confirmingDelete: boolean } => {
    if (!isAdmin) return { headerExtras: undefined, confirmingDelete: false };
    const isConfirming = confirmDeleteId === confirmId;
    return {
      confirmingDelete: isConfirming,
      headerExtras: isConfirming ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
            Delete this block? This cannot be undone.
          </span>
          <button
            className="text-xs px-2 py-1 rounded-lg font-medium transition-colors shrink-0"
            style={{ color: '#b91c1c', backgroundColor: 'rgba(220,38,38,0.07)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(220,38,38,0.13)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(220,38,38,0.07)')}
            onClick={() => handleDeleteBlock(applyDelete)}
          >
            Delete
          </button>
          <button className="btn-secondary text-xs px-2 py-1 shrink-0" onClick={() => setConfirmDeleteId(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="shrink-0 transition-colors"
          style={{ color: 'rgba(14,14,14,0.28)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.28)')}
          title="Delete block"
          onClick={() => setConfirmDeleteId(confirmId)}
        >
          <Trash2 size={13} strokeWidth={1.6} />
        </button>
      ),
    };
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isDeleted = (blockId: string) => (kpi.deletedBuiltins || []).includes(blockId);

  const deleteBuiltin = (blockId: string) => (k: KpiData): KpiData => ({
    ...k,
    deletedBuiltins: [...(k.deletedBuiltins || []), blockId],
  });

  const blocksForSection = (section: KpiSection) =>
    (kpi.customBlocks || []).filter(b => b.section === section);

  const isSectionEmpty = (builtinIds: string[], section: KpiSection) =>
    builtinIds.every(isDeleted) && blocksForSection(section).length === 0;

  // ── Generic: Response Times block ─────────────────────────────────────────

  const renderResponseTimes = (
    blockId: string,
    title: string,
    readData: ResponseTimeRow[],
    draftData: ResponseTimeRow[],
    onDraftUpdate: (rows: ResponseTimeRow[]) => void,
  ) => {
    if (isDeleted(blockId)) return null;

    const isEditing = editingBlock === blockId;
    const data = isEditing ? draftData : readData;
    const { headerExtras, confirmingDelete } = mkDeleteExtras(blockId, deleteBuiltin(blockId));

    return (
      <BlockCard
        title={title}
        isAdmin={isAdmin}
        isEditing={isEditing}
        saving={saving}
        confirmingDelete={confirmingDelete}
        onEdit={() => handleEdit(blockId)}
        onSave={handleSave}
        onCancel={handleCancel}
        headerExtras={headerExtras}
      >
        {!isEditing && data.length === 0 ? (
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>No entries yet.</p>
        ) : data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHeader cols={['Channel', 'First Response', 'Reply Time']} />
              <tbody>
                {data.map((row, i) => {
                  const border = i > 0 ? { borderTop: '1px solid rgba(14,14,14,0.06)' } : undefined;
                  return (
                    <tr key={i}>
                      <td className="py-2.5 pr-5 align-top" style={border}>
                        {isEditing ? (
                          <AutoTextarea
                            value={row.channel}
                            onChange={(e) => {
                              const next = [...data];
                              next[i] = { ...next[i], channel: e.target.value };
                              onDraftUpdate(next);
                            }}
                          />
                        ) : (
                          <MultilineText text={row.channel} className="font-medium text-slate-700" />
                        )}
                      </td>
                      <td className="py-2.5 pr-5 align-top" style={border}>
                        {isEditing ? (
                          <input
                            className="input text-sm"
                            value={row.firstResponse}
                            onChange={(e) => {
                              const next = [...data];
                              next[i] = { ...next[i], firstResponse: e.target.value };
                              onDraftUpdate(next);
                            }}
                          />
                        ) : (
                          <span style={{ color: 'rgba(14,14,14,0.65)' }}>{row.firstResponse}</span>
                        )}
                      </td>
                      <td className="py-2.5 align-top" style={border}>
                        {isEditing ? (
                          <input
                            className="input text-sm"
                            value={row.replyTime}
                            onChange={(e) => {
                              const next = [...data];
                              next[i] = { ...next[i], replyTime: e.target.value };
                              onDraftUpdate(next);
                            }}
                          />
                        ) : (
                          <span style={{ color: 'rgba(14,14,14,0.65)' }}>{row.replyTime}</span>
                        )}
                      </td>
                      {isEditing && (
                        <td className="py-2.5 pl-2 align-top" style={border}>
                          <button
                            onClick={() => onDraftUpdate(data.filter((_, idx) => idx !== i))}
                            className="transition-colors mt-1"
                            style={{ color: 'rgba(14,14,14,0.30)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.30)')}
                            title="Remove row"
                          >
                            <X size={13} strokeWidth={1.5} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {isEditing && (
          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => onDraftUpdate([...data, { channel: '', firstResponse: '', replyTime: '' }])}
          >
            <Plus size={12} strokeWidth={2} />
            Add row
          </button>
        )}
      </BlockCard>
    );
  };

  // ── Generic: Priorities block ──────────────────────────────────────────────

  const renderPriorities = (
    blockId: string,
    title: string,
    readData: string[],
    draftData: string[],
    onDraftUpdate: (items: string[]) => void,
  ) => {
    if (isDeleted(blockId)) return null;

    const isEditing = editingBlock === blockId;
    const data = isEditing ? draftData : readData;
    const { headerExtras, confirmingDelete } = mkDeleteExtras(blockId, deleteBuiltin(blockId));

    return (
      <BlockCard
        title={title}
        isAdmin={isAdmin}
        isEditing={isEditing}
        saving={saving}
        confirmingDelete={confirmingDelete}
        onEdit={() => handleEdit(blockId)}
        onSave={handleSave}
        onCancel={handleCancel}
        headerExtras={headerExtras}
      >
        {isEditing ? (
          <EditableList items={data} onChange={onDraftUpdate} />
        ) : data.length === 0 ? (
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>No priorities set yet.</p>
        ) : (
          <div>
            <ol className="space-y-2.5">
              {data.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  {/* Lime green priority badge */}
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                  >
                    {i + 1}
                  </span>
                  <MultilineText text={item} />
                </li>
              ))}
            </ol>
            <p className="text-xs mt-3" style={{ color: 'rgba(14,14,14,0.38)' }}>1 = highest priority</p>
          </div>
        )}
      </BlockCard>
    );
  };

  // ── Block: Reviews KPI ─────────────────────────────────────────────────────

  const renderReviewsKpi = () => {
    if (isDeleted('reviewsKpi')) return null;

    const isEditing = editingBlock === 'reviewsKpi';
    const rules = isEditing ? draft.reviewsKpi.rules : kpi.reviewsKpi.rules;
    const bonusTable = isEditing ? draft.reviewsKpi.bonusTable : kpi.reviewsKpi.bonusTable;
    const { headerExtras, confirmingDelete } = mkDeleteExtras('reviewsKpi', deleteBuiltin('reviewsKpi'));

    return (
      <BlockCard
        title="Reviews KPI"
        isAdmin={isAdmin}
        isEditing={isEditing}
        saving={saving}
        confirmingDelete={confirmingDelete}
        onEdit={() => handleEdit('reviewsKpi')}
        onSave={handleSave}
        onCancel={handleCancel}
        headerExtras={headerExtras}
      >
        <div>
          <SectionLabel>Key rules</SectionLabel>
          {isEditing ? (
            <EditableList
              items={draft.reviewsKpi.rules}
              onChange={(items) => setDraft((d) => ({ ...d, reviewsKpi: { ...d.reviewsKpi, rules: items } }))}
              placeholder="Enter rule. Use new lines for sub-items."
            />
          ) : (
            <ul className="space-y-2.5">
              {rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'rgba(14,14,14,0.30)' }} />
                  <MultilineText text={rule} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionLabel>Bonus structure</SectionLabel>
          <table className="w-full text-sm">
            <TableHeader cols={['Reviews', 'Bonus per review']} />
            <tbody>
              {bonusTable.map((row, i) => {
                const border = i > 0 ? { borderTop: '1px solid rgba(14,14,14,0.06)' } : undefined;
                return (
                  <tr key={i}>
                    <td className="py-2.5 pr-8 align-top" style={border}>
                      {isEditing ? (
                        <input
                          className="input text-sm"
                          value={row.range}
                          onChange={(e) => {
                            const next = deepClone(draft.reviewsKpi.bonusTable);
                            next[i].range = e.target.value;
                            setDraft((d) => ({ ...d, reviewsKpi: { ...d.reviewsKpi, bonusTable: next } }));
                          }}
                        />
                      ) : (
                        <span className="font-medium text-slate-700">{row.range}</span>
                      )}
                    </td>
                    <td className="py-2.5 align-top" style={border}>
                      {isEditing ? (
                        <input
                          className="input text-sm"
                          value={row.bonus}
                          onChange={(e) => {
                            const next = deepClone(draft.reviewsKpi.bonusTable);
                            next[i].bonus = e.target.value;
                            setDraft((d) => ({ ...d, reviewsKpi: { ...d.reviewsKpi, bonusTable: next } }));
                          }}
                        />
                      ) : (
                        <span className="font-medium" style={{ color: 'rgba(14,14,14,0.65)' }}>{row.bonus}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </BlockCard>
    );
  };

  // ── Block: QA Score ────────────────────────────────────────────────────────

  const renderQAScore = () => {
    if (isDeleted('qaScore')) return null;

    const isEditing = editingBlock === 'qaScore';
    const thresholds = isEditing ? draft.qaScore.thresholds : kpi.qaScore.thresholds;
    const commErrors = isEditing ? draft.qaScore.communicationErrors : kpi.qaScore.communicationErrors;
    const techErrors = isEditing ? draft.qaScore.technicalErrors : kpi.qaScore.technicalErrors;
    const { headerExtras, confirmingDelete } = mkDeleteExtras('qaScore', deleteBuiltin('qaScore'));

    const CollapsibleSection = ({
      sectionKey,
      label,
      items,
      editItems,
      onEditChange,
      dotColor,
    }: {
      sectionKey: string;
      label: string;
      items: string[];
      editItems: string[];
      onEditChange: (items: string[]) => void;
      dotColor: string;
    }) => {
      const isExpanded = expandedSections.has(sectionKey);
      return (
        <div className="overflow-hidden" style={{ border: '1px solid rgba(14,14,14,0.09)', borderRadius: '0.75rem' }}>
          <button
            onClick={() => toggleSection(sectionKey)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <span className="text-sm font-medium text-slate-700">{label}</span>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}>
                  {items.length}
                </span>
              )}
              {isExpanded
                ? <ChevronDown size={14} strokeWidth={1.8} style={{ color: 'rgba(14,14,14,0.35)' }} />
                : <ChevronRight size={14} strokeWidth={1.8} style={{ color: 'rgba(14,14,14,0.35)' }} />}
            </div>
          </button>
          {isExpanded && (
            <div className="px-4 pb-4" style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}>
              {isEditing ? (
                <div className="mt-3">
                  <EditableList items={editItems} onChange={onEditChange} placeholder="Enter error. Use new lines for details." />
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm mt-3" style={{ color: 'rgba(14,14,14,0.38)' }}>No entries yet.</p>
              ) : (
                <ul className="space-y-2 mt-3">
                  {items.map((err, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                      <MultilineText text={err} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <BlockCard
        title="QA Score"
        isAdmin={isAdmin}
        isEditing={isEditing}
        saving={saving}
        confirmingDelete={confirmingDelete}
        onEdit={() => handleEdit('qaScore')}
        onSave={handleSave}
        onCancel={handleCancel}
        headerExtras={headerExtras}
      >
        <table className="w-full text-sm">
          <TableHeader cols={['Result', 'Score']} />
          <tbody>
            {thresholds.map((row, i) => {
              const border = i > 0 ? { borderTop: '1px solid rgba(14,14,14,0.06)' } : undefined;
              // Apply subtle row tint in read mode
              const rowStyle = !isEditing
                ? { ...border, ...(QA_ROW_TINTS[row.result] ?? {}) }
                : border;
              return (
                <tr key={i} style={rowStyle}>
                  <td className="py-2.5 pr-8 align-top">
                    {isEditing ? (
                      <AutoTextarea
                        value={row.result}
                        onChange={(e) => {
                          const next = deepClone(draft.qaScore.thresholds);
                          next[i].result = e.target.value;
                          setDraft((d) => ({ ...d, qaScore: { ...d.qaScore, thresholds: next } }));
                        }}
                      />
                    ) : (
                      <span
                        className="text-xs px-2.5 py-1 rounded-lg font-medium"
                        style={QA_BADGE_STYLES[row.result] ?? { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }}
                      >
                        {row.result}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 align-top">
                    {isEditing ? (
                      <AutoTextarea
                        value={row.score}
                        onChange={(e) => {
                          const next = deepClone(draft.qaScore.thresholds);
                          next[i].score = e.target.value;
                          setDraft((d) => ({ ...d, qaScore: { ...d.qaScore, thresholds: next } }));
                        }}
                      />
                    ) : (
                      <span className="text-sm font-medium text-slate-700">{row.score}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="space-y-2">
          <CollapsibleSection
            sectionKey="comm"
            label="Communication errors"
            items={commErrors}
            editItems={draft.qaScore.communicationErrors}
            onEditChange={(items) => setDraft((d) => ({ ...d, qaScore: { ...d.qaScore, communicationErrors: items } }))}
            dotColor="rgba(239,68,68,0.55)"
          />
          <CollapsibleSection
            sectionKey="tech"
            label="Technical errors"
            items={techErrors}
            editItems={draft.qaScore.technicalErrors}
            onEditChange={(items) => setDraft((d) => ({ ...d, qaScore: { ...d.qaScore, technicalErrors: items } }))}
            dotColor="rgba(245,158,11,0.70)"
          />
        </div>
      </BlockCard>
    );
  };

  // ── Custom block card ──────────────────────────────────────────────────────

  const renderCustomBlock = (block: CustomBlock) => {
    const blockId = `custom:${block.id}`;
    const isEditing = editingBlock === blockId;
    const editBlock = isEditing
      ? (draft.customBlocks || []).find(b => b.id === block.id) ?? block
      : block;
    const { headerExtras: deleteUI, confirmingDelete: isConfirmingDelete } = mkDeleteExtras(
      block.id,
      (k) => ({ ...k, customBlocks: (k.customBlocks || []).filter(b => b.id !== block.id) }),
    );

    return (
      <div key={blockId} className="card p-5 space-y-4" style={CARD_ACCENT_STYLE}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          {isEditing ? (
            <input
              className="input text-sm font-semibold flex-1"
              value={editBlock.title}
              placeholder="Block title"
              onChange={(e) =>
                setDraft(d => ({
                  ...d,
                  customBlocks: (d.customBlocks || []).map(b =>
                    b.id === block.id ? { ...b, title: e.target.value } : b
                  ),
                }))
              }
            />
          ) : (
            <h3 className="font-semibold text-slate-800" style={{ fontSize: '0.875rem' }}>{block.title}</h3>
          )}

          {isAdmin && !isEditing && (
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {deleteUI}
              {!isConfirmingDelete && (
                <button
                  className="btn-secondary text-xs flex items-center gap-1.5"
                  onClick={() => handleEdit(blockId)}
                >
                  <Pencil size={11} strokeWidth={1.8} />
                  Edit
                </button>
              )}
            </div>
          )}

          {isAdmin && isEditing && (
            <div className="flex gap-2 shrink-0">
              <button className="btn-secondary text-xs" onClick={handleCancel} disabled={saving}>Cancel</button>
              <button className="btn-accent text-xs flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        {isEditing ? (
          <AutoTextarea
            className="input text-sm w-full"
            value={editBlock.content}
            placeholder="Write block content here. Use new lines for sub-items or list items."
            onChange={(e) =>
              setDraft(d => ({
                ...d,
                customBlocks: (d.customBlocks || []).map(b =>
                  b.id === block.id ? { ...b, content: e.target.value } : b
                ),
              }))
            }
          />
        ) : (
          <div className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{block.content}</div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">My KPI</h2>
        <p className="text-sm text-slate-400">
          {isAdmin
            ? 'Performance standards — edit any block to update for all agents'
            : 'Performance standards — reference card'}
        </p>
      </div>

      {/* ── Chats ── */}
      <PageSectionHeader label="Chats" />
      {renderResponseTimes(
        'chatResponseTimes', 'Response Times',
        kpi.chatResponseTimes, draft.chatResponseTimes,
        (rows) => setDraft(d => ({ ...d, chatResponseTimes: rows })),
      )}
      {renderPriorities(
        'chatPriorities', 'Chat Priorities',
        kpi.chatPriorities, draft.chatPriorities,
        (items) => setDraft(d => ({ ...d, chatPriorities: items })),
      )}
      {blocksForSection('chats').map(renderCustomBlock)}
      {isSectionEmpty(['chatResponseTimes', 'chatPriorities'], 'chats') && <SectionEmptyPlaceholder />}

      {/* ── Tickets ── */}
      <PageSectionHeader label="Tickets" />
      {renderResponseTimes(
        'ticketResponseTimes', 'Response Times',
        kpi.ticketResponseTimes, draft.ticketResponseTimes,
        (rows) => setDraft(d => ({ ...d, ticketResponseTimes: rows })),
      )}
      {renderPriorities(
        'ticketPriorities', 'Ticket Priorities',
        kpi.ticketPriorities, draft.ticketPriorities,
        (items) => setDraft(d => ({ ...d, ticketPriorities: items })),
      )}
      {blocksForSection('tickets').map(renderCustomBlock)}
      {isSectionEmpty(['ticketResponseTimes', 'ticketPriorities'], 'tickets') && <SectionEmptyPlaceholder />}

      {/* ── Calls ── */}
      <PageSectionHeader label="Calls" />
      {renderResponseTimes(
        'callResponseTimes', 'Response Times',
        kpi.callResponseTimes, draft.callResponseTimes,
        (rows) => setDraft(d => ({ ...d, callResponseTimes: rows })),
      )}
      {renderPriorities(
        'callPriorities', 'Call Priorities',
        kpi.callPriorities, draft.callPriorities,
        (items) => setDraft(d => ({ ...d, callPriorities: items })),
      )}
      {blocksForSection('calls').map(renderCustomBlock)}
      {isSectionEmpty(['callResponseTimes', 'callPriorities'], 'calls') && <SectionEmptyPlaceholder />}

      {/* ── General ── */}
      <PageSectionHeader label="General" />
      {renderReviewsKpi()}
      {renderQAScore()}
      {blocksForSection('general').map(renderCustomBlock)}
      {isSectionEmpty(['reviewsKpi', 'qaScore'], 'general') && <SectionEmptyPlaceholder />}

      {/* ── Add block (admin only) ── */}
      {isAdmin && (
        <div className="space-y-3 pb-2">
          {!showAddForm ? (
            <button
              className="text-sm flex items-center gap-2 w-full justify-center py-2.5 rounded-lg font-medium transition-colors"
              style={{
                backgroundColor: 'rgba(161,249,110,0.14)',
                border: '1px solid rgba(161,249,110,0.45)',
                color: '#0E0E0E',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(161,249,110,0.24)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(161,249,110,0.14)'; }}
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={14} strokeWidth={2} />
              Add block
            </button>
          ) : (
            <div className="card p-5 space-y-3" style={CARD_ACCENT_STYLE}>
              <p className="text-sm font-semibold text-slate-800">New block</p>

              <div>
                <input
                  className="input text-sm w-full"
                  value={newTitle}
                  placeholder="Block title *"
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    if (e.target.value.trim()) setFormErrors(fe => ({ ...fe, title: undefined }));
                  }}
                />
                {formErrors.title && (
                  <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{formErrors.title}</p>
                )}
              </div>

              <select
                className="input text-sm w-full"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value as KpiSection)}
              >
                <option value="chats">Chats</option>
                <option value="tickets">Tickets</option>
                <option value="calls">Calls</option>
                <option value="general">General</option>
              </select>

              <div>
                <AutoTextarea
                  className="input text-sm w-full"
                  value={newContent}
                  placeholder="Write block content here. Use new lines for sub-items or list items."
                  onChange={(e) => {
                    setNewContent(e.target.value);
                    if (e.target.value.trim()) setFormErrors(fe => ({ ...fe, content: undefined }));
                  }}
                />
                {formErrors.content && (
                  <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{formErrors.content}</p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button className="btn-accent text-sm" onClick={handleAddBlock} disabled={addSaving}>
                  {addSaving ? 'Saving…' : 'Save block'}
                </button>
                <button
                  className="text-sm transition-colors"
                  style={{ color: 'rgba(14,14,14,0.45)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#0E0E0E')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.45)')}
                  onClick={() => {
                    setShowAddForm(false);
                    setNewTitle('');
                    setNewContent('');
                    setNewSection('chats');
                    setFormErrors({});
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
