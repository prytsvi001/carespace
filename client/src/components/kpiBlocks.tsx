// client/src/components/kpiBlocks.tsx
// Specialized read-mode renderers for the 4 legacy Peekviewer KPI blocks
// ("Обов'язки", "Графік роботи", "Parse and requests", "Бонусна система").
// Each renderer parses the block's plain-text content (the same string an
// admin edits as raw text via the textarea) into a nicer visual layout.
// Parsing is defensive: if the content doesn't match the expected shape
// (e.g. an admin rewrote it freely), every renderer falls back to the
// plain RichText rendering used for any other KPI block.
import React, { useState } from 'react';
import { ChevronDown, Sparkles, AlertTriangle } from 'lucide-react';
import { RichText } from './ui';

interface Section {
  header: string | null;
  body: string;
}

// Splits content on lines that are *entirely* "**bold**" (nothing else on
// the line) — the convention already used for sub-headers in these blocks.
function parseBoldSections(content: string): Section[] {
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

// ─── Обов'язки — accordion ───────────────────────────────────────────────
function DutiesAccordion({ content }: { content: string }) {
  const sections = parseBoldSections(content);
  const preamble = sections.find((s) => s.header === null);
  const items = sections.filter((s) => s.header !== null);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  if (items.length < 2) return <RichText text={content} className="text-sm text-slate-700 leading-relaxed" />;

  return (
    <div className="space-y-2">
      {preamble?.body && <p className="text-sm" style={{ color: 'rgba(14,14,14,0.5)' }}>{preamble.body}</p>}
      {items.map((s, i) => {
        const open = openIdx === i;
        return (
          <div key={i} className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(14,14,14,0.08)' }}>
            <button
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

// ─── Графік роботи — week strip + callouts ──────────────────────────────
const DAY_ABBREVIATIONS: Record<string, string> = {
  'понеділок': 'пн',
  'вівторок': 'вт',
  'середа': 'ср',
  'четвер': 'чт',
  "п'ятниця": 'пт',
  'субота': 'сб',
  'неділя': 'нд',
};

function dayAbbreviation(day: string): string {
  const normalized = day.toLowerCase().replace(/[’‘]/g, "'");
  return DAY_ABBREVIATIONS[normalized] || day.slice(0, 2);
}

function dayStatusStyle(status: string): { bg: string; text: string; border?: string } {
  const s = status.toLowerCase();
  if (s.includes('обов')) return { bg: '#A1F96E', text: '#0E0E0E' };
  if (s.includes('бажан')) return { bg: 'transparent', text: 'rgba(14,14,14,0.6)', border: '1.5px solid rgba(14,14,14,0.25)' };
  return { bg: 'rgba(14,14,14,0.06)', text: 'rgba(14,14,14,0.4)' };
}

function ScheduleView({ content }: { content: string }) {
  const sections = parseBoldSections(content);
  const daysSection = sections.find((s) => s.header?.toLowerCase().startsWith('робочі дні'));
  const hoursSection = sections.find((s) => s.header?.toLowerCase().startsWith('робочі години'));
  const rest = sections.filter((s) => s !== daysSection && s !== hoursSection);

  const dayRows = (daysSection?.body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?)\s*[—-]\s*\(?([^)]+?)\)?$/);
      return m ? { day: m[1].trim(), status: m[2].trim() } : null;
    })
    .filter((x): x is { day: string; status: string } => !!x);

  if (dayRows.length < 5) return <RichText text={content} className="text-sm text-slate-700 leading-relaxed" />;

  const hourParagraphs = (hoursSection?.body || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const goldenIdx = hourParagraphs.findIndex((p) => p.toLowerCase().includes('золоте правило'));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {dayRows.map(({ day, status }) => {
          const style = dayStatusStyle(status);
          return (
            <div key={day} className="flex flex-col items-center gap-1">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: style.bg, color: style.text, border: style.border }}
                title={status}
              >
                {dayAbbreviation(day)}
              </div>
              <span className="text-[10px]" style={{ color: 'rgba(14,14,14,0.4)' }}>{day}</span>
            </div>
          );
        })}
      </div>

      {hourParagraphs.map((p, i) => {
        const isGolden = i === goldenIdx;
        const isAbsenceNote = /вихідні дні та відлучення/i.test(p);
        if (isGolden) {
          return (
            <div
              key={i}
              className="flex gap-2 rounded-lg px-3.5 py-3"
              style={{ backgroundColor: 'rgba(250,204,21,0.14)', border: '1px solid rgba(250,204,21,0.4)' }}
            >
              <Sparkles size={16} strokeWidth={1.8} className="shrink-0 mt-0.5" style={{ color: '#b45309' }} />
              <RichText text={p} className="text-sm text-slate-700" />
            </div>
          );
        }
        if (isAbsenceNote) {
          return (
            <div
              key={i}
              className="rounded-lg px-3.5 py-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}
            >
              <RichText text={p} className="text-sm text-slate-700" />
            </div>
          );
        }
        return <RichText key={i} text={p} className="text-sm text-slate-600 leading-relaxed block" />;
      })}

      {rest.map((s, i) => (
        <div
          key={i}
          className="rounded-lg px-3.5 py-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}
        >
          <RichText text={s.body} className="text-sm text-slate-700" />
        </div>
      ))}
    </div>
  );
}

// ─── Parse and requests — level cards ────────────────────────────────────
const LEVEL_KEYWORDS = ['trainee', 'junior', 'middle', 'senior'];

function LevelsView({ content }: { content: string }) {
  const sections = parseBoldSections(content);
  const levelSections = sections.filter(
    (s) => s.header && LEVEL_KEYWORDS.some((k) => s.header!.toLowerCase().includes(k))
  );
  const otherSections = sections.filter((s) => !levelSections.includes(s));

  if (levelSections.length < 3) return <RichText text={content} className="text-sm text-slate-700 leading-relaxed" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {levelSections.map((s, i) => {
          const unlocks = s.body.match(/План unlocks\s*—\s*(.+)/i)?.[1]?.trim();
          const requests = s.body.match(/План requests\s*—\s*(.+)/i)?.[1]?.trim();
          const restBody = s.body
            .split('\n')
            .filter(
              (l) =>
                !/^Plan for/i.test(l.trim()) &&
                !/^План unlocks/i.test(l.trim()) &&
                !/^План requests/i.test(l.trim())
            )
            .join('\n')
            .trim();
          return (
            <div
              key={i}
              className="rounded-xl p-4 space-y-2"
              style={{ border: '1px solid rgba(14,14,14,0.08)', backgroundColor: 'rgba(14,14,14,0.015)' }}
            >
              <p className="text-sm font-bold" style={{ color: '#0E0E0E' }}>{s.header}</p>
              {unlocks && (
                <div>
                  <p className="text-lg font-extrabold" style={{ color: '#166534' }}>{unlocks}</p>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.35)' }}>unlocks</p>
                </div>
              )}
              {requests && (
                <div>
                  <p className="text-sm font-bold" style={{ color: 'rgba(14,14,14,0.7)' }}>{requests}</p>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.35)' }}>requests/day</p>
                </div>
              )}
              {restBody && <RichText text={restBody} className="text-xs text-slate-600 leading-relaxed block pt-1" />}
            </div>
          );
        })}
      </div>
      {otherSections.map((s, i) => (
        <div key={i}>
          {s.header && <p className="text-sm font-semibold text-slate-800 mb-1.5">{s.header}</p>}
          <RichText text={s.body} className="text-sm text-slate-600 leading-relaxed" />
        </div>
      ))}
    </div>
  );
}

