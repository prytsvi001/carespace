// client/src/pages/Notes.tsx
// My Space — "Notes" tab, available to every agent on either team. Fully
// personal: a title + free text per note, own CRUD only, quick navigation
// by title (same pattern as Onboarding's block list).
import React, { useEffect, useState } from 'react';
import { StickyNote, Plus, Pencil, Trash2, List } from 'lucide-react';
import { getNotes, createNote, updateNote, deleteNote, NoteData } from '../api';
import { Modal, ConfirmDialog, EmptyState, CardListSkeleton, RichText } from '../components/ui';

interface FormData { title: string; content: string }

export default function Notes() {
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setNotes(await getNotes()); } catch (e) { console.error(e); }
  };
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ title: '', content: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm({ title: '', content: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (n: NoteData) => {
    setEditingId(n.id);
    setForm({ title: n.title, content: n.content });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('Title and text are required.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const data = { title: form.title.trim(), content: form.content.trim() };
      if (editingId) {
        const updated = await updateNote(editingId, data);
        setNotes((prev) => prev.map((n) => (n.id === editingId ? updated : n)));
      } else {
        const created = await createNote(data);
        setNotes((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      setFormError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await deleteNote(id); } catch (e) { console.error(e); load(); }
    setConfirmDeleteId(null);
  };

  const noteAnchorId = (id: string) => `note-${id}`;
  const scrollToNote = (id: string) => {
    document.getElementById(noteAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Notes</h2>
          <p className="text-sm text-slate-400">Your personal notes</p>
        </div>
        <button onClick={openCreate} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
          <Plus size={14} strokeWidth={2} />
          Add Note
        </button>
      </div>

      {!loading && notes.length > 1 && (
        <div className="card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
            <List size={12} strokeWidth={2} />
            Quick navigation
          </p>
          <div className="flex flex-col">
            {notes.map((n, i) => (
              <button
                key={n.id}
                onClick={() => scrollToNote(n.id)}
                className="flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                style={{ color: 'rgba(14,14,14,0.7)' }}
              >
                <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{i + 1}.</span>
                <span className="truncate">{n.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : notes.length === 0 ? (
        <EmptyState icon={<StickyNote size={32} strokeWidth={1.2} />} message="No notes yet." />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} id={noteAnchorId(n.id)} className="card space-y-3" style={{ scrollMarginTop: '80px' }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-800">{n.title}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(n)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                  >
                    <Pencil size={13} strokeWidth={1.8} />
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(n.id)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                    style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                    Delete
                  </button>
                </div>
              </div>
              <RichText text={n.content} className="text-sm text-slate-600 leading-relaxed" />
            </div>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit Note' : 'Add Note'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Note title"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Text</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={6}
              placeholder="Write your note…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={submitting} className="btn-accent text-sm disabled:opacity-50">
              {submitting ? 'Saving…' : editingId ? 'Save' : 'Add Note'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this note? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
