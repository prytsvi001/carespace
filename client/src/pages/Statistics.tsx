// client/src/pages/Statistics.tsx
import React, { useEffect, useState, useRef } from 'react';
import { Clock, CalendarDays, MessageCircle, Ticket, Phone, RefreshCcw, Calendar, Sun, Moon } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import 'react-day-picker/dist/style.css';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { getStatistics } from '../api';
import { MonthlyStats, AgentStats } from '../types';
import { Spinner } from '../components/ui';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const AGENT_ORDER = ['Jonathan Lewis', 'Julia Manson', 'Nicky Brown', 'Victoria Davis', 'Sandra Moore'];
const AGENT_COLOR_MAP: Record<string, string> = {
  'Jonathan Lewis': '#639922',
  'Julia Manson':   '#D4537E',
  'Nicky Brown':    '#7F77DD',
  'Victoria Davis': '#993556',
  'Sandra Moore':   '#BA7517',
};
function agentColor(name: string): string {
  return AGENT_COLOR_MAP[name] ?? '#94A3B8';
}

function rangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty) {
    if (fm === tm) return `${MONTH_NAMES[fm - 1]} ${fd}–${td}, ${fy}`;
    return `${MONTH_NAMES[fm - 1]} ${fd} – ${MONTH_NAMES[tm - 1]} ${td}, ${fy}`;
  }
  return `${MONTH_NAMES[fm - 1]} ${fd}, ${fy} – ${MONTH_NAMES[tm - 1]} ${td}, ${ty}`;
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
             style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }}>
          {icon}
        </div>
        <div>
          <p className="text-xl font-bold text-slate-800">{value}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function AgentRow({ stat, index, max }: { stat: AgentStats; index: number; max: number }) {
  const pct = max > 0 ? (stat.totalChats / max) * 100 : 0;
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: agentColor(stat.agentName) }}
          />
          <span className="text-sm font-medium text-slate-700">{stat.agentName}</span>
        </div>
        <span className="text-xs text-slate-400">{stat.totalHours}h worked</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500 pl-4">
        <span className="flex items-center gap-1"><MessageCircle size={11} strokeWidth={1.5} />{stat.totalChats}</span>
        <span className="flex items-center gap-1"><Ticket size={11} strokeWidth={1.5} />{stat.totalTickets}</span>
        <span className="flex items-center gap-1"><Phone size={11} strokeWidth={1.5} />{stat.totalCalls}</span>
        <span className="flex items-center gap-1"><RefreshCcw size={11} strokeWidth={1.5} />{stat.totalRefunds}</span>
        <span className="ml-auto">{stat.totalShifts} shifts</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full ml-4 mt-1">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: agentColor(stat.agentName) }}
        />
      </div>
    </div>
  );
}

type Mode = 'monthly' | 'range';

