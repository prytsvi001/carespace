// client/src/pages/RequestSchedule.tsx
// Peekviewer Team — placeholder landing tab. Logic to be defined later.
import { CalendarClock } from 'lucide-react';
import { EmptyState } from '../components/ui';

export default function RequestSchedule() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Request Schedule</h2>
        <p className="text-sm text-slate-400">Coming soon</p>
      </div>
      <EmptyState icon={<CalendarClock size={32} strokeWidth={1.2} />} message="This tab isn't set up yet." />
    </div>
  );
}
