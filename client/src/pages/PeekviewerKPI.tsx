// client/src/pages/PeekviewerKPI.tsx
// Peekviewer Team's KPI tab (inside My Space) — unlike Support's MyKPI.tsx,
// there are no built-in sections here, just a flat list of custom blocks
// written from scratch by whoever has peekviewerAdmin rights (Sandra Moore,
// Victoria Davis, Yana Fedorova). Everyone else sees it read-only.
import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getKpiSettings, updateKpiSettings } from '../api';
import { AutoTextarea, EmptyState, ConfirmDialog } from '../components/ui';
import { KpiBlockBody } from '../components/kpiBlocks';
import { BarChart3 } from 'lucide-react';

interface KpiBlock {
  id: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

interface PeekviewerKpiData {
  customBlocks: KpiBlock[];
}

const EMPTY: PeekviewerKpiData = { customBlocks: [] };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const CARD_ACCENT_STYLE: React.CSSProperties = { borderLeft: '3px solid rgba(161,249,110,0.55)' };

export default function PeekviewerKPI() {
  const { user } = useAuth();
  const isAdmin = !!user?.peekviewerAdmin;

  const [kpi, setKpi] = useState<PeekviewerKpiData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [formErrors, setFormErrors] = useState<{ title?: string; content?: string }>({});
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    getKpiSettings('peekviewer')
      .then((data: PeekviewerKpiData) => setKpi({ customBlocks: data.customBlocks || [] }))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const persist = async (next: PeekviewerKpiData) => {
    const updated = await updateKpiSettings(next, 'peekviewer');
    setKpi({ customBlocks: updated.customBlocks || [] });
  };

  const handleEdit = (block: KpiBlock) => {
    setEditingId(block.id);
    setDraftTitle(block.title);
    setDraftContent(block.content);
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await persist({
        customBlocks: kpi.customBlocks.map((b) =>
          b.id === editingId ? { ...b, title: draftTitle.trim() || b.title, content: draftContent } : b
        ),
      });
      setEditingId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await persist({ customBlocks: kpi.customBlocks.filter((b) => b.id !== id) });
    } catch (e) {
      console.error(e);
    }
    setConfirmDeleteId(null);
  };

  const handleAdd = async () => {
    const errors: { title?: string; content?: string } = {};
    if (!newTitle.trim()) errors.title = 'Title is required';
    if (!newContent.trim()) errors.content = 'Content is required';
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    setAddSaving(true);
    const block: KpiBlock = {
      id: generateId(),
      title: newTitle.trim(),
      content: newContent.trim(),
      createdBy: user?.id || '',
      createdAt: new Date().toISOString(),
    };
    try {
      await persist({ customBlocks: [...kpi.customBlocks, block] });
      setShowAddForm(false);
      setNewTitle('');
      setNewContent('');
      setFormErrors({});
    } catch (e) {
      console.error(e);
    } finally {
      setAddSaving(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">KPI</h2>
        <p className="text-sm text-slate-400">
          {isAdmin ? 'Peekviewer Team performance standards — add or edit blocks below' : 'Peekviewer Team performance standards'}
        </p>
      </div>

      {kpi.customBlocks.length === 0 && !showAddForm && (
        <EmptyState icon={<BarChart3 size={32} strokeWidth={1.2} />} message="No KPI content yet." />
      )}

      {kpi.customBlocks.map((block) => {
        const isEditing = editingId === block.id;
        return (
          <div key={block.id} className="card p-5 space-y-4" style={CARD_ACCENT_STYLE}>
            <div className="flex items-start justify-between gap-3">
              {isEditing ? (
                <input
                  className="input text-sm font-semibold flex-1"
                  value={draftTitle}
                  placeholder="Block title"
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              ) : (
                <h3 className="font-semibold text-slate-800" style={{ fontSize: '0.875rem' }}>{block.title}</h3>
              )}

              {isAdmin && !isEditing && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="shrink-0 transition-colors"
                    style={{ color: 'rgba(14,14,14,0.28)' }}
                    title="Delete block"
                    onClick={() => setConfirmDeleteId(block.id)}
                  >
                    <Trash2 size={13} strokeWidth={1.6} />
                  </button>
                  <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => handleEdit(block)}>
                    <Pencil size={11} strokeWidth={1.8} />
                    Edit
                  </button>
                </div>
              )}

              {isAdmin && isEditing && (
                <div className="flex gap-2 shrink-0">
                  <button className="btn-secondary text-xs" onClick={() => setEditingId(null)} disabled={saving}>Cancel</button>
                  <button className="btn-accent text-xs" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {isEditing ? (
              <AutoTextarea className="input text-sm w-full" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} />
            ) : (
              <KpiBlockBody title={block.title} content={block.content} />
            )}
          </div>
        );
      })}

      {isAdmin && (
        <div className="space-y-3 pb-2">
          {!showAddForm ? (
            <button
              className="text-sm flex items-center gap-2 w-full justify-center py-2.5 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'rgba(161,249,110,0.14)', border: '1px solid rgba(161,249,110,0.45)', color: '#0E0E0E' }}
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
                  onChange={(e) => { setNewTitle(e.target.value); if (e.target.value.trim()) setFormErrors((fe) => ({ ...fe, title: undefined })); }}
                />
                {formErrors.title && <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{formErrors.title}</p>}
              </div>
              <div>
                <AutoTextarea
                  className="input text-sm w-full"
                  value={newContent}
                  placeholder="Write block content here."
                  onChange={(e) => { setNewContent(e.target.value); if (e.target.value.trim()) setFormErrors((fe) => ({ ...fe, content: undefined })); }}
                />
                {formErrors.content && <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{formErrors.content}</p>}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button className="btn-accent text-sm" onClick={handleAdd} disabled={addSaving}>
                  {addSaving ? 'Saving…' : 'Save block'}
                </button>
                <button
                  className="text-sm"
                  style={{ color: 'rgba(14,14,14,0.45)' }}
                  onClick={() => { setShowAddForm(false); setNewTitle(''); setNewContent(''); setFormErrors({}); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this KPI block? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
