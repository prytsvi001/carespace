// client/src/components/UpdatesTab.tsx
// Presentational "Updates" view for the Inbox page — lead/head-authored team
// announcements with read-tracking. Driven entirely by props from Inbox.tsx
// (which already polls /api/updates in its existing 20s loop), so this
// component does no fetching of its own.
import React, { useState } from 'react';
import { Megaphone, Pencil, Trash2, ChevronDown, ChevronUp, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { TeamUpdate, UpdateTag } from '../types';
import { Modal, ConfirmDialog } from './ui';

const TAG_META: Record<UpdateTag, { cls: string }> = {
  'Important': { cls: 'bg-red-50 text-red-600' },
  'Policy change': { cls: 'bg-amber-50 text-amber-700' },
  'Reminder': { cls: 'bg-blue-50 text-blue-600' },
};

interface UpdateFormData {
  title: string;
  content: string;
  tag: string | null;
}

interface UpdatesTabProps {
  updates: TeamUpdate[];
  isAdmin: boolean;
  onPublish: (data: UpdateFormData) => Promise<void>;
  onEdit: (id: string, data: UpdateFormData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMarkRead: (id: string) => void;
}

export function UpdatesTab({ updates, isAdmin, onPublish, onEdit, onDelete, onMarkRead }: UpdatesTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UpdateFormData>({ title: '', content: '', tag: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [adminDetailIds, setAdminDetailIds] = useState<Set<string>>(new Set());

  const toggleSet = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ title: '', content: '', tag: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (u: TeamUpdate) => {
    setEditingId(u.id);
    setForm({ title: u.title, content: u.content, tag: u.tag ?? '' });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('Title and content are required.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const data: UpdateFormData = { title: form.title.trim(), content: form.content.trim(), tag: form.tag || null };
      if (editingId) {
        await onEdit(editingId, data);
      } else {
        await onPublish(data);
      }
      setShowForm(false);
    } catch {
      setFormError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }}
          >
            <Megaphone size={13} strokeWidth={1.8} />
            New Update
          </button>
        </div>
      )}

      {updates.length === 0 ? (
        <div className="py-14 text-center">
          <Megaphone size={40} strokeWidth={1} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No updates yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {updates.map((u) => {
            const isCollapsed = !expandedIds.has(u.id);
            const collapsedPreview = u.content.length > 100 ? `${u.content.slice(0, 100)}…` : u.content;
            const showAdminDetail = adminDetailIds.has(u.id);
            const canShowNames = isAdmin || u.isAuthor;

            return (
              <div
                key={u.id}
                className="card transition-all"
                style={!u.read && !u.isAuthor ? { borderLeft: '3px solid #A1F96E' } : {}}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {u.tag && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TAG_META[u.tag].cls}`}>
                        {u.tag}
                      </span>
                    )}
                    <span className="text-sm font-medium text-slate-700">from {u.authorName}</span>
                    {!u.read && !u.isAuthor && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: '#A1F96E' }} />
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {format(new Date(u.createdAt), "dd MMM yyyy 'at' HH:mm")}
                  </span>
                </div>

                <button
                  onClick={() => toggleSet(expandedIds, setExpandedIds, u.id)}
                  className="w-full flex items-center justify-between gap-2 text-left mb-1"
                >
                  <span className="text-sm font-semibold text-slate-700 truncate">{u.title}</span>
                  {isCollapsed
                    ? <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-slate-300" />
                    : <ChevronUp size={16} strokeWidth={2} className="shrink-0 text-slate-300" />}
                </button>

                <p className="text-sm text-slate-600 leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                  {isCollapsed ? collapsedPreview : u.content}
                </p>

                {u.editedAt && (
                  <p className="text-xs text-slate-400 mt-1">
                    Edited {format(new Date(u.editedAt), "dd MMM yyyy 'at' HH:mm")}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <button
                      onClick={() => canShowNames && toggleSet(adminDetailIds, setAdminDetailIds, u.id)}
                      className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500"
                      style={canShowNames ? { cursor: 'pointer' } : undefined}
                    >
                      Read by {u.readCount}/{u.totalCount} agents
                    </button>
                    {showAdminDetail && canShowNames && (
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                        <span className="font-medium text-slate-500">Read by:</span>{' '}
                        {u.readNames && u.readNames.length > 0 ? u.readNames.join(', ') : '—'}
                        {' · '}
                        <span className="font-medium text-slate-500">Not yet read:</span>{' '}
                        {u.unreadNames && u.unreadNames.length > 0 ? u.unreadNames.join(', ') : '—'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!u.isAuthor && !u.read && (
                      <button
                        onClick={() => onMarkRead(u.id)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                        style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                      >
                        <Mail size={13} strokeWidth={2} />
                        Mark as read
                      </button>
                    )}
                    {u.isAuthor && (
                      <>
                        <button
                          onClick={() => openEdit(u)}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                          style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                        >
                          <Pencil size={13} strokeWidth={1.8} />
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteTarget(u.id)}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                          style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit Update' : 'New Update'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. New refund policy"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Tag (optional)</label>
            <select
              value={form.tag ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
            >
              <option value="">None</option>
              <option value="Important">Important</option>
              <option value="Policy change">Policy change</option>
              <option value="Reminder">Reminder</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={5}
              placeholder="Write the update…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
            >
              {submitting ? 'Saving…' : editingId ? 'Save' : 'Publish'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        message="Delete this update? This removes it and everyone's read receipts."
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
