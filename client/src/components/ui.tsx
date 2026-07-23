// client/src/components/ui.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import type { ShiftLog } from '../types';

// ─── Status strip ────────────────────────────────────────────────────────────
// Generic green/gray "is anyone active right now" banner — bold label when
// active, muted + moon icon when not. Shared by every online-status indicator
// so they all look and behave identically.
export function StatusStrip({
  active,
  label,
  value,
  offlineText,
}: {
  active: boolean;
  label: string;
  value: string;
  offlineText: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-sm"
      style={
        active
          ? { border: '1px solid rgba(161,249,110,0.50)', backgroundColor: 'rgba(161,249,110,0.12)', color: '#0E0E0E' }
          : { border: '1px solid rgba(14,14,14,0.09)', backgroundColor: 'rgba(14,14,14,0.03)', color: 'rgba(14,14,14,0.45)' }
      }
    >
      {active ? (
        <span><span className="font-semibold">{label}:</span> {value}</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Moon size={13} strokeWidth={1.5} />
          {offlineText}
        </span>
      )}
    </div>
  );
}

// Shows agents with a currently active (unarchived) shift log — i.e. they've
// started a shift but not yet clicked "End Shift". Shared by Daily Log and
// Peek Requests so both surfaces agree on who's actually on shift right now.
export function OnlineNowStrip({
  activeLogs,
  emptyMessage = "Everyone's offline right now",
}: {
  activeLogs: ShiftLog[];
  emptyMessage?: string;
}) {
  const value = activeLogs
    .map((log) => `${log.agent.name} — ${log.shiftType === 'MORNING' ? 'Morning' : 'Night'} Shift`)
    .join(', ');
  return <StatusStrip active={activeLogs.length > 0} label="Online now" value={value} offlineText={emptyMessage} />;
}

// ─── Auto-resize textarea ────────────────────────────────────────────────────
export function useAutoResize(ref: React.RefObject<HTMLTextAreaElement>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);
}

export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = 'input text-sm',
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoResize(ref, value);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      rows={1}
      style={{ resize: 'none', overflow: 'hidden' }}
    />
  );
}

// ─── Collapsible text (long pasted content) ─────────────────────────────────
export function CollapsibleText({
  text,
  lines = 3,
  className = 'text-sm text-slate-700',
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.split('\n').length > lines || text.length > 240;

  if (!isLong) {
    return <span className={className} style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  }

  return (
    <div>
      <span
        className={className}
        style={
          expanded
            ? { whiteSpace: 'pre-wrap' }
            : {
                whiteSpace: 'pre-wrap',
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {text}
      </span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs font-medium mt-1 hover:underline"
        style={{ color: '#2563eb' }}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0E0E0E]/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}
           style={{ border: '1px solid rgba(14,14,14,0.09)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink text-2xl leading-none transition-colors">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-10 h-10' : 'w-6 h-6';
  return (
    <div className={`${s} rounded-full animate-spin`}
         style={{ border: '2px solid rgba(14,14,14,0.10)', borderTopColor: '#0E0E0E' }} />
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────
export function EmptyState({ icon, message, action }: { icon?: React.ReactNode; message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      {icon && <div className="mb-3" style={{ color: 'rgba(14,14,14,0.22)' }}>{icon}</div>}
      <p className="text-sm mb-4" style={{ color: 'rgba(14,14,14,0.40)' }}>{message}</p>
      {action}
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    NEW: 'badge-new',
    IN_PROGRESS: 'badge-progress',
    DONE: 'badge-done',
    MORNING: 'badge-morning',
    NIGHT: 'badge-night',
  };
  const labels: Record<string, React.ReactNode> = {
    NEW: 'New',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
    MORNING: <span className="inline-flex items-center gap-1"><Sun size={11} strokeWidth={1.5} />Morning</span>,
    NIGHT: <span className="inline-flex items-center gap-1"><Moon size={11} strokeWidth={1.5} />Night</span>,
  };
  return (
    <span className={map[status] || 'px-2 py-0.5 rounded-full text-xs font-medium text-ink/50'}
          style={!map[status] ? { backgroundColor: 'rgba(14,14,14,0.07)' } : undefined}>
      {labels[status] || status}
    </span>
  );
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onConfirm, onCancel, message }: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  message: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0E0E0E]/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full"
           style={{ border: '1px solid rgba(14,14,14,0.09)' }}>
        <p className="text-ink mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
