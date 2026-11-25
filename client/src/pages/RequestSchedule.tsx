// client/src/pages/RequestSchedule.tsx
// Peekviewer Team — Request Schedule.
//
// From 2026-11-01 the schedule uses a wave model: new clients arriving on
// day D form "wave D". Waves are assigned in 3-day blocks rotating across
// cycles of 3·N days (01.11: Diana → Tetyana → Yana, 9-day cycles; from
// 22.11: Daria → Tetyana → Yana → Diana, 12-day cycles). The calendar shows
// the agents in rotation in every cell; one is highlighted on the view-date.
//
// Pre-Nov 2026 dates keep the legacy single-agent display. Drag-to-swap and
// click-to-reassign are disabled in the wave era (Variant 2 decision).
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
  'Daria Biletska':     { bg: 'bg-violet-100',   text: 'text-violet-700',  border: 'border-violet-200',  dot: 'bg-violet-400',  ring: 'ring-violet-400' },
  // Kept for historical rendering only — removed from future rotation
  'Tetyana Fomyuk':     { bg: 'bg-sky-100',      text: 'text-sky-700',     border: 'border-sky-200',     dot: 'bg-sky-400',     ring: 'ring-sky-400' },
};
const DEFAULT_STYLE: AssigneeStyle = { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', ring: 'ring-slate-400' };
const styleFor = (name: string) => ASSIGNEE_STYLES[name] ?? DEFAULT_STYLE;

const SHORT_LABELS: Record<string, string> = {};
const shortLabel = (name: string) => SHORT_LABELS[name] ?? name.split(' ')[0];

// ─── Wave formula (mirrors server/src/routes/requestSchedule.ts; pure math) ──
// Agent indices point into calendarAgents (server's WAVE_AGENT_EMAILS order:
// 0 Diana, 1 Tetyana, 2 Yana, 3 Daria). Each era rotates 3-day blocks through
// its `order`; every 3·N days all waves pass to the next agent in that order.
// An era's start is not a transfer. A `fresh` era starts the schedule over:
// earlier waves stay frozen with their owner on its eve, cycles restart at 1.

const WAVE_EPOCH = '2026-11-01';
const WAVE_EPOCH_MS = Date.UTC(2026, 10, 1);
const MS_PER_DAY = 86_400_000;
const WAVE_BLOCK_DAYS = 3;

type WaveEra = { startIdx: number; order: number[]; fresh?: boolean };
const WAVE_ERAS: WaveEra[] = [
  { startIdx: 0,  order: [0, 1, 2] },    // 01.11.2026: Diana → Tetyana → Yana
  { startIdx: 21, order: [3, 1, 2, 0] }, // 22.11.2026: Daria → Tetyana → Yana → Diana
  { startIdx: 30, order: [1, 2, 0], fresh: true }, // 01.12.2026: new schedule, Tetyana → Yana → Diana
];
const WAVE_AGENT_COUNT = 4;

function utcMsForDateStr(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function toDayIndex(dateStr: string): number {
  return Math.round((utcMsForDateStr(dateStr) - WAVE_EPOCH_MS) / MS_PER_DAY);
}

function dateStrFromDayIndex(idx: number): string {
  const d = new Date(WAVE_EPOCH_MS + idx * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const modulo = (n: number, m: number) => ((n % m) + m) % m;
const cycleDays = (era: WaveEra) => WAVE_BLOCK_DAYS * era.order.length;

function eraIndex(dayIdx: number): number {
  let idx = 0;
  WAVE_ERAS.forEach((e, i) => { if (dayIdx >= e.startIdx) idx = i; });
  return idx;
}

function firstAgentIdx(waveDayIdx: number): number {
  const era = WAVE_ERAS[eraIndex(waveDayIdx)];
  return era.order[modulo(Math.floor((waveDayIdx - era.startIdx) / WAVE_BLOCK_DAYS), era.order.length)];
}

// View day clamped to the eve of a fresh era that ended the wave's schedule.
function frozenView(waveDayIdx: number, viewDayIdx: number): number {
  const fresh = WAVE_ERAS.find((e) => e.fresh && e.startIdx > waveDayIdx && e.startIdx <= viewDayIdx);
  return fresh ? fresh.startIdx - 1 : viewDayIdx;
}

function ownerIdx(waveDayIdx: number, viewDayIdx: number): number {
  viewDayIdx = frozenView(waveDayIdx, viewDayIdx);
  let ei = eraIndex(waveDayIdx);
  let agent = firstAgentIdx(waveDayIdx);
  let from = waveDayIdx;
  for (;;) {
    const era = WAVE_ERAS[ei];
    const next = WAVE_ERAS[ei + 1];
    const until = next && viewDayIdx >= next.startIdx ? next.startIdx - 1 : viewDayIdx;
    const L = cycleDays(era);
    const transfers = Math.floor((until - era.startIdx) / L) - Math.floor((from - era.startIdx) / L);
    agent = era.order[modulo(era.order.indexOf(agent) + transfers, era.order.length)];
    if (until === viewDayIdx) return agent;
    ei += 1;
    from = WAVE_ERAS[ei].startIdx;
  }
}

// True if a fresh era (new schedule) starts on viewDayIdx.
function isFreshStart(viewDayIdx: number): boolean {
  return WAVE_ERAS.some((e) => e.fresh && e.startIdx === viewDayIdx);
}

// First transfer day strictly after viewDayIdx.
function nextTransferDateStr(viewDayIdx: number): string {
  let ei = eraIndex(viewDayIdx);
  let from = viewDayIdx;
  for (;;) {
    const era = WAVE_ERAS[ei];
    const L = cycleDays(era);
    const t = era.startIdx + (Math.floor((from - era.startIdx) / L) + 1) * L;
    const next = WAVE_ERAS[ei + 1];
    if (!next || t < next.startIdx) return dateStrFromDayIndex(t);
    ei += 1;
    from = next.startIdx;
  }
}

function isTransferDay(viewDayIdx: number): boolean {
  const era = WAVE_ERAS[eraIndex(viewDayIdx)];
  const offset = viewDayIdx - era.startIdx;
  return offset > 0 && offset % cycleDays(era) === 0;
}

function cycleNumber(viewDayIdx: number): number {
  const ei = eraIndex(viewDayIdx);
  let n = 0;
  let firstEra = 0; // counting restarts at the latest fresh era
  WAVE_ERAS.forEach((e, i) => { if (e.fresh && i <= ei) firstEra = i; });
  for (let i = firstEra; i < ei; i++) {
    n += Math.ceil((WAVE_ERAS[i + 1].startIdx - WAVE_ERAS[i].startIdx) / cycleDays(WAVE_ERAS[i]));
  }
  const era = WAVE_ERAS[ei];
  return n + Math.floor((viewDayIdx - era.startIdx) / cycleDays(era)) + 1;
}

// Agent indices in rotation on viewDayIdx (that era's order).
function eraOrder(viewDayIdx: number): number[] {
  return WAVE_ERAS[eraIndex(viewDayIdx)].order;
}

// Today as "YYYY-MM-DD" in local time (matches Kyiv-local used server-side
// for the banner, close enough for navigation purposes).
function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ─── Wave cell chips ───────────────────────────────────────────────────────

// status:
//   'active'   — this agent currently manages this wave on viewDate
//   'inactive' — another agent manages it (shown grey)
//   'preview'  — wave date is in the future; this agent will receive it first

function WaveChip({ name, status, reduced }: { name: string; status: 'active' | 'inactive' | 'preview'; reduced: boolean }) {
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

function WaveDayCell({ date, day, calendarAgents, viewDateStr, isCurrentMonth, onClick }: {
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

  if (day?.firstAgentIndex !== undefined && day.waveDayIndex !== undefined) {
    if (isFuture) {
      // Show only the first agent with dashed preview style
      const previewName = calendarAgents[day.firstAgentIndex]?.userName ?? '';
      chips = previewName ? [{ name: previewName, status: 'preview' }] : [];
    } else {
      const owner = ownerIdx(day.waveDayIndex, viewIdx);
      // A past-schedule wave shows the agents of its own (frozen) rotation.
      const inRotation = eraOrder(frozenView(day.waveDayIndex, viewIdx));
      chips = calendarAgents
        .map((a, i) => ({ a, i }))
        .filter(({ i }) => inRotation.includes(i))
        .map(({ a, i }) => ({
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
          <WaveChip key={c.name} name={c.name} status={c.status} reduced={reduced} />
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
  const cycleNum = cycleNumber(viewIdx);
  const nextTransfer = nextTransferDateStr(viewIdx);
  const isTransfer = isTransferDay(viewIdx);
  const freshStart = isFreshStart(viewIdx);
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
            {eraOrder(viewIdx).map((agentIdx, i, order) => {
              const a = calendarAgents[agentIdx];
              const nextAgent = calendarAgents[order[(i + 1) % order.length]];
              return `${a?.userName.split(' ')[0]} → ${nextAgent?.userName.split(' ')[0]}`;
            }).join(', ')}
          </span>
        </div>
      )}

      {/* New-schedule banner (fresh era starts today) */}
      {freshStart && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ backgroundColor: 'rgba(161,249,110,0.22)', border: '1px solid rgba(161,249,110,0.55)', color: '#0E0E0E' }}
        >
          <Megaphone size={16} strokeWidth={1.8} className="shrink-0" style={{ color: '#166534' }} />
          <span>
            Сьогодні починається новий графік:{' '}
            {eraOrder(viewIdx).map((i) => calendarAgents[i]?.userName.split(' ')[0]).join(' → ')}
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
    </div>
  );
}

// ─── Redistribution card ─────────────────────────────────────────────────────

const formatDotDate = (d: string) => d.split('-').reverse().join('.');

function RedistributionCard({ rows, period, isMonthly }: {
  rows: RequestScheduleData['redistribution'];
  period: RequestScheduleData['redistributionPeriod'];
  isMonthly: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">Перерозподіл активних і неактивних профілів</h3>
      {period && (
        <div className="text-xs space-y-0.5" style={{ color: 'rgba(14,14,14,0.55)' }}>
          {isMonthly ? (
            <p>Наступний перерозподіл: <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.75)' }}>{formatDotDate(period.next)}</span></p>
          ) : (
            <>
              <p>День перерозподілу: <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.75)' }}>{formatDotDate(period.start)}</span></p>
              <p>Наступний перерозподіл: {formatDotDate(period.next)}</p>
            </>
          )}
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
    days: [], redistribution: [], redistributionPeriod: null, calendarAgents: [], waveEpoch: WAVE_EPOCH,
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

  const epochStr = data.waveEpoch ?? WAVE_EPOCH;
  const waveMonthFirst = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const isWaveMonth = waveMonthFirst >= epochStr;

  // Wave agents in rotation order (only present for wave months)
  const waveAgents = isWaveMonth ? data.calendarAgents : [];
  // Legend shows only agents in rotation on some day of this month (Daria
  // stays in calendarAgents so indices hold, but drops out from December).
  const monthStartIdx = toDayIndex(waveMonthFirst);
  const monthEndIdx = toDayIndex(format(endOfMonth(currentMonth), 'yyyy-MM-dd'));
  const legendWaveAgents = waveAgents.filter((_, i) =>
    WAVE_ERAS.some((e, ei) => {
      const nextStart = WAVE_ERAS[ei + 1]?.startIdx ?? Infinity;
      return e.order.includes(i) && e.startIdx <= monthEndIdx && nextStart > monthStartIdx;
    }));

  // Legacy agents for legend (non-wave months)
  const legacyAgents = isWaveMonth ? [] : data.calendarAgents;

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
            {isWaveMonth
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
        {(isWaveMonth ? legendWaveAgents : legacyAgents).map((a) => {
          const s = styleFor(a.userName);
          return (
            <span key={a.userId} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {a.userName}
            </span>
          );
        })}
      </div>

      {/* Wave view-date panel */}
      {isWaveMonth && waveAgents.length === WAVE_AGENT_COUNT && (
        <ViewDatePanel
          viewDateStr={viewDateStr}
          calendarAgents={waveAgents}
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
              const isInWaveEra = dateStr >= epochStr;

              if (isInWaveEra && waveAgents.length === WAVE_AGENT_COUNT) {
                return (
                  <WaveDayCell
                    key={dateStr}
                    date={date}
                    day={day}
                    calendarAgents={waveAgents}
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

      <RedistributionCard rows={data.redistribution} period={data.redistributionPeriod} isMonthly={isWaveMonth} />
    </div>
  );
}
