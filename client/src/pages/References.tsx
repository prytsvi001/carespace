// client/src/pages/References.tsx
// Peekviewer Team — placeholder tab. Logic to be defined later.
import { BookOpen } from 'lucide-react';
import { EmptyState } from '../components/ui';

export default function References() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">References</h2>
        <p className="text-sm text-slate-400">Coming soon</p>
      </div>
      <EmptyState icon={<BookOpen size={32} strokeWidth={1.2} />} message="This tab isn't set up yet." />
    </div>
  );
}
