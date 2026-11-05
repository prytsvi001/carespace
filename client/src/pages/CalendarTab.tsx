// client/src/pages/CalendarTab.tsx
// Decides which calendar a user sees under the calendar tab:
// - peek_handler: Peek Requests Calendar (their "Peek Calendar" tab).
// - everyone else: Support Calendar only (the Peek Requests Calendar toggle
//   for Julia Manson / head / lead was removed from the Shift Calendar tab).
import React from 'react';
import { useAuth } from '../context/AuthContext';
import ShiftCalendar from './ShiftCalendar';
import PeekRequestsCalendar from './PeekRequestsCalendar';

export default function CalendarTab({ onDataChanged }: { onDataChanged?: () => void }) {
  const { user } = useAuth();

  if (user?.role === 'peek_handler') {
    return <PeekRequestsCalendar />;
  }

  return <ShiftCalendar onDataChanged={onDataChanged} />;
}
