// client/src/pages/Onboarding.tsx
// Peekviewer Team — "Onboarding" tab (inside My Space): product info and
// how-to material, in blocks. Only Sandra Moore / Victoria Davis (role
// head/lead) can create/edit/delete; every team member can read. Any
// attached file type is supported (images/video/audio, PDFs, Office docs,
// text/CSV, zip — see onboarding.ts's ALLOWED_ATTACHMENT_TYPES); photos and
// videos render inline right on the page — no download step — via the same
// Vercel Blob private-store + presigned-upload pattern Updates uses, just
// streamed through an <img>/<video> tag, while everything else falls back to
// a clickable download link (AttachmentPreview below).
import React, { useEffect, useRef, useState } from 'react';
import { GraduationCap, Plus, Pencil, Trash2, X, Paperclip, FileText, List, Bold, ChevronRight, ChevronDown } from 'lucide-react';
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

interface FormData { title: string; content: string; attachments: OnboardingAttachment[]; parentId: string | null }

// Cycled by a top-level block's position — purely decorative, gives each
// block its own identity (a colored dot + left accent bar) without needing
// admins to pick a color/icon per block themselves.
const ACCENT_PALETTE = [
  { dot: '#3b82f6', bg: 'rgba(59,130,246,0.07)', line: 'rgba(59,130,246,0.35)' },
  { dot: '#22c55e', bg: 'rgba(34,197,94,0.07)', line: 'rgba(34,197,94,0.35)' },
  { dot: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', line: 'rgba(139,92,246,0.35)' },
  { dot: '#f59e0b', bg: 'rgba(245,158,11,0.07)', line: 'rgba(245,158,11,0.35)' },
  { dot: '#f43f5e', bg: 'rgba(244,63,94,0.07)', line: 'rgba(244,63,94,0.35)' },
  { dot: '#14b8a6', bg: 'rgba(20,184,166,0.07)', line: 'rgba(20,184,166,0.35)' },
];

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const data = await getOnboardingBlocks();
      setBlocks(data);
      // Default to the first top-level block open so the page isn't just a
      // flat list of closed rows on first visit.
      const firstTop = data.find((b) => !b.parentId);
      if (firstTop) setExpandedIds((prev) => (prev.size > 0 ? prev : new Set([firstTop.id])));
    } catch (e) { console.error(e); }
  };
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ title: '', content: '', attachments: [], parentId: null });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // parentId set means "create a sub-block under this top-level block" —
  // reached via that block's own "+ Add sub-block" button.
  const openCreate = (parentId: string | null = null) => {
    setEditingId(null);
    setForm({ title: '', content: '', attachments: [], parentId });
    setFormError(''); setUploadError('');
    setShowForm(true);
  };

  const openEdit = (b: OnboardingBlockData) => {
    setEditingId(b.id);
    setForm({ title: b.title, content: b.content, attachments: b.attachments, parentId: b.parentId });
    setFormError(''); setUploadError('');
    setShowForm(true);
  };

  const uploadFiles = async (files: File[]) => {
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

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadFiles(files);
  };

  // Lets you Ctrl+V an image (or any file) straight from the clipboard as an
  // attachment, alongside the "Attach file" button — e.g. a screenshot
  // copied from Snipping Tool pastes in directly, no save-then-browse step.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    await uploadFiles(files);
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
      const data = { title: form.title.trim(), content: form.content.trim(), attachments: form.attachments, parentId: form.parentId };
      if (editingId) {
        const updated = await updateOnboardingBlock(editingId, data);
        setBlocks((prev) => prev.map((b) => (b.id === editingId ? updated : b)));
      } else {
        const created = await createOnboardingBlock(data);
        setBlocks((prev) => [...prev, created]);
        if (!created.parentId) {
          setExpandedIds((prev) => new Set(prev).add(created.id));
        }
      }
      setShowForm(false);
    } catch {
      setFormError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    // Deleting a top-level block cascades to its sub-blocks server-side —
    // drop them from local state too so the optimistic update matches.
    setBlocks((prev) => prev.filter((b) => b.id !== id && b.parentId !== id));
    try { await deleteOnboardingBlock(id); } catch (e) { console.error(e); load(); }
    setConfirmDeleteId(null);
  };

  const blockAnchorId = (id: string) => `onboarding-block-${id}`;
  const scrollToBlock = (id: string) => {
    document.getElementById(blockAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Two-level tree: top-level blocks (e.g. "Мультилогін") each with their own
  // sub-blocks (e.g. "Знайомство з додатком", "Робота з додатком"). Quick
  // navigation only lists top-level blocks.
  const topLevelBlocks = blocks.filter((b) => !b.parentId);
  const childrenOf = (id: string) => blocks.filter((b) => b.parentId === id);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Onboarding</h2>
          <p className="text-sm text-slate-400">Product info and how-to material</p>
        </div>
        {isAdmin && (
          <button onClick={() => openCreate()} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
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
            {topLevelBlocks.map((b, i) => (
              <React.Fragment key={b.id}>
                <button
                  onClick={() => scrollToBlock(b.id)}
                  className="flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                  style={{ color: 'rgba(14,14,14,0.7)' }}
                >
                  <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{i + 1}.</span>
                  <span className="truncate font-medium">{b.title}</span>
                </button>
                {childrenOf(b.id).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => scrollToBlock(c.id)}
                    className="flex items-center gap-2 text-left text-sm pl-8 pr-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                    style={{ color: 'rgba(14,14,14,0.55)' }}
                  >
                    <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.3)' }}>–</span>
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : topLevelBlocks.length === 0 ? (
        <EmptyState icon={<GraduationCap size={32} strokeWidth={1.2} />} message="Nothing here yet." />
      ) : (
        <div className="space-y-3">
          {topLevelBlocks.map((b, i) => {
            const children = childrenOf(b.id);
            const accent = ACCENT_PALETTE[i % ACCENT_PALETTE.length];
            const isOpen = expandedIds.has(b.id);
            return (
              <div
                key={b.id}
                id={blockAnchorId(b.id)}
                className="card overflow-hidden"
                style={{ scrollMarginTop: '80px', borderLeft: `3px solid ${accent.dot}`, padding: 0 }}
              >
                <button
                  onClick={() => toggleExpanded(b.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  style={{ backgroundColor: isOpen ? accent.bg : undefined }}
                >
                  {isOpen
                    ? <ChevronDown size={15} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />
                    : <ChevronRight size={15} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />}
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent.dot }} />
                  <h3 className="text-sm font-semibold text-slate-800 flex-1 min-w-0 truncate">{b.title}</h3>
                  {children.length > 0 && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                    >
                      {children.length} sub-block{children.length === 1 ? '' : 's'}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-3">
                    {isAdmin && (
                      <div className="flex items-center justify-end gap-2">
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

                    <RichText text={b.content} className="text-sm text-slate-600 leading-relaxed" />

                    {b.attachments.length > 0 && (
                      <div className="space-y-2">
                        {b.attachments.map((a) => <AttachmentPreview key={a.url} a={a} />)}
                      </div>
                    )}

                    {children.length > 0 && (
                      <div className="pl-4 space-y-3" style={{ borderLeft: `2px solid ${accent.line}` }}>
                        {children.map((c) => (
                          <div key={c.id} id={blockAnchorId(c.id)} className="space-y-2" style={{ scrollMarginTop: '80px' }}>
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="text-sm font-medium text-slate-700">{c.title}</h4>
                              {isAdmin && (
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={() => openEdit(c)}
                                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
                                    style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                                  >
                                    <Pencil size={12} strokeWidth={1.8} />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(c.id)}
                                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                                    style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                                  >
                                    <Trash2 size={12} strokeWidth={1.8} />
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>

                            <RichText text={c.content} className="text-sm text-slate-600 leading-relaxed" />

                            {c.attachments.length > 0 && (
                              <div className="space-y-2">
                                {c.attachments.map((a) => <AttachmentPreview key={a.url} a={a} />)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {isAdmin && (
                      <button
                        onClick={() => openCreate(b.id)}
                        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                        style={{ backgroundColor: 'rgba(161,249,110,0.14)', color: 'rgba(14,14,14,0.65)' }}
                      >
                        <Plus size={12} strokeWidth={2} />
                        Add sub-block
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? (form.parentId ? 'Edit Sub-block' : 'Edit Block') : (form.parentId ? 'Add Sub-block' : 'Create New Block')}
        maxWidth="max-w-2xl"
      >
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
              onPaste={handlePaste}
              rows={6}
              placeholder="Write the instructions… (paste an image with Ctrl+V to attach it)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Files (optional) <span style={{ color: 'rgba(14,14,14,0.35)' }}>— attach a file, or paste one (Ctrl+V) into the content field above</span>
            </label>

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

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.6)' }}
              >
                <Paperclip size={13} strokeWidth={1.8} />
                Attach file
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
