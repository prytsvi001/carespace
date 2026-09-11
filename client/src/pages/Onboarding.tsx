// client/src/pages/Onboarding.tsx
// Peekviewer Team — "Onboarding" tab (inside My Space): product info and
// how-to material, in blocks. Only Sandra Moore / Victoria Davis (role
// head/lead) can create/edit/delete; every team member can read. Photos and
// videos render inline right on the page — no download step — via the same
// Vercel Blob private-store + presigned-upload pattern Updates uses, just
// streamed through an <img>/<video> tag instead of a download link.
import React, { useEffect, useRef, useState } from 'react';
import { GraduationCap, Plus, Pencil, Trash2, X, Paperclip, FileText, List, Bold } from 'lucide-react';
import { uploadPresigned } from '@vercel/blob/client';
import { useAuth } from '../context/AuthContext';
import {
  getOnboardingBlocks, createOnboardingBlock, updateOnboardingBlock, deleteOnboardingBlock,
  deleteOnboardingAttachment, getOnboardingAttachmentUrl,
  OnboardingBlockData, OnboardingAttachment,
} from '../api';
import { Modal, ConfirmDialog, EmptyState, CardListSkeleton, RichText } from '../components/ui';

function formatFileSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

interface FormData { title: string; content: string; attachments: OnboardingAttachment[] }

function AttachmentPreview({ a }: { a: OnboardingAttachment }) {
  const src = getOnboardingAttachmentUrl(a.url);
  if (a.contentType.startsWith('image/')) {
    return <img src={src} alt={a.name} className="rounded-lg w-full max-h-[420px] object-contain bg-slate-50" />;
  }
  if (a.contentType.startsWith('video/')) {
    return <video src={src} controls className="rounded-lg w-full max-h-[420px] bg-black" />;
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
    >
      <FileText size={16} strokeWidth={1.8} className="shrink-0 text-slate-400" />
      <span className="truncate">{a.name}</span>
    </a>
  );
}

export default function Onboarding() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [blocks, setBlocks] = useState<OnboardingBlockData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setBlocks(await getOnboardingBlocks()); } catch (e) { console.error(e); }
  };
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ title: '', content: '', attachments: [] });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm({ title: '', content: '', attachments: [] });
    setFormError(''); setUploadError('');
    setShowForm(true);
  };

  const openEdit = (b: OnboardingBlockData) => {
    setEditingId(b.id);
    setForm({ title: b.title, content: b.content, attachments: b.attachments });
    setFormError(''); setUploadError('');
    setShowForm(true);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadError('');
    for (const file of files) {
      setUploadingCount((c) => c + 1);
      try {
        const result = await uploadPresigned(`onboarding/${file.name}`, file, {
          access: 'private',
          handleUploadUrl: '/api/onboarding/attachments/upload-url',
        });
        setForm((f) => ({
          ...f,
          attachments: [...f.attachments, {
            url: result.url, pathname: result.pathname, name: file.name,
            contentType: result.contentType, size: file.size,
          }],
        }));
      } catch (err) {
        console.error(err);
        setUploadError(`Failed to upload "${file.name}".`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
  };

  // Wraps the current textarea selection in "**...**" (or inserts a
  // placeholder if nothing's selected) — the content is stored as flat text,
  // RichText renders "**...**" runs bold, no rich-text editor involved.
  const applyBold = () => {
    const el = contentRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const before = value.slice(0, selectionStart);
    const selected = value.slice(selectionStart, selectionEnd);
    const after = value.slice(selectionEnd);
    const inner = selected || 'bold text';
    setForm((f) => ({ ...f, content: `${before}**${inner}**${after}` }));
    requestAnimationFrame(() => {
      el.focus();
      const start = before.length + 2;
      el.setSelectionRange(start, start + inner.length);
    });
  };

  const handleRemoveAttachment = (url: string) => {
    setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.url !== url) }));
    deleteOnboardingAttachment(url).catch((err) => console.error(err));
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('Title and content are required.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const data = { title: form.title.trim(), content: form.content.trim(), attachments: form.attachments };
      if (editingId) {
        const updated = await updateOnboardingBlock(editingId, data);
        setBlocks((prev) => prev.map((b) => (b.id === editingId ? updated : b)));
      } else {
        const created = await createOnboardingBlock(data);
        setBlocks((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      setFormError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    try { await deleteOnboardingBlock(id); } catch (e) { console.error(e); load(); }
    setConfirmDeleteId(null);
  };

  const blockAnchorId = (id: string) => `onboarding-block-${id}`;
  const scrollToBlock = (id: string) => {
    document.getElementById(blockAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Onboarding</h2>
          <p className="text-sm text-slate-400">Product info and how-to material</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
            <Plus size={14} strokeWidth={2} />
            Create New Block
          </button>
        )}
      </div>

      {!loading && blocks.length > 1 && (
        <div className="card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
            <List size={12} strokeWidth={2} />
            Quick navigation
          </p>
          <div className="flex flex-col">
            {blocks.map((b, i) => (
              <button
                key={b.id}
                onClick={() => scrollToBlock(b.id)}
                className="flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                style={{ color: 'rgba(14,14,14,0.7)' }}
              >
                <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{i + 1}.</span>
                <span className="truncate">{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : blocks.length === 0 ? (
        <EmptyState icon={<GraduationCap size={32} strokeWidth={1.2} />} message="Nothing here yet." />
      ) : (
        <div className="space-y-3">
          {blocks.map((b) => (
            <div key={b.id} id={blockAnchorId(b.id)} className="card space-y-3" style={{ scrollMarginTop: '80px' }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-800">{b.title}</h3>
                {b.isAuthor && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(b)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                    >
                      <Pencil size={13} strokeWidth={1.8} />
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(b.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                      Delete
                    </button>
                  </div>
                )}
              </div>

              <div>
                <RichText text={b.content} className="text-sm text-slate-600 leading-relaxed" />
              </div>

              {b.attachments.length > 0 && (
                <div className="space-y-2">
                  {b.attachments.map((a) => <AttachmentPreview key={a.url} a={a} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit Block' : 'Create New Block'} maxWidth="max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. How to process a new profile"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-slate-400">Content</label>
              <button
                type="button"
                onClick={applyBold}
                title="Bold (wraps the selection in **...**)"
                className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.65)' }}
              >
                <Bold size={12} strokeWidth={2.2} />
                Bold
              </button>
            </div>
            <textarea
              ref={contentRef}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={6}
              placeholder="Write the instructions…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Photos / videos (optional)</label>

            {form.attachments.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {form.attachments.map((a) => (
                  <div key={a.url} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-2 min-w-0">
                      {a.contentType.startsWith('image/')
                        ? <img src={getOnboardingAttachmentUrl(a.url)} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                        : <FileText size={16} strokeWidth={1.8} className="shrink-0 text-slate-400" />}
                      <span className="text-xs text-slate-600 truncate">{a.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{formatFileSize(a.size)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(a.url)}
                      className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 shrink-0 transition-colors"
                      aria-label={`Remove ${a.name}`}
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={handleFilesSelected} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.6)' }}
              >
                <Paperclip size={13} strokeWidth={1.8} />
                Attach photo / video
              </button>
              {uploadingCount > 0 && <span className="text-xs text-slate-400">Uploading {uploadingCount}…</span>}
            </div>
            {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || uploadingCount > 0}
              className="btn-accent text-sm disabled:opacity-50"
            >
              {submitting ? 'Saving…' : uploadingCount > 0 ? 'Uploading…' : editingId ? 'Save' : 'Publish'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this block? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
