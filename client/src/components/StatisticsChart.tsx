// client/src/components/StatisticsChart.tsx
// Isolated so recharts (heavy, ~400kB of the Statistics bundle) loads lazily
// via React.lazy in Statistics.tsx instead of blocking the whole page.
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

export interface ChartDatum {
  name: string;
  Chats: number;
  Tickets: number;
  Calls: number;
  Refunds: number;
}

export default function StatisticsChart({ chartData, periodLabel }: { chartData: ChartDatum[]; periodLabel: string }) {
  return (
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
  );
}
