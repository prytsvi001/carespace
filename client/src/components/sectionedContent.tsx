// client/src/components/sectionedContent.tsx
// Shared "parse **bold**-only lines as sub-headers, render as a mini
// accordion" renderer — originally built for the Peekviewer KPI blocks
// (kpiBlocks.tsx), reused by Onboarding so its blocks get the same
// structure-aware look when an author writes content with bold sub-headers.
// Falls back to plain RichText when the content doesn't have 2+ such
// sections (e.g. a short block, or free-form text with no bold headers).
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { RichText } from './ui';

export interface Section {
  header: string | null;
  body: string;
}

// Splits content on lines that are *entirely* "**bold**" (nothing else on
// the line).
export function parseBoldSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentHeader: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^\*\*(.+)\*\*$/);
    if (m) {
      const body = buf.join('\n').trim();
      if (currentHeader !== null || body) sections.push({ header: currentHeader, body });
      currentHeader = m[1];
      buf = [];
    } else {
      buf.push(line);
    }
  }
  const body = buf.join('\n').trim();
  if (currentHeader !== null || body) sections.push({ header: currentHeader, body });
  return sections;
}

export function SectionedContent({ content, className }: { content: string; className?: string }) {
  const sections = parseBoldSections(content);
  const preamble = sections.find((s) => s.header === null);
  const items = sections.filter((s) => s.header !== null);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  if (items.length < 2) return <RichText text={content} className={className ?? 'text-sm text-slate-700 leading-relaxed'} />;

  return (
    <div className="space-y-2">
      {preamble?.body && <p className="text-sm" style={{ color: 'rgba(14,14,14,0.5)' }}>{preamble.body}</p>}
      {items.map((s, i) => {
        const open = openIdx === i;
        return (
          <div key={i} className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(14,14,14,0.08)' }}>
            <button
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm font-semibold transition-colors"
              style={{ backgroundColor: open ? 'rgba(161,249,110,0.16)' : 'rgba(14,14,14,0.025)', color: '#0E0E0E' }}
            >
              <span>{s.header}</span>
              <ChevronDown
                size={15}
                strokeWidth={2}
                style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s', color: 'rgba(14,14,14,0.4)' }}
              />
            </button>
            {open && (
              <div className="px-3.5 py-3" style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}>
                <RichText text={s.body} className="text-sm text-slate-600 leading-relaxed" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
