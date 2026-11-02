// client/src/pages/RequestSchedule.tsx
// Peekviewer Team — Request Schedule.
//
// From 2026-11-01 the schedule uses a cohort model: new clients arriving on
// day D form "cohort D". Cohorts are assigned in 3-day blocks rotating across
// 9-day cycles (Diana → Tetyana → Yana → Diana…). The calendar shows all
// three agents in every cell; one is highlighted on the selected view-date.
//
// Pre-Nov 2026 dates keep the legacy single-agent display. Drag-to-swap and
// click-to-reassign are disabled in the cohort era (Variant 2 decision).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isToday, addMonths, subMonths, addDays, parseISO,
} from 'date-fns';
import { Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getRequestSchedule, RequestScheduleDay, RequestScheduleData,
} from '../api';
import { Spinner } from '../components/ui';

// ─── Styles ─────────────────────────────────────────────────────────────────

interface AssigneeStyle { bg: string; text: string; border: string; dot: string; ring: string }

const ASSIGNEE_STYLES: Record<string, AssigneeStyle> = {
  'Iryna Kolodienko':    { bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'bg-indigo-400',  ring: 'ring-indigo-400' },
  'Victoria Horopeka':  { bg: 'bg-red-100',      text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400',    ring: 'ring-red-400' },
  'Tetyana Veremeyenko':{ bg: 'bg-emerald-100',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400', ring: 'ring-emerald-400' },
  'Yana Fedorova':      { bg: 'bg-amber-100',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-400',   ring: 'ring-amber-400' },
  'Diana Semeniuk':     { bg: 'bg-pink-100',     text: 'text-pink-700',    border: 'border-pink-200',    dot: 'bg-pink-400',    ring: 'ring-pink-400' },
  // Kept for historical rendering only — removed from future rotation
  'Tetyana Fomyuk':     { bg: 'bg-sky-100',      text: 'text-sky-700',     border: 'border-sky-200',     dot: 'bg-sky-400',     ring: 'ring-sky-400' },
};
const DEFAULT_STYLE: AssigneeStyle = { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', ring: 'ring-slate-400' };
const styleFor = (name: string) => ASSIGNEE_STYLES[name] ?? DEFAULT_STYLE;

const SHORT_LABELS: Record<string, string> = {};
const shortLabel = (name: string) => SHORT_LABELS[name] ?? name.split(' ')[0];

// ─── Cohort formula (mirrors server logic; pure math, no I/O) ───────────────

const COHORT_EPOCH = '2026-11-01';
const COHORT_EPOCH_MS = Date.UTC(2026, 10, 1);
const MS_PER_DAY = 86_400_000;

function utcMsForDateStr(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function toDayIndex(dateStr: string): number {
  return Math.round((utcMsForDateStr(dateStr) - COHORT_EPOCH_MS) / MS_PER_DAY);
}

const modulo = (n: number, m: number) => ((n % m) + m) % m;

function firstAgentIdx(cohortDayIdx: number): number {
  return modulo(Math.floor(cohortDayIdx / 3), 3);
}

function ownerIdx(cohortDayIdx: number, viewDayIdx: number): number {
  return modulo(
    firstAgentIdx(cohortDayIdx) + Math.floor(viewDayIdx / 9) - Math.floor(cohortDayIdx / 9),
    3,
  );
}

function nextTransferDateStr(viewDayIdx: number): string {
  const nextCycle = (Math.floor(viewDayIdx / 9) + 1) * 9;
  const ms = COHORT_EPOCH_MS + nextCycle * MS_PER_DAY;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isTransferDay(viewDayIdx: number): boolean {
  return viewDayIdx >= 0 && viewDayIdx % 9 === 0;
}

// Returns per-agent cohort count [Diana, Tetyana, Yana] on a given viewDayIdx.
function cohortCounts(viewDayIdx: number): [number, number, number] {
  const counts: [number, number, number] = [0, 0, 0];
  for (let c = 0; c <= viewDayIdx; c++) {
    counts[ownerIdx(c, viewDayIdx)]++;
  }
  return counts;
}

// Today as "YYYY-MM-DD" in local time (matches Kyiv-local used server-side
// for the banner, close enough for navigation purposes).
function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ─── Cohort cell chips ───────────────────────────────────────────────────────

// status:
//   'active'   — this agent currently manages this cohort on viewDate
//   'inactive' — another agent manages it (shown grey)
//   'preview'  — cohort date is in the future; this agent will receive it first

function CohortChip({ name, status, reduced }: { name: string; status: 'active' | 'inactive' | 'preview'; reduced: boolean }) {
  const s = styleFor(name);
  if (status === 'inactive') {
    return (
      <div className="px-1.5 py-0.5 rounded text-[10px] font-medium truncate bg-slate-100 text-slate-400 border border-slate-200">
        {shortLabel(name)}
      </div>
    );
  }
  if (status === 'preview') {
    return (
      <div
        className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate ${s.text} border border-dashed ${s.border}`}
        style={{ backgroundColor: 'transparent' }}
      >
        {shortLabel(name)}
      </div>
    );
  }
  // active
  return (
    <div className={`px-1.5 py-0.5 rounded text-[10px] font-semibold truncate border ${s.bg} ${s.text} ${s.border} ${
      reduced ? '' : 'transition-colors duration-500'
    }`}>
      {shortLabel(name)}
    </div>
  );
}

// ─── Day cells ───────────────────────────────────────────────────────────────

function CohortDayCell({ date, day, calendarAgents, viewDateStr, isCurrentMonth, onClick }: {
  date: Date;
  day: RequestScheduleDay | undefined;
  calendarAgents: { userId: string; userName: string }[];
  viewDateStr: string;
  isCurrentMonth: boolean;
  onClick: () => void;
}) {
  const dateStr = format(date, 'yyyy-MM-dd');
  const isFuture = dateStr > viewDateStr;
  const viewIdx = toDayIndex(viewDateStr);

  const reduced = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let chips: { name: string; status: 'active' | 'inactive' | 'preview' }[] = [];

  if (day?.firstAgentIndex !== undefined && day.cohortDayIndex !== undefined) {
    if (isFuture) {
      // Show only the first agent with dashed preview style
      const previewName = calendarAgents[day.firstAgentIndex]?.userName ?? '';
      chips = previewName ? [{ name: previewName, status: 'preview' }] : [];
    } else {
      const owner = ownerIdx(day.cohortDayIndex, viewIdx);
      chips = calendarAgents.map((a, i) => ({
        name: a.userName,
        status: (i === owner ? 'active' : 'inactive') as 'active' | 'inactive',
      }));
    }
  }

  return (
    <div
      className={`relative min-h-[80px] sm:min-h-[92px] p-1.5 rounded-lg cursor-pointer
        ${!isCurrentMonth ? 'opacity-35' : ''}
        ${isToday(date) ? 'ring-2 ring-inset ring-[#0E0E0E]/20' : ''}
        ${dateStr === viewDateStr ? 'ring-2 ring-inset ring-[#A1F96E]/70' : ''}
      `}
      style={{ border: '1px solid rgba(14,14,14,0.09)' }}
      onClick={onClick}
    >
      <div className="mb-1">
        <span className={`text-xs font-bold ${isToday(date) ? 'text-ink' : ''}`}
              style={!isToday(date) ? { color: 'rgba(14,14,14,0.55)' } : undefined}>
          {format(date, 'd')}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {chips.map((c) => (
          <CohortChip key={c.name} name={c.name} status={c.status} reduced={reduced} />
        ))}
      </div>
    </div>
  );
}

function LegacyDayCell({ date, day, isCurrentMonth }: {
  date: Date;
  day: RequestScheduleDay | undefined;
  isCurrentMonth: boolean;
}) {
  const s = day ? styleFor(day.userName) : DEFAULT_STYLE;
  return (
    <div
      className={`relative min-h-[68px] sm:min-h-[80px] p-1.5 rounded-lg
        ${!isCurrentMonth ? 'opacity-35' : ''}
        ${isToday(date) ? 'ring-2 ring-inset ring-[#0E0E0E]/20' : ''}
      `}
      style={{ border: '1px solid rgba(14,14,14,0.09)' }}
    >
      <div className="mb-1">
        <span className={`text-xs font-bold ${isToday(date) ? 'text-ink' : ''}`}
              style={!isToday(date) ? { color: 'rgba(14,14,14,0.55)' } : undefined}>
          {format(date, 'd')}
        </span>
      </div>
      {day && (
        <div className={`px-1.5 py-1 rounded text-[11px] font-medium border truncate ${s.bg} ${s.text} ${s.border}`}>
          {shortLabel(day.userName)}
        </div>
      )}
    </div>
  );
}

// ─── View-date panel ─────────────────────────────────────────────────────────

function formatDisplayDate(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMM yyyy');
}

function ViewDatePanel({ viewDateStr, calendarAgents, onSetViewDate }: {
  viewDateStr: string;
  calendarAgents: { userId: string; userName: string }[];
  onSetViewDate: (d: string | ((prev: string) => string)) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const viewIdx = toDayIndex(viewDateStr);
  const cycleNum = Math.floor(viewIdx / 9) + 1;
  const nextTransfer = nextTransferDateStr(viewIdx);
  const isTransfer = isTransferDay(viewIdx);
  const counts = cohortCounts(viewIdx);
  const daysUntilNext = toDayIndex(nextTransfer) - viewIdx;

  const step = useCallback((delta: number) => {
    onSetViewDate((prev: string) => {
      const d = addDays(parseISO(prev), delta);
      return format(d, 'yyyy-MM-dd');
    });
  }, [onSetViewDate]);

  useEffect(() => {
    if (isPlaying) {
      playRef.current = setInterval(() => step(1), 1000);
    } else {
      if (playRef.current) clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, step]);

  return (
    <div className="card p-4 space-y-3">
      {/* Transfer banner */}
      {isTransfer && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ backgroundColor: 'rgba(161,249,110,0.22)', border: '1px solid rgba(161,249,110,0.55)', color: '#0E0E0E' }}
        >
          <Megaphone size={16} strokeWidth={1.8} className="shrink-0" style={{ color: '#166534' }} />
          <span>
            Сьогодні — день передачі клієнтів:{' '}
            {calendarAgents.map((a, i) => {
              const nextAgent = calendarAgents[(i + 1) % calendarAgents.length];
              return `${a.userName.split(' ')[0]} → ${nextAgent.userName.split(' ')[0]}`;
            }).join(', ')}
          </span>
        </div>
      )}

      {/* Date navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">
          Стан на {formatDisplayDate(viewDateStr)}
        </span>
        <div className="flex items-center gap-1 ml-auto flex-wrap">
          <button className="btn-secondary px-2 py-1 text-xs" onClick={() => step(-1)}>− день</button>
          <button className="btn-secondary px-2 py-1 text-xs" onClick={() => step(1)}>+ день</button>
          <button
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => onSetViewDate(nextTransfer)}
          >
            До наступної передачі
          </button>
          <button
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => onSetViewDate(todayStr())}
          >
            Сьогодні
          </button>
          <button
            className={`px-2 py-1 text-xs rounded border font-medium transition-colors ${
              isPlaying
                ? 'bg-[#A1F96E]/30 border-[#A1F96E]/60 text-ink'
                : 'btn-secondary'
            }`}
            onClick={() => setIsPlaying((p) => !p)}
          >
            {isPlaying ? '⏸ Пауза' : '▶ Авто'}
          </button>
        </div>
      </div>

      {/* Cycle info */}
      <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'rgba(14,14,14,0.6)' }}>
        <span>Цикл <span className="font-semibold text-ink">#{cycleNum}</span></span>
        <span>
          Наступна передача: <span className="font-semibold text-ink">{formatDisplayDate(nextTransfer)}</span>
          <span className="ml-1">({daysUntilNext} {daysUntilNext === 1 ? 'день' : 'дн.'})</span>
        </span>
      </div>

      {/* Per-agent cohort counts */}
      <div className="flex flex-wrap gap-3">
        {calendarAgents.map((a, i) => {
          const s = styleFor(a.userName);
          return (
            <div key={a.userId} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              <span className="text-xs text-ink font-medium">{a.userName.split(' ')[0]}</span>
              <span className="text-xs font-semibold" style={{ color: 'rgba(14,14,14,0.7)' }}>
                {counts[i]} {counts[i] === 1 ? 'когорта' : 'когорт'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Redistribution card (legacy months only) ────────────────────────────────

const formatDotDate = (d: string) => d.split('-').reverse().join('.');

function RedistributionCard({ rows, period }: {
  rows: RequestScheduleData['redistribution'];
  period: RequestScheduleData['redistributionPeriod'];
}) {
  if (!rows.length) return null;
  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">Перерозподіл активних і неактивних профілів</h3>
      {period && (
        <div className="text-xs space-y-0.5" style={{ color: 'rgba(14,14,14,0.55)' }}>
          <p>День перерозподілу: <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.75)' }}>{formatDotDate(period.start)}</span></p>
          <p>Наступний перерозподіл: {formatDotDate(period.next)}</p>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const s = styleFor(r.userName);
          return (
            <div key={r.userId} className="flex items-center gap-2 flex-wrap">
              <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
                {r.userName}
              </span>
              <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
                {r.days.join(' · ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function RequestSchedule() {
  const { user } = useAuth();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [data, setData] = useState<RequestScheduleData>({
    days: [], redistribution: [], redistributionPeriod: null, calendarAgents: [], cohortEpoch: COHORT_EPOCH,
  });
  const [loading, setLoading] = useState(true);
  const [viewDateStr, setViewDateStr] = useState<string>(todayStr());
  const [isMyTurnToday, setIsMyTurnToday] = useState(false);

  // Allow both string setter and updater function (for auto-play step)
  const handleSetViewDate = useCallback((d: string | ((prev: string) => string)) => {
    if (typeof d === 'function') {
      setViewDateStr((prev) => d(prev));
    } else {
      setViewDateStr(d);
      // Navigate calendar to the month of the selected date if needed
      setCurrentMonth((prev) => {
        const target = parseISO(d);
        if (target.getFullYear() !== prev.getFullYear() || target.getMonth() !== prev.getMonth()) {
          return new Date(target.getFullYear(), target.getMonth(), 1);
        }
        return prev;
      });
    }
  }, []);

  // "Your turn" banner — who submits new requests today
  useEffect(() => {
    if (!user?.id) return;
    import('../api').then(({ getTodayRequestScheduleAssignee }) => {
      getTodayRequestScheduleAssignee()
        .then((a) => setIsMyTurnToday(a.userId === user.id))
        .catch((e) => console.error(e));
    });
  }, [user?.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getRequestSchedule(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startPad = startOfMonth(currentMonth).getDay();
  const paddedDays: (Date | null)[] = [...Array(startPad).fill(null), ...days];
  const dayByDate = new Map(data.days.map((d) => [d.date, d]));

  const epochStr = data.cohortEpoch ?? COHORT_EPOCH;
  const cohortMonthFirst = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const isCohortMonth = cohortMonthFirst >= epochStr;

  // Cohort agents in rotation order (only present for cohort months)
  const cohortAgents = isCohortMonth ? data.calendarAgents : [];

  // Legacy agents for legend (non-cohort months)
  const legacyAgents = isCohortMonth ? [] : data.calendarAgents;

  return (
    <div className="space-y-4">
      {isMyTurnToday && (
        <div
          className="flex items-center gap-2.5 rounded-lg px-3.5 py-3"
          style={{ backgroundColor: 'rgba(161,249,110,0.22)', border: '1px solid rgba(161,249,110,0.55)' }}
        >
          <Megaphone size={18} strokeWidth={1.8} className="shrink-0" style={{ color: '#166534' }} />
          <p className="text-sm font-semibold" style={{ color: '#0E0E0E' }}>
            Твоя черга кидати запити на нові профілі!
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Request Schedule</h2>
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>
            {isCohortMonth
              ? 'Клікни на день, щоб переглянути стан на цю дату'
              : 'Графік призначень на місяць'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>‹</button>
          <span className="text-sm font-semibold text-ink min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>›</button>
        </div>
      </div>

      {/* Agent legend */}
      <div className="flex flex-wrap gap-2">
        {(isCohortMonth ? cohortAgents : legacyAgents).map((a) => {
          const s = styleFor(a.userName);
          return (
            <span key={a.userId} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {a.userName}
            </span>
          );
        })}
      </div>

      {/* Cohort view-date panel */}
      {isCohortMonth && cohortAgents.length === 3 && (
        <ViewDatePanel
          viewDateStr={viewDateStr}
          calendarAgents={cohortAgents}
          onSetViewDate={handleSetViewDate}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="text-center text-xs font-bold py-1" style={{ color: 'rgba(14,14,14,0.55)' }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {paddedDays.map((date, i) => {
              if (!date) return <div key={`pad-${i}`} className="min-h-[68px] sm:min-h-[80px]" />;
              const dateStr = format(date, 'yyyy-MM-dd');
              const day = dayByDate.get(dateStr);
              const isInCohortEra = dateStr >= epochStr;

              if (isInCohortEra && cohortAgents.length === 3) {
                return (
                  <CohortDayCell
                    key={dateStr}
                    date={date}
                    day={day}
                    calendarAgents={cohortAgents}
                    viewDateStr={viewDateStr}
                    isCurrentMonth={isSameMonth(date, currentMonth)}
                    onClick={() => handleSetViewDate(dateStr)}
                  />
                );
              }
              return (
                <LegacyDayCell
                  key={dateStr}
                  date={date}
                  day={day}
                  isCurrentMonth={isSameMonth(date, currentMonth)}
                />
              );
            })}
          </div>
        </>
      )}

      <RedistributionCard rows={data.redistribution} period={data.redistributionPeriod} />
    </div>
  );
}
