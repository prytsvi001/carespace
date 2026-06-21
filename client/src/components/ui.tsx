// client/src/components/ui.tsx
import React from 'react';
import { Sun, Moon } from 'lucide-react';

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
