// client/src/components/SalaryCard.tsx
// One person's pay summary for the selected month — auto-calculated line
// items (each overridable via EditableField), toggles, a free-text bonus
// list, and a large total.
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { EditableField } from './EditableField';
import { HoursBreakdownTooltip } from './HoursBreakdownTooltip';
import { InfoTooltip } from './InfoTooltip';
import { Modal } from './ui';
import { BonusEntry, SalaryRow } from '../types';

function newBonusId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Parsed Profiles has no auto-calculated default (unlike EditableField's
// override-of-a-computed-value fields), so it's a plain always-visible
// required input rather than a click-to-edit one.
function ParsedProfilesInput({ value, onSave }: { value: number | null; onSave: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));

  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    if (draft.trim() === '') { onSave(null); return; }
    const n = Number(draft);
    if (!Number.isNaN(n)) onSave(n);
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>Parsed Profiles by Agent per month</span>
        <InfoTooltip>
          <div className="space-y-0.5">
            <p className="font-semibold mb-1" style={{ color: 'rgba(14,14,14,0.80)' }}>Examples</p>
            <p>170 parses → 10 × $1.00 = $10</p>
            <p>180 parses → 20 × $1.00 = $20</p>
            <p>185 parses → 25 × $1.00 = $25</p>
            <p>200 parses → 25 × $1.00 + 15 × $1.50 = $47.50</p>
            <p>220 parses → 25 × $1.00 + 35 × $1.50 = $77.50</p>
          </div>
        </InfoTooltip>
      </div>
      <input
        type="number"
        required
        className="input w-full text-sm py-1"
        placeholder="e.g. 200"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

export function SalaryCard({
  row, monthLabel, defaultMessage, teamTotalSet, onSaveOverride, onSaveBonuses, onSend,
}: {
  row: SalaryRow;
  monthLabel: string;
  defaultMessage: string;
  teamTotalSet: boolean;
  onSaveOverride: (key: string, value: number | boolean | null) => void;
  onSaveBonuses: (bonuses: BonusEntry[]) => void;
  onSend: (message: string) => Promise<void>;
}) {
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [showSendModal, setShowSendModal] = useState(false);
  const [draftMessage, setDraftMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (!justSent) return;
    const t = setTimeout(() => setJustSent(false), 2000);
    return () => clearTimeout(t);
  }, [justSent]);

  const openSendModal = () => {
    setDraftMessage(defaultMessage);
    setShowSendModal(true);
  };

  const handleSend = async () => {
    if (!draftMessage.trim()) return;
    setSending(true);
    try {
      await onSend(draftMessage.trim());
      setShowSendModal(false);
      setJustSent(true);
    } finally {
      setSending(false);
    }
  };

  const isEdited = (key: string) => row.editedFields.includes(key);

  const addBonus = () => {
    const amount = Number(newAmount);
    if (!newDesc.trim() || Number.isNaN(amount)) return;
    onSaveBonuses([...row.bonuses, { id: newBonusId(), description: newDesc.trim(), amount }]);
    setNewDesc('');
    setNewAmount('');
  };

  const deleteBonus = (id: string) => {
    onSaveBonuses(row.bonuses.filter((b) => b.id !== id));
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold text-slate-800">{row.displayName}</h3>
          <p className="text-xs text-slate-400">{monthLabel}</p>
        </div>
        <button
          type="button"
          onClick={openSendModal}
          disabled={!row.canNotify}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
          style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
          title={row.canNotify ? 'Send salary notification to this person' : 'No account linked'}
          aria-label={row.canNotify ? 'Send salary notification' : 'No account linked'}
        >
          {justSent ? (
            <><CheckCircle2 size={13} strokeWidth={2} /> Sent ✓</>
          ) : (
            <><Send size={13} strokeWidth={1.8} /> Send to Agent</>
          )}
        </button>
      </div>

      {row.notifiedAt && (
        <p className="text-[10px] mb-2" style={{ color: 'rgba(14,14,14,0.40)' }}>
          Sent on {format(new Date(row.notifiedAt), 'MMM d, yyyy')}
        </p>
      )}

      {row.hasSupportDuties ? (
        <div className="pb-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label="Base salary" value={row.base} edited={isEdited('base')}
            onSave={(v) => onSaveOverride('base', v)} onClear={() => onSaveOverride('base', null)} />
          <p className="text-[10px] -mt-1 mb-1.5" style={{ color: 'rgba(14,14,14,0.40)' }}>
            Not based on hours worked
          </p>

          <p className="text-xs font-medium pt-0.5" style={{ color: 'rgba(14,14,14,0.55)' }}>Extra support duties</p>
          <HoursBreakdownTooltip breakdown={row.hoursBreakdown} totalHours={row.hours}>
            <EditableField label="Hours worked" value={row.hours} prefix="" edited={isEdited('hours')}
              onSave={(v) => onSaveOverride('hours', v)} onClear={() => onSaveOverride('hours', null)} />
          </HoursBreakdownTooltip>
          {row.rate != null ? (
            <EditableField label="Rate / hr" value={row.rate} edited={isEdited('rate')}
              onSave={(v) => onSaveOverride('rate', v)} onClear={() => onSaveOverride('rate', null)} />
          ) : (
            <EditableField label="Rate / hr (set your rate)" value={0} edited
              onSave={(v) => onSaveOverride('rate', v)} />
          )}
        </div>
      ) : row.team === 'support' ? (
        <div className="pb-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <HoursBreakdownTooltip breakdown={row.hoursBreakdown} totalHours={row.hours}>
            <EditableField label="Hours worked" value={row.hours} prefix="" edited={isEdited('hours')}
              onSave={(v) => onSaveOverride('hours', v)} onClear={() => onSaveOverride('hours', null)} />
          </HoursBreakdownTooltip>
          <EditableField label="Rate / hr" value={row.rate ?? 0} edited={isEdited('rate')}
            onSave={(v) => onSaveOverride('rate', v)} onClear={() => onSaveOverride('rate', null)} />
          <EditableField label="Base salary" value={row.base} edited={isEdited('base')}
            onSave={(v) => onSaveOverride('base', v)} onClear={() => onSaveOverride('base', null)} />
        </div>
      ) : (
        <div className="pb-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label="Base salary" value={row.base} edited={isEdited('base')}
            onSave={(v) => onSaveOverride('base', v)} onClear={() => onSaveOverride('base', null)} />
        </div>
      )}

      {row.team === 'peekviewer' && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          {teamTotalSet && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>Team bonus</span>
              <span className="text-sm font-medium" style={{ color: 'rgba(14,14,14,0.80)' }}>+${row.teamBonus.toFixed(2)}</span>
            </div>
          )}

          <ParsedProfilesInput value={row.parsedProfiles} onSave={(v) => onSaveOverride('parsedProfiles', v)} />

          {row.parsedProfiles == null ? (
            <p className="text-xs mt-1.5 flex items-start gap-1 text-amber-600">
              <span className="shrink-0">⚠️</span>
              <span>Введи кількість парсів</span>
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>Індивідуальний бонус за парси</span>
              <span className="text-sm font-medium" style={{ color: 'rgba(14,14,14,0.80)' }}>+${row.individualParseBonus.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {row.hasReviews && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label={`Reviews (${row.reviewsCount})`} value={row.reviewsCount} prefix="" edited={isEdited('reviewsCount')}
            onSave={(v) => onSaveOverride('reviewsCount', v)} onClear={() => onSaveOverride('reviewsCount', null)} />
          <EditableField label="Reviews bonus" value={row.reviewsBonus} edited={isEdited('reviewsBonus')}
            onSave={(v) => onSaveOverride('reviewsBonus', v)} onClear={() => onSaveOverride('reviewsBonus', null)} />
        </div>
      )}

      {row.hasPeekBonus && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label="Peek Requests done" value={row.peekCount ?? 0} prefix="" edited={isEdited('peekCount')}
            onSave={(v) => onSaveOverride('peekCount', v)} onClear={() => onSaveOverride('peekCount', null)} />
          <EditableField label="Peek Requests bonus" value={row.peekBonus} edited={isEdited('peekBonus')}
            onSave={(v) => onSaveOverride('peekBonus', v)} onClear={() => onSaveOverride('peekBonus', null)} />
        </div>
      )}

      {row.hasResolvedRequestCount && (
        <div className="py-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          <EditableField label="Peek Requests processed" value={row.resolvedCount ?? 0} prefix="" edited={isEdited('resolvedCount')}
            onSave={(v) => onSaveOverride('resolvedCount', v)} onClear={() => onSaveOverride('resolvedCount', null)} />
        </div>
      )}

      {row.toggles.length > 0 && (
        <div className="py-1 space-y-1" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
          {row.toggles.map((t) => (
            <label key={t.key} className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
              <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>{t.label} (${t.amount})</span>
              <input
                type="checkbox"
                checked={t.on}
                onChange={(e) => onSaveOverride(t.key, e.target.checked)}
                className="accent-current"
              />
            </label>
          ))}
        </div>
      )}

      <div className="py-2">
        <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.65)' }}>Additional bonuses</span>
        {row.bonuses.length > 0 && (
          <div className="space-y-1 mt-1">
            {row.bonuses.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'rgba(14,14,14,0.60)' }}>{b.description}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.75)' }}>${b.amount.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => deleteBonus(b.id)}
                    className="p-0.5 rounded transition-colors"
                    style={{ color: 'rgba(14,14,14,0.30)' }}
                    aria-label="Delete bonus"
                    title="Delete bonus"
                  >
                    <Trash2 size={12} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 mt-2">
          <input
            className="input text-xs flex-1 py-1"
            placeholder="Description"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <input
            className="input text-xs w-20 py-1"
            type="number"
            step="0.01"
            placeholder="$"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
          <button
            type="button"
            onClick={addBonus}
            className="shrink-0 p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.55)' }}
            aria-label="Add bonus"
            title="Add bonus"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="pt-2 flex items-center justify-between" style={{ borderTop: '1px solid rgba(14,14,14,0.10)' }}>
        <span className="text-sm font-semibold" style={{ color: 'rgba(14,14,14,0.65)' }}>TOTAL</span>
        <EditableField label="" value={row.total} size="lg" edited={isEdited('total')}
          onSave={(v) => onSaveOverride('total', v)} onClear={() => onSaveOverride('total', null)} />
      </div>

      <Modal open={showSendModal} onClose={() => setShowSendModal(false)} title={`Send to ${row.displayName}`}>
        <div className="space-y-4">
          <textarea
            className="input resize-none"
            rows={5}
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
          />
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => setShowSendModal(false)} disabled={sending}>
              Cancel
            </button>
            <button
              className="btn-accent flex-1 flex items-center justify-center gap-1.5"
              onClick={handleSend}
              disabled={sending || !draftMessage.trim()}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
