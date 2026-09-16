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
import { GraduationCap, Plus, Pencil, Trash2, X, Paperclip, FileText, List, Bold, ChevronRight, ChevronDown, GripVertical, Search } from 'lucide-react';
import { uploadPresigned } from '@vercel/blob/client';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../context/AuthContext';
import {
  getOnboardingBlocks, createOnboardingBlock, updateOnboardingBlock, deleteOnboardingBlock,
  deleteOnboardingAttachment, getOnboardingAttachmentUrl, reorderOnboardingBlocks,
  OnboardingBlockData, OnboardingAttachment,
} from '../api';
import { Modal, ConfirmDialog, EmptyState, CardListSkeleton, RichText } from '../components/ui';

const blockAnchorId = (id: string) => `onboarding-block-${id}`;

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

// widthPct only applies to images/videos — undefined means full-width (the
// original, pre-resize behavior).
function AttachmentPreview({ a, widthPct }: { a: OnboardingAttachment; widthPct?: number }) {
  const src = getOnboardingAttachmentUrl(a.url);
  const sizeStyle = widthPct ? { width: `${widthPct}%` } : undefined;
  if (a.contentType.startsWith('image/')) {
    return <img src={src} alt={a.name} className="rounded-lg max-w-full max-h-[420px] object-contain bg-slate-50" style={sizeStyle ?? { width: '100%' }} />;
  }
  if (a.contentType.startsWith('video/')) {
    return <video src={src} controls className="rounded-lg max-w-full max-h-[420px] bg-black" style={sizeStyle ?? { width: '100%' }} />;
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

// Groups a block's plain-text content into visually distinct chunks —
// consecutive "- "/"• "/"* " lines become a real bulleted list, a line that
// is ENTIRELY "**...**" (nothing else on it) becomes a spaced-out label
// (the "Обов'язки" style mini-header agents already write, just given room
// to breathe instead of running straight into the paragraph after it), and
// everything else is grouped into paragraphs. Works whether or not the
// original text has blank lines between sections — a run of same-type
// lines merges into one group either way, so already-published content
// gets the new spacing automatically with zero edits needed. Purely a
// render-time grouping — never changes the stored content string itself.
function FormattedText({ text, className }: { text: string; className?: string }) {
  type Group = { type: 'list'; lines: string[] } | { type: 'label'; line: string } | { type: 'para'; lines: string[] };
  const groups: Group[] = [];
  let breakNext = true;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { breakNext = true; continue; }

    const bulletMatch = line.match(/^[-•*]\s+(.*)$/);
    const labelMatch = line.match(/^\*\*(.+)\*\*$/);
    const last = groups[groups.length - 1];

    if (labelMatch) {
      groups.push({ type: 'label', line });
      breakNext = true;
    } else if (bulletMatch) {
      if (!breakNext && last?.type === 'list') last.lines.push(bulletMatch[1]);
      else groups.push({ type: 'list', lines: [bulletMatch[1]] });
      breakNext = false;
    } else {
      if (!breakNext && last?.type === 'para') last.lines.push(line);
      else groups.push({ type: 'para', lines: [line] });
      breakNext = false;
    }
  }

  return (
    <div className="space-y-3">
      {groups.map((g, i) => {
        if (g.type === 'label') {
          return (
            <div key={i} className="font-semibold text-slate-700">
              <RichText text={g.line} className={className} />
            </div>
          );
        }
        if (g.type === 'list') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {g.lines.map((l, j) => (
                <li key={j}><RichText text={l} className={className} /></li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i}>
            <RichText text={g.lines.join('\n')} className={className} />
          </div>
        );
      })}
    </div>
  );
}

function inlineAttachmentTypeAllowed(contentType: string): boolean {
  return contentType.startsWith('image/') || contentType.startsWith('video/');
}

const RESIZE_PRESETS = [25, 50, 75, 100];

// A pasted image/video is inserted into the content text as this marker, at
// the cursor position, so it renders right where it was pasted instead of
// only in the attachments list at the end of the block. "att" identifies
// the attachment by url, looked up from the block's own attachments array;
// the optional "|w=NN" suffix is its display width as a percentage (see the
// resize buttons in the edit-form preview below) — no suffix means 100%.
const INLINE_ATTACHMENT_PATTERN = /\[\[att:([^|\]]+)(?:\|w=(\d{1,3}))?\]\]/;

function inlineAttachmentMarker(url: string, widthPct?: number): string {
  return widthPct && widthPct !== 100 ? `[[att:${url}|w=${widthPct}]]` : `[[att:${url}]]`;
}

// Renders a block's content, splicing in an inline image/video (at its
// stored width) wherever a marker appears, then appends any attachments the
// content doesn't reference (e.g. added via the "Attach file" button, or
// non-inline types like PDFs) below, same as before.
//
// In the edit form, the same renderer doubles as a live "what this will
// look like" preview: pass onResize and each inline image/video gets a row
// of size-preset buttons under it that rewrite that exact marker occurrence
// in the content string (by character offset, so pasting the same image
// twice resizes only the one you clicked).
function BlockContent({ content, attachments, className, onResize }: {
  content: string; attachments: OnboardingAttachment[]; className?: string;
  onResize?: (matchStart: number, matchEnd: number, url: string, widthPct: number) => void;
}) {
  const byUrl = new Map(attachments.map((a) => [a.url, a]));
  const usedUrls = new Set<string>();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const re = new RegExp(INLINE_ATTACHMENT_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const chunk = content.slice(lastIndex, match.index);
      if (chunk.trim()) parts.push(<FormattedText key={key++} text={chunk} className={className} />);
    }
    const attachment = byUrl.get(match[1]);
    const widthPct = match[2] ? Number(match[2]) : 100;
    if (attachment) {
      usedUrls.add(attachment.url);
      const matchStart = match.index;
      const matchEnd = re.lastIndex;
      parts.push(
        <div key={key++}>
          <AttachmentPreview a={attachment} widthPct={widthPct} />
          {onResize && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px]" style={{ color: 'rgba(14,14,14,0.35)' }}>Size:</span>
              {RESIZE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onResize(matchStart, matchEnd, attachment.url, preset)}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors"
                  style={preset === widthPct
                    ? { backgroundColor: 'rgba(161,249,110,0.35)', color: '#0E0E0E' }
                    : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }}
                >
                  {preset}%
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    lastIndex = re.lastIndex;
  }
  const tail = content.slice(lastIndex);
  if (tail.trim()) parts.push(<FormattedText key={key++} text={tail} className={className} />);

  const remaining = attachments.filter((a) => !usedUrls.has(a.url));

  return (
    <div className="space-y-2">
      {parts}
      {remaining.map((a) => <AttachmentPreview key={a.url} a={a} />)}
    </div>
  );
}

// A sub-block row within its parent's card — its own chevron/collapse (see
// Onboarding()'s expandedIds) and, for admins, its own drag handle so
// sub-blocks reorder independently of their siblings under other parents.
function SubBlockRow({ block, isOpen, isAdmin, canDrag, onToggle, onEdit, onDeleteRequest }: {
  block: OnboardingBlockData; isOpen: boolean; isAdmin: boolean; canDrag: boolean;
  onToggle: () => void; onEdit: () => void; onDeleteRequest: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const dragStyle: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} id={blockAnchorId(block.id)} style={{ ...dragStyle, scrollMarginTop: '80px' }}>
      <div className="w-full flex items-center">
        {canDrag && (
          <button
            {...attributes}
            {...listeners}
            className="p-1.5 shrink-0 cursor-grab active:cursor-grabbing rounded-lg transition-colors hover:bg-slate-100"
            style={{ color: 'rgba(14,14,14,0.3)' }}
            aria-label="Drag to reorder"
          >
            <GripVertical size={12} strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 text-left py-1.5 rounded-lg transition-colors hover:bg-slate-50"
        >
          {isOpen
            ? <ChevronDown size={13} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />
            : <ChevronRight size={13} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />}
          <h4 className="text-sm font-medium text-slate-700 flex-1 min-w-0 truncate">{block.title}</h4>
        </button>
      </div>

      {isOpen && (
        <div className="pl-5 pb-2 space-y-2">
          {isAdmin && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
              >
                <Pencil size={12} strokeWidth={1.8} />
                Edit
              </button>
              <button
                onClick={onDeleteRequest}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
              >
                <Trash2 size={12} strokeWidth={1.8} />
                Delete
              </button>
            </div>
          )}

          <BlockContent content={block.content} attachments={block.attachments} className="text-sm text-slate-600 leading-relaxed" />
        </div>
      )}
    </div>
  );
}

// A top-level block's accordion card. Extracted (rather than rendered
// inline in the .map() below) because useSortable must be called once per
// draggable item from its own component — React hooks can't be called a
// variable number of times inside a single component's render.
function TopLevelBlockCard({
  block, accent, isOpen, isAdmin, canDrag, childBlocks, expandedIds, dndSensors,
  onToggle, onToggleChild, onEdit, onEditChild, onDeleteRequest, onDeleteChildRequest,
  onAddSubBlock, onReorderChildren,
}: {
  block: OnboardingBlockData;
  accent: { dot: string; bg: string; line: string };
  isOpen: boolean;
  isAdmin: boolean;
  canDrag: boolean;
  childBlocks: OnboardingBlockData[];
  expandedIds: Set<string>;
  dndSensors: ReturnType<typeof useSensors>;
  onToggle: () => void;
  onToggleChild: (id: string) => void;
  onEdit: () => void;
  onEditChild: (c: OnboardingBlockData) => void;
  onDeleteRequest: () => void;
  onDeleteChildRequest: (id: string) => void;
  onAddSubBlock: () => void;
  onReorderChildren: (event: DragEndEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const dragStyle: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      id={blockAnchorId(block.id)}
      className="card overflow-hidden"
      style={{ ...dragStyle, scrollMarginTop: '80px', borderLeft: `3px solid ${accent.dot}`, padding: 0 }}
    >
      <div className="w-full flex items-center" style={{ backgroundColor: isOpen ? accent.bg : undefined }}>
        {canDrag && (
          <button
            {...attributes}
            {...listeners}
            className="p-2 shrink-0 cursor-grab active:cursor-grabbing rounded-lg transition-colors hover:bg-slate-100"
            style={{ color: 'rgba(14,14,14,0.3)' }}
            aria-label="Drag to reorder"
          >
            <GripVertical size={14} strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2.5 py-3 pr-4 text-left transition-colors"
        >
          {isOpen
            ? <ChevronDown size={15} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />
            : <ChevronRight size={15} strokeWidth={2} className="shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />}
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent.dot }} />
          <h3 className="text-sm font-semibold text-slate-800 flex-1 min-w-0 truncate">{block.title}</h3>
          {childBlocks.length > 0 && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
            >
              {childBlocks.length} sub-block{childBlocks.length === 1 ? '' : 's'}
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {isAdmin && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
              >
                <Pencil size={13} strokeWidth={1.8} />
                Edit
              </button>
              <button
                onClick={onDeleteRequest}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
              >
                <Trash2 size={13} strokeWidth={1.8} />
                Delete
              </button>
            </div>
          )}

          <BlockContent content={block.content} attachments={block.attachments} className="text-sm text-slate-600 leading-relaxed" />

          {childBlocks.length > 0 && (
            <DndContext sensors={dndSensors} onDragEnd={onReorderChildren}>
              <SortableContext items={childBlocks.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <div className="pl-4 space-y-1" style={{ borderLeft: `2px solid ${accent.line}` }}>
                  {childBlocks.map((c) => (
                    <SubBlockRow
                      key={c.id}
                      block={c}
                      isOpen={expandedIds.has(c.id)}
                      isAdmin={isAdmin}
                      canDrag={canDrag}
                      onToggle={() => onToggleChild(c.id)}
                      onEdit={() => onEditChild(c)}
                      onDeleteRequest={() => onDeleteChildRequest(c.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {isAdmin && (
            <button
              onClick={onAddSubBlock}
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

  // Separate from expandedIds (which opens the actual block card below) —
  // this only controls whether a top-level entry's sub-blocks are listed
  // out in Quick Navigation itself. Collapsed by default so the nav stays a
  // short list of topics instead of a full copy of the page's structure.
  const [navExpandedIds, setNavExpandedIds] = useState<Set<string>>(new Set());
  const toggleNavExpanded = (id: string) => {
    setNavExpandedIds((prev) => {
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

  // Lets you Ctrl+V an image/video straight from the clipboard, alongside
  // the "Attach file" button — e.g. a screenshot copied from Snipping Tool
  // pastes in directly, no save-then-browse step. Unlike the button (which
  // only appends to the attachments list), a pasted image/video also gets a
  // marker inserted at the cursor so it renders right where it was pasted
  // (see BlockContent/INLINE_ATTACHMENT_PATTERN above). Other file types
  // pasted this way still just append to the attachments list, same as the
  // button.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length === 0) return;
    e.preventDefault();

    const el = e.currentTarget;
    let cursor = el.selectionStart ?? el.value.length;

    setUploadError('');
    for (const file of files) {
      setUploadingCount((c) => c + 1);
      try {
        const result = await uploadPresigned(`onboarding/${file.name}`, file, {
          access: 'private',
          handleUploadUrl: '/api/onboarding/attachments/upload-url',
        });
        const attachment: OnboardingAttachment = {
          url: result.url, pathname: result.pathname, name: file.name,
          contentType: result.contentType, size: file.size,
        };

        setForm((f) => {
          const attachments = [...f.attachments, attachment];
          if (!inlineAttachmentTypeAllowed(attachment.contentType)) {
            return { ...f, attachments };
          }
          const marker = inlineAttachmentMarker(attachment.url);
          const before = f.content.slice(0, cursor);
          const after = f.content.slice(cursor);
          const lead = before && !before.endsWith('\n') ? '\n' : '';
          const trail = after && !after.startsWith('\n') ? '\n' : '';
          const insert = `${lead}${marker}${trail}`;
          cursor = (before + insert).length; // next pasted file (if any) inserts after this one
          return { ...f, attachments, content: before + insert + after };
        });
      } catch (err) {
        console.error(err);
        setUploadError(`Failed to upload "${file.name}".`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }

    requestAnimationFrame(() => {
      contentRef.current?.focus();
      contentRef.current?.setSelectionRange(cursor, cursor);
    });
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
    // Drop the inline marker too, if this attachment was pasted inline —
    // otherwise a dangling "[[att:...]]" (with or without a "|w=NN" size
    // suffix) is left behind as literal text.
    const markerForUrl = new RegExp(`\\[\\[att:${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|w=\\d{1,3})?\\]\\]`, 'g');
    setForm((f) => ({
      ...f,
      attachments: f.attachments.filter((a) => a.url !== url),
      content: f.content.replace(markerForUrl, ''),
    }));
    deleteOnboardingAttachment(url).catch((err) => console.error(err));
  };

  // Rewrites one specific marker occurrence's width, by character offset —
  // targets exactly the image the resize buttons were clicked under, even
  // if the same file was pasted more than once.
  const handleResizeInline = (matchStart: number, matchEnd: number, url: string, widthPct: number) => {
    setForm((f) => ({
      ...f,
      content: f.content.slice(0, matchStart) + inlineAttachmentMarker(url, widthPct) + f.content.slice(matchEnd),
    }));
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
        // Sub-blocks collapse independently now (see toggleExpanded below),
        // so a freshly created one needs to be added here too — otherwise it
        // would publish already collapsed and look like nothing happened.
        setExpandedIds((prev) => new Set(prev).add(created.id));
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

  // Expands the target block (and its parent, for a sub-block) before
  // scrolling to it — sub-blocks collapse independently now, so jumping to
  // one from Quick Navigation would otherwise land on a closed, empty header.
  const scrollToBlock = (id: string, parentId?: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (parentId) next.add(parentId);
      return next;
    });
    requestAnimationFrame(() => {
      document.getElementById(blockAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Two-level tree: top-level blocks (e.g. "Мультилогін") each with their own
  // sub-blocks (e.g. "Знайомство з додатком", "Робота з додатком"). Quick
  // navigation only lists top-level blocks.
  const topLevelBlocks = blocks.filter((b) => !b.parentId);
  const childrenOf = (id: string) => blocks.filter((b) => b.parentId === id);

  // Title-only filter, shared by Quick Navigation and the main list below —
  // a top-level block stays visible if its own title matches OR any of its
  // sub-blocks' titles do (so a matching sub-block never loses its parent's
  // context); when only sub-blocks match, only THOSE sub-blocks show (not
  // the whole set) to keep the point of searching — less to scan, not more.
  const [search, setSearch] = useState('');
  const searchQuery = search.trim().toLowerCase();
  const titleMatches = (title: string) => title.toLowerCase().includes(searchQuery);

  const filteredTopLevelBlocks = searchQuery
    ? topLevelBlocks.filter((b) => titleMatches(b.title) || childrenOf(b.id).some((c) => titleMatches(c.title)))
    : topLevelBlocks;
  const visibleChildrenOf = (b: OnboardingBlockData) => {
    const kids = childrenOf(b.id);
    if (!searchQuery || titleMatches(b.title)) return kids;
    return kids.filter((c) => titleMatches(c.title));
  };

  // Auto-expand whatever currently matches as the query changes, so results
  // are visible immediately instead of needing an extra click per match —
  // never auto-collapses anything, so clearing the search just reveals
  // whatever else was already open.
  useEffect(() => {
    if (!searchQuery) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const b of topLevelBlocks) {
        const ownMatch = titleMatches(b.title);
        const matchingKids = childrenOf(b.id).filter((c) => titleMatches(c.title));
        if (ownMatch || matchingKids.length > 0) {
          next.add(b.id);
          if (!ownMatch) matchingKids.forEach((c) => next.add(c.id));
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, blocks]);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Reorders the top-level blocks (drag handle on each TopLevelBlockCard).
  // Optimistic: rebuild `blocks` as [new top-level order, ...every sub-block
  // untouched] — topLevelBlocks/childrenOf are plain filters, so only the
  // relative order among matching items matters, not their absolute
  // position in the flat array.
  const handleReorderTop = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((prev) => {
      const top = prev.filter((b) => !b.parentId);
      const rest = prev.filter((b) => b.parentId);
      const oldIndex = top.findIndex((b) => b.id === active.id);
      const newIndex = top.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reordered = arrayMove(top, oldIndex, newIndex);
      reorderOnboardingBlocks(null, reordered.map((b) => b.id)).catch((e) => { console.error(e); load(); });
      return [...reordered, ...rest];
    });
  };

  // Same idea, scoped to one parent's own sub-blocks.
  const handleReorderChildren = (parentId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((prev) => {
      const kids = prev.filter((b) => b.parentId === parentId);
      const rest = prev.filter((b) => b.parentId !== parentId);
      const oldIndex = kids.findIndex((b) => b.id === active.id);
      const newIndex = kids.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reordered = arrayMove(kids, oldIndex, newIndex);
      reorderOnboardingBlocks(parentId, reordered.map((b) => b.id)).catch((e) => { console.error(e); load(); });
      return [...rest, ...reordered];
    });
  };

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
        <div className="relative">
          <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search blocks by title…"
            className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-9 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Clear search"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {!loading && blocks.length > 1 && filteredTopLevelBlocks.length > 0 && (
        <div className="card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
            <List size={12} strokeWidth={2} />
            Quick navigation
          </p>
          <div className="flex flex-col">
            {filteredTopLevelBlocks.map((b, i) => {
              const kids = visibleChildrenOf(b);
              // While searching, always show the (already-filtered, already
              // short) matching sub-blocks — no need to also click a chevron.
              const navOpen = !!searchQuery || navExpandedIds.has(b.id);
              return (
                <React.Fragment key={b.id}>
                  <div className="flex items-center gap-0.5">
                    {kids.length > 0 ? (
                      <button
                        onClick={() => toggleNavExpanded(b.id)}
                        className="p-1 rounded-lg shrink-0 transition-colors hover:bg-slate-100"
                        style={{ color: 'rgba(14,14,14,0.35)' }}
                        aria-label={navOpen ? 'Collapse' : 'Expand'}
                      >
                        {navOpen
                          ? <ChevronDown size={13} strokeWidth={2} />
                          : <ChevronRight size={13} strokeWidth={2} />}
                      </button>
                    ) : (
                      <span className="w-[26px] shrink-0" />
                    )}
                    <button
                      onClick={() => scrollToBlock(b.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                      style={{ color: 'rgba(14,14,14,0.7)' }}
                    >
                      <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{i + 1}.</span>
                      <span className="truncate font-medium flex-1 min-w-0">{b.title}</span>
                      {kids.length > 0 && !navOpen && (
                        <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{kids.length}</span>
                      )}
                    </button>
                  </div>
                  {navOpen && kids.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => scrollToBlock(c.id, b.id)}
                      className="flex items-center gap-2 text-left text-sm pl-8 pr-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                      style={{ color: 'rgba(14,14,14,0.55)' }}
                    >
                      <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.3)' }}>–</span>
                      <span className="truncate">{c.title}</span>
                    </button>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : topLevelBlocks.length === 0 ? (
        <EmptyState icon={<GraduationCap size={32} strokeWidth={1.2} />} message="Nothing here yet." />
      ) : filteredTopLevelBlocks.length === 0 ? (
        <EmptyState icon={<Search size={32} strokeWidth={1.2} />} message="No blocks match your search." />
      ) : (
        <DndContext sensors={dndSensors} onDragEnd={handleReorderTop}>
          <SortableContext items={filteredTopLevelBlocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {filteredTopLevelBlocks.map((b, i) => {
                const children = visibleChildrenOf(b);
                const accent = ACCENT_PALETTE[i % ACCENT_PALETTE.length];
                return (
                  <TopLevelBlockCard
                    key={b.id}
                    block={b}
                    accent={accent}
                    isOpen={expandedIds.has(b.id)}
                    isAdmin={isAdmin}
                    canDrag={isAdmin && !searchQuery}
                    childBlocks={children}
                    expandedIds={expandedIds}
                    dndSensors={dndSensors}
                    onToggle={() => toggleExpanded(b.id)}
                    onToggleChild={(id) => toggleExpanded(id)}
                    onEdit={() => openEdit(b)}
                    onEditChild={(c) => openEdit(c)}
                    onDeleteRequest={() => setConfirmDeleteId(b.id)}
                    onDeleteChildRequest={(id) => setConfirmDeleteId(id)}
                    onAddSubBlock={() => openCreate(b.id)}
                    onReorderChildren={(e) => handleReorderChildren(b.id, e)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
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

          {new RegExp(INLINE_ATTACHMENT_PATTERN.source).test(form.content) && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Preview — click a size to resize an image</label>
              <div className="rounded-lg p-3" style={{ backgroundColor: 'rgba(14,14,14,0.02)', border: '1px solid rgba(14,14,14,0.07)' }}>
                <BlockContent
                  content={form.content}
                  attachments={form.attachments}
                  className="text-sm text-slate-600 leading-relaxed"
                  onResize={handleResizeInline}
                />
              </div>
            </div>
          )}

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
