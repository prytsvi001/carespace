// client/src/pages/CalendarTab.tsx
// Decides which calendar(s) a user sees under the "Shift Calendar" tab:
// - peek_handler: Peek Requests Calendar only, no Support Calendar, no toggle.
// - Julia Manson / head / lead: Support Calendar by default, with a toggle to
//   switch to the Peek Requests Calendar (both view + edit access).
// - everyone else: Support Calendar only, exactly as before.
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getPeekCalendarAccess } from '../api';
import ShiftCalendar from './ShiftCalendar';
import PeekRequestsCalendar from './PeekRequestsCalendar';

type View = 'support' | 'peek';

export default function CalendarTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const { user } = useAuth();
  const isPeekHandler = user?.role === 'peek_handler';

  const [canAccessPeek, setCanAccessPeek] = useState(false);
  const [view, setView] = useState<View>('support');

  useEffect(() => {
    if (isPeekHandler) return;
    getPeekCalendarAccess()
      .then((r) => setCanAccessPeek(r.canAccess))
      .catch(() => setCanAccessPeek(false));
  }, [isPeekHandler]);

  if (isPeekHandler) {
    return <PeekRequestsCalendar />;
  }

  return (
    <div className="space-y-4">
      {canAccessPeek && (
        <div className="flex gap-1 p-0.5 rounded-lg w-fit" style={{ backgroundColor: 'rgba(14,14,14,0.06)' }}>
          {([['support', 'Support Calendar'], ['peek', 'Peek Requests Calendar']] as [View, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                view === v ? 'text-[#0E0E0E]' : 'text-slate-500 hover:text-slate-700'
              }`}
              style={view === v ? { backgroundColor: '#A1F96E' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'support' ? <ShiftCalendar onDataChanged={onDataChanged} /> : <PeekRequestsCalendar />}
    </div>
  );
}
