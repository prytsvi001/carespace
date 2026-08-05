// client/src/components/HoursBreakdownTooltip.tsx
// Hover-only breakdown of how a Support Team agent's monthly "Hours worked"
// figure was calculated, sourced from the Shift Calendar. Wraps whatever's
// passed as children (the Hours worked EditableField) — shows on hover,
// hides on mouse leave, flips above/below depending on available space.
import React, { useRef, useState } from 'react';
import { HoursBreakdown } from '../types';

const ROWS: Array<{
  key: string;
  icon: string;
  label: string;
  unit: string;
  countKey: keyof HoursBreakdown;
  hoursKey: keyof HoursBreakdown;
}> = [
  { key: 'morning', icon: '☀️', label: 'Morning shifts', unit: 'shifts', countKey: 'morningShifts', hoursKey: 'morningHours' },
  { key: 'night', icon: '🌙', label: 'Night shifts', unit: 'shifts', countKey: 'nightShifts', hoursKey: 'nightHours' },
  { key: 'vacation', icon: '🌴', label: 'Vacation', unit: 'days', countKey: 'vacationDays', hoursKey: 'vacationHours' },
  { key: 'sickWith', icon: '📋', label: 'Sick leave with note', unit: 'days', countKey: 'sickWithNoteDays', hoursKey: 'sickWithNoteHours' },
  { key: 'sickWithout', icon: '🚫', label: 'Sick leave without note', unit: 'days', countKey: 'sickWithoutNoteDays', hoursKey: 'sickWithoutNoteHours' },
  { key: 'birthday', icon: '🎂', label: 'Birthday off', unit: 'days', countKey: 'birthdayOffDays', hoursKey: 'birthdayOffHours' },
  { key: 'extra', icon: '⭐', label: 'Extra shifts', unit: 'shifts', countKey: 'extraShifts', hoursKey: 'extraHours' },
];

export function HoursBreakdownTooltip({
  breakdown, totalHours, children,
}: {
  breakdown: HoursBreakdown | undefined;
  totalHours: number;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('below');
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (!breakdown) return <>{children}</>;

  const visibleRows = ROWS.filter((r) => breakdown[r.countKey] > 0);

  const handleEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const estimatedHeight = 40 + visibleRows.length * 22 + 40;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? 'above' : 'below');
    }
    setShow(true);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && visibleRows.length > 0 && (
        <div
          className={`absolute z-50 left-0 w-60 bg-white rounded-xl shadow-lg p-3 ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{ border: '1px solid rgba(14,14,14,0.09)' }}
        >
          <div className="space-y-1">
            {visibleRows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-2 text-xs" style={{ color: 'rgba(14,14,14,0.65)' }}>
                <span>{r.icon} {r.label}: {breakdown[r.countKey]} {r.unit}</span>
                <span className="font-medium shrink-0" style={{ color: 'rgba(14,14,14,0.80)' }}>{breakdown[r.hoursKey]}h</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 text-xs font-bold" style={{ borderTop: '1px solid rgba(14,14,14,0.10)', color: '#0E0E0E' }}>
            <span>Total</span>
            <span>{totalHours}h</span>
          </div>
        </div>
      )}
    </div>
  );
}