export default function Statistics({ year, month, onYearChange, onMonthChange, refreshKey }: {
  year: number;
  month: number;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  refreshKey?: number;
}) {
  const now = new Date();
  const [data, setData] = useState<MonthlyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('monthly');

  // Range picker state
  const [range, setRange] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Stable string versions for effect deps
  const rangeFrom = range?.from ? format(range.from, 'yyyy-MM-dd') : '';
  const rangeTo   = range?.to   ? format(range.to,   'yyyy-MM-dd') : '';

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    const handle = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [pickerOpen]);

  // Auto-close once both dates are chosen
  useEffect(() => {
    if (range?.from && range?.to) setPickerOpen(false);
  }, [range?.from, range?.to]);

  const loadData = async () => {
    if (mode === 'range' && (!rangeFrom || !rangeTo)) return;
    setLoading(true);
    try {
      const params = mode === 'range'
        ? { dateFrom: rangeFrom, dateTo: rangeTo }
        : { year, month };
      const result = await getStatistics(params);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [year, month, mode, rangeFrom, rangeTo, refreshKey]);

  const sortedStats = data?.stats.slice().sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agentName);
    const bi = AGENT_ORDER.indexOf(b.agentName);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }) ?? [];

  const chartData = sortedStats.map(s => ({
    name: s.agentName.split(' ')[0],
    Chats: s.totalChats,
    Tickets: s.totalTickets,
    Calls: s.totalCalls,
    Refunds: s.totalRefunds,
  })) || [];

  const maxChats = Math.max(...(data?.stats.map(s => s.totalChats) || [1]));
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  const periodLabel = mode === 'range' && rangeFrom && rangeTo
    ? rangeLabel(rangeFrom, rangeTo)
    : `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Statistics</h2>
          <p className="text-sm text-slate-400">
            {mode === 'monthly' ? 'Monthly performance overview' : 'Custom date range'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden text-sm" style={{ border: '1px solid rgba(14,14,14,0.12)' }}>
            <button
              onClick={() => setMode('monthly')}
              className="px-3 py-1.5 font-medium transition-colors text-[#0E0E0E]"
              style={mode === 'monthly' ? { backgroundColor: 'rgba(161,249,110,0.30)' } : { backgroundColor: '#ffffff', color: 'rgba(14,14,14,0.50)' }}
            >
              Monthly
            </button>
            <button
              onClick={() => setMode('range')}
              className="px-3 py-1.5 font-medium transition-colors text-[#0E0E0E]"
              style={mode === 'range' ? { backgroundColor: 'rgba(161,249,110,0.30)' } : { backgroundColor: '#ffffff', color: 'rgba(14,14,14,0.50)' }}
            >
              Custom Range
            </button>
          </div>

          {/* Monthly controls */}
          {mode === 'monthly' && (
            <div className="flex items-center gap-2">
              <select className="input w-auto text-sm" value={month} onChange={e => onMonthChange(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="input w-auto text-sm" value={year} onChange={e => onYearChange(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          {/* Range picker */}
          {mode === 'range' && (
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setPickerOpen(v => !v)}
                className="input flex items-center gap-2 text-sm cursor-pointer text-left min-w-[230px]"
              >
                <Calendar size={14} strokeWidth={1.5} style={{ color: 'rgba(14,14,14,0.35)' }} />
                <span className={rangeFrom && rangeTo ? 'text-slate-700' : 'text-slate-400'}>
                  {rangeFrom && rangeTo
                    ? rangeLabel(rangeFrom, rangeTo)
                    : 'Select date range…'}
                </span>
                <span className="ml-auto text-slate-300">▾</span>
              </button>

              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-3">
                  <DayPicker
                    mode="range"
                    selected={range}
                    onSelect={setRange}
                    numberOfMonths={2}
                    showOutsideDays
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {mode === 'range' && (!rangeFrom || !rangeTo) ? (
        <div className="card text-center py-12">
          <div className="flex justify-center mb-3" style={{ color: 'rgba(14,14,14,0.20)' }}>
            <Calendar size={44} strokeWidth={1} />
          </div>
          <p className="text-slate-500 font-medium">Select a date range to view statistics</p>
          <p className="text-slate-400 text-sm mt-1">Click the picker above, choose a start date, then an end date</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : data ? (
        <>
          {/* Team totals */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<Clock size={16} strokeWidth={1.5} />}          label="Total Hours"   value={data.totals.totalHours}   />
            <StatCard icon={<CalendarDays size={16} strokeWidth={1.5} />}   label="Total Shifts"  value={data.totals.totalShifts}  />
            <StatCard icon={<MessageCircle size={16} strokeWidth={1.5} />}  label="Total Chats"   value={data.totals.totalChats}   />
            <StatCard icon={<Ticket size={16} strokeWidth={1.5} />}         label="Total Tickets" value={data.totals.totalTickets} />
            <StatCard icon={<Phone size={16} strokeWidth={1.5} />}          label="Total Calls"   value={data.totals.totalCalls}   />
            <StatCard icon={<RefreshCcw size={16} strokeWidth={1.5} />}     label="Total Refunds" value={data.totals.totalRefunds} />
          </div>

          {/* Chart */}
          <div className="card">
            <h3 className="font-semibold text-slate-700 mb-4">Agent Performance — {periodLabel}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} formatter={(value) => <span style={{ color: '#0E0E0E' }}>{value}</span>} />
                <Bar dataKey="Chats"   fill="rgba(14,14,14,0.75)"    radius={[4,4,0,0]} />
                <Bar dataKey="Tickets" fill="rgba(161,249,110,0.75)" radius={[4,4,0,0]} />
                <Bar dataKey="Calls"   fill="rgba(212,197,160,0.75)" radius={[4,4,0,0]} />
                <Bar dataKey="Refunds" fill="rgba(139,157,131,0.75)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-agent breakdown */}
          <div className="card">
            <h3 className="font-semibold text-slate-700 mb-3">Agent Breakdown</h3>
            <div className="divide-y divide-slate-50">
              {sortedStats.map((stat, i) => (
                <AgentRow key={stat.agentId} stat={stat} index={i} max={maxChats} />
              ))}
            </div>
          </div>

          {/* Detailed table */}
          <div className="card overflow-x-auto">
            <h3 className="font-semibold text-slate-700 mb-3">Detailed Table</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium text-center">Shifts</th>
                  <th className="pb-2 font-medium text-center"><span className="inline-flex items-center gap-1"><Sun size={11} strokeWidth={1.5} />Morning</span></th>
                  <th className="pb-2 font-medium text-center"><span className="inline-flex items-center gap-1"><Moon size={11} strokeWidth={1.5} />Night</span></th>
                  <th className="pb-2 font-medium text-center">Hours</th>
                  <th className="pb-2 font-medium text-center">Chats</th>
                  <th className="pb-2 font-medium text-center">Tickets</th>
                  <th className="pb-2 font-medium text-center">Calls</th>
                  <th className="pb-2 font-medium text-center">Refunds</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((s, i) => (
                  <tr key={s.agentId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: agentColor(s.agentName) }} />
                        {s.agentName}
                      </div>
                    </td>
                    <td className="py-2.5 text-center text-slate-600">{s.totalShifts}</td>
                    <td className="py-2.5 text-center text-orange-500">{s.morningShifts}</td>
                    <td className="py-2.5 text-center text-indigo-500">{s.nightShifts}</td>
                    <td className="py-2.5 text-center font-medium text-slate-700">{s.totalHours}</td>
                    <td className="py-2.5 text-center text-slate-600">{s.totalChats}</td>
                    <td className="py-2.5 text-center text-slate-600">{s.totalTickets}</td>
                    <td className="py-2.5 text-center text-slate-600">{s.totalCalls}</td>
                    <td className="py-2.5 text-center text-slate-600">{s.totalRefunds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