// ─── Бонусна система — tiers ladder + calc table ────────────────────────
function parseTierLines(body?: string): { tiers: string[]; extra: string } {
  if (!body) return { tiers: [], extra: '' };
  const lines = body.split('\n').map((l) => l.trim());
  const tiers = lines.filter((l) => l && /—/.test(l)).map((l) => l.replace(/^•\s*/, ''));
  const extra = lines.filter((l) => l && !/—/.test(l)).join(' ').trim();
  return { tiers, extra };
}

const TIER_COLORS = ['rgba(14,14,14,0.05)', 'rgba(161,249,110,0.35)', 'rgba(161,249,110,0.75)'];

function BonusView({ content }: { content: string }) {
  const sections = parseBoldSections(content);
  const individual = sections.find((s) => s.header?.toLowerCase().includes('індивідуальний'));
  const team = sections.find((s) => s.header?.toLowerCase().includes('командний'));
  const examples = sections.find((s) => s.header?.toLowerCase().includes('приклади'));
  const warnings = sections.filter((s) => s.header && /утриманн|нижче мінімуму/i.test(s.header));
  const handled = new Set([individual, team, examples, ...warnings].filter(Boolean) as Section[]);
  const rest = sections.filter((s) => !handled.has(s) && s.header === null);

  if (!individual && !team) return <RichText text={content} className="text-sm text-slate-700 leading-relaxed" />;

  const exampleRows = (examples?.body || '')
    .split('\n')
    .map((l) => l.trim())
    .map((l) => l.match(/^(\d+)\s*парсів\s*→\s*(.+?)\s*=\s*(\$[\d.]+)$/))
    .filter((m): m is RegExpMatchArray => !!m);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {[individual, team].map((sec, gi) => {
          if (!sec) return null;
          const { tiers, extra } = parseTierLines(sec.body);
          return (
            <div key={gi} className="rounded-xl p-4 space-y-1.5" style={{ border: '1px solid rgba(14,14,14,0.08)' }}>
              <p className="text-sm font-bold mb-1">{sec.header}</p>
              {tiers.map((line, i) => (
                <div
                  key={i}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: TIER_COLORS[Math.min(i, TIER_COLORS.length - 1)], color: '#0E0E0E' }}
                >
                  {line}
                </div>
              ))}
              {extra && (
                <p className="text-xs italic pt-1" style={{ color: 'rgba(14,14,14,0.45)' }}>
                  {extra.replace(/^\*+|\*+$/g, '')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {rest.map((s, i) => (
        <p key={i} className="text-xs italic" style={{ color: 'rgba(14,14,14,0.45)' }}>
          {s.body.replace(/^\*+|\*+$/g, '')}
        </p>
      ))}

      {examples && (
        <div>
          <p className="text-sm font-semibold text-slate-800 mb-2">{examples.header}</p>
          {exampleRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="text-xs w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'rgba(14,14,14,0.4)' }}>
                    <th className="text-left font-medium pb-1.5 pr-4">Unlocks</th>
                    <th className="text-left font-medium pb-1.5 pr-4">Розрахунок</th>
                    <th className="text-left font-medium pb-1.5">Разом</th>
                  </tr>
                </thead>
                <tbody>
                  {exampleRows.map((m, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}>
                      <td className="py-1.5 pr-4 font-medium text-slate-700">{m[1]}</td>
                      <td className="py-1.5 pr-4" style={{ color: 'rgba(14,14,14,0.55)' }}>{m[2]}</td>
                      <td className="py-1.5 font-bold" style={{ color: '#166534' }}>{m[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <RichText text={examples.body} className="text-sm text-slate-600 leading-relaxed" />
          )}
        </div>
      )}

      {warnings.map((s, i) => (
        <div
          key={i}
          className="flex gap-2 rounded-lg px-3.5 py-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}
        >
          <AlertTriangle size={16} strokeWidth={1.8} className="shrink-0 mt-0.5" style={{ color: '#b91c1c' }} />
          <div>
            <p className="text-xs font-bold mb-0.5" style={{ color: '#b91c1c' }}>{s.header}</p>
            <RichText text={s.body} className="text-xs text-slate-600 leading-relaxed" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── dispatcher ──────────────────────────────────────────────────────────
export function KpiBlockBody({ title, content }: { title: string; content: string }) {
  try {
    if (title === "Обов'язки") return <DutiesAccordion content={content} />;
    if (title === 'Графік роботи') return <ScheduleView content={content} />;
    if (title === 'Parse and requests') return <LevelsView content={content} />;
    if (title === 'Бонусна система') return <BonusView content={content} />;
  } catch (e) {
    console.error('KPI block render fallback for', title, e);
  }
  return <RichText text={content} className="text-sm text-slate-700 leading-relaxed" />;
}
