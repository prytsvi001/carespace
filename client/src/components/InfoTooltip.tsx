// client/src/components/InfoTooltip.tsx
// Small "?" icon that reveals a hover panel with arbitrary help content —
// same hover/placement pattern as HoursBreakdownTooltip, but for static text
// (e.g. a calculation example table) instead of live data.
import React, { useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

export function InfoTooltip({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('below');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow < 180 && spaceAbove > spaceBelow ? 'above' : 'below');
    }
    setShow(true);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      <button
        type="button"
        className="p-0.5 rounded-full transition-colors"
        style={{ color: 'rgba(14,14,14,0.35)' }}
        aria-label="Show calculation examples"
        onClick={(e) => e.preventDefault()}
      >
        <HelpCircle size={13} strokeWidth={1.8} />
      </button>
      {show && (
        <div
          className={`absolute z-50 left-0 w-56 bg-white rounded-xl shadow-lg p-3 text-xs ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{ border: '1px solid rgba(14,14,14,0.09)', color: 'rgba(14,14,14,0.65)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
