// client/src/components/PeekDutyToggle.tsx
// "I'm online" toggle for Peek Requests duty. Self-contained: fetches its own
// eligibility/status and hides itself entirely for ineligible users, so it's
// safe to drop into any page (DailyLog.tsx, PeakRequests.tsx) unconditionally.
import React, { useEffect, useState } from 'react';
import { Circle } from 'lucide-react';
import { getDutyStatus, setDutyStatus } from '../api';

export function PeekDutyToggle() {
  const [status, setStatus] = useState<{ myOnDuty: boolean; eligible: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDutyStatus().then(setStatus).catch(() => {});
  }, []);

  if (!status?.eligible) return null;

  const toggle = async () => {
    const next = !status.myOnDuty;
    setSaving(true);
    setStatus((s) => s && { ...s, myOnDuty: next });
    try {
      await setDutyStatus(next);
    } catch (e) {
      console.error(e);
      setStatus((s) => s && { ...s, myOnDuty: !next });
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
      style={
        status.myOnDuty
          ? { backgroundColor: '#A1F96E', color: '#0E0E0E' }
          : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.6)' }
      }
    >
      <Circle size={9} fill={status.myOnDuty ? '#0E0E0E' : 'transparent'} strokeWidth={1.8} />
      {status.myOnDuty ? 'End Peek Duty' : 'Start Peek Duty'}
    </button>
  );
}
