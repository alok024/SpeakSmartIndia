'use client';

/**
 * components/shared/EnglishJourneyChart.tsx
 *
 * Week-over-week fluency score line chart for the "English Journey" section
 * on the dashboard. Powered by recharts, same library used by ScoreHistoryChart.
 *
 * Design:
 *  - One dot per ISO-week, value = average fluency score for that week.
 *  - Baseline is the user's first week of Elara usage.
 *  - The chart only renders from week 2 onward (when there's a trend to show).
 *  - Uses the same CSS variables and visual language as ScoreHistoryChart.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { ElaraSessionRecord } from '@/features/elara/api';

interface WeekBucket {
  weekLabel: string; // e.g. "W23"
  avg:       number;
}

/**
 * Bucket elara sessions into ISO weeks and compute per-week average fluency.
 * Returns buckets oldest → newest.
 */
function bucketByWeek(sessions: ElaraSessionRecord[]): WeekBucket[] {
  const map = new Map<string, number[]>();

  for (const s of sessions) {
    if (s.fluency_score == null) continue;
    const d = new Date(s.created_at ?? Date.now());
    // ISO week key: YYYY-Www  (e.g. "2026-W23")
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86_400_000 + jan4.getDay() + 1) / 7);
    const key  = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    const arr  = map.get(key) ?? [];
    arr.push(s.fluency_score);
    map.set(key, arr);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, scores]) => ({
      weekLabel: key.split('-')[1], // "W23"
      avg:       Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10,
    }));
}

// ── Custom tooltip ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs border shadow-lg"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
    >
      <div className="font-bold mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div>
        Avg fluency:{' '}
        <span className="font-bold" style={{ color: 'var(--accent)' }}>{payload[0].value}/10</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function EnglishJourneyChart({ sessions }: { sessions: ElaraSessionRecord[] }) {
  const buckets = bucketByWeek(sessions);

  // Need at least 2 weeks of data to show a meaningful trend
  if (buckets.length < 2) return null;

  const baseline = buckets[0].avg;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          English Journey
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          Week-over-week fluency
        </span>
      </div>

      {/* Chart */}
      <div className="px-4 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={buckets} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="weekLabel"
              tick={{ fontSize: 10, fill: 'var(--text-3)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 10]}
              tick={{ fontSize: 10, fill: 'var(--text-3)' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Baseline reference line from first week */}
            <ReferenceLine
              y={baseline}
              stroke="var(--border2)"
              strokeDasharray="4 2"
              label={{
                value: `Baseline ${baseline}`,
                position: 'insideTopRight',
                fontSize: 9,
                fill: 'var(--text-3)',
              }}
            />
            <Line
              type="monotone"
              dataKey="avg"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: 'var(--accent)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
        Baseline set in {buckets[0].weekLabel} · {buckets.length} weeks tracked
      </div>
    </div>
  );
}
